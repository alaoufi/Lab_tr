const assert = require('node:assert/strict');
const { load, makeBridge } = require('./harness');
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.stack); }
}
function setup(kind = 'labs') {
  const b = makeBridge();
  b.upsertItem(kind, JSON.stringify({ id: 'a', name: 'First', trade_name: 'First', requirements: 'طلب مشترك\nتعليمات أولى', dosage: 'جرعة خاصة' }));
  b.upsertItem(kind, JSON.stringify({ id: 'b', name: 'Last', trade_name: 'Last', requirements: ' طلب  مشترك \nتعليمات ثانية' }));
  const c = load(b); c.Store.load(); c.showApp(); c.DB.cart[kind] = ['a', 'b']; c.Store.setCart(kind);
  return { c, b };
}
function recorder(c) {
  const draw = [], old = c.document.createElement;
  c.document.createElement = tag => {
    const e = old(tag);
    if (tag === 'canvas') {
      const ctx = e.getContext('2d');
      ctx.fillText = function (text, x, y) { draw.push({ text, x, y, color: this.fillStyle, font: this.font }); };
      ctx.measureText = function (s) { return { width: s.length * (this.font.startsWith('bold') ? 10 : 8) }; };
      e.getContext = () => ctx;
    }
    return e;
  };
  return draw;
}
test('requirements deduplicate identical lines, preserve order and distinct amounts', () => {
  const { c } = setup();
  assert.equal(c.requirementsFor('labs', ['a', 'b', 'missing']), 'طلب مشترك\nتعليمات أولى\nتعليمات ثانية');
  assert.equal(c.uniqueRequirements('صيام 8 ساعات\nصيام 12 ساعة\nصيام 8 ساعات\n\nA\nA.'), 'صيام 8 ساعات\nصيام 12 ساعة\nA\nA.');
});
test('medicines use explicit requirements and keep individual dosage separate', () => {
  const { c } = setup('meds');
  assert.ok(c.MED_FLD.some(f => f[0] === 'requirements'));
  const text = c.listText('meds', ['a', 'b'], 'Title');
  assert.equal(text.split('طلب مشترك').length - 1, 1);
  assert.ok(text.includes('جرعة خاصة') && text.indexOf('جرعة خاصة') < text.indexOf('متطلبات'));
});
test('selected explicit requirements move below items while details retain original fields', () => {
  const { c } = setup();
  const opt = c.sendOptions('labs', ['a', 'b']);
  const body = c.itemsHtml('labs', ['a', 'b'], opt);
  assert.ok(!body.includes('طلب مشترك'));
  assert.ok(c.outLines('labs', c.DB.labs[0]).some(l => l.v.includes('طلب مشترك')), 'detail fields retain source content');
  const html = c.docBody('Title', body, '', 'NOTE', opt);
  assert.ok(html.indexOf('rx-requirements') > html.indexOf('Last'));
  assert.ok(html.indexOf('rx-notes') > html.indexOf('rx-requirements'));
  assert.equal(html.split('طلب مشترك').length - 1, 1);
});
test('hidden requirements stay excluded from automatic output but explicit send edits still work', () => {
  for (const kind of ['labs', 'meds', 'imaging']) {
    const { c } = setup(kind); c.DB.out[kind] = c.DB.out[kind].filter(f => f !== 'requirements');
    assert.equal(c.requirementsFor(kind, ['a', 'b']), '');
    assert.ok(!c.listText(kind, ['a', 'b'], 'Title').includes('طلب مشترك'));
    assert.ok(c.listText(kind, ['a'], 'Title', '', '', { requirements: 'Explicit' }).includes('Explicit'));
  }
});
test('old medicine field settings gain only the new requirements field once and later hiding survives reload', () => {
  const { b } = setup('meds'); b._t.settings.out_meds = '["dosage"]'; b._t.settings.out_labs = '["code"]';
  b._t.settings.img_out_done = '1';
  let c = load(b); c.boot();
  assert.deepEqual(Array.from(c.DB.out.meds), ['dosage', 'requirements']);
  assert.ok(!c.DB.out.labs.includes('requirements'), 'do not restore hidden existing requirements');
  c.toggleOut('meds', 'requirements');
  c = load(b); c.boot(); assert.ok(!c.DB.out.meds.includes('requirements'));
  const backup = c.snapshot();
  assert.equal(backup.med_req_out_done, 1);
});
test('manual empty requirements hide the box; whitespace and notes remain optional', () => {
  const { c } = setup(); const opt = c.sendOptions('labs', ['a'], { requirements: ' \n ' });
  const html = c.docBody('Title', c.itemsHtml('labs', ['a'], opt), '', '', opt);
  assert.ok(!html.includes('rx-requirements') && !html.includes('rx-notes') && !html.includes('طلب مشترك'));
});
test('all output wrappers share dedup requirements, escaped styled notes and plain copy', () => {
  const { c } = setup(); const draw = recorder(c), out = {};
  c.AndroidBridge = { sharePdf: h => out.pdf = h, printHtml: h => out.print = h, copyText: t => out.copy = t, shareImageBase64: d => out.image = d };
  const opt = { requirements: 'Custom\nCustom\nEnd', notesColor: '#b91c1c', notesBold: true };
  for (const fn of ['pdfList', 'printList', 'copyList']) c[fn]('labs', ['a', 'b'], 'Title', '', '<NOTE>', opt);
  c.shareList('labs', ['a', 'b'], 'Title', 'Title', '', '<NOTE>', opt);
  for (const html of [out.pdf, out.print]) {
    assert.ok(html.includes('color:#b91c1c;font-weight:bold'));
    assert.ok(html.includes('&lt;NOTE&gt;'));
    assert.equal(html.split('Custom').length - 1, 1);
    assert.ok(!html.includes('طلب مشترك'));
  }
  assert.ok(out.copy.endsWith('Custom\nEnd\n\n<NOTE>'));
  assert.ok(!out.copy.includes('#b91c1c') && !out.copy.includes('**'));
  const note = draw.find(d => d.text === '<NOTE>');
  assert.equal(note.color, '#b91c1c'); assert.ok(note.font.startsWith('bold '));
  assert.ok(note.y > draw.find(d => d.text === 'End').y);
  assert.ok(out.image);
});
test('unsafe colors and malformed saved metadata cannot inject HTML or CSS', () => {
  const { c } = setup();
  for (const val of ['{"notesColor":"red;display:none","notesBold":"false"}', '{"notesColor":["#aabbcc"]}', 'broken JSON', null]) {
    const opt = c.sendOptions('labs', ['a'], val);
    assert.equal(opt.notesColor, '#0f172a'); assert.equal(opt.notesBold, false);
  }
  const opt = c.sendOptions('labs', ['a'], { requirements: '<img onerror=bad>', notesColor: '#ABCDEF', notesBold: true });
  const html = c.docBody('Title', 'BODY', '', '<b>text</b>', opt);
  assert.ok(!html.includes('<img') && !html.includes('<b>text'));
  assert.ok(html.includes('&lt;img onerror=bad&gt;') && html.includes('#abcdef'));
});
test('preview editing is per-send, retains focus, and survives stage navigation', () => {
  const { c, b } = setup(); const original = JSON.stringify(b._t.labs); c.previewCart('labs');
  let before = c._els('page').innerHTML;
  assert.ok(before.includes('id="pv-requirements"') && before.includes('id="pv-notes-color"') && before.includes('id="pv-notes-bold"'));
  c._els('pv-requirements').value = 'Edited\nEdited'; c.pvRequirements();
  c._els('pv-notes').value = 'All notes'; c.pvNotes();
  c._els('pv-notes-color').value = '#1d4ed8'; c._els('pv-notes-bold').checked = true; c.pvNoteStyle();
  assert.equal(c._els('page').innerHTML, before, 'editing must not rebuild focused fields');
  c.pvTab('paper'); const html = c._els('page').innerHTML;
  assert.ok(html.includes('color:#1d4ed8;font-weight:bold') && html.includes('Edited'));
  assert.equal(JSON.stringify(b._t.labs), original, 'source requirements unaffected');
});
test('automatic requirements track selection and order; edits persist with review hint and reset action', () => {
  const { c } = setup(); c.previewCart('labs'); c.pvTab('list'); c.pvPick('a');
  assert.equal(c.pvOptions().requirements, 'طلب  مشترك\nتعليمات ثانية');
  c.pvTab('details'); c._els('pv-requirements').value = 'Edited'; c.pvRequirements(); c.pvTab('list'); c.pvPick('a');
  assert.equal(c.pvOptions().requirements, 'Edited');
  c.pvTab('paper'); assert.ok(c._els('page').innerHTML.includes('تغيّرت العناصر'));
  c.pvResetRequirements(); assert.equal(c.pvOptions().requirements, 'طلب مشترك\nتعليمات أولى\nتعليمات ثانية');
  c.pvTab('list'); c.pvMove(0, 1);
  assert.equal(c.pvOptions().requirements, 'طلب  مشترك\nتعليمات ثانية\nتعليمات أولى');
});
test('saved send requirements and styles reopen after native reload and backup roundtrip', () => {
  const { c, b } = setup(); c.previewCart('labs');
  c._els('pv-requirements').value = 'Custom'; c.pvRequirements();
  c._els('pv-notes').value = 'Saved note'; c.pvNotes();
  c._els('pv-notes-color').value = '#b91c1c'; c._els('pv-notes-bold').checked = true; c.pvNoteStyle();
  c.pvTab('paper'); c.AndroidBridge = { copyText() {} }; c.pvSend('copy');
  const record = b._t.sent[0], meta = JSON.parse(record.send_options);
  assert.equal(meta.requirements, 'Custom'); assert.equal(meta.notesColor, '#b91c1c'); assert.equal(meta.notesBold, true);
  const b2 = makeBridge(); b2.replaceAll(b.loadAll());
  const reopened = load(b2); reopened.Store.load(); reopened.showApp(); reopened.sentOpen(record.id);
  assert.equal(reopened.PV.notes, 'Saved note'); assert.equal(reopened.pvOptions().requirements, 'Custom');
  assert.equal(reopened.pvOptions().notesColor, '#b91c1c'); assert.equal(reopened.pvOptions().notesBold, true);
  reopened.previewCart('labs'); assert.equal(reopened.pvOptions().notesBold, false);
});
test('legacy sent entries get current automatic requirements and default note formatting', () => {
  const { c } = setup(); c.DB.sent = [{ id: 'old', kind: 'labs', ids: ['a'], notes: 'Old note' }]; c.sentOpen('old');
  assert.equal(c.PV.notes, 'Old note'); assert.equal(c.pvOptions().requirements, 'طلب مشترك\nتعليمات أولى');
  assert.equal(c.pvOptions().notesColor, '#0f172a'); assert.equal(c.pvOptions().notesBold, false);
});
test('bold long notes and requirements wrap using their actual font without truncation', () => {
  const { c } = setup(); const draw = recorder(c), req = 'R'.repeat(420), note = 'N'.repeat(420);
  const canvas = c.buildCanvas('labs', ['a'], 'Title', {}, '', note, { requirements: req, notesBold: true });
  const nr = draw.filter(d => /^N+$/.test(d.text)), rr = draw.filter(d => /^R+$/.test(d.text));
  assert.equal(nr.map(d => d.text).join(''), note); assert.equal(rr.map(d => d.text).join(''), req);
  assert.ok(nr.every(d => d.text.length * 10 <= 822)); assert.ok(rr.every(d => d.text.length * 8 <= 822));
  assert.ok(nr.at(-1).y < canvas.height && nr[0].y > rr.at(-1).y);
});
test('requirements retain embedded image tokens across HTML, Canvas and plain text, including manual additions', () => {
  const { c } = setup();
  c.DB.images = [{ id: 'im1', code: 'instruction', name: 'تعليمات مصورة', data: 'data:image/png;base64,TEST' }];
  const options = { requirements: 'Prepare {instruction}\nPrepare {instruction}' };
  const normalized = c.sendOptions('labs', ['a'], options);
  const html = c.docBody('Title', c.itemsHtml('labs', ['a'], normalized), '', '', normalized);
  assert.ok(html.includes('<img') && !html.includes('{instruction}'));
  assert.ok(c.listText('labs', ['a'], 'Title', '', '', options).includes('[صورة: تعليمات مصورة]'));
  assert.deepEqual(Array.from(c.imgsUsed('labs', ['a'], options)), ['instruction']);
  const draw = recorder(c), imageCalls = [];
  const old = c.document.createElement;
  c.document.createElement = tag => { const el = old(tag); if (tag === 'canvas') el.getContext('2d').drawImage = (...args) => imageCalls.push(args); return el; };
  const pic = { naturalWidth: 200, naturalHeight: 100 };
  const image = c.buildCanvas('labs', ['a'], 'Title', { instruction: pic }, '', 'After image', options);
  assert.equal(imageCalls.length, 1);
  const imY = imageCalls[0][2], noteY = draw.find(d => d.text === 'After image').y;
  assert.ok(imY + 100 < noteY && noteY < image.height);
});
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
