/* ============================================================
   فحص نسخة احتياطية حقيقية — ثم **بروفة استيرادها**.

       node tools/check_backup.js <ملف-النسخة.json>

   يقرأ الملف ويعدّ ما فيه، ثم يبني تثبيتًا نظيفًا من `app.js` الحقيقي
   ويستورد الملف فيه ويعيد الإقلاع، ثم يقارن ما خرج بما دخل عنصرًا
   عنصرًا. الغاية واحدة: ألّا يُلغي أحدٌ تثبيته اعتمادًا على وعدٍ لم
   يُجرَّب على ملفه هو.

   لا يطبع محتوى العناصر ولا أسماء المرضى — أعدادًا وأسماء حقولٍ فقط.
   ============================================================ */
const fs = require('fs');
const { makeBridge, load } = require('./harness');

const file = process.argv[2];
if (!file) { console.error('الاستعمال: node tools/check_backup.js <ملف.json>'); process.exit(2); }

let data;
try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (e) { console.error('✗ الملف غير صالح كـJSON: ' + e.message); process.exit(1); }

let bad = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) bad++; };
const n = v => (Array.isArray(v) ? v.length : 0);

/* ── ١. ما في الملف ───────────────────────────────────────────── */
console.log('\n── ما في الملف ──────────────────────────────');
const secs = Array.isArray(data.sections) ? data.sections : [];
const kinds = secs.map(s => s.id);
secs.forEach(s => {
  console.log('  ' + (s.icon || '') + ' ' + s.title + ' — ' + n(data[s.id]) + ' عنصرًا');
});
console.log('  التصنيفات: ' + n(data.cats)
  + ' | الحقول الإضافية: ' + n(data.fields)
  + ' | المجموعات: ' + n(data.groups)
  + ' | الصور: ' + n(data.images)
  + ' | سجل الإرسال: ' + n(data.sent));
const hdr = data.header || {};
console.log('  الترويسة: ' + (hdr.name || hdr.title || hdr.contact ? 'مملوءة' : 'فارغة')
  + ' | القفل: ' + (data.pin_hash ? 'موجود' : 'لا يوجد'));

/* ── ٢. سلامة ما في الملف نفسه ────────────────────────────────── */
console.log('\n── سلامة الملف ──────────────────────────────');
ok(secs.length > 0, 'فيه أقسام');
const ids = {};
let dupes = 0, noId = 0;
kinds.forEach(k => (data[k] || []).forEach(o => {
  if (!o || !o.id) { noId++; return; }
  if (ids[o.id]) dupes++; else ids[o.id] = k;
}));
ok(noId === 0, 'كل عنصر له معرّف' + (noId ? ' (' + noId + ' بلا معرّف)' : ''));
ok(dupes === 0, 'لا معرّفات مكرّرة' + (dupes ? ' (' + dupes + ')' : ''));

const catNames = {};
(data.cats || []).forEach(c => { catNames[c.kind + '\u0000' + c.name] = 1; });
let orphanCat = 0;
kinds.forEach(k => (data[k] || []).forEach(o => {
  if (o.category && !catNames[k + '\u0000' + o.category]) orphanCat++;
}));
ok(orphanCat === 0, 'كل عنصر تصنيفُه معروف'
  + (orphanCat ? ' (' + orphanCat + ' تصنيفه غير مسجَّل — يظهر تحت «غير مصنّف»)' : ''));

let ghost = 0;
(data.groups || []).forEach(g => (g.items || []).forEach(id => { if (!ids[id]) ghost++; }));
ok(ghost === 0, 'عناصر المجموعات كلها موجودة'
  + (ghost ? ' (' + ghost + ' معرّفًا لا عنصر له — يُرشَّح تلقائيًّا)' : ''));

const fkeys = {};
(data.fields || []).forEach(f => { fkeys[f.kind + '\u0000' + f.key] = f.label; });
let lostVals = 0;
kinds.forEach(k => (data[k] || []).forEach(o => {
  Object.keys((o && o.extra) || {}).forEach(key => {
    if (!fkeys[k + '\u0000' + key]) lostVals++;
  });
}));
ok(lostVals === 0, 'قيم الحقول الإضافية كلها لها حقولٌ معرَّفة'
  + (lostVals ? ' (' + lostVals + ' قيمة بلا حقل — لن تظهر)' : ''));

/* ── ٣. بروفة الاستيراد في التطبيق الحقيقي ────────────────────── */
console.log('\n── بروفة الاستيراد (app.js الحقيقي) ─────────');
const b = makeBridge();
const c = load(b);
c.boot();                                   // تثبيتٌ نظيف بالإصدار الحالي

const fake = { files: [{}] };
c.FileReader = function () {
  return {
    readAsText() { this.result = JSON.stringify(data); this.onload.call(this); },
    set onload(f) { this._f = f; }, get onload() { return this._f; }
  };
};
c.vm = null;
require('./harness').vm.runInContext('window.FileReader = FileReader;', c);
c.importBackup(fake);
c._els('dz-in').value = 'استبدال'; c.dzCheck();
const yes = c._els('cb-yes');
ok(typeof yes.onclick === 'function', 'التطبيق قبِل الملف وطلب التأكيد');
if (typeof yes.onclick === 'function') yes.onclick();

const c2 = load(b); c2.boot();              // إعادة فتحٍ بعد الاستيراد

kinds.forEach(k => {
  const want = n(data[k]), got = n(c2.DB[k]);
  if (want === 0 && got === 0) return;
  const title = (secs.find(s => s.id === k) || {}).title || k;
  ok(got === want, title + ': ' + got + '/' + want + ' عنصرًا');
});

secs.forEach(s => ok(!!c2.secOf(s.id), 'القسم «' + s.title + '» موجود بعد الاستيراد'));

ok(c2.DB.cats.filter(x => kinds.indexOf(x.kind) >= 0).length >= n(data.cats),
   'التصنيفات: ' + c2.DB.cats.filter(x => kinds.indexOf(x.kind) >= 0).length + '/' + n(data.cats));
ok(c2.DB.fields.filter(f => kinds.indexOf(f.kind) >= 0).length === n(data.fields),
   'الحقول الإضافية: ' + c2.DB.fields.filter(f => kinds.indexOf(f.kind) >= 0).length + '/' + n(data.fields));
ok(c2.DB.groups.length === n(data.groups), 'المجموعات: ' + c2.DB.groups.length + '/' + n(data.groups));
ok(c2.DB.images.length === n(data.images), 'الصور: ' + c2.DB.images.length + '/' + n(data.images));
ok(c2.DB.sent.length === n(data.sent), 'سجل الإرسال: ' + c2.DB.sent.length + '/' + n(data.sent));

// قيم الحقول الإضافية — أكثر ما يضيع بصمت
let valsIn = 0, valsOut = 0;
kinds.forEach(k => {
  (data[k] || []).forEach(o => { valsIn += Object.keys((o && o.extra) || {}).length; });
  (c2.DB[k] || []).forEach(o => { valsOut += Object.keys((o && o.extra) || {}).length; });
});
ok(valsOut === valsIn, 'قيم الحقول الإضافية: ' + valsOut + '/' + valsIn);

// المجموعات بمحتواها لا باسمها فقط
let gIn = 0, gOut = 0;
(data.groups || []).forEach(g => { gIn += n(g.items); });
c2.DB.groups.forEach(g => { gOut += n(g.items); });
ok(gOut === gIn, 'عناصر داخل المجموعات: ' + gOut + '/' + gIn);

ok(JSON.stringify(c2.DB.header) === JSON.stringify({
  name: hdr.name || '', title: hdr.title || '', contact: hdr.contact || ''
}), 'الترويسة كما كانت');
ok((c2.DB.pin_hash || null) === (data.pin_hash || null), 'رمز القفل كما كان');

kinds.forEach(k => {
  if (!data.out || !data.out[k]) return;
  ok(JSON.stringify(c2.DB.out[k]) === JSON.stringify(data.out[k]),
     'الحقول المرسلة في «' + ((secs.find(s => s.id === k) || {}).title || k) + '» كما ضبطتَها');
});

// وما تجلبه النسخة الجديدة فوق ذلك
if (c2.secOf('sec_dir')) {
  console.log('\n  + يصلك «📇 دليل العناوين» بتصنيفاته الأربعة وحقل الموقع.');
}

console.log('\n' + (bad ? '✗ ' + bad + ' ملاحظة تحتاج نظرًا' : '✅ كل ما في الملف عبَر سليمًا — الاستيراد آمن'));
process.exit(bad ? 1 : 0);
