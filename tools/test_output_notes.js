/* Output notes and the three sending stages. Run: node tools/test_output_notes.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { load, makeBridge } = require('./harness');
let passed = 0, failed = 0;
function run(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}
function setup() {
  const b = makeBridge();
  b.upsertItem('labs', JSON.stringify({ id: 'first', name: 'First item', code: 'FIRST' }));
  b.upsertItem('labs', JSON.stringify({ id: 'last', name: 'Last item', code: 'LAST' }));
  const c = load(b); c.Store.load(); c.showApp();
  c.DB.cart.labs = ['first', 'last'];
  return { c, b };
}
function canvasRecorder(c) {
  const draws = [];
  const old = c.document.createElement;
  c.document.createElement = function (tag) {
    const el = old(tag);
    if (tag === 'canvas') {
      const ctx = el.getContext('2d');
      ctx.fillText = function (text, x, y) { draws.push({ text, x, y, align: this.textAlign }); };
      ctx.drawImage = function () {};
      el.getContext = function () { return ctx; };
    }
    return el;
  };
  return draws;
}
function android(c) {
  const out = { pdf: [], print: [], copy: [], image: [] };
  c.AndroidBridge = {
    sharePdf: function (html) { out.pdf.push(html); },
    printHtml: function (html) { out.print.push(html); },
    copyText: function (text) { out.copy.push(text); },
    shareImageBase64: function (data) { out.image.push(data); }
  };
  return out;
}

run('HTML notes follow every item, escape markup and preserve multiline text', function () {
  const { c } = setup();
  const html = c.docBody('Title', c.itemsHtml('labs', ['first', 'last']), 'Person', '<script>x</script>\nsecond & final');
  assert.ok(html.includes('class="rx-notes"'));
  assert.ok(html.indexOf('class="rx-notes"') > html.indexOf('Last item'));
  assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;\nsecond &amp; final'));
  assert.ok(!html.includes('<script>'));
  assert.match(c.printCss('', false), /\.rx-notes\{[^}]*white-space:pre-wrap/);
});
run('empty or whitespace-only notes add no HTML or text or image height', function () {
  const { c } = setup();
  for (const notes of ['', ' \t\r\n ', null, undefined]) {
    assert.equal(c.docBody('Title', 'BODY', '', notes), c.docBody('Title', 'BODY', ''));
    assert.equal(c.listText('labs', ['first'], 'Title', '', notes), c.listText('labs', ['first'], 'Title', ''));
    assert.equal(c.buildCanvas('labs', ['first'], 'Title', {}, '', notes).height,
      c.buildCanvas('labs', ['first'], 'Title', {}, '').height);
  }
});
run('copied text has notes at the very end with original line breaks', function () {
  const { c } = setup();
  const text = c.listText('labs', ['first', 'last'], 'Title', '', 'First note\nآخر ملاحظة');
  assert.ok(text.endsWith('First note\nآخر ملاحظة'));
  assert.ok(text.indexOf('First note') > text.indexOf('Last item'));
});
run('image reserves room and draws every note line after all item content', function () {
  const { c } = setup(); const draw = canvasRecorder(c);
  const plain = c.buildCanvas('labs', ['first', 'last'], 'Title', {}, '');
  draw.length = 0;
  const image = c.buildCanvas('labs', ['first', 'last'], 'Title', {}, '', 'First note\nآخر ملاحظة');
  const lastItem = draw.find(d => d.text === 'LAST — Last item');
  const firstNote = draw.find(d => d.text === 'First note');
  const lastNote = draw.find(d => d.text === 'آخر ملاحظة');
  assert.ok(firstNote && lastNote);
  assert.ok(firstNote.y > lastItem.y && lastNote.y > firstNote.y);
  assert.ok(image.height > plain.height && lastNote.y < image.height);
});
run('long unbroken notes wrap within the image and preserve the complete token', function () {
  const { c } = setup(); const draw = canvasRecorder(c);
  const notes = 'https://example.com/' + 'a'.repeat(400);
  c.buildCanvas('labs', ['first'], 'Title', {}, '', notes);
  const first = draw.findIndex(d => d.text.startsWith('https://example.com/'));
  assert.ok(first >= 0);
  const lines = draw.slice(first).map(d => d.text);
  assert.ok(lines.length > 1, 'long token is split across lines');
  assert.ok(lines.every(line => line.length * 8 <= 822), 'every note line fits the available width');
  assert.equal(lines.join(''), notes, 'no characters are dropped or invented');
});
run('oversized tokens keep surrogate pairs intact and normal whitespace/newlines still wrap', function () {
  const { c } = setup();
  const ctx = { measureText: function (text) { return { width: text.length * 8 }; } };
  const token = 'A😀🧪B'.repeat(20);
  const lines = Array.from(c.wrapText(ctx, token, 24));
  assert.ok(lines.every(line => line.length * 8 <= 24));
  assert.equal(lines.join(''), token);
  assert.ok(lines.every(line => !/[\uD800-\uDBFF]$/.test(line) && !/^[\uDC00-\uDFFF]/.test(line)), 'no split surrogate pairs');
  assert.deepEqual(Array.from(c.wrapBlock(ctx, 'one  two\tthree\n\nfour five', 72)), ['one two', 'three', '', 'four five']);
});
run('enabled output titles are centered in HTML and image', function () {
  const { c } = setup(); c.DB.showTitle = 1; const draw = canvasRecorder(c);
  assert.match(c.printCss('', false), /h1\{[^}]*text-align:center/);
  c.buildCanvas('labs', ['first'], 'Centered title', {}, '');
  const title = draw.find(d => d.text === 'Centered title');
  assert.equal(title.align, 'center'); assert.equal(title.x, 450);
});
run('all four direct output wrappers carry the optional notes argument', function () {
  const { c } = setup(); const out = android(c), draw = canvasRecorder(c);
  const notes = 'Wrapper trailing note';
  c.pdfList('labs', ['first'], 'Title', '', notes);
  c.printList('labs', ['first'], 'Title', '', notes);
  c.copyList('labs', ['first'], 'Title', '', notes);
  c.shareList('labs', ['first'], 'Title', 'Image title', '', notes);
  assert.ok(out.pdf[0].includes(notes)); assert.ok(out.print[0].includes(notes));
  assert.ok(out.copy[0].endsWith(notes)); assert.ok(draw.some(d => d.text === notes));
  assert.equal(out.image.length, 1);
});
run('preselected sending starts at details; only final preview has send buttons', function () {
  const { c } = setup(); c.previewCart('labs');
  assert.equal(c.PV_TAB, 'details');
  let html = c._els('page').innerHTML;
  assert.ok(html.includes('id="pv-who"') && html.includes('id="pv-notes"'));
  assert.ok(!html.includes('onclick="pvSend('));
  assert.ok(html.includes('اختيار العناصر') && html.includes('بيانات الإرسال') && html.includes('المعاينة والإرسال'));
  c.pvTab('list'); html = c._els('page').innerHTML;
  assert.ok(html.includes('pvPick(') && !html.includes('onclick="pvSend('));
  assert.ok(!html.includes('onclick="pvKeepOrder()"'), 'send selection does not edit the saved section order');
  c.pvTab('paper'); html = c._els('page').innerHTML;
  assert.ok(html.includes('class="paper"') && html.includes('onclick="pvSend('));
  assert.ok(!html.includes('id="pv-who"') && !html.includes('id="pv-notes"'));
});
run('recipient typing does not rerender and survives every stage and format', function () {
  const { c } = setup(); c.previewCart('labs');
  const before = c._els('page').innerHTML;
  c._els('pv-who').value = 'سعد'; c.pvWho();
  c._els('pv-notes').value = 'سطر أول\nسطر ثان'; c.pvNotes();
  assert.equal(c._els('page').innerHTML, before);
  assert.equal(c.PV.who, 'سعد'); assert.equal(c.PV.notes, 'سطر أول\nسطر ثان');
  c.pvTab('list'); c.pvPick('first'); c.pvTab('details'); c.pvTab('paper');
  assert.ok(c._els('page').innerHTML.includes('سطر أول\nسطر ثان'));
  c.pvTab('img'); assert.ok(c._els('pv-img').innerHTML.includes('data:image/png;base64,'));
  assert.equal(c.PV.who, 'سعد'); assert.equal(c.PV.notes, 'سطر أول\nسطر ثان');
  assert.deepEqual(Array.from(c.pvOn()), ['last']);
});
run('preview send includes notes and persists them across reload and history reopen', function () {
  const { c, b } = setup(); const out = android(c); c.previewCart('labs');
  c._els('pv-who').value = 'سعد'; c.pvWho();
  c._els('pv-notes').value = 'Saved note\nsecond line'; c.pvNotes(); c.pvTab('paper');
  c.pvSend('pdf'); c.pvSend('print'); c.pvSend('copy');
  assert.ok(out.pdf[0].includes('Saved note')); assert.ok(out.print[0].includes('Saved note'));
  assert.ok(out.copy[0].endsWith('Saved note\nsecond line'));
  assert.equal(b._t.sent[0].notes, 'Saved note\nsecond line');
  const reopened = load(b); reopened.Store.load(); reopened.showApp(); reopened.sentOpen(b._t.sent[0].id);
  assert.equal(reopened.PV.notes, 'Saved note\nsecond line'); assert.equal(reopened.PV.who, 'سعد');
  assert.equal(reopened.PV_TAB, 'details');
});
run('a new send clears recipient details and legacy sent records default to no notes', function () {
  const { c } = setup(); c.previewCart('labs'); c.PV.who = 'Old'; c.PV.notes = 'Old note';
  c.previewCart('labs'); assert.equal(c.PV.who, ''); assert.equal(c.PV.notes, '');
  c.DB.sent = [{ id: 'old', kind: 'labs', ids: ['first'], who: 'Legacy', title: 'Old title', ts: 1 }];
  c.sentOpen('old'); assert.equal(c.PV.notes, ''); assert.equal(c.PV.who, 'Legacy');
});
run('cannot advance from an empty selection', function () {
  const { c } = setup(); c.previewCart('labs'); c.pvTab('list'); c.pvAll(0); c.pvTab('details');
  assert.equal(c.PV_TAB, 'list');
});
run('native schema adds nullable notes safely to old records and fresh installs', function () {
  const file = path.join(__dirname, '..', 'app/src/main/java/me/alaoufi/dalili/DaliliDb.java');
  const java = fs.readFileSync(file, 'utf8');
  assert.ok(/DB_VERSION = 12;/.test(java), 'schema version is 12');
  const create = java.match(/private void createSent\(SQLiteDatabase db\) \{([\s\S]*?)\n    \}/)[1];
  const sql = Array.from(create.matchAll(/db\.execSQL\(([\s\S]*?)\);/g), m =>
    Array.from(m[1].matchAll(/"((?:\\.|[^"\\])*)"/g), p => JSON.parse('"' + p[1] + '"')).join(''));
  const fresh = new DatabaseSync(':memory:'); sql.forEach(s => fresh.exec(s));
  assert.ok(fresh.prepare('PRAGMA table_info(sent)').all().some(c => c.name === 'notes' && c.notnull === 0));
  const old = new DatabaseSync(':memory:');
  old.exec('CREATE TABLE sent(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT,who TEXT,item_ids TEXT NOT NULL,ts INTEGER NOT NULL)');
  old.prepare('INSERT INTO sent VALUES(?,?,?,?,?,?)').run('keep', 'labs', 'Title', 'Patient', '["first"]', 123);
  const upgrade = java.match(/if \(oldVersion < 11\) \{([\s\S]*?)\n        \}/);
  assert.ok(upgrade, 'upgrade step exists');
  const columns = upgrade[1].match(/addCols\(db, "sent", new String\[\]\{([^}]+)\}, "TEXT"\)/);
  assert.ok(columns, 'upgrade uses idempotent additive helper');
  for (let pass = 0; pass < 2; pass++) {
    for (const column of Array.from(columns[1].matchAll(/"([^"]+)"/g), m => m[1])) {
      if (!old.prepare('PRAGMA table_info(sent)').all().some(c => c.name === column)) old.exec('ALTER TABLE sent ADD COLUMN ' + column + ' TEXT');
    }
  }
  const record = old.prepare('SELECT * FROM sent').get();
  assert.equal(record.id, 'keep'); assert.equal(record.who, 'Patient'); assert.equal(record.item_ids, '["first"]'); assert.equal(record.notes, null);
  old.prepare('UPDATE sent SET notes=? WHERE id=?').run('Line one\nالسطر الثاني', 'keep');
  assert.equal(old.prepare('SELECT notes FROM sent').get().notes, 'Line one\nالسطر الثاني');
  const repair = java.match(/void ensureSchema\(SQLiteDatabase db\) \{([\s\S]*?)\n    \}/)[1];
  assert.match(repair, /addCols\(db, "sent", new String\[\]\{[^}]*"notes"/);
  assert.match(java, /o\.put\("notes", str\(c, "notes"\)\)/);
  assert.match(java, /v\.put\("notes", o\.optString\("notes", ""\)\)/);
  fresh.close(); old.close();
});
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
