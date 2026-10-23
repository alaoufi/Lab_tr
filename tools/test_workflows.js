const assert = require('node:assert/strict');
const { makeBridge, load } = require('./harness');
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('✓ ' + name); }
  catch (error) { console.error('✗ ' + name + ': ' + error.message); process.exitCode = 1; }
}
function app() { const bridge = makeBridge(); const c = load(bridge); c.boot(); return { c, bridge }; }

test('tabs isolate manual entry, library, organization and sending', () => {
  const { c, bridge } = app();
  c.goSectionTab('labs', 'manual');
  assert.equal(c.mode(), 'edit');
  assert.match(c._els('page').innerHTML, /إضافة عنصر/);
  assert.doesNotMatch(c._els('page').innerHTML, /goPage\('sort:|goPage\('fld:|openLibrary\(/);
  c._els('lf-name').value = 'Workflow test'; c.labSave('');
  assert.equal(bridge._t.labs.length, 1);
  assert.equal(c.mode(), 'edit', 'saving must stay in manual entry');
  assert.equal(c.curPage(), 'manual:labs');
  c.goSectionTab('labs', 'library');
  assert.equal(c.curPage(), 'lib:labs');
  assert.match(c._els('page').innerHTML, /إضافة المحدد/);
  c.goSectionTab('labs', 'organize');
  assert.match(c._els('page').innerHTML, /التصنيفات/);
  assert.match(c._els('page').innerHTML, /حقول الإرسال/);
  c.goSectionTab('labs', 'send');
  assert.equal(c.mode(), 'send');
  assert.match(c._els('page').innerHTML, /type="checkbox"/);
  assert.doesNotMatch(c._els('page').innerHTML, /➕ إضافة عنصر|itemMove\(/);
  assert.match(c._els('section-tabs').innerHTML, /aria-current="page"[^>]*>[\s\S]*نسخة الإرسال/);
  assert.equal(bridge._t.labs.length, 1);
});

test('switching tabs keeps selection and does not grow the back stack', () => {
  const { c } = app();
  c.goSectionTab('labs', 'manual');
  c._els('lf-name').value = 'CBC'; c.labSave('');
  c.goSectionTab('labs', 'send');
  c.toggleCart('labs', c.DB.labs[0].id);
  c.goSectionTab('labs', 'organize');
  c.goPage('cat:labs');
  c.goSectionTab('labs', 'manual');
  assert.equal(c.DB.cart.labs.length, 1);
  assert.equal(c.NAV.length, 2);
  c.goBack();
  assert.equal(c.curPage(), 'home');
});

test('back navigation restores route-specific editing behavior', () => {
  const { c } = app();
  c.goSectionTab('labs', 'manual');
  c.goSectionTab('meds', 'send');
  c.goBack();
  assert.equal(c.mode(), 'edit');
  assert.match(c._els('page').innerHTML, /إضافة عنصر/);
});

test('tabs remain available in categories, fields and sending preview', () => {
  const { c } = app();
  c.goSectionTab('labs', 'manual');
  c._els('lf-name').value = 'CBC'; c.labSave('');
  ['cat:labs', 'fld:labs'].forEach(route => {
    c.goPage(route);
    assert.match(c._els('section-tabs').innerHTML, /الترتيب والإدارة/);
    assert.equal(c._els('section-tabs').style.display, '');
  });
  c.openPreview('labs', [c.DB.labs[0].id], 'قائمة');
  assert.match(c._els('section-tabs').innerHTML, /نسخة الإرسال/);
  c.goHome();
  assert.equal(c._els('section-tabs').style.display, 'none');
  assert.doesNotMatch(c._els('page').innerHTML, /class="modebar"/);
});

test('sections without a library offer manual entry without a missing-file error', () => {
  const { c } = app();
  c.goSectionTab('recipes', 'library');
  assert.match(c._els('page').innerHTML, /لا توجد مكتبة جاهزة لهذا القسم/);
  assert.match(c._els('page').innerHTML, /goSectionTab/);
  assert.doesNotMatch(c._els('page').innerHTML, /ملف library.js مفقود/);
});

test('invalid tabs and unknown sections do not alter navigation', () => {
  const { c } = app();
  c.goSectionTab('missing', 'manual');
  c.goSectionTab('labs', 'missing');
  assert.equal(c.curPage(), 'home');
});
test('legacy drawer entries still choose the requested mode after explicit tabs', () => {
  const { c } = app();
  c.goSectionTab('labs', 'manual');
  c.dwGo('meds', 'edit');
  assert.equal(c.mode(), 'edit');
  assert.match(c._els('page').innerHTML, /إضافة عنصر/);
  c.goSectionTab('labs', 'send');
  c.dwGo('meds', 'send');
  assert.equal(c.mode(), 'send');
});
test('reading item details from sending offers editing without deletion or duplication', () => {
  const { c } = app();
  c.goSectionTab('labs', 'manual');
  c._els('lf-name').value = 'Read only item'; c.labSave('');
  const id = c.DB.labs[0].id;
  c.DB.compact = 1;
  c.goSectionTab('labs', 'send');
  assert.match(c._els('page').innerHTML, /view-send:labs:/);
  c.goPage('view-send:labs:' + id);
  assert.match(c._els('page').innerHTML, /Read only item/);
  assert.match(c._els('page').innerHTML, /تعديل البيانات/);
  assert.doesNotMatch(c._els('page').innerHTML, /delOpen\(|dupItem\(/);
  assert.equal(c.sectionContext(c.curPage()).tab, 'send');
  c.goBack();
  assert.equal(c.curPage(), 'send:labs');
});
console.log(passed + ' workflow tests passed');
