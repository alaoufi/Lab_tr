const assert = require('node:assert/strict');
const { makeBridge, load, vm } = require('./harness');
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { process.exitCode = 1; console.error('FAIL ' + name + ': ' + error.message); }
}
const kinds = ['meds', 'labs', 'imaging', 'recipes', 'sec_dir', 'sec_custom'];
const prefixes = { meds: 'mf', labs: 'lf', imaging: 'if', recipes: 'rf' };
const saves = { meds: 'medSave', labs: 'labSave', imaging: 'imgSave', recipes: 'recipeSave' };
function fixture(kind) {
  const bridge = makeBridge();
  bridge._t.sections.push({ id: 'sec_custom', title: 'قسم تجريبي', singular: 'عنصر', icon: '📋' });
  const c = load(bridge); c.boot();
  const record = { id: 'saved-' + kind, category: 'تصنيف محفوظ', img: '', extra: { memo: 'قيمة محفوظة' } };
  record[c.nameKey(kind)] = 'عنصر محفوظ';
  c.DB.fields.push({ id: 'field-' + kind, kind, key: 'memo', label: 'حقل محفوظ', type: 'text' });
  c.Store.saveField(c.DB.fields[c.DB.fields.length - 1]);
  c.coll(kind).push(record); c.Store.upsert(kind, record);
  c.toggleCart(kind, record.id);
  c.DB.groups.push({ id: 'group-' + kind, kind, name: 'مجموعة محفوظة', items: [record.id] });
  c.Store.saveGroup(c.DB.groups[c.DB.groups.length - 1]);
  return { c, bridge, record };
}
function clickEdit(c) {
  const buttons = [...c._els('page').innerHTML.matchAll(/<button\b[^>]*onclick="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)];
  const edit = buttons.find(button => button[2].includes('تعديل البيانات'));
  assert.ok(edit, 'a visible text button must identify editing');
  vm.runInContext(edit[1], c);
  assert.match(c._els('modal-title').innerHTML + c._els('modal-body').innerHTML, /عنصر محفوظ/);
}

test('every section exposes a named edit action in manual and sending lists, including compact lists', () => {
  for (const kind of kinds) {
    for (const tab of ['manual', 'send']) {
      for (const compact of [0, 1]) {
        const { c, bridge } = fixture(kind);
        const before = JSON.stringify(bridge._t);
        c.DB.compact = compact; c.goSectionTab(kind, tab);
        assert.match(c._els('section-tabs').innerHTML, /إضافة وتعديل/);
        clickEdit(c);
        assert.match(c._els('modal-body').innerHTML, /قيمة محفوظة/);
        c.closeModal();
        assert.equal(JSON.stringify(bridge._t), before, 'opening/cancelling must not change stored data');
        assert.equal(c.curPage(), (tab === 'manual' ? 'manual:' : 'send:') + kind);
      }
    }
  }
});

test('details opened from sending expose editing without exposing deletion or duplication', () => {
  for (const kind of kinds) {
    const { c, record } = fixture(kind);
    c.goPage('view-send:' + kind + ':' + record.id);
    assert.doesNotMatch(c._els('page').innerHTML, /delOpen\(|dupItem\(/);
    clickEdit(c);
  }
});

test('editing saves the existing item and stays on its originating list or detail page in every section', () => {
  for (const kind of kinds) {
    for (const route of ['send:', 'manual:', 'view-send:', 'view:']) {
      const { c, bridge, record } = fixture(kind);
      const page = route + kind + (route.startsWith('view') ? ':' + record.id : '');
      c.goPage(page);
      const navBefore = Array.from(c.NAV);
      c.editOpen(kind, record.id);
      const prefix = prefixes[kind] || 'cf';
      c._els(prefix + '-' + c.nameKey(kind)).value = 'عنصر بعد التعديل';
      c._els(prefix + '-category').value = record.category;
      c._els(prefix + '-x-memo').value = record.extra.memo;
      if (saves[kind]) c[saves[kind]](record.id); else c.secItemSave(kind, record.id);
      assert.equal(c.curPage(), page, 'save must return to the same page: ' + page);
      assert.deepEqual(Array.from(c.NAV), navBefore, 'save must not add an unexpected navigation entry');
      const reopened = load(bridge); reopened.boot();
      const rows = reopened.coll(kind);
      assert.equal(rows.length, 1, 'edit must not create a duplicate');
      assert.equal(rows[0].id, record.id);
      assert.equal(rows[0][c.nameKey(kind)], 'عنصر بعد التعديل');
      assert.equal(rows[0].category, 'تصنيف محفوظ');
      assert.equal(rows[0].extra.memo, 'قيمة محفوظة');
      assert.deepEqual(Array.from(reopened.DB.cart[kind]), [record.id]);
      assert.deepEqual(Array.from(reopened.DB.groups.find(g => g.id === 'group-' + kind).items), [record.id]);
    }
  }
});

test('cancelling a group addition cannot redirect or capture a later edit', () => {
  const { c, bridge, record } = fixture('labs');
  c.groupOpen('group-labs'); c.groupAddNew(); c.closeModal();
  c.goSectionTab('labs', 'send'); c.editOpen('labs', record.id);
  const groupsBefore = JSON.stringify(bridge._t.groups);
  c._els('lf-name').value = 'تعديل بعد الإلغاء';
  c.labSave(record.id);
  assert.equal(c.curPage(), 'send:labs');
  assert.equal(c.GRP_CATCH, null);
  assert.equal(JSON.stringify(bridge._t.groups), groupsBefore);
  assert.equal(bridge._t.labs[0].name, 'تعديل بعد الإلغاء');
});

test('an unsuccessful edit keeps the form open and preserves its originating send route', () => {
  const { c, bridge, record } = fixture('labs');
  c.goSectionTab('labs', 'send'); c.editOpen('labs', record.id);
  c._els('lf-name').value = 'تعديل لم يحفظ';
  bridge.upsertItem = () => false;
  c.labSave(record.id);
  assert.equal(c.curPage(), 'send:labs');
  assert.equal(c._els('lf-name').value, 'تعديل لم يحفظ');
  assert.equal(bridge._t.labs[0].name, 'عنصر محفوظ');
  assert.equal(c._els('modal-bg').className, 'modal-bg on');
});
console.log(passed + ' edit-access tests passed');
