/* ============================================================
   دليلي — أداة شخصية للعلاجات والتحاليل
   كل البيانات محلية على الجهاز فقط — لا خادم ولا إنترنت.
   التخزين داخل التطبيق (APK): قاعدة بيانات SQLite محلية عبر جسر NativeDb.
   عند فتح الملفات في متصفح عادي (بلا الجسر): localStorage كبديل.
   ============================================================ */
'use strict';

var KEY = 'clinic_tool_v1';   /* تخزين الإصدارات السابقة — يُستخدم للترحيل والبديل */
/** الأقسام الأصلية الأربعة — لها جداولها وحقولها المكتوبة في الكود. */
var BUILTIN = ['meds', 'labs', 'imaging', 'recipes'];
/** أقسام هذه النسخة من البيانات (الأصلية + ما أنشأه المستخدم) — يُملأ في applyData. */
var KINDS = BUILTIN.slice();
var DB = { pin_hash: null, meds: [], labs: [], imaging: [], recipes: [],
           cart: { meds: [], labs: [], imaging: [], recipes: [] },
           cats: [], groups: [], sections: [], fields: [], out: null };
/* DB.out يُملأ في applyData — انظر OUT_DEF أدناه */

/* الحقول التي يمكن إظهارها في الطباعة/الصورة المُرسَلة. اسم العلاج واسم
   التحليل يظهران دائمًا، فليسا ضمن القائمة. */
var OUT_MEDS = [
  ['scientific_name', 'الاسم العلمي'],
  ['category', 'التصنيف'],
  ['concentration', 'التركيز'],
  ['dosage', 'الجرعات'],
  ['duration', 'مدة الاستخدام'],
  ['uses', 'الاستخدامات'],
  ['cautions', 'المحاذير'],
  ['notes', 'ملاحظات']
];
var OUT_LABS = [
  ['code', 'رمز التحليل (المصطلح)'],
  ['category', 'التصنيف (التخصص)'],
  ['purpose', 'الهدف من التحليل'],
  ['requirements', 'متطلبات التحليل'],
  ['prohibitions', 'ممنوعات التحليل']
];
var OUT_IMAGING = [
  ['category', 'نوع الفحص'],
  ['region', 'المنطقة أو العضو'],
  ['purpose', 'الهدف من الفحص'],
  ['requirements', 'التحضير المطلوب'],
  ['prohibitions', 'موانع الإجراء']
];
var OUT_RECIPES = [
  ['category', 'التصنيف'],
  ['type', 'نوع الوصفة'],
  ['purpose', 'الهدف'],
  ['ingredients', 'المواد المستخدمة'],
  ['preparation', 'طريقة الإعداد'],
  ['usage', 'الاستخدام'],
  ['dose', 'الجرعة'],
  ['duration', 'مدة الاستخدام'],
  ['effects', 'الأعراض المتوقعة'],
  ['precautions', 'الاحتياطات']
];
var OUT_DEF = {
  meds: ['dosage', 'uses'],
  labs: ['code', 'requirements'],
  imaging: ['region', 'requirements'],
  recipes: ['ingredients', 'preparation', 'dose']
};
var OUT_ALL = { meds: OUT_MEDS, labs: OUT_LABS, imaging: OUT_IMAGING, recipes: OUT_RECIPES };
/**
 * الحقول القابلة للإرسال في قسم: الأصلية المكتوبة في الكود، ثم ما عرّفه
 * المستخدم. حقول المستخدم تُسبَق بـ«x:» فيعرف `outLines` أن قيمتها في
 * `extra` لا في العنصر مباشرةً.
 */
function outDefs(kind) {
  var base = OUT_ALL[kind] ? OUT_ALL[kind].slice() : [['category', 'التصنيف']];
  return base.concat(fieldsOf(kind).map(function (f) { return ['x:' + f.key, f.label]; }));
}
function outValue(o, key) {
  if (key.indexOf('x:') === 0) return ((o.extra || {})[key.slice(2)]) || '';
  return o[key] == null ? '' : o[key];
}
/** مجموعة القسم في الذاكرة. */
function coll(kind) { return DB[kind]; }
function setColl(kind, arr) { DB[kind] = arr; }
/** الأسماء الأصلية للأقسام الأربعة — مرجع الزرع، وأساس المقارنة عند التسمية. */
var KIND_DEF = {
  meds: { one: 'علاج واحد', two: 'علاجان', few: 'علاجات', many: 'علاجًا', title: 'العلاجات', icon: '💊' },
  labs: { one: 'تحليل واحد', two: 'تحليلان', few: 'تحاليل', many: 'تحليلًا', title: 'التحاليل', icon: '🧪' },
  imaging: { one: 'فحص واحد', two: 'فحصان', few: 'فحوصات', many: 'فحصًا', title: 'الأشعة والفحوصات', icon: '📷' },
  recipes: { one: 'وصفة واحدة', two: 'وصفتان', few: 'وصفات', many: 'وصفة', title: 'الوصفات العلاجية', icon: '🌿' }
};
/** ألفاظ عدّ محايدة تصلح لأي قسم — تُستعمل لما لا نعرف مفرده. */
var GEN_LBL = { one: 'عنصر واحد', two: 'عنصران', few: 'عناصر', many: 'عنصرًا' };

/**
 * تسمية القسم وأيقونته وألفاظ عدّه. القسم الأصلي يحتفظ بألفاظه الخاصة
 * («٣ تحاليل») ما دام اسمه لم يتغيّر؛ فإن سمّاه المستخدم باسم آخر — أو كان
 * قسمًا أنشأه بنفسه — رجعنا لألفاظ محايدة، لأن اشتقاق جمع عربي صحيح من اسم
 * كيفما كان غير ممكن، و«٣ عناصر» صحيحة دائمًا بينما «٣ وصفات» تحت اسم
 * «الخلطات» ليست كذلك.
 */
function kindLbl(kind) {
  var s = secOf(kind) || {}, d = KIND_DEF[kind];
  var title = s.title || (d ? d.title : kind);
  var w = (d && title === d.title) ? d : GEN_LBL;
  return { title: title, icon: s.icon || (d ? d.icon : '📄'),
           one: w.one, two: w.two, few: w.few, many: w.many };
}
function secOf(kind) {
  return DB.sections.find(function (s) { return s.id === kind; });
}
function isBuiltin(kind) { return BUILTIN.indexOf(kind) >= 0; }
var NDB = (typeof window.NativeDb === 'object' && window.NativeDb) ? window.NativeDb : null;

function parseList(raw, fallback) {
  if (Array.isArray(raw)) return raw.slice();
  try { var v = JSON.parse(raw); return Array.isArray(v) ? v : fallback.slice(); }
  catch (e) { return fallback.slice(); }
}
function applyData(data) {
  // تشغيل أول بلا بيانات محفوظة يصل هنا بـnull — نكمل بالقيم الافتراضية
  // بدل الخروج، وإلا بقي DB.out فارغًا وانهارت الطباعة والإعدادات.
  data = data || {};
  var c = data.cart || {}, st = data.settings || {}, o = data.out || {};
  // الأقسام تُقرأ أولًا لأنها تحدّد KINDS التي يدور عليها كل ما بعدها
  DB.sections = Array.isArray(data.sections) ? data.sections : [];
  DB.fields = Array.isArray(data.fields) ? data.fields : [];
  ensureSections();
  DB.cart = {}; DB.out = {};
  KINDS.forEach(function (k) {
    setColl(k, Array.isArray(data[k]) ? data[k] : []);
    DB.cart[k] = Array.isArray(c[k]) ? c[k] : [];
    // الحقول المرسلة: من جدول الإعدادات داخل التطبيق، أو من النسخة
    // المحفوظة كاملةً في المتصفح/النسخة الاحتياطية
    DB.out[k] = parseList(o[k] || st['out_' + k], OUT_DEF[k] || []);
  });
  DB.cats = Array.isArray(data.cats) ? data.cats : [];
  DB.cats_seeded = Number(data.cats_seeded || st.cats_seeded || 0) || 0;
  DB.groups = Array.isArray(data.groups) ? data.groups : [];
  // ترويسة الطباعة اختيارية بالكامل — تبقى فارغة ما لم يملأها المستخدم،
  // وأي سطر فارغ لا يظهر في الورقة أصلًا.
  var hd = data.header || {};
  DB.header = {
    name: hd.name || st.hdr_name || '',
    title: hd.title || st.hdr_title || '',
    contact: hd.contact || st.hdr_contact || ''
  };
  DB.backup_at = Number(data.backup_at || st.backup_at || 0) || 0;
  DB.pin_hash = data.pin_hash || null;
}
function blobSave() {
  try { localStorage.setItem(KEY, JSON.stringify(DB)); }
  catch (e) { toast('تعذّر الحفظ — الذاكرة ممتلئة؟', 'er'); }
}
function dbFail() { toast('تعذّر الحفظ في قاعدة البيانات', 'er'); return false; }
function snapshot() {
  var o = { cart: DB.cart, cats: DB.cats, groups: DB.groups, pin_hash: DB.pin_hash,
            sections: DB.sections, fields: DB.fields, out: DB.out, header: DB.header };
  KINDS.forEach(function (k) { o[k] = DB[k]; });
  return o;
}

/* ── طبقة التخزين: SQLite داخل التطبيق، أو localStorage في المتصفح ── */
var Store = {
  native: !!NDB,

  load: function () {
    if (!NDB) {
      try { applyData(JSON.parse(localStorage.getItem(KEY) || 'null')); }
      catch (e) { /* بيانات تالفة — نبدأ فارغين بأمان */ }
      return;
    }
    try { applyData(JSON.parse(NDB.loadAll() || 'null')); } catch (e) { /* تجاهل */ }
    migrateLegacy();
  },

  upsert: function (kind, o) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.upsertItem(kind, JSON.stringify(o)) || dbFail(); } catch (e) { return dbFail(); }
  },
  remove: function (kind, id) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.deleteItem(kind, id) || dbFail(); } catch (e) { return dbFail(); }
  },
  setCart: function (kind) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setCart(kind, JSON.stringify(DB.cart[kind])) || dbFail(); } catch (e) { return dbFail(); }
  },
  /** الحقول المرسلة لكل قسم — تُحفَظ كنص JSON في جدول الإعدادات. */
  setOut: function (kind) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setSetting('out_' + kind, JSON.stringify(DB.out[kind])) || dbFail(); } catch (e) { return dbFail(); }
  },
  /** إضافة دفعة عناصر (من المكتبة الجاهزة) في معاملة واحدة. */
  addMany: function (kind, items) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.upsertMany(kind, JSON.stringify(items)) || dbFail(); } catch (e) { return dbFail(); }
  },
  setHeader: function () {
    if (!NDB) { blobSave(); return true; }
    try {
      return (NDB.setSetting('hdr_name', DB.header.name)
        && NDB.setSetting('hdr_title', DB.header.title)
        && NDB.setSetting('hdr_contact', DB.header.contact)) || dbFail();
    } catch (e) { return dbFail(); }
  },
  setBackupAt: function (t) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setSetting('backup_at', String(t)) || dbFail(); } catch (e) { return dbFail(); }
  },
  saveSection: function (sec) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.saveSection(JSON.stringify(sec)) || dbFail(); } catch (e) { return dbFail(); }
  },
  dropSection: function (id) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.deleteSection(id) || dbFail(); } catch (e) { return dbFail(); }
  },
  setSectionOrder: function (ids) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setSectionOrder(JSON.stringify(ids)) || dbFail(); } catch (e) { return dbFail(); }
  },
  saveField: function (f) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.saveField(JSON.stringify(f)) || dbFail(); } catch (e) { return dbFail(); }
  },
  dropField: function (id) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.deleteField(id) || dbFail(); } catch (e) { return dbFail(); }
  },
  setFieldOrder: function (ids) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setFieldOrder(JSON.stringify(ids)) || dbFail(); } catch (e) { return dbFail(); }
  },
  saveCat: function (c) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.saveCat(JSON.stringify(c)) || dbFail(); } catch (e) { return dbFail(); }
  },
  dropCat: function (id) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.deleteCat(id) || dbFail(); } catch (e) { return dbFail(); }
  },
  /** نقل عناصر تصنيف إلى آخر (إعادة تسمية) أو إلى «غير مصنّف» (حذف). */
  moveCatItems: function (kind, from, to) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.moveCatItems(kind, from, to) || dbFail(); } catch (e) { return dbFail(); }
  },
  setSeeded: function () {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setSetting('cats_seeded', '1') || dbFail(); } catch (e) { return dbFail(); }
  },
  setCatOrder: function (ids) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setCatOrder(JSON.stringify(ids)) || dbFail(); } catch (e) { return dbFail(); }
  },
  saveGroup: function (g) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.saveGroup(JSON.stringify(g)) || dbFail(); } catch (e) { return dbFail(); }
  },
  dropGroup: function (id) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.deleteGroup(id) || dbFail(); } catch (e) { return dbFail(); }
  },
  setPin: function (hash) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setSetting('pin_hash', hash) || dbFail(); } catch (e) { return dbFail(); }
  },
  replaceAll: function () {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.replaceAll(JSON.stringify(snapshot())) || dbFail(); } catch (e) { return dbFail(); }
  }
};

/* ترحيل بيانات الإصدارات السابقة (localStorage) إلى قاعدة البيانات — مرّة
   واحدة فقط، وبشرط أن تكون القاعدة فارغة حتى لا يُطمس شيء. */
function migrateLegacy() {
  var raw;
  try { raw = localStorage.getItem(KEY); } catch (e) { return; }
  if (!raw) return;
  try {
    if (!NDB.isEmpty()) { localStorage.removeItem(KEY); return; }
    var old = JSON.parse(raw);
    if (!old || (!Array.isArray(old.meds) && !Array.isArray(old.labs))) return;
    applyData(old);
    if (NDB.replaceAll(JSON.stringify(snapshot()))) localStorage.removeItem(KEY);
  } catch (e) { /* ترحيل فاشل — تبقى النسخة القديمة مكانها بلا ضرر */ }
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function $(id) { return document.getElementById(id); }
function h(id, html) { var e = $(id); if (e) e.innerHTML = html; }

var _tt;
window.toast = toast;   // جافا تنادِيها عند فشل تجهيز PDF
function toast(msg, type) {
  var e = $('toast'); if (!e) return;
  e.textContent = msg; e.className = 'toast on' + (type === 'er' ? ' er' : '');
  clearTimeout(_tt); _tt = setTimeout(function () { e.className = 'toast'; }, 2600);
}

/* ── النسخ الاحتياطي التلقائي ──────────────────────────────────────────
   عند كل إقلاع: إن مرّ يوم على آخر نسخة وفيه بيانات، تُكتب نسخة جديدة في
   مجلد التطبيق الخاص (بلا أي صلاحية) ويُبقى على أحدث خمس. هذا يحمي من تلف
   البيانات أو حذفها بالخطأ، ولا يحمي من ضياع الجهاز — لذلك في الإعدادات
   زرّ «مشاركة» يُخرج الملف إلى درايف أو الحاسوب بضغطة. */
var AB = (window.AndroidBridge && typeof window.AndroidBridge.writeBackup === 'function')
  ? window.AndroidBridge : null;
var BACKUP_EVERY = 24 * 60 * 60 * 1000;

function stampNow() {
  var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + '-' + p(d.getHours()) + p(d.getMinutes());
}
function dataCount() {
  return KINDS.reduce(function (a, k) { return a + DB[k].length; }, 0);
}
/** يكتب نسخة الآن. force من زر يدوي، وإلا فبشرط مرور المدة ووجود بيانات. */
window.autoBackup = function (force) {
  if (!AB) return false;
  if (!force) {
    if (!dataCount()) return false;
    if (Date.now() - (DB.backup_at || 0) < BACKUP_EVERY) return false;
  }
  try {
    var name = AB.writeBackup(JSON.stringify(snapshot()), stampNow());
    if (!name) return false;
    DB.backup_at = Date.now();
    Store.setBackupAt(DB.backup_at);
    return name;
  } catch (e) { return false; }
};
function backupList() {
  if (!AB) return [];
  try { return JSON.parse(AB.listBackups() || '[]'); } catch (e) { return []; }
}
window.backupNow = function () {
  var name = autoBackup(true);
  if (name) { render(); toast('✅ حُفظت نسخة: ' + name); }
  else toast('تعذّر حفظ النسخة', 'er');
};
window.backupShare = function (name) { if (AB) AB.shareBackup(name); };
/* اختيار مكان الحفظ: الافتراضي مجلد التطبيق (يزول مع إلغاء التثبيت)،
   ويمكن اختيار مجلد دائم من منتقي النظام فيبقى ويظهر في مدير الملفات. */
window.backupPickDir = function () { if (AB && AB.pickBackupDir) AB.pickBackupDir(); };
window.backupResetDir = function () {
  confirmBox('العودة لمجلد التطبيق الخاص؟ النسخ الموجودة في المجلد الذي اخترته تبقى مكانها.', function () {
    if (AB && AB.resetBackupDir) AB.resetBackupDir();
    closeModal();
  });
};
/** ينادِيها أندرويد بعد اختيار المجلد أو إعادته للافتراضي. */
window.onBackupDirPicked = function () {
  render();
  toast('📂 مكان الحفظ: ' + backupDirLabel());
};
function backupDirLabel() {
  try { return (AB && AB.backupDir) ? AB.backupDir() : ''; } catch (e) { return ''; }
}
function backupDirIsCustom() {
  try { return !!(AB && AB.backupDirIsCustom && AB.backupDirIsCustom()); } catch (e) { return false; }
}
window.backupDelete = function (name) {
  confirmBox('حذف هذه النسخة الاحتياطية؟', function () {
    if (AB) AB.deleteBackup(name);
    closeModal(); render(); toast('🗑️ حُذفت');
  });
};
window.backupRestore = function (name) {
  confirmBox('استعادة «' + name + '» ستستبدل كل بياناتك الحالية. متابعة؟', function () {
    var raw = AB ? AB.readBackup(name) : '';
    var data;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    if (!data) { closeModal(); return toast('الملف غير صالح', 'er'); }
    applyData(data);
    Store.replaceAll();
    KINDS.forEach(function (k) { Store.setOut(k); });
    Store.setHeader();
    closeModal(); goHome(); toast('✅ تمت الاستعادة');
  });
};

/* ── قفل PIN محلي (SHA-256 عبر Web Crypto المدمجة — بلا مكتبات) ── */
async function sha256(text) {
  var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}
/* ── التنقل: صفحة رئيسية + صفحات داخلية بسهم رجوع ──
   NAV مكدّس بسيط: goPage يدفع صفحة، وسهم الرجوع (وزر الرجوع في الجهاز)
   يسحب آخر واحدة. هكذا يعود «المكتبة» لمن دخلها من الإعدادات إلى
   الإعدادات، ولمن دخلها من الرئيسية إلى الرئيسية. */
var NAV = ['home'];
function curPage() { return NAV[NAV.length - 1]; }
window.goPage = function (p) {
  if (curPage() !== p) NAV.push(p);
  window.scrollTo(0, 0);
  render();
};
window.goBack = function () {
  // مسوّدة المجموعة تُسقَط فقط عند مغادرة صفحات المجموعات نفسها؛ الرجوع من
  // المعاينة إلى المحرّر يجب أن يبقي التعديلات المؤقّتة كما هي.
  var leaving = curPage().indexOf('grp:') === 0;
  if (GRP && GRP.dirty && leaving) {
    confirmBox('لديك تعديلات غير محفوظة على المجموعة. الخروج يعيدها كما كانت.', function () {
      GRP = null; closeModal(); popPage();
    });
    return;
  }
  if (leaving) GRP = null;
  popPage();
};
function popPage() {
  if (NAV.length > 1) NAV.pop();
  window.scrollTo(0, 0);
  render();
}
window.goHome = function () { NAV = ['home']; window.scrollTo(0, 0); render(); };

/** زر الرجوع في الجهاز: يغلق المودال، ثم يرجع صفحة، وإلا يخرج من التطبيق. */
window.onAndroidBack = function () {
  var mb = $('modal-bg');
  if (mb && mb.className.indexOf('on') >= 0) { closeModal(); return true; }
  if (NAV.length > 1) { goBack(); return true; }
  return false;
};

var PAGES = {
  home:     { icon: '💊🧪', title: 'دليلي الطبي' },
  meds:     { icon: '💊', title: 'العلاجات' },
  labs:     { icon: '🧪', title: 'التحاليل' },
  imaging:  { icon: '📷', title: 'الأشعة والفحوصات' },
  recipes:  { icon: '🌿', title: 'الوصفات العلاجية' },
  settings: { icon: '⚙️', title: 'الإعدادات' },
  pv:       { icon: '👁️', title: 'معاينة قبل الإرسال' },
  'lib:labs': { icon: '📚', title: 'مكتبة التحاليل' },
  'lib:imaging': { icon: '📚', title: 'مكتبة الأشعة والفحوصات' },
  'lib:meds': { icon: '📚', title: 'مكتبة العلاجات' }
};
/** عنوان صفحات المجموعات يُحسَب لأنه يتضمّن اسم القسم أو اسم المجموعة. */
function pageMeta(p) {
  if (PAGES[p]) return PAGES[p];
  if (p === 'secs') return { icon: '🗂️', title: 'إدارة الأقسام' };
  if (p.indexOf('cat:') === 0) {
    return { icon: '🏷️', title: 'تصنيفات ' + kindLbl(p.slice(4)).title };
  }
  if (p.indexOf('fld:') === 0) {
    return { icon: '🧩', title: 'حقول ' + kindLbl(p.slice(4)).title };
  }
  // قسم أنشأه المستخدم: عنوانه وأيقونته من تسجيله
  if (secOf(p)) { var L = kindLbl(p); return { icon: L.icon, title: L.title }; }
  if (p.indexOf('grp:') === 0) {
    var a = p.split(':');
    if (a[2]) {
      var g = DB.groups.find(function (x) { return x.id === a[2]; });
      return { icon: '📁', title: (GRP && GRP.id === a[2] ? GRP.name : (g ? g.name : 'مجموعة')) || 'مجموعة' };
    }
    return { icon: '📁', title: a[1] === 'all' ? 'مجموعاتي المحفوظة' : 'مجموعات ' + kindLbl(a[1]).title };
  }
  return PAGES.home;
}

async function boot() {
  Store.load();
  seedCats();
  autoBackup(false);
  if (DB.pin_hash) showLock();
  else showApp();
}

function showLock() {
  $('lock').className = 'scr on'; $('app').className = 'scr';
  h('lock', '<div class="lockbox">'
    + '<div class="lockicon">🔒</div><div class="lt">أدخل الرمز</div>'
    + '<input id="lk-pin" class="pin-inp" type="password" inputmode="numeric" maxlength="8" autofocus>'
    + '<div id="lk-err" class="err"></div>'
    + '<button class="btn primary" style="width:100%;margin-top:10px" onclick="tryUnlock()">دخول</button>'
    + '</div>');
  var inp = $('lk-pin');
  if (inp) inp.onkeydown = function (e) { if (e.key === 'Enter') tryUnlock(); };
}
window.tryUnlock = async function () {
  var v = ($('lk-pin') || {}).value || '';
  var hash = await sha256(v);
  if (hash === DB.pin_hash) { showApp(); }
  else { h('lk-err', 'رمز غير صحيح'); var i = $('lk-pin'); if (i) { i.value = ''; i.focus(); } }
};

function showApp() {
  $('lock').className = 'scr'; $('app').className = 'scr on';
  render();
}

/* ── صفحة الإعدادات: رمز القفل + الحقول المرسلة + المكتبة + النسخ الاحتياطي ── */
window.openSettings = function () { goPage('settings'); };
function renderSettings() {
  var hasPin = !!DB.pin_hash;
  var lib = window.LIBRARY || { labs: [], meds: [] };
  h('page',
    '<div class="settings-sec">'
    + '<div class="settings-lbl">حماية التطبيق</div>'
    + (hasPin
      ? '<button class="btn danger full" onclick="removePin()">🔓 إزالة رمز القفل</button>'
      : '<button class="btn primary full" onclick="setupPin()">🔒 تفعيل رمز قفل</button>')
    + '</div>'
    + '<div class="settings-sec">'
    + '<div class="settings-lbl">الحقول المرسلة في الطباعة والصورة</div>'
    + '<div class="muted" style="margin-bottom:9px">اسم العلاج واسم التحليل يظهران دائمًا. اختر ما يُضاف معهما.</div>'
    + KINDS.map(function (k) {
      var L = kindLbl(k);
      return outBlock(k, L.icon + ' ' + L.title, outDefs(k));
    }).join('')
    + '</div>'
    + '<div class="settings-sec">'
    + '<div class="settings-lbl">ترويسة الطباعة (اختيارية — اتركها فارغة إن لم ترغب)</div>'
    + '<div class="muted" style="margin-bottom:8px">ما تكتبه هنا يظهر أعلى كل ورقة مطبوعة ومع النص المنسوخ. الأسطر الفارغة لا تظهر إطلاقًا.</div>'
    + '<div class="f"><label>الاسم</label><input id="hd-name" class="inp" value="' + esc(DB.header.name) + '" placeholder="اتركه فارغًا إن لم ترغب" onchange="saveHeader()"></div>'
    + '<div class="f"><label>الصفة أو التخصص</label><input id="hd-title" class="inp" value="' + esc(DB.header.title) + '" placeholder="اختياري" onchange="saveHeader()"></div>'
    + '<div class="f"><label>بيانات التواصل</label><input id="hd-contact" class="inp" value="' + esc(DB.header.contact) + '" placeholder="اختياري" onchange="saveHeader()"></div>'
    + (headerHtml() ? '<button class="btn full" onclick="clearHeader()">🧹 إفراغ الترويسة</button>' : '')
    + '</div>'
    + backupSection()
    + '<div class="settings-sec">'
    + '<div class="settings-lbl">الأقسام</div>'
    + '<div class="muted" style="margin-bottom:9px">سمِّ الأقسام ورتّبها، وأضِف أقسامًا جديدة، ولكل قسم تصنيفاته وحقوله الإضافية.</div>'
    + '<button class="btn full primary" onclick="goPage(\'secs\')">🗂️ إدارة الأقسام (' + DB.sections.length + ')</button>'
    + '</div>'
    + '<div class="settings-sec">'
    + '<div class="settings-lbl">إضافة سريعة</div>'
    + KINDS.map(function (k) {
      var L = kindLbl(k);
      return '<button class="btn full" onclick="quickAdd(\'' + k + '\')">'
        + L.icon + ' + إضافة إلى ' + esc(L.title) + '</button>';
    }).join('')
    + '</div>'
    + '<div class="settings-sec">'
    + '<div class="settings-lbl">المكتبة الجاهزة (مدمجة داخل التطبيق)</div>'
    + '<button class="btn full" onclick="goPage(\'lib:labs\')">🧪 مكتبة التحاليل (' + (lib.labs || []).length + ')</button>'
    + '<button class="btn full" onclick="goPage(\'lib:imaging\')">📷 مكتبة الأشعة والفحوصات (' + (lib.imaging || []).length + ')</button>'
    + '<button class="btn full" onclick="goPage(\'lib:meds\')">💊 مكتبة العلاجات (' + (lib.meds || []).length + ')</button>'
    + '</div>'
    + '<div class="settings-sec">'
    + '<div class="settings-lbl">النسخ الاحتياطي (يبقى على جهازك فقط)</div>'
    + '<button class="btn full" onclick="exportBackup()">⬇️ تصدير نسخة احتياطية</button>'
    + '<label class="btn full" style="display:block;text-align:center;margin-top:8px;cursor:pointer">⬆️ استيراد نسخة احتياطية'
    + '<input type="file" accept="application/json" onchange="importBackup(this)" style="display:none"></label>'
    + '</div>'
    + '<div class="settings-sec"><div class="settings-lbl">حول</div>'
    + '<div class="muted">جميع بياناتك محفوظة في قاعدة بيانات محلية على هذا الجهاز فقط، ولا تُرسَل لأي خادم مطلقًا. التطبيق لا يملك صلاحية إنترنت أصلًا.</div></div>'
  );
}
window.saveHeader = function () {
  DB.header = {
    name: (($('hd-name') || {}).value || '').trim(),
    title: (($('hd-title') || {}).value || '').trim(),
    contact: (($('hd-contact') || {}).value || '').trim()
  };
  Store.setHeader();
};
window.clearHeader = function () {
  DB.header = { name: '', title: '', contact: '' };
  Store.setHeader(); render(); toast('أُفرغت الترويسة');
};

function fmtBytes(n) { return n < 1024 ? n + ' ب' : Math.round(n / 1024) + ' ك.ب'; }
function backupSection() {
  if (!AB) {
    return '<div class="settings-sec"><div class="settings-lbl">النسخ الاحتياطي التلقائي</div>'
      + '<div class="muted">متاح داخل التطبيق فقط (غير متاح في المتصفح).</div></div>';
  }
  var list = backupList(), custom = backupDirIsCustom();
  var html = '<div class="settings-sec"><div class="settings-lbl">النسخ الاحتياطي التلقائي</div>'
    + '<div class="muted" style="margin-bottom:8px">نسخة يوميًا عند فتح التطبيق، ويُحتفظ بأحدث خمس.</div>'
    + '<div class="loc"><div class="loc-l">📂 مكان الحفظ</div>'
    + '<div class="loc-v">' + esc(backupDirLabel()) + '</div>'
    + (custom ? '' : '<div class="loc-w">⚠️ هذا المجلد يُحذف مع إلغاء تثبيت التطبيق. اختر مجلدًا دائمًا لتبقى النسخ.</div>')
    + '</div>'
    + '<button class="btn full" onclick="backupPickDir()">📂 تغيير مكان الحفظ…</button>'
    + (custom ? '<button class="btn full" onclick="backupResetDir()">↩️ العودة لمجلد التطبيق</button>' : '')
    + '<button class="btn full" onclick="backupNow()">💾 احفظ نسخة الآن</button>';
  if (!list.length) return html + '<div class="muted">لا توجد نسخ بعد.</div></div>';
  html += list.map(function (b) {
    return '<div class="card"><div class="row">'
      + '<div class="grow"><div class="name">🗄️ ' + esc(b.name.replace(/^dalili-|\.json$/g, '')) + '</div>'
      + '<div class="sub">' + fmtBytes(b.size) + '</div></div>'
      + '<button class="ic" onclick="backupShare(\'' + esc(b.name) + '\')">📤</button>'
      + '<button class="ic" onclick="backupRestore(\'' + esc(b.name) + '\')">↩️</button>'
      + '<button class="ic" onclick="backupDelete(\'' + esc(b.name) + '\')">🗑️</button>'
      + '</div></div>';
  }).join('');
  return html + '</div>';
}

function outBlock(kind, title, fields) {
  var sel = DB.out[kind];
  return '<div class="out-grp"><div class="out-t">' + title + '</div>'
    + fields.map(function (f) {
      return '<label class="chk-row"><input type="checkbox" ' + (sel.indexOf(f[0]) >= 0 ? 'checked' : '')
        + ' onchange="toggleOut(\'' + kind + '\',\'' + f[0] + '\')"> ' + esc(f[1]) + '</label>';
    }).join('') + '</div>';
}
window.toggleOut = function (kind, key) {
  var arr = DB.out[kind], i = arr.indexOf(key);
  if (i >= 0) arr.splice(i, 1); else arr.push(key);
  Store.setOut(kind);
};

/* ── المكتبة الجاهزة: نسخ عناصر مصنّفة إلى قاعدة بيانات المستخدم ──
   المكتبة كبيرة (مئات العناصر) فالعرض مقسّم على تصنيفات مطويّة، ومعها بحث
   يعرض النتائج قائمةً مسطّحة. البحث يُحدِّث قائمة النتائج فقط حتى لا يفقد
   حقل البحث تركيزه أثناء الكتابة. */
var LIB_SEL = {}, LIB_KIND = 'labs', LIB_MINE = {};

function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
function libKey(kind, o) {
  if (kind === 'meds') return norm(o.trade_name) + '|' + norm(o.scientific_name);
  if (kind === 'imaging') return norm(o.name) + '|' + norm(o.region);
  return norm(o.code) + '|' + norm(o.name);
}
function libList() { return (window.LIBRARY || {})[LIB_KIND] || []; }
function libCats() {
  var cats = [];
  libList().forEach(function (o) { if (cats.indexOf(o.category) < 0) cats.push(o.category); });
  return cats;
}
/* البحث يشمل كل نص العنصر — البحث عن «صيام» أو «مضاد حيوي» يجب أن يجد
   ما ورد في المتطلبات والمحاذير لا في الاسم وحده. */
function libHay(o) {
  if (LIB_KIND === 'meds') {
    return norm([o.trade_name, o.scientific_name, o.category, o.uses, o.cautions].join(' '));
  }
  return norm([o.code, o.name, o.region, o.category, o.purpose,
               o.requirements, o.prohibitions].join(' '));
}
function libCount() {
  var e = $('lib-n'); if (e) e.textContent = Object.keys(LIB_SEL).length;
}

window.openLibrary = function (kind) { goPage('lib:' + kind); };

/** يُعيد بناء قائمة «الموجود عندي» — تُستدعى عند فتح الصفحة وبعد كل إضافة. */
function libSyncMine() {
  LIB_MINE = {};
  coll(LIB_KIND).forEach(function (o) { LIB_MINE[libKey(LIB_KIND, o)] = 1; });
}
function renderLibraryPage(kind) {
  LIB_KIND = kind;
  var lib = libList();
  if (!lib.length) { h('page', emptyBox('📚', 'المكتبة غير متوفرة', 'ملف library.js مفقود')); return; }
  LIB_SEL = {};
  libSyncMine();
  h('page', '<div class="lib-bar">'
    + '<button class="btn primary full" style="margin:0" onclick="libAdd()">'
    + '➕ إضافة المحدد: <span id="lib-n">0</span></button>'
    + '<input id="lib-q" class="srch-inp" style="width:100%;margin-top:8px" placeholder="🔎 ابحث في المكتبة…" oninput="libRender()">'
    + '<div class="muted" style="margin-top:7px">'
    + lib.length + ' ' + kindLbl(kind).many + ' في ' + libCats().length + ' تصنيفًا. '
    + 'العناصر الباهتة مضافة عندك مسبقًا.'
    + (kind === 'meds' ? ' الجرعات فارغة عمدًا — أضِفها بنفسك بعد الإضافة.' : '')
    + '</div></div><div id="lib-list"></div>');
  libRender();
}

function libItem(i, ci) {
  var o = libList()[i];
  var have = !!LIB_MINE[libKey(LIB_KIND, o)];
  var nm = LIB_KIND === 'meds' ? o.trade_name
    : LIB_KIND === 'imaging' ? (o.region ? o.name + ' (' + o.region + ')' : o.name)
    : (o.code ? o.code + ' — ' + o.name : o.name);
  // الاسم ظاهر في السطر الأول — لا نكرّره في السطر الوصفي
  var sub = LIB_KIND === 'meds'
    ? [o.scientific_name, o.uses].filter(Boolean).join(' • ')
    : (o.purpose || o.requirements || '');
  return '<label class="lib-i' + (have ? ' have' : '') + '" data-cat="' + ci + '">'
    + '<input type="checkbox" id="lib-c-' + i + '"' + (have ? ' disabled' : '')
    + (LIB_SEL[i] ? ' checked' : '') + ' onchange="libToggle(' + i + ')">'
    + '<span><span class="lib-t">' + esc(nm) + '</span>'
    + (sub ? '<span class="lib-s"><br>' + esc(sub) + '</span>' : '') + '</span></label>';
}

window.libRender = function () {
  var lib = libList();
  var q = norm(($('lib-q') || {}).value);
  var hits = [];
  lib.forEach(function (o, i) { if (!q || libHay(o).indexOf(q) >= 0) hits.push(i); });
  if (!hits.length) { h('lib-list', emptyBox('🔎', 'لا نتائج', 'جرّب كلمة أخرى')); return; }

  if (q) {
    // نتائج البحث قائمة مسطّحة — التصنيفات المطويّة تخفي المطلوب
    h('lib-list', '<div class="acc"><div class="acc-b">'
      + hits.map(function (i) { return libItem(i, -1); }).join('') + '</div></div>');
    return;
  }
  var cats = libCats(), html = '';
  cats.forEach(function (cat, ci) {
    var idx = hits.filter(function (i) { return lib[i].category === cat; });
    if (!idx.length) return;
    html += accBlock('📁 ' + cat + ' (' + idx.length + ')',
      '<div style="padding:4px 6px 8px"><button class="btn sm" onclick="libAll(' + ci + ')">تحديد كل التصنيف</button></div>'
      + idx.map(function (i) { return libItem(i, ci); }).join(''), false);
  });
  h('lib-list', html);
};

window.libToggle = function (i) {
  if (LIB_SEL[i]) delete LIB_SEL[i]; else LIB_SEL[i] = 1;
  libCount();
};
window.libAll = function (ci) {
  // نعدّل مربعات الاختيار مباشرةً بدل إعادة الرسم حتى لا ينطوي التصنيف المفتوح
  var boxes = document.querySelectorAll('#lib-list .lib-i[data-cat="' + ci + '"] input:not([disabled])');
  for (var k = 0; k < boxes.length; k++) {
    boxes[k].checked = true;
    LIB_SEL[parseInt(boxes[k].id.slice(6), 10)] = 1;
  }
  libCount();
};
/** صياغة عربية سليمة للعدد: مفرد ومثنى وجمع قلة وجمع كثرة. */
function countWord(n, one, two, few, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  return n + ' ' + (n <= 10 ? few : many);
}
window.libAdd = function () {
  var lib = libList(), kind = LIB_KIND;
  var items = Object.keys(LIB_SEL).map(function (k) {
    var src = lib[parseInt(k, 10)]; if (!src) return null;
    var o = {}; for (var f in src) if (Object.prototype.hasOwnProperty.call(src, f)) o[f] = src[f];
    o.id = uid();
    return o;
  }).filter(Boolean);
  if (!items.length) return toast('لم تحدد شيئًا بعد', 'er');
  setColl(kind, coll(kind).concat(items));
  Store.addMany(kind, items);
  // تصنيفات المكتبة تُسجَّل تلقائيًا فتُدار كغيرها بدل أن تبقى أسماء يتيمة
  items.forEach(function (o) { catEnsure(kind, o.category); });
  LIB_SEL = {};
  libSyncMine();          // المضاف حديثًا يصير باهتًا فلا يُضاف مرتين
  libCount(); libRender();
  var L = kindLbl(kind);
  toast('✅ تمت إضافة ' + countWord(items.length, L.one, L.two, L.few, L.many));
};

window.setupPin = function () {
  openModal('🔒 تعيين رمز قفل',
    '<div class="f"><label>رمز جديد (٤ أرقام فأكثر)</label><input id="np1" class="inp" type="password" inputmode="numeric" maxlength="8"></div>'
    + '<div class="f"><label>تأكيد الرمز</label><input id="np2" class="inp" type="password" inputmode="numeric" maxlength="8"></div>'
    + '<div class="mft"><button class="btn primary" onclick="savePin()">حفظ</button><button class="btn" onclick="closeModal()">إلغاء</button></div>');
};
window.savePin = async function () {
  var a = ($('np1') || {}).value || '', b = ($('np2') || {}).value || '';
  if (a.length < 4) return toast('٤ أرقام على الأقل', 'er');
  if (a !== b) return toast('الرمزان غير متطابقين', 'er');
  DB.pin_hash = await sha256(a); Store.setPin(DB.pin_hash); closeModal(); toast('✅ فُعِّل رمز القفل');
};
window.removePin = function () {
  confirmBox('إزالة رمز القفل؟', function () { DB.pin_hash = null; Store.setPin(null); closeModal(); toast('تمت الإزالة'); });
};
window.exportBackup = function () {
  var blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'دليلي-نسخة-احتياطية-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  toast('✅ نزّل الملف — احفظه في مكان آمن');
};
window.importBackup = function (input) {
  var file = input.files && input.files[0]; if (!file) return;
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var data = JSON.parse(reader.result);
      if (!data || !KINDS.some(function (k) { return Array.isArray(data[k]); })) throw new Error('bad');
      confirmBox('استيراد هذه النسخة سيستبدل بياناتك الحالية. متابعة؟', function () {
        var keep = DB.pin_hash;
        applyData(data);
        DB.pin_hash = data.pin_hash || keep;
        // السلة تشير لمعرّفات قد تكون اختفت في النسخة المستوردة
        KINDS.forEach(function (k) {
          DB.cart[k] = DB.cart[k].filter(function (id) {
            return coll(k).some(function (x) { return x.id === id; });
          });
        });
        Store.replaceAll();
        KINDS.forEach(function (k) { Store.setOut(k); });
        closeModal(); render(); toast('✅ تم الاستيراد');
      });
    } catch (e) { toast('ملف غير صالح', 'er'); }
  };
  reader.readAsText(file);
};

/* ── حقول النص الطويل ──────────────────────────────────────────────
   المشكلة التي كانت: الصندوق ثابت الارتفاع فلا يظهر منه إلا سطران مهما
   طال النص، وسحب الحجم لا يعمل باللمس. الحل: يتمدّد مع المحتوى، ومعه
   شريط إدراج للنقاط والترقيم وسطر جديد، وEnter يُكمل القائمة تلقائيًا. */

/** يضبط ارتفاع الحقل ليطابق محتواه بالضبط. */
window.grow = function (el) {
  if (!el || !el.style) return;
  el.style.height = 'auto';
  el.style.height = (el.scrollHeight + 2) + 'px';
};
function growAll() {
  try {
    var all = document.querySelectorAll('#modal-body .ta');
    for (var i = 0; i < all.length; i++) grow(all[i]);
  } catch (e) { /* بيئة بلا DOM كامل */ }
}

/** حقل نص طويل كامل: تسمية + شريط أدوات + صندوق متمدّد. */
function taField(id, label, value, placeholder) {
  return '<div class="f"><label>' + esc(label) + '</label>'
    + '<div class="fbar">'
    + '<button type="button" class="fb" onclick="taBullet(\'' + id + '\')">• نقطة</button>'
    + '<button type="button" class="fb" onclick="taNumber(\'' + id + '\')">١. ترقيم</button>'
    + '<button type="button" class="fb" onclick="taNewline(\'' + id + '\')">↵ سطر جديد</button>'
    + '</div>'
    + '<textarea id="' + id + '" class="inp ta" placeholder="' + esc(placeholder || '') + '"'
    + ' oninput="grow(this)" onkeydown="return taKey(event,this)">' + esc(value || '') + '</textarea>'
    + '</div>';
}

function taInsert(el, text) {
  var v = el.value, a = el.selectionStart, b = el.selectionEnd;
  if (typeof a !== 'number') { el.value = v + text; grow(el); return; }
  el.value = v.slice(0, a) + text + v.slice(b);
  var pos = a + text.length;
  el.selectionStart = el.selectionEnd = pos;
  el.focus();
  grow(el);
}
/** بداية السطر الذي فيه المؤشر. */
function lineStart(v, pos) { return v.lastIndexOf('\n', pos - 1) + 1; }

window.taNewline = function (id) { var el = $(id); if (el) taInsert(el, '\n'); };
window.taBullet = function (id) {
  var el = $(id); if (!el) return;
  var p = el.selectionStart || el.value.length;
  var head = lineStart(el.value, p) === p ? '' : '\n';
  taInsert(el, head + '• ');
};
window.taNumber = function (id) {
  var el = $(id); if (!el) return;
  var p = el.selectionStart || el.value.length;
  // يتابع آخر رقم قبل المؤشر بدل أن يبدأ من واحد في كل مرة
  var before = el.value.slice(0, p).split('\n').reverse();
  var n = 1;
  for (var i = 0; i < before.length; i++) {
    var m = before[i].match(/^\s*(\d+)[.)]\s/);
    if (m) { n = parseInt(m[1], 10) + 1; break; }
  }
  var head = lineStart(el.value, p) === p ? '' : '\n';
  taInsert(el, head + n + '. ');
};
/** Enter داخل قائمة يبدأ العنصر التالي؛ وعلى عنصر فارغ يُنهي القائمة. */
window.taKey = function (e, el) {
  var key = e.key || '';
  if (key !== 'Enter' && e.keyCode !== 13) return true;
  if (e.shiftKey || e.ctrlKey) return true;
  var v = el.value, p = el.selectionStart;
  if (typeof p !== 'number') return true;
  var ls = lineStart(v, p);
  var line = v.slice(ls, p);
  var m = line.match(/^(\s*)(•\s|(\d+)[.)]\s)/);
  if (!m) return true;                       // سطر عادي — Enter يعمل كالمعتاد
  if (line.length === m[0].length) {         // علامة بلا نص ⇒ أنهِ القائمة
    el.value = v.slice(0, ls) + v.slice(p);
    el.selectionStart = el.selectionEnd = ls;
    grow(el);
    if (e.preventDefault) e.preventDefault();
    return false;
  }
  var next = m[3] ? m[1] + (parseInt(m[3], 10) + 1) + '. ' : m[1] + '• ';
  taInsert(el, '\n' + next);
  if (e.preventDefault) e.preventDefault();
  return false;
};

/* ── مودال + تأكيد بسيطان ── */
function openModal(title, body) {
  h('modal-title', esc(title)); h('modal-body', body);
  $('modal-bg').className = 'modal-bg on';
  growAll();   // النص المحفوظ سابقًا يظهر كاملًا لا في سطرين
}
window.closeModal = function () { $('modal-bg').className = 'modal-bg'; };
function confirmBox(msg, onYes) {
  openModal('تأكيد', '<div style="margin-bottom:14px">' + esc(msg) + '</div>'
    + '<div class="mft"><button class="btn danger" id="cb-yes">تأكيد</button><button class="btn" onclick="closeModal()">إلغاء</button></div>');
  var b = $('cb-yes'); if (b) b.onclick = onYes;
}

/* ── موزّع الصفحات ── */
function render() {
  var p = curPage(), meta = pageMeta(p);
  var bk = $('hdr-back'), st = $('hdr-set');
  if (bk) bk.style.display = NAV.length > 1 ? '' : 'none';
  if (st) st.style.display = (p === 'settings') ? 'none' : '';
  h('hdr-title', esc(meta.title));
  h('hdr-icon', meta.icon);

  if (p === 'meds') renderMeds();
  else if (p === 'labs') renderLabs();
  else if (p === 'imaging') renderImaging();
  else if (p === 'recipes') renderRecipes();
  else if (p === 'settings') renderSettings();
  else if (p === 'secs') renderSectionsPage();
  else if (p === 'pv') renderPreview();
  else if (p.indexOf('lib:') === 0) renderLibraryPage(p.slice(4));
  else if (p.indexOf('cat:') === 0) renderCatsPage(p.slice(4));
  else if (p.indexOf('fld:') === 0) renderFieldsPage(p.slice(4));
  else if (p.indexOf('grp:') === 0) {
    var a = p.split(':');
    if (a[2]) renderGroupPage(a[1], a[2]); else renderGroupsPage(a[1]);
  }
  else if (secOf(p)) renderCustomSection(p);
  else renderHome();
}

/* ── الصفحة الرئيسية ── */
function homeCard(page, icon, title, sub, extra) {
  return '<button class="hcard' + (extra || '') + '" onclick="goPage(\'' + page + '\')">'
    + '<span class="hci">' + icon + '</span>'
    + '<span class="hct">' + esc(title) + '</span>'
    + '<span class="hcs">' + esc(sub) + '</span></button>';
}
/* الرئيسية تعرض الخدمات الثلاث فقط. المكتبة الجاهزة والإضافة السريعة
   نُقلتا إلى الإعدادات لأنهما لا تُستخدمان باستمرار. */
function renderHome() {
  var html = '<div class="hero"><div class="hero-t">أهلًا بك 👋</div>'
    + '<div class="hero-s">كتالوجك الشخصي للعلاجات والتحاليل والوصفات — يعمل بلا إنترنت، وبياناتك على جهازك وحده.</div></div>';

  var cart = KINDS.reduce(function (a, k) { return a + DB.cart[k].length; }, 0);
  if (cart) {
    html += '<div class="hbar">📝 المحدد: ' + countWord(cart, 'عنصر واحد', 'عنصران', 'عناصر', 'عنصرًا')
      + KINDS.map(function (k) {
        return DB.cart[k].length
          ? '<button class="btn white sm" onclick="goPage(\'' + k + '\')">' + kindLbl(k).title + ' (' + DB.cart[k].length + ')</button>'
          : '';
      }).join('') + '</div>';
  }

  if (DB.groups.length) {
    html += '<button class="btn full" style="margin-bottom:12px" onclick="goPage(\'grp:all\')">'
      + '📁 مجموعاتي المحفوظة (' + DB.groups.length + ')</button>';
  }
  html += '<div class="hgrid">'
    + KINDS.map(function (k, i) {
      var n = coll(k).length, L = kindLbl(k);
      return homeCard(k, L.icon, L.title,
        n ? countWord(n, L.one, L.two, L.few, L.many) : 'لا شيء بعد',
        (i === KINDS.length - 1 && KINDS.length % 2) ? ' wide' : '');
    }).join('')
    + '</div>';
  h('page', html);
}

/* ════════════════════════ 🗂️ الأقسام ════════════════════════
   الأقسام الأربعة الأصلية مسجّلة كبقيّتها، فيقدر المستخدم على تسميتها
   وتغيير أيقونتها وترتيبها، وعلى إضافة أقسام جديدة كاملة. الأصلية لها
   جداولها وحقولها المكتوبة في الكود ولا تُحذف؛ الجديدة عناصرها في جدول
   `items` وحقولها كلها من تعريف المستخدم. */

/**
 * يضمن وجود الأربعة الأصلية ويحدّث KINDS ومصفوفات العناصر والسلة.
 *
 * الصفّ يُكتب في القاعدة فور استحداثه لا عند أول تعديل: `setSectionOrder`
 * تُحدّث صفوفًا موجودة فقط، فلولا ذلك ضاع ترتيبٌ يغيّره المستخدم قبل أن
 * يكون قد سمّى قسمًا واحدًا.
 */
function ensureSections() {
  BUILTIN.forEach(function (k) {
    if (secOf(k)) return;
    var d = KIND_DEF[k];
    var sec = { id: k, title: d.title, icon: d.icon, builtin: 1 };
    DB.sections.push(sec);
    Store.saveSection(sec);
  });
  KINDS = DB.sections.map(function (s) { return s.id; });
  KINDS.forEach(function (k) {
    if (!Array.isArray(DB[k])) DB[k] = [];
    if (!Array.isArray(DB.cart[k])) DB.cart[k] = [];
  });
}
/** «+ إضافة» من الإعدادات — يفتح نموذج القسم أيًّا كان أصليًّا أو جديدًا. */
window.quickAdd = function (kind) {
  if (kind === 'meds') return medForm();
  if (kind === 'labs') return labForm();
  if (kind === 'imaging') return imgForm();
  if (kind === 'recipes') return recipeForm();
  secItemForm(kind);
};

function renderSectionsPage() {
  var html = '<button class="btn full primary" onclick="secNew()">➕ قسم جديد</button>'
    + '<div class="hint">الأقسام الأصلية تُسمّى وتُرتَّب ولا تُحذف. ولكل قسم'
    + ' تصنيفاته وحقوله الإضافية.</div>';

  html += DB.sections.map(function (s, i) {
    var L = kindLbl(s.id), n = coll(s.id).length, nf = fieldsOf(s.id).length;
    return '<div class="card"><div class="row">'
      + '<div class="grow"><div class="name">' + L.icon + ' ' + esc(L.title)
      + (s.builtin ? '' : ' <span class="chip">قسم جديد</span>') + '</div>'
      + '<div class="sub">' + (n ? countWord(n, L.one, L.two, L.few, L.many) : 'فارغ')
      + ' • ' + countWord(catNames(s.id).length, 'تصنيف واحد', 'تصنيفان', 'تصنيفات', 'تصنيفًا')
      + (nf ? ' • ' + countWord(nf, 'حقل إضافي', 'حقلان إضافيان', 'حقول إضافية', 'حقلًا إضافيًا') : '')
      + '</div></div>'
      + '<button class="ic"' + (i === 0 ? ' disabled' : '')
      + ' onclick="secMove(\'' + s.id + '\',-1)">⬆️</button>'
      + '<button class="ic"' + (i === DB.sections.length - 1 ? ' disabled' : '')
      + ' onclick="secMove(\'' + s.id + '\',1)">⬇️</button>'
      + '<button class="ic" onclick="secEdit(\'' + s.id + '\')">✏️</button>'
      + (s.builtin ? '' : '<button class="ic" onclick="secDel(\'' + s.id + '\')">🗑️</button>')
      + '</div>'
      + '<div class="row" style="gap:7px;margin-top:7px">'
      + '<button class="btn sm grow" onclick="goPage(\'cat:' + s.id + '\')">🏷️ التصنيفات</button>'
      + '<button class="btn sm grow" onclick="goPage(\'fld:' + s.id + '\')">🧩 الحقول الإضافية</button>'
      + '</div></div>';
  }).join('');
  h('page', html);
}

/** نموذج القسم — الاسم والأيقونة. الأيقونة رمز تعبيري واحد. */
function secFormBody(s) {
  var icons = ['💊', '🧪', '📷', '🌿', '🩺', '💉', '🦷', '👁️', '🫀', '🧠', '🦴',
               '🍎', '📋', '📌', '🧬', '🧫', '🩹', '📄'];
  var cur = s.icon || '📄';
  return '<div class="f"><label>اسم القسم *</label>'
    + '<input id="sf-title" class="inp" value="' + esc(s.title || '') + '" placeholder="مثال: اللقاحات"></div>'
    + '<div class="f"><label>الأيقونة</label><div class="segs wrap">'
    + icons.map(function (v) {
      return '<button type="button" class="seg' + (cur === v ? ' on' : '') + '"'
        + ' data-t="' + v + '" onclick="secPickIcon(this)">' + v + '</button>';
    }).join('')
    + '</div><input type="hidden" id="sf-icon" value="' + esc(cur) + '"></div>';
}
window.secPickIcon = function (btn) {
  var kids = btn.parentNode.children;
  for (var i = 0; i < kids.length; i++) kids[i].className = 'seg';
  btn.className = 'seg on';
  var hidden = $('sf-icon'); if (hidden) hidden.value = btn.getAttribute('data-t');
};
window.secNew = function () {
  openModal('➕ قسم جديد', secFormBody({ icon: '📋' })
    + '<div class="hint">القسم الجديد يبدأ بحقل «الاسم» فقط — أضِف إليه ما تشاء'
    + ' من «الحقول الإضافية»، وله تصنيفاته وسلّته ومجموعاته وطباعته كالبقية.</div>'
    + '<div class="mft"><button class="btn primary" onclick="secCreate()">إنشاء</button>'
    + '<button class="btn" onclick="closeModal()">إلغاء</button></div>');
};
window.secCreate = function () {
  var title = (($('sf-title') || {}).value || '').trim();
  if (!title) return toast('اسم القسم مطلوب', 'er');
  var sec = { id: 'sec_' + uid(), title: title, icon: ($('sf-icon') || {}).value || '📋', builtin: 0 };
  DB.sections.push(sec);
  DB[sec.id] = []; DB.cart[sec.id] = [];
  DB.out[sec.id] = [];
  KINDS = DB.sections.map(function (s) { return s.id; });
  Store.saveSection(sec); Store.setOut(sec.id);
  closeModal(); goPage(sec.id); toast('✅ أُنشئ القسم');
};
window.secEdit = function (id) {
  var s = secOf(id); if (!s) return;
  openModal('✏️ تعديل القسم', secFormBody(s)
    + '<div class="mft"><button class="btn primary" onclick="secSave(\'' + id + '\')">حفظ</button>'
    + '<button class="btn" onclick="closeModal()">إلغاء</button></div>');
};
window.secSave = function (id) {
  var s = secOf(id); if (!s) return;
  var title = (($('sf-title') || {}).value || '').trim();
  if (!title) return toast('اسم القسم مطلوب', 'er');
  s.title = title;
  s.icon = ($('sf-icon') || {}).value || s.icon;
  Store.saveSection(s);
  closeModal(); render(); toast('✅ حُفظ القسم');
};
window.secDel = function (id) {
  var s = secOf(id); if (!s || s.builtin) return;
  var n = coll(id).length;
  confirmBox('حذف قسم «' + s.title + '»؟'
    + (n ? ' سيُحذف معه ' + countWord(n, 'عنصر واحد', 'عنصران', 'عناصر', 'عنصرًا')
      + ' وتصنيفاته ومجموعاته.' : ''), function () {
    DB.sections = DB.sections.filter(function (x) { return x.id !== id; });
    DB.cats = DB.cats.filter(function (c) { return c.kind !== id; });
    DB.fields = DB.fields.filter(function (f) { return f.kind !== id; });
    DB.groups = DB.groups.filter(function (g) { return g.kind !== id; });
    delete DB[id]; delete DB.cart[id]; delete DB.out[id];
    KINDS = DB.sections.map(function (x) { return x.id; });
    Store.dropSection(id);
    closeModal(); goPage('secs'); toast('🗑️ حُذف القسم');
  });
};
window.secMove = function (id, dir) {
  var i = DB.sections.findIndex(function (s) { return s.id === id; });
  var j = i + dir;
  if (i < 0 || j < 0 || j >= DB.sections.length) return;
  var tmp = DB.sections[i]; DB.sections[i] = DB.sections[j]; DB.sections[j] = tmp;
  KINDS = DB.sections.map(function (s) { return s.id; });
  Store.setSectionOrder(KINDS);
  render();
};

/* ── صفحة قسمٍ أنشأه المستخدم ──
   عارض واحد يخدم أي قسم جديد: الاسم حقل ثابت، والتصنيف، ثم حقول المستخدم.
   بقيّة الوظائف (السلة، المجموعات، المعاينة، الطباعة) تعمل بلا سطر إضافي
   لأنها كلها تدور على `kind` لا على أسماء الحقول. */
function secRow(kind, o) {
  var on = DB.cart[kind].indexOf(o.id) >= 0;
  var sub = fieldsOf(kind).map(function (f) {
    var v = (o.extra || {})[f.key];
    return v ? '<div class="sub">' + esc(f.label) + ': ' + esc(v) + '</div>' : '';
  }).slice(0, 2).join('');
  return '<div class="card' + (on ? ' sel' : '') + '"><div class="row">'
    + '<input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="toggleCart(\'' + kind + '\',\'' + o.id + '\')">'
    + '<div class="grow" onclick="secItemForm(\'' + kind + '\',\'' + o.id + '\')">'
    + '<div class="name">' + esc(o.name) + (o.flag ? ' <span class="star">★</span>' : '') + '</div>'
    + sub + '</div>'
    + '<button class="ic" onclick="secItemForm(\'' + kind + '\',\'' + o.id + '\')">✏️</button>'
    + '<button class="ic" onclick="secItemDel(\'' + kind + '\',\'' + o.id + '\')">🗑️</button>'
    + '</div></div>';
}
function renderCustomSection(kind) {
  var L = kindLbl(kind);
  var q = (($('srch') || {}).value || '').trim().toLowerCase();
  var list = coll(kind).filter(function (o) {
    if (!q) return true;
    var hay = [o.name, o.category].concat(fieldsOf(kind).map(function (f) {
      return (o.extra || {})[f.key] || '';
    })).join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  });
  var ng = groupsOf(kind).length;
  var html = '<div class="toolbar">'
    + '<input id="srch" class="srch-inp" placeholder="🔎 ابحث…" value="' + esc(q) + '" oninput="render()">'
    + '<button class="btn" onclick="goPage(\'cat:' + kind + '\')">🏷️</button>'
    + '<button class="btn" onclick="goPage(\'grp:' + kind + '\')">📁' + (ng ? ' ' + ng : '') + '</button>'
    + '<button class="btn primary" onclick="secItemForm(\'' + kind + '\')">+ إضافة</button></div>';
  if (DB.cart[kind].length) html += cartBar(kind, DB.cart[kind].length);
  if (!list.length) {
    h('page', html + emptyBox(L.icon, 'لا شيء في ' + L.title,
      fieldsOf(kind).length ? 'اضغط «+ إضافة» لتبدأ'
        : 'أضِف حقولًا لهذا القسم من ⚙️ الإعدادات ← إدارة الأقسام'));
    return;
  }
  if (q) {
    html += list.map(function (o) { return secRow(kind, o); }).join('');
  } else {
    var fav = list.filter(function (o) { return o.flag; });
    if (fav.length) html += accBlock('⭐ مفضّلة', fav.map(function (o) { return secRow(kind, o); }).join(''), true);
    var gs = groupBy(list, kind), op = openByDefault(list, gs);
    gs.forEach(function (g) {
      html += accBlock(L.icon + ' ' + g.cat + ' (' + g.items.length + ')',
        g.items.map(function (o) { return secRow(kind, o); }).join(''), op);
    });
  }
  h('page', html);
}
window.secItemForm = function (kind, id) {
  var o = id ? (coll(kind).find(function (x) { return x.id === id; }) || {}) : {};
  var L = kindLbl(kind);
  var body = '<div class="f"><label>الاسم *</label>'
    + '<input id="cf-name" class="inp" value="' + esc(o.name || '') + '"></div>'
    + catField('cf', kind, o.category)
    + extraFields('cf', kind, o)
    + '<label class="chk-row"><input type="checkbox" id="cf-flag" ' + (o.flag ? 'checked' : '') + '> ⭐ مفضّل</label>'
    + '<div class="mft"><button class="btn primary" onclick="secItemSave(\'' + kind + '\',\'' + (id || '') + '\')">حفظ</button>'
    + '<button class="btn" onclick="closeModal()">إلغاء</button></div>';
  openModal((id ? '✏️ تعديل — ' : '+ إضافة — ') + L.title, body);
};
window.secItemSave = function (kind, id) {
  var body = {
    name: (($('cf-name') || {}).value || '').trim(),
    category: (($('cf-category') || {}).value || '').trim(),
    extra: readExtra('cf', kind),
    flag: ($('cf-flag') || {}).checked ? 1 : 0
  };
  if (!body.name) return toast('الاسم مطلوب', 'er');
  catEnsure(kind, body.category);
  var rec;
  if (id) { rec = coll(kind).find(function (x) { return x.id === id; }); Object.assign(rec, body); }
  else { body.id = uid(); coll(kind).push(body); rec = body; }
  Store.upsert(kind, rec); closeModal(); toast('✅ تم الحفظ');
  if (curPage() !== kind) goPage(kind); else render();
};
window.secItemDel = function (kind, id) {
  confirmBox('حذف هذا العنصر؟', function () {
    setColl(kind, coll(kind).filter(function (x) { return x.id !== id; }));
    DB.cart[kind] = DB.cart[kind].filter(function (x) { return x !== id; });
    Store.remove(kind, id); closeModal(); toast('🗑️ تم الحذف'); render();
  });
};

/* ════════════════════════ 🧩 الحقول الإضافية ════════════════════════
   حقل يعرّفه المستخدم داخل بيانات العنصر. قيمته تُحفَظ في `extra` (JSON)
   على صفّ العنصر نفسه، فلا يتغيّر مخطط القاعدة كلّما أُضيف حقل. ويظهر في
   النموذج وفي «الحقول المرسلة» كأي حقل أصلي. */

function fieldsOf(kind) {
  return DB.fields.filter(function (f) { return f.kind === kind; });
}
/** مفتاح ثابت لا يتغيّر بتغيّر التسمية، فلا تضيع القيم عند إعادة التسمية. */
function fieldKey() { return 'f' + uid(); }

function renderFieldsPage(kind) {
  var L = kindLbl(kind), list = fieldsOf(kind);
  var html = '<button class="btn full primary" onclick="fldNew(\'' + kind + '\')">➕ حقل جديد</button>'
    + '<div class="hint">حقول تضيفها لبيانات ' + esc(L.title) + '. تظهر في نموذج'
    + ' العنصر، وتقدر تختارها في «الحقول المرسلة» لتُطبع وتُرسَل.</div>';

  if (!list.length) {
    h('page', html + emptyBox('🧩', 'لا حقول إضافية', 'الحقول الأصلية للقسم موجودة دائمًا'));
    return;
  }
  html += list.map(function (f, i) {
    return '<div class="card"><div class="row">'
      + '<div class="grow"><div class="name">🧩 ' + esc(f.label) + '</div>'
      + '<div class="sub">' + (f.type === 'area' ? 'نصّ طويل' : 'سطر واحد') + '</div></div>'
      + '<button class="ic"' + (i === 0 ? ' disabled' : '')
      + ' onclick="fldMove(\'' + kind + '\',\'' + f.id + '\',-1)">⬆️</button>'
      + '<button class="ic"' + (i === list.length - 1 ? ' disabled' : '')
      + ' onclick="fldMove(\'' + kind + '\',\'' + f.id + '\',1)">⬇️</button>'
      + '<button class="ic" onclick="fldEdit(\'' + kind + '\',\'' + f.id + '\')">✏️</button>'
      + '<button class="ic" onclick="fldDel(\'' + kind + '\',\'' + f.id + '\')">🗑️</button>'
      + '</div></div>';
  }).join('');
  h('page', html);
}
function fldFormBody(f) {
  var t = f.type || 'text';
  return '<div class="f"><label>اسم الحقل *</label>'
    + '<input id="ff-label" class="inp" value="' + esc(f.label || '') + '" placeholder="مثال: الشركة المصنّعة"></div>'
    + '<div class="f"><label>نوع الحقل</label><div class="segs">'
    + [['text', 'سطر واحد'], ['area', 'نصّ طويل']].map(function (o) {
      return '<button type="button" class="seg' + (t === o[0] ? ' on' : '') + '"'
        + ' data-t="' + o[0] + '" onclick="fldPickType(this)">' + o[1] + '</button>';
    }).join('')
    + '</div><input type="hidden" id="ff-type" value="' + t + '"></div>';
}
window.fldPickType = function (btn) {
  var kids = btn.parentNode.children;
  for (var i = 0; i < kids.length; i++) kids[i].className = 'seg';
  btn.className = 'seg on';
  var hidden = $('ff-type'); if (hidden) hidden.value = btn.getAttribute('data-t');
};
window.fldNew = function (kind) {
  openModal('➕ حقل جديد', fldFormBody({})
    + '<div class="mft"><button class="btn primary" onclick="fldCreate(\'' + kind + '\')">إنشاء</button>'
    + '<button class="btn" onclick="closeModal()">إلغاء</button></div>');
};
window.fldCreate = function (kind) {
  var label = (($('ff-label') || {}).value || '').trim();
  if (!label) return toast('اسم الحقل مطلوب', 'er');
  var f = { id: uid(), kind: kind, key: fieldKey(), label: label,
            type: ($('ff-type') || {}).value || 'text' };
  DB.fields.push(f); Store.saveField(f);
  closeModal(); render(); toast('✅ أُضيف الحقل');
};
window.fldEdit = function (kind, id) {
  var f = DB.fields.find(function (x) { return x.id === id; }); if (!f) return;
  openModal('✏️ تعديل الحقل', fldFormBody(f)
    + '<div class="mft"><button class="btn primary" onclick="fldSave(\'' + id + '\')">حفظ</button>'
    + '<button class="btn" onclick="closeModal()">إلغاء</button></div>');
};
window.fldSave = function (id) {
  var f = DB.fields.find(function (x) { return x.id === id; }); if (!f) return;
  var label = (($('ff-label') || {}).value || '').trim();
  if (!label) return toast('اسم الحقل مطلوب', 'er');
  // المفتاح لا يتغيّر — إعادة التسمية لا تفقد القيم المحفوظة
  f.label = label;
  f.type = ($('ff-type') || {}).value || f.type;
  Store.saveField(f);
  closeModal(); render(); toast('✅ حُفظ الحقل');
};
window.fldDel = function (kind, id) {
  var f = DB.fields.find(function (x) { return x.id === id; }); if (!f) return;
  confirmBox('حذف حقل «' + f.label + '»؟ ما كُتب فيه داخل العناصر لن يظهر بعدها.', function () {
    DB.fields = DB.fields.filter(function (x) { return x.id !== id; });
    DB.out[kind] = (DB.out[kind] || []).filter(function (k) { return k !== 'x:' + f.key; });
    Store.dropField(id); Store.setOut(kind);
    closeModal(); render(); toast('🗑️ حُذف الحقل');
  });
};
window.fldMove = function (kind, id, dir) {
  var list = fieldsOf(kind);
  var i = list.findIndex(function (f) { return f.id === id; });
  var j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
  DB.fields = DB.fields.filter(function (f) { return f.kind !== kind; }).concat(list);
  Store.setFieldOrder(DB.fields.map(function (f) { return f.id; }));
  render();
};

/** حقول المستخدم داخل نموذج العنصر — تُقرأ وتُكتب في o.extra. */
function extraFields(pfx, kind, o) {
  var x = (o && o.extra) || {};
  return fieldsOf(kind).map(function (f) {
    var id = pfx + '-x-' + f.key;
    if (f.type === 'area') return taField(id, f.label, x[f.key] || '');
    return '<div class="f"><label>' + esc(f.label) + '</label>'
      + '<input id="' + id + '" class="inp" value="' + esc(x[f.key] || '') + '"></div>';
  }).join('');
}
function readExtra(pfx, kind) {
  var out = {};
  fieldsOf(kind).forEach(function (f) {
    var el = $(pfx + '-x-' + f.key);
    var v = el ? String(el.value || '').trim() : '';
    if (v) out[f.key] = v;
  });
  return out;
}

/* ════════════════════════ 🏷️ التصنيفات ════════════════════════
   التصنيف كيان مستقل لا نصّ داخل العنصر: يُنشأ ويُسمّى ويُرتَّب ويُحذف قبل
   وجود أي عنصر فيه، والعناصر تسكنه. العنصر يشير للتصنيف بالاسم (لا
   بالمعرّف) فتبقى النسخة الاحتياطية مقروءة بذاتها، وإعادة التسمية تُنفَّذ
   بتحديث واحد على كل عناصر القسم. */

/* تصنيفات الوصفات وحدها مكتوبة هنا — لا مكتبة جاهزة لها. */
var RX_CAT_SEED = ['أعشاب ومشروبات', 'تغذية علاجية', 'عناية موضعية', 'مكمّلات طبيعية'];

/** التصنيفات المبدئية تُؤخذ من المكتبة الجاهزة نفسها لا من قائمة موازية:
    لو كتبناها يدويًا لاختلفت بحرف («مسكّنات» و«مسكنات») فظهر تصنيفان
    متطابقان معنى أول مرة يستورد فيها المستخدم من المكتبة. */
function seedList(kind) {
  if (kind === 'recipes') return RX_CAT_SEED;
  var out = [];
  ((window.LIBRARY || {})[kind] || []).forEach(function (o) {
    var c = (o.category || '').trim();
    if (c && out.indexOf(c) < 0) out.push(c);
  });
  return out;
}

function catsRaw(kind) {
  return DB.cats.filter(function (c) { return c.kind === kind; });
}
/** أسماء تصنيفات القسم بالترتيب، مع أي اسم موجود في العناصر ولم يُسجَّل بعد. */
function catNames(kind) {
  var out = catsRaw(kind).map(function (c) { return c.name; });
  coll(kind).forEach(function (o) {
    var c = (o.category || '').trim();
    if (c && out.indexOf(c) < 0) out.push(c);
  });
  return out;
}
function catByName(kind, name) {
  return catsRaw(kind).find(function (c) { return c.name === name; });
}
function catCount(kind, name) {
  return coll(kind).filter(function (o) { return (o.category || '').trim() === name; }).length;
}
/** يضمن وجود التصنيف قبل الحفظ — يُنادى عند حفظ عنصر أو استيراد من المكتبة. */
function catEnsure(kind, name) {
  name = (name || '').trim();
  if (!name || catByName(kind, name)) return;
  var c = { id: uid(), kind: kind, name: name };
  DB.cats.push(c); Store.saveCat(c);
}
/** الزرع مرّة واحدة فقط: حذف المستخدم لتصنيف مزروع لا يعيده الإقلاع التالي.
    القاعدة المرقّاة تصل ومعها تصنيفات مبنيّة من عناصرها، فلا تُزرَع فوقها. */
function seedCats() {
  if (DB.cats_seeded || DB.cats.length) return;
  KINDS.forEach(function (k) {
    seedList(k).forEach(function (n) {
      var c = { id: uid(), kind: k, name: n };
      DB.cats.push(c); Store.saveCat(c);
    });
  });
  DB.cats_seeded = 1; Store.setSeeded();
}

/** اختيار التصنيف: قائمة منسدلة سطرًا واحدًا مهما كثرت التصنيفات، وفيها
    خيار إنشاء تصنيف جديد يكشف حقل اسمه بلا مغادرة النموذج. */
/* خيار «تصنيف جديد» آخر القائمة دائمًا، ونتعرّف عليه بموقعه لا بقيمته:
   أي قيمة حارسة قد يكتبها المستخدم اسمًا لتصنيف، كما أن المحرف NUL يُستبدَل
   أصلًا عند تحليل HTML فلا تعود المقارنة النصّية صحيحة. */
var CAT_NEW = '__new__';
function catIsNew(sel) { return sel.selectedIndex === sel.options.length - 1; }
function catField(pfx, kind, cur) {
  cur = (cur || '').trim();
  var names = catNames(kind);
  var known = !cur || names.indexOf(cur) >= 0;
  return '<div class="f"><label>التصنيف</label>'
    + '<select id="' + pfx + '-catsel" class="inp sel" onchange="catSel(\'' + pfx + '\')">'
    + '<option value=""' + (cur ? '' : ' selected') + '>— بلا تصنيف —</option>'
    + names.map(function (n) {
      return '<option value="' + esc(n) + '"' + (cur === n ? ' selected' : '') + '>' + esc(n) + '</option>';
    }).join('')
    + '<option value="' + CAT_NEW + '"' + (known ? '' : ' selected') + '>➕ تصنيف جديد…</option>'
    + '</select>'
    + '<input id="' + pfx + '-catnew" class="inp" style="margin-top:7px'
    + (known ? ';display:none' : '') + '" value="' + (known ? '' : esc(cur)) + '"'
    + ' placeholder="اسم التصنيف الجديد" oninput="catNewInput(\'' + pfx + '\')">'
    + '<input type="hidden" id="' + pfx + '-category" value="' + esc(cur) + '"></div>';
}
window.catSel = function (pfx) {
  var sel = $(pfx + '-catsel'), nw = $(pfx + '-catnew'), hidden = $(pfx + '-category');
  if (!sel || !hidden) return;
  if (catIsNew(sel)) {
    if (nw) { nw.style.display = ''; nw.focus(); hidden.value = String(nw.value || '').trim(); }
    return;
  }
  if (nw) { nw.value = ''; nw.style.display = 'none'; }
  hidden.value = sel.value;
};
window.catNewInput = function (pfx) {
  var nw = $(pfx + '-catnew'), hidden = $(pfx + '-category');
  if (nw && hidden) hidden.value = String(nw.value || '').trim();
};

/* ── صفحة إدارة التصنيفات ── */
function renderCatsPage(kind) {
  var L = kindLbl(kind), cats = catsRaw(kind);
  var orphans = catNames(kind).filter(function (n) { return !catByName(kind, n); });
  var html = '<button class="btn full primary" onclick="catNew(\'' + kind + '\')">➕ تصنيف جديد</button>';

  if (!cats.length && !orphans.length) {
    h('page', html + emptyBox('🏷️', 'لا توجد تصنيفات', 'أنشئ تصنيفًا ثم أسنِد إليه عناصرك'));
    return;
  }
  html += '<div class="hint">التصنيف يظهر في القسم عند وجود عنصر فيه. إعادة'
    + ' التسمية تنقل كل عناصره معه، والحذف يعيدها «غير مصنّف».</div>';

  html += cats.map(function (c, i) {
    var n = catCount(kind, c.name);
    return '<div class="card"><div class="row">'
      + '<div class="grow"><div class="name">🏷️ ' + esc(c.name) + '</div>'
      + '<div class="sub">' + (n ? countWord(n, L.one, L.two, L.few, L.many) : 'فارغ') + '</div></div>'
      + '<button class="ic"' + (i === 0 ? ' disabled' : '')
      + ' onclick="catMove(\'' + kind + '\',\'' + c.id + '\',-1)">⬆️</button>'
      + '<button class="ic"' + (i === cats.length - 1 ? ' disabled' : '')
      + ' onclick="catMove(\'' + kind + '\',\'' + c.id + '\',1)">⬇️</button>'
      + '<button class="ic" onclick="catRename(\'' + kind + '\',\'' + c.id + '\')">✏️</button>'
      + '<button class="ic" onclick="catDel(\'' + kind + '\',\'' + c.id + '\')">🗑️</button>'
      + '</div></div>';
  }).join('');

  // أسماء مكتوبة داخل العناصر ولم تُسجَّل كتصنيفات (نسخة قديمة أو استيراد)
  if (orphans.length) {
    html += orphans.map(function (n) {
      return '<div class="card"><div class="row">'
        + '<div class="grow"><div class="name">🏷️ ' + esc(n) + '</div>'
        + '<div class="sub">' + countWord(catCount(kind, n), L.one, L.two, L.few, L.many)
        + ' — غير مسجّل</div></div>'
        + '<button class="btn sm" onclick="catAdopt(\'' + kind + '\',\'' + esc(n) + '\')">تسجيل</button>'
        + '</div></div>';
    }).join('');
  }
  h('page', html);
}
window.catNew = function (kind) {
  openModal('➕ تصنيف جديد',
    '<div class="f"><label>اسم التصنيف *</label>'
    + '<input id="cn" class="inp" placeholder="' + esc(seedList(kind)[0] || 'اسم التصنيف') + '"></div>'
    + '<div class="mft"><button class="btn primary" onclick="catCreate(\'' + kind + '\')">إنشاء</button>'
    + '<button class="btn" onclick="closeModal()">إلغاء</button></div>');
};
window.catCreate = function (kind) {
  var name = (($('cn') || {}).value || '').trim();
  if (!name) return toast('الاسم مطلوب', 'er');
  if (catByName(kind, name)) return toast('التصنيف موجود', 'er');
  catEnsure(kind, name);
  closeModal(); render(); toast('✅ أُنشئ التصنيف');
};
window.catRename = function (kind, id) {
  var c = DB.cats.find(function (x) { return x.id === id; }); if (!c) return;
  openModal('✏️ إعادة تسمية التصنيف',
    '<div class="f"><label>اسم التصنيف *</label>'
    + '<input id="cn" class="inp" value="' + esc(c.name) + '"></div>'
    + '<div class="hint">سيُنقل ' + countWord(catCount(kind, c.name), kindLbl(kind).one,
      kindLbl(kind).two, kindLbl(kind).few, kindLbl(kind).many) + ' إلى الاسم الجديد.</div>'
    + '<div class="mft"><button class="btn primary" onclick="catRenameSave(\'' + kind + '\',\'' + id + '\')">حفظ</button>'
    + '<button class="btn" onclick="closeModal()">إلغاء</button></div>');
};
window.catRenameSave = function (kind, id) {
  var c = DB.cats.find(function (x) { return x.id === id; }); if (!c) return;
  var name = (($('cn') || {}).value || '').trim();
  if (!name) return toast('الاسم مطلوب', 'er');
  if (name === c.name) { closeModal(); return; }
  if (catByName(kind, name)) return toast('التصنيف موجود', 'er');
  var old = c.name;
  c.name = name;
  coll(kind).forEach(function (o) { if ((o.category || '').trim() === old) o.category = name; });
  Store.saveCat(c);
  Store.moveCatItems(kind, old, name);
  closeModal(); render(); toast('✅ أُعيدت التسمية');
};
window.catDel = function (kind, id) {
  var c = DB.cats.find(function (x) { return x.id === id; }); if (!c) return;
  var n = catCount(kind, c.name);
  confirmBox('حذف التصنيف «' + c.name + '»؟'
    + (n ? ' لن يُحذف أي عنصر — تعود عناصره «غير مصنّف».' : ''), function () {
    DB.cats = DB.cats.filter(function (x) { return x.id !== id; });
    coll(kind).forEach(function (o) { if ((o.category || '').trim() === c.name) o.category = ''; });
    Store.moveCatItems(kind, c.name, '');
    Store.dropCat(id);
    closeModal(); render(); toast('🗑️ حُذف التصنيف');
  });
};
/** تسجيل اسم كُتِب داخل العناصر ليصير تصنيفًا كامل الصلاحيات. */
window.catAdopt = function (kind, name) {
  catEnsure(kind, name); render(); toast('✅ سُجّل التصنيف');
};
window.catMove = function (kind, id, dir) {
  var cats = catsRaw(kind);
  var i = cats.findIndex(function (c) { return c.id === id; });
  var j = i + dir;
  if (i < 0 || j < 0 || j >= cats.length) return;
  var tmp = cats[i]; cats[i] = cats[j]; cats[j] = tmp;
  // DB.cats تخلط الأقسام، فنعيد بناءها بترتيب هذا القسم الجديد مع إبقاء غيره
  var rest = DB.cats.filter(function (c) { return c.kind !== kind; });
  DB.cats = rest.concat(cats);
  Store.setCatOrder(DB.cats.map(function (c) { return c.id; }));
  render();
};

/* ════════════════════════ 💊 العلاجات ════════════════════════ */
var MED_FLD = [
  ['trade_name', 'الاسم التجاري', false],
  ['scientific_name', 'الاسم العلمي', false],
  ['category', 'التصنيف', false],
  ['concentration', 'التركيز', false],
  ['dosage', 'الجرعات', false],
  ['duration', 'مدة الاستخدام', false],
  ['uses', 'الاستخدامات', true],
  ['cautions', 'المحاذير', true],
  ['notes', 'ملاحظات', true]
];

function medRow(m) {
  var on = DB.cart.meds.indexOf(m.id) >= 0;
  return '<div class="card' + (on ? ' sel' : '') + '">'
    + '<div class="row">'
    + '<input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="toggleCart(\'meds\',\'' + m.id + '\')">'
    + '<div class="grow" onclick="medForm(\'' + m.id + '\')">'
    + '<div class="name">' + esc(m.trade_name) + (m.default_include ? ' <span class="star">★</span>' : '') + '</div>'
    + (m.scientific_name ? '<div class="sub">' + esc(m.scientific_name) + (m.concentration ? ' • ' + esc(m.concentration) : '') + '</div>' : '')
    + (m.dosage ? '<div class="req">💊 ' + esc(m.dosage) + '</div>' : '')
    + '</div>'
    + '<button class="ic" onclick="medForm(\'' + m.id + '\')">✏️</button>'
    + '<button class="ic" onclick="medDel(\'' + m.id + '\')">🗑️</button>'
    + '</div></div>';
}
function renderMeds() {
  var q = (($('srch') || {}).value || '').trim().toLowerCase();
  var list = DB.meds.filter(function (m) {
    return !q || (m.trade_name + ' ' + (m.scientific_name || '') + ' ' + (m.category || '')).toLowerCase().indexOf(q) >= 0;
  });
  var ng = groupsOf('meds').length;
  var html = '<div class="toolbar">'
    + '<input id="srch" class="srch-inp" placeholder="🔎 ابحث بالاسم أو التصنيف…" value="' + esc(q) + '" oninput="renderMeds()">'
    + '<button class="btn" onclick="goPage(\'cat:meds\')">🏷️</button>'
    + '<button class="btn" onclick="goPage(\'grp:meds\')">📁' + (ng ? ' ' + ng : '') + '</button>'
    + '<button class="btn primary" onclick="medForm()">+ إضافة</button></div>';
  if (DB.cart.meds.length) html += cartBar('meds', DB.cart.meds.length);
  if (!list.length) { h('page', html + emptyBox('💊', 'لا توجد علاجات محفوظة', 'أضِف واحدًا، أو استورد من المكتبة الجاهزة في ⚙️')); return; }

  if (q) {
    html += list.map(medRow).join('');
  } else {
    var fav = list.filter(function (m) { return m.default_include; });
    if (fav.length) html += accBlock('⭐ افتراضية', fav.map(medRow).join(''), true);
    var gs = groupBy(list, 'meds'), op = openByDefault(list, gs);
    gs.forEach(function (g) {
      html += accBlock('💊 ' + g.cat + ' (' + g.items.length + ')', g.items.map(medRow).join(''), op);
    });
  }
  h('page', html);
}
/* الطيّ للقوائم الطويلة فقط. قائمة قصيرة كلها مطويّة تعني ألا يرى المستخدم
   اسم عنصر واحد — وهذا ما كان يحدث في الوصفات (نوعان مطويّان بلا أسماء). */
function openByDefault(list, groups) { return groups.length === 1 || list.length <= 40; }

var UNCAT = 'غير مصنّف';
/** تجميع عناصر القسم في تصنيفاتها، بترتيب التصنيفات كما رتّبها المستخدم.
    التصنيفات الفارغة لا تظهر هنا — مكانها صفحة إدارة التصنيفات. */
function groupBy(list, kind) {
  var byCat = {}, extra = [];
  list.forEach(function (o) {
    var c = (o.category || '').trim() || UNCAT;
    if (!byCat[c]) { byCat[c] = []; if (c !== UNCAT) extra.push(c); }
    byCat[c].push(o);
  });
  var order = catNames(kind).filter(function (c) { return byCat[c]; });
  extra.forEach(function (c) { if (order.indexOf(c) < 0) order.push(c); });
  if (byCat[UNCAT]) order.push(UNCAT);              // غير المصنّف آخرًا دائمًا
  return order.map(function (c) { return { cat: c, items: byCat[c] }; });
}
function emptyBox(icon, title, sub) {
  return '<div class="empty"><div class="ei">' + icon + '</div><div class="et">' + esc(title) + '</div><div class="es">' + esc(sub) + '</div></div>';
}
function cartBar(kind, n) {
  return '<div class="cartbar">'
    + '<span>📝 المحدد: ' + n + '</span>'
    + '<span class="grow"></span>'
    // مخرج واحد: المعاينة — منها يختار المستخدم PDF أو صورة أو طباعة أو نسخًا
    // بعد أن يرى ما سيُرسَل. هذا يبقي الشريط مقروءًا ويمنع الإرسال بالخطأ.
    + '<button class="btn primary sm" onclick="previewCart(\'' + kind + '\')">👁️ عرض وإرسال</button>'
    + '<button class="btn white sm" onclick="groupFromCart(\'' + kind + '\')">💾 مجموعة</button>'
    + '<button class="btn ghost sm" onclick="clearCart(\'' + kind + '\')">مسح</button>'
    + '</div>';
}
window.toggleCart = function (kind, id) {
  var arr = DB.cart[kind]; var i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1); else arr.push(id);
  Store.setCart(kind); render();
};
window.clearCart = function (kind) { DB.cart[kind] = []; Store.setCart(kind); render(); };

window.medForm = function (id) {
  var m = id ? (DB.meds.find(function (x) { return x.id === id; }) || {}) : {};
  var body = MED_FLD.map(function (f) {
    var key = f[0], lbl = f[1], area = f[2];
    var v = esc(m[key] || '');
    if (key === 'category') return catField('mf', 'meds', m.category);
    if (area) return taField('mf-' + key, lbl, m[key] || '');
    return '<div class="f"><label>' + lbl + (key === 'trade_name' ? ' *' : '') + '</label>'
      + '<input id="mf-' + key + '" class="inp" value="' + v + '"></div>';
  }).join('');
  body += extraFields('mf', 'meds', m);
  body += '<label class="chk-row"><input type="checkbox" id="mf-default" ' + (m.default_include ? 'checked' : '') + '> ⭐ محدَّد افتراضيًا</label>';
  body += '<div class="mft"><button class="btn primary" onclick="medSave(\'' + (id || '') + '\')">حفظ</button><button class="btn" onclick="closeModal()">إلغاء</button></div>';
  openModal(id ? '✏️ تعديل علاج' : '+ إضافة علاج', body);
};
window.medSave = function (id) {
  var body = {};
  MED_FLD.forEach(function (f) { var el = $('mf-' + f[0]); body[f[0]] = el ? el.value.trim() : ''; });
  body.default_include = ($('mf-default') || {}).checked ? 1 : 0;
  body.extra = readExtra('mf', 'meds');
  if (!body.trade_name) return toast('الاسم التجاري مطلوب', 'er');
  catEnsure('meds', body.category);
  var rec;
  if (id) { rec = DB.meds.find(function (x) { return x.id === id; }); Object.assign(rec, body); }
  else { body.id = uid(); DB.meds.push(body); rec = body; }
  Store.upsert('meds', rec); closeModal(); toast('✅ تم الحفظ');
  if (curPage() === 'home') goPage('meds'); else render();
};
window.medDel = function (id) {
  confirmBox('حذف هذا العلاج؟', function () {
    DB.meds = DB.meds.filter(function (x) { return x.id !== id; });
    DB.cart.meds = DB.cart.meds.filter(function (x) { return x !== id; });
    Store.remove('meds', id); closeModal(); toast('🗑️ تم الحذف'); render();
  });
};

/* ════════════════════════ 🧪 التحاليل ════════════════════════ */
function labRow(t) {
  var on = DB.cart.labs.indexOf(t.id) >= 0;
  return '<div class="card' + (on ? ' sel' : '') + '">'
    + '<div class="row">'
    + '<input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="toggleCart(\'labs\',\'' + t.id + '\')">'
    + '<div class="grow" onclick="labForm(\'' + t.id + '\')">'
    + '<div class="name">' + esc(t.code || t.name) + (t.is_common ? ' <span class="star">★</span>' : '') + '</div>'
    + (t.code ? '<div class="sub">' + esc(t.name) + '</div>' : '')
    + (t.requirements ? '<div class="req">📋 ' + esc(t.requirements) + '</div>' : '')
    + (t.prohibitions ? '<div class="ban">⛔ ' + esc(t.prohibitions) + '</div>' : '')
    + '</div>'
    + '<button class="ic" onclick="labForm(\'' + t.id + '\')">✏️</button>'
    + '<button class="ic" onclick="labDel(\'' + t.id + '\')">🗑️</button>'
    + '</div></div>';
}
function renderLabs() {
  var q = (($('srch') || {}).value || '').trim().toLowerCase();
  var ng = groupsOf('labs').length;
  var html = '<div class="toolbar">'
    + '<input id="srch" class="srch-inp" placeholder="🔎 ابحث بالرمز أو الاسم أو التخصص…" value="' + esc(q) + '" oninput="renderLabs()">'
    + '<button class="btn" onclick="goPage(\'cat:labs\')">🏷️</button>'
    + '<button class="btn" onclick="goPage(\'grp:labs\')">📁' + (ng ? ' ' + ng : '') + '</button>'
    + '<button class="btn primary" onclick="labForm()">+ إضافة</button></div>';
  if (DB.cart.labs.length) html += cartBar('labs', DB.cart.labs.length);

  var list = DB.labs.filter(function (t) {
    return !q || ((t.code || '') + ' ' + t.name + ' ' + (t.category || '') + ' ' + (t.purpose || '')).toLowerCase().indexOf(q) >= 0;
  });
  if (!list.length) { h('page', html + emptyBox('🧪', 'لا توجد تحاليل محفوظة', 'أضِف واحدًا، أو استورد من المكتبة الجاهزة في ⚙️')); return; }

  if (q) {
    html += list.map(labRow).join('');
  } else {
    var common = list.filter(function (t) { return t.is_common; });
    if (common.length) html += accBlock('⭐ شائعة', common.map(labRow).join(''), true);
    var gs = groupBy(list, 'labs'), op = openByDefault(list, gs);
    gs.forEach(function (g) {
      html += accBlock('🧪 ' + g.cat + ' (' + g.items.length + ')', g.items.map(labRow).join(''), op);
    });
  }
  h('page', html);
}
var _accSeq = 0;
function accBlock(title, inner, open) {
  var id = 'acc' + (_accSeq++);
  return '<details class="acc"' + (open ? ' open' : '') + '><summary>' + esc(title) + '<span class="arrow">▾</span></summary><div class="acc-b">' + inner + '</div></details>';
}
window.labForm = function (id) {
  var t = id ? (DB.labs.find(function (x) { return x.id === id; }) || {}) : {};
  var body = catField('lf', 'labs', t.category)
    + '<div class="f"><label>اسم التحليل *</label><input id="lf-name" class="inp" value="' + esc(t.name || '') + '" placeholder="مثال: صورة دم كاملة"></div>'
    + '<div class="f"><label>رمز التحليل (المصطلح)</label><input id="lf-code" class="inp" dir="ltr" value="' + esc(t.code || '') + '" placeholder="مثال: CBC"></div>'
    + taField('lf-purpose', 'الهدف من التحليل', t.purpose, 'مثال: تقييم فقر الدم والالتهابات')
    + taField('lf-requirements', 'متطلبات التحليل', t.requirements, 'مثال: صيام ٨–١٢ ساعة')
    + taField('lf-prohibitions', 'ممنوعات التحليل', t.prohibitions, 'مثال: لا يُجرى بعد بدء المضاد الحيوي')
    + extraFields('lf', 'labs', t)
    + '<label class="chk-row"><input type="checkbox" id="lf-common" ' + (t.is_common ? 'checked' : '') + '> ⭐ تحليل شائع</label>'
    + '<div class="mft"><button class="btn primary" onclick="labSave(\'' + (id || '') + '\')">حفظ</button><button class="btn" onclick="closeModal()">إلغاء</button></div>';
  openModal(id ? '✏️ تعديل تحليل' : '+ إضافة تحليل', body);
};
window.labSave = function (id) {
  var body = {
    category: ($('lf-category') || {}).value.trim(),
    code: ($('lf-code') || {}).value.trim(),
    name: ($('lf-name') || {}).value.trim(),
    purpose: ($('lf-purpose') || {}).value.trim(),
    requirements: ($('lf-requirements') || {}).value.trim(),
    prohibitions: ($('lf-prohibitions') || {}).value.trim(),
    is_common: ($('lf-common') || {}).checked ? 1 : 0,
    extra: readExtra('lf', 'labs')
  };
  if (!body.name) return toast('اسم التحليل مطلوب', 'er');
  catEnsure('labs', body.category);
  var rec;
  if (id) { rec = DB.labs.find(function (x) { return x.id === id; }); Object.assign(rec, body); }
  else { body.id = uid(); DB.labs.push(body); rec = body; }
  Store.upsert('labs', rec); closeModal(); toast('✅ تم الحفظ');
  if (curPage() === 'home') goPage('labs'); else render();
};
window.labDel = function (id) {
  confirmBox('حذف هذا التحليل؟', function () {
    DB.labs = DB.labs.filter(function (x) { return x.id !== id; });
    DB.cart.labs = DB.cart.labs.filter(function (x) { return x !== id; });
    Store.remove('labs', id); closeModal(); toast('🗑️ تم الحذف'); render();
  });
};

/* ════════════════════════ 📷 الأشعة والفحوصات ════════════════════════
   تصوير ومناظير وتخطيط — بنيتها كالتحاليل مع «المنطقة أو العضو» بدل الرمز. */
function imgRow(t) {
  var on = DB.cart.imaging.indexOf(t.id) >= 0;
  return '<div class="card' + (on ? ' sel' : '') + '">'
    + '<div class="row">'
    + '<input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="toggleCart(\'imaging\',\'' + t.id + '\')">'
    + '<div class="grow" onclick="imgForm(\'' + t.id + '\')">'
    + '<div class="name">' + esc(t.name) + (t.is_common ? ' <span class="star">★</span>' : '')
    + (t.region ? ' <span class="chip">' + esc(t.region) + '</span>' : '') + '</div>'
    + (t.purpose ? '<div class="sub">' + esc(t.purpose) + '</div>' : '')
    + (t.requirements ? '<div class="req">📋 ' + esc(t.requirements) + '</div>' : '')
    + (t.prohibitions ? '<div class="ban">⛔ ' + esc(t.prohibitions) + '</div>' : '')
    + '</div>'
    + '<button class="ic" onclick="imgForm(\'' + t.id + '\')">✏️</button>'
    + '<button class="ic" onclick="imgDel(\'' + t.id + '\')">🗑️</button>'
    + '</div></div>';
}
function renderImaging() {
  var q = (($('srch') || {}).value || '').trim().toLowerCase();
  var list = DB.imaging.filter(function (t) {
    return !q || [t.name, t.category, t.region, t.purpose, t.requirements].join(' ').toLowerCase().indexOf(q) >= 0;
  });
  var ng = groupsOf('imaging').length;
  var html = '<div class="toolbar">'
    + '<input id="srch" class="srch-inp" placeholder="🔎 ابحث بالاسم أو النوع أو المنطقة…" value="' + esc(q) + '" oninput="renderImaging()">'
    + '<button class="btn" onclick="goPage(\'cat:imaging\')">🏷️</button>'
    + '<button class="btn" onclick="goPage(\'grp:imaging\')">📁' + (ng ? ' ' + ng : '') + '</button>'
    + '<button class="btn primary" onclick="imgForm()">+ إضافة</button></div>';
  if (DB.cart.imaging.length) html += cartBar('imaging', DB.cart.imaging.length);
  if (!list.length) { h('page', html + emptyBox('📷', 'لا توجد فحوصات محفوظة', 'أضِف واحدًا، أو استورد من المكتبة الجاهزة في ⚙️')); return; }

  if (q) {
    html += list.map(imgRow).join('');
  } else {
    var common = list.filter(function (t) { return t.is_common; });
    if (common.length) html += accBlock('⭐ شائعة', common.map(imgRow).join(''), true);
    var gs = groupBy(list, 'imaging'), op = openByDefault(list, gs);
    gs.forEach(function (g) {
      html += accBlock('📷 ' + g.cat + ' (' + g.items.length + ')', g.items.map(imgRow).join(''), op);
    });
  }
  h('page', html);
}
window.imgForm = function (id) {
  var t = id ? (DB.imaging.find(function (x) { return x.id === id; }) || {}) : {};
  var body = catField('if', 'imaging', t.category)
    + '<div class="f"><label>اسم الفحص *</label><input id="if-name" class="inp" value="' + esc(t.name || '') + '" placeholder="مثال: رنين مغناطيسي للعمود القطني"></div>'
    + '<div class="f"><label>المنطقة أو العضو</label><input id="if-region" class="inp" value="' + esc(t.region || '') + '" placeholder="مثال: العمود القطني"></div>'
    + taField('if-purpose', 'الهدف من الفحص', t.purpose, 'مثال: تقييم الانزلاق الغضروفي')
    + taField('if-requirements', 'التحضير المطلوب', t.requirements, 'مثال: صيام ٦ ساعات، إحضار فحوصات الكلى')
    + taField('if-prohibitions', 'موانع الإجراء', t.prohibitions, 'مثال: الحمل، منظّم ضربات القلب')
    + extraFields('if', 'imaging', t)
    + '<label class="chk-row"><input type="checkbox" id="if-common" ' + (t.is_common ? 'checked' : '') + '> ⭐ فحص شائع</label>'
    + '<div class="mft"><button class="btn primary" onclick="imgSave(\'' + (id || '') + '\')">حفظ</button><button class="btn" onclick="closeModal()">إلغاء</button></div>';
  openModal(id ? '✏️ تعديل فحص' : '+ إضافة فحص/أشعة', body);
};
window.imgSave = function (id) {
  var body = {
    category: ($('if-category') || {}).value.trim(),
    name: ($('if-name') || {}).value.trim(),
    region: ($('if-region') || {}).value.trim(),
    purpose: ($('if-purpose') || {}).value.trim(),
    requirements: ($('if-requirements') || {}).value.trim(),
    prohibitions: ($('if-prohibitions') || {}).value.trim(),
    is_common: ($('if-common') || {}).checked ? 1 : 0,
    extra: readExtra('if', 'imaging')
  };
  if (!body.name) return toast('اسم الفحص مطلوب', 'er');
  catEnsure('imaging', body.category);
  var rec;
  if (id) { rec = DB.imaging.find(function (x) { return x.id === id; }); Object.assign(rec, body); }
  else { body.id = uid(); DB.imaging.push(body); rec = body; }
  Store.upsert('imaging', rec); closeModal(); toast('✅ تم الحفظ');
  if (curPage() !== 'imaging') goPage('imaging'); else render();
};
window.imgDel = function (id) {
  confirmBox('حذف هذا الفحص؟', function () {
    DB.imaging = DB.imaging.filter(function (x) { return x.id !== id; });
    DB.cart.imaging = DB.cart.imaging.filter(function (x) { return x !== id; });
    Store.remove('imaging', id); closeModal(); toast('🗑️ تم الحذف'); render();
  });
};

/* ════════════════════════ 🌿 الوصفات العلاجية ════════════════════════ */
var RX_TYPES = ['علاجية', 'وقائية', 'غذائية'];
var RX_FLD = [
  ['category', 'التصنيف', 'cat'],
  ['name', 'اسم الوصفة', 'text'],
  ['type', 'نوع الوصفة', 'type'],
  ['purpose', 'الهدف', 'area'],
  ['ingredients', 'المواد المستخدمة', 'area'],
  ['preparation', 'طريقة الإعداد', 'area'],
  ['usage', 'الاستخدام', 'area'],
  ['dose', 'الجرعة', 'text'],
  ['duration', 'مدة الاستخدام', 'text'],
  ['effects', 'الأعراض المتوقعة', 'area'],
  ['precautions', 'الاحتياطات', 'area']
];

function recipeRow(r) {
  var on = DB.cart.recipes.indexOf(r.id) >= 0;
  return '<div class="card' + (on ? ' sel' : '') + '">'
    + '<div class="row">'
    + '<input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="toggleCart(\'recipes\',\'' + r.id + '\')">'
    + '<div class="grow" onclick="recipeForm(\'' + r.id + '\')">'
    + '<div class="name">' + esc(r.name) + (r.is_favorite ? ' <span class="star">★</span>' : '')
    + (r.type ? ' <span class="chip">' + esc(r.type) + '</span>' : '') + '</div>'
    + (r.purpose ? '<div class="sub">' + esc(r.purpose) + '</div>' : '')
    + (r.dose ? '<div class="req">⚖️ ' + esc(r.dose) + '</div>' : '')
    + (r.precautions ? '<div class="ban">⛔ ' + esc(r.precautions) + '</div>' : '')
    + '</div>'
    + '<button class="ic" onclick="recipeForm(\'' + r.id + '\')">✏️</button>'
    + '<button class="ic" onclick="recipeDel(\'' + r.id + '\')">🗑️</button>'
    + '</div></div>';
}
function renderRecipes() {
  var q = (($('srch') || {}).value || '').trim().toLowerCase();
  var list = DB.recipes.filter(function (r) {
    return !q || [r.name, r.category, r.type, r.purpose, r.ingredients].join(' ').toLowerCase().indexOf(q) >= 0;
  });
  var ng = groupsOf('recipes').length;
  var html = '<div class="toolbar">'
    + '<input id="srch" class="srch-inp" placeholder="🔎 ابحث بالاسم أو النوع أو المواد…" value="' + esc(q) + '" oninput="renderRecipes()">'
    + '<button class="btn" onclick="goPage(\'cat:recipes\')">🏷️</button>'
    + '<button class="btn" onclick="goPage(\'grp:recipes\')">📁' + (ng ? ' ' + ng : '') + '</button>'
    + '<button class="btn primary" onclick="recipeForm()">+ إضافة</button></div>';
  if (DB.cart.recipes.length) html += cartBar('recipes', DB.cart.recipes.length);
  if (!list.length) { h('page', html + emptyBox('🌿', 'لا توجد وصفات محفوظة', 'اضغط «+ إضافة» لتبدأ')); return; }

  if (q) {
    html += list.map(recipeRow).join('');
  } else {
    var fav = list.filter(function (r) { return r.is_favorite; });
    if (fav.length) html += accBlock('⭐ مفضّلة', fav.map(recipeRow).join(''), true);
    var gs = groupBy(list, 'recipes'), op = openByDefault(list, gs);
    gs.forEach(function (g) {
      html += accBlock('🌿 ' + g.cat + ' (' + g.items.length + ')', g.items.map(recipeRow).join(''), op);
    });
  }
  h('page', html);
}
window.recipeForm = function (id) {
  var r = id ? (DB.recipes.find(function (x) { return x.id === id; }) || {}) : {};
  var body = RX_FLD.map(function (f) {
    var key = f[0], lbl = f[1], kind = f[2], v = esc(r[key] || '');
    if (kind === 'cat') return catField('rf', 'recipes', r.category);
    if (kind === 'type') {
      return '<div class="f"><label>' + lbl + '</label><div class="segs">'
        + RX_TYPES.map(function (t) {
          var on = (r.type || RX_TYPES[0]) === t;
          return '<button type="button" class="seg' + (on ? ' on' : '') + '" data-t="' + esc(t) + '"'
            + ' onclick="rxPickType(this)">' + esc(t) + '</button>';
        }).join('')
        + '</div><input type="hidden" id="rf-type" value="' + esc(r.type || RX_TYPES[0]) + '"></div>';
    }
    if (kind === 'area') return taField('rf-' + key, lbl, r[key] || '');
    return '<div class="f"><label>' + lbl + (key === 'name' ? ' *' : '') + '</label>'
      + '<input id="rf-' + key + '" class="inp" value="' + v + '"></div>';
  }).join('');
  body += extraFields('rf', 'recipes', r);
  body += '<label class="chk-row"><input type="checkbox" id="rf-fav" ' + (r.is_favorite ? 'checked' : '') + '> ⭐ وصفة مفضّلة</label>';
  body += '<div class="mft"><button class="btn primary" onclick="recipeSave(\'' + (id || '') + '\')">حفظ</button><button class="btn" onclick="closeModal()">إلغاء</button></div>';
  openModal(id ? '✏️ تعديل وصفة' : '+ إضافة وصفة', body);
};
/** اختيار النوع بأزرار بدل قائمة منسدلة — أوضح على الجوال. */
window.rxPickType = function (btn) {
  var wrap = btn.parentNode, kids = wrap.children;
  for (var i = 0; i < kids.length; i++) kids[i].className = 'seg';
  btn.className = 'seg on';
  var hidden = $('rf-type'); if (hidden) hidden.value = btn.getAttribute('data-t');
};
window.recipeSave = function (id) {
  var body = {};
  RX_FLD.forEach(function (f) { var el = $('rf-' + f[0]); body[f[0]] = el ? el.value.trim() : ''; });
  body.is_favorite = ($('rf-fav') || {}).checked ? 1 : 0;
  body.extra = readExtra('rf', 'recipes');
  if (!body.name) return toast('اسم الوصفة مطلوب', 'er');
  catEnsure('recipes', body.category);
  var rec;
  if (id) { rec = DB.recipes.find(function (x) { return x.id === id; }); Object.assign(rec, body); }
  else { body.id = uid(); DB.recipes.push(body); rec = body; }
  Store.upsert('recipes', rec); closeModal(); toast('✅ تم الحفظ');
  if (curPage() !== 'recipes') goPage('recipes'); else render();
};
window.recipeDel = function (id) {
  confirmBox('حذف هذه الوصفة؟', function () {
    DB.recipes = DB.recipes.filter(function (x) { return x.id !== id; });
    DB.cart.recipes = DB.cart.recipes.filter(function (x) { return x !== id; });
    Store.remove('recipes', id); closeModal(); toast('🗑️ تم الحذف'); render();
  });
};

/* ════════════════════════ 📁 المجموعات المسمّاة ════════════════════════
   قائمة جاهزة داخل القسم («فحوصات ما قبل الجراحة» مثلًا). تُفتَح في محرّر
   يعمل على نسخة مؤقتة: تضيف وتحذف منها ثم إمّا تحفظ التعديل، أو تطبع/ترسل
   وتخرج بلا حفظ فتعود المجموعة كما كانت. */
var GRP = null;

function groupsOf(kind) {
  if (kind === 'all') return DB.groups.slice();
  return DB.groups.filter(function (g) { return g.kind === kind; });
}
function itemLabel(kind, o) {
  if (!o) return '(عنصر محذوف)';
  if (kind === 'meds') return o.trade_name;
  if (kind === 'labs') return o.code ? o.code + ' — ' + o.name : o.name;
  if (kind === 'imaging') return o.region ? o.name + ' (' + o.region + ')' : o.name;
  return o.name;
}
function itemById(kind, id) {
  return coll(kind).find(function (x) { return x.id === id; });
}

function renderGroupsPage(kind) {
  var all = kind === 'all';
  var gs = groupsOf(kind);
  var html = '';
  if (!all) {
    html += '<div class="toolbar">'
      + '<button class="btn primary grow" onclick="groupNew(\'' + kind + '\')">+ مجموعة جديدة</button></div>';
    if (DB.cart[kind].length) {
      html += '<button class="btn full" onclick="groupFromCart(\'' + kind + '\')">💾 حفظ التحديد الحالي كمجموعة ('
        + DB.cart[kind].length + ')</button>';
    }
  }
  if (!gs.length) {
    h('page', html + emptyBox('📁', 'لا توجد مجموعات',
      'اختر ما تطلبه عادةً ثم احفظه مجموعة باسم تختاره — تُعيد إرسالها لاحقًا بضغطة'));
    return;
  }
  html += gs.map(function (g) {
    var L = kindLbl(g.kind);
    return '<div class="card"><div class="row">'
      + '<div class="grow" onclick="goPage(\'grp:' + g.kind + ':' + g.id + '\')">'
      + '<div class="name">📁 ' + esc(g.name) + '</div>'
      + '<div class="sub">' + L.icon + ' ' + countWord(g.items.length, L.one, L.two, L.few, L.many) + '</div></div>'
      + '<button class="ic" onclick="groupPreview(\'' + g.id + '\')">👁️</button>'
      + '</div></div>';
  }).join('');
  h('page', html);
}

function findGroup(id) { return DB.groups.find(function (g) { return g.id === id; }); }

window.groupNew = function (kind) { askGroupName(kind, [], ''); };
window.groupFromCart = function (kind) { askGroupName(kind, DB.cart[kind].slice(), ''); };
function askGroupName(kind, items, preset) {
  openModal('📁 اسم المجموعة',
    '<div class="f"><label>اسم المجموعة *</label>'
    + '<input id="gn" class="inp" value="' + esc(preset) + '" placeholder="مثال: فحوصات ما قبل الجراحة"></div>'
    + '<div class="mft"><button class="btn primary" onclick="groupCreate(\'' + kind + '\')">إنشاء</button>'
    + '<button class="btn" onclick="closeModal()">إلغاء</button></div>');
  window._grpPending = items;
}
window.groupCreate = function (kind) {
  var name = (($('gn') || {}).value || '').trim();
  if (!name) return toast('الاسم مطلوب', 'er');
  var g = { id: uid(), kind: kind, name: name, items: (window._grpPending || []).slice() };
  DB.groups.push(g);
  Store.saveGroup(g);
  closeModal();
  goPage('grp:' + kind + ':' + g.id);
};

/** المحرّر يعمل على نسخة: الخروج بلا حفظ يعيد المجموعة كما كانت. */
function renderGroupPage(kind, id) {
  var g = findGroup(id);
  if (!g) { h('page', emptyBox('📁', 'المجموعة غير موجودة', '')); return; }
  if (!GRP || GRP.id !== id) GRP = { id: id, kind: kind, name: g.name, items: g.items.slice(), dirty: false };

  var html = '<div class="gbar">'
    + '<button class="btn primary sm" onclick="groupSave()">💾 حفظ' + (GRP.dirty ? ' •' : '') + '</button>'
    + '<button class="btn wa sm" onclick="groupEditPreview()">👁️ عرض وإرسال</button>'
    + '<span class="grow"></span>'
    + '<button class="btn sm" onclick="groupRename()">✏️</button>'
    + '<button class="btn danger sm" onclick="groupDelete()">🗑️</button>'
    + '</div>'
    + (GRP.dirty ? '<div class="hint">✎ تعديلات غير محفوظة — «حفظ» يثبّتها، والرجوع يعيد المجموعة كما كانت.</div>' : '')
    + '<button class="btn full" onclick="groupPick()">➕ إضافة عناصر</button>';

  if (!GRP.items.length) {
    h('page', html + emptyBox('📁', 'المجموعة فارغة', 'اضغط «إضافة عناصر»'));
    return;
  }
  html += GRP.items.map(function (iid, i) {
    var o = itemById(kind, iid);
    return '<div class="card"><div class="row">'
      + '<span class="idx">' + (i + 1) + '</span>'
      + '<div class="grow"><div class="name">' + esc(itemLabel(kind, o)) + '</div></div>'
      + '<button class="ic" onclick="groupRemove(\'' + iid + '\')">✖️</button>'
      + '</div></div>';
  }).join('');
  h('page', html);
}
window.groupRemove = function (iid) {
  GRP.items = GRP.items.filter(function (x) { return x !== iid; });
  GRP.dirty = true; render();
};
window.groupSave = function () {
  var g = findGroup(GRP.id); if (!g) return;
  g.name = GRP.name; g.items = GRP.items.slice();
  Store.saveGroup(g);
  GRP.dirty = false; render(); toast('✅ حُفظت المجموعة');
};
window.groupRename = function () {
  openModal('✏️ إعادة تسمية',
    '<div class="f"><label>اسم المجموعة *</label><input id="gn" class="inp" value="' + esc(GRP.name) + '"></div>'
    + '<div class="mft"><button class="btn primary" onclick="groupRenameSave()">حفظ</button>'
    + '<button class="btn" onclick="closeModal()">إلغاء</button></div>');
};
window.groupRenameSave = function () {
  var name = (($('gn') || {}).value || '').trim();
  if (!name) return toast('الاسم مطلوب', 'er');
  GRP.name = name; GRP.dirty = true; closeModal(); render();
};
window.groupDelete = function () {
  confirmBox('حذف هذه المجموعة؟ (لا يُحذف أي تحليل أو علاج)', function () {
    var id = GRP.id, kind = GRP.kind;
    DB.groups = DB.groups.filter(function (g) { return g.id !== id; });
    Store.dropGroup(id);
    GRP = null; closeModal(); toast('🗑️ حُذفت المجموعة');
    NAV.pop(); render();
  });
};

/* منتقي العناصر: نفس فكرة المكتبة — بحث وقائمة تأشير، والموجود مقفل */
var GPICK = {};
window.groupPick = function () {
  GPICK = {};
  openModal('➕ إضافة إلى ' + GRP.name,
    '<div class="lib-bar">'
    + '<button class="btn primary full" style="margin:0" onclick="groupPickAdd()">➕ إضافة المحدد: <span id="gp-n">0</span></button>'
    + '<input id="gp-q" class="srch-inp" style="width:100%;margin-top:8px" placeholder="🔎 ابحث…" oninput="groupPickRender()">'
    + '</div><div id="gp-list"></div>');
  groupPickRender();
};
window.groupPickRender = function () {
  var kind = GRP.kind, q = norm(($('gp-q') || {}).value);
  var list = coll(kind).filter(function (o) {
    return !q || norm(itemLabel(kind, o) + ' ' + (o.category || o.type || '')).indexOf(q) >= 0;
  });
  if (!list.length) { h('gp-list', emptyBox('🔎', 'لا نتائج', '')); return; }
  h('gp-list', list.map(function (o) {
    var have = GRP.items.indexOf(o.id) >= 0;
    return '<label class="lib-i' + (have ? ' have' : '') + '">'
      + '<input type="checkbox"' + (have ? ' disabled' : '') + (GPICK[o.id] ? ' checked' : '')
      + ' onchange="groupPickToggle(\'' + o.id + '\')">'
      + '<span class="lib-t">' + esc(itemLabel(kind, o)) + '</span></label>';
  }).join(''));
};
window.groupPickToggle = function (id) {
  if (GPICK[id]) delete GPICK[id]; else GPICK[id] = 1;
  var e = $('gp-n'); if (e) e.textContent = Object.keys(GPICK).length;
};
window.groupPickAdd = function () {
  var add = Object.keys(GPICK);
  if (!add.length) return toast('لم تحدد شيئًا بعد', 'er');
  GRP.items = GRP.items.concat(add);
  GRP.dirty = true; GPICK = {}; closeModal(); render();
};

/* ════════════════════════ طباعة/PDF + مشاركة واتساب ════════════════════════ */
/* الاسم دائمًا في السطر الأول؛ الرمز (للتحاليل) والاسم العلمي (للعلاجات)
   يُدمجان معه إن اختيرا، وبقية الحقول المختارة تنزل أسطرًا تحته. */
function outTitle(kind, o, i) {
  var sel = DB.out[kind];
  if (kind === 'meds') {
    return (i + 1) + '. ' + o.trade_name
      + (sel.indexOf('scientific_name') >= 0 && o.scientific_name ? ' (' + o.scientific_name + ')' : '');
  }
  if (kind === 'labs') {
    return (i + 1) + '. ' + (sel.indexOf('code') >= 0 && o.code ? o.code + ' — ' : '') + o.name;
  }
  return (i + 1) + '. ' + o.name;
}
function outLines(kind, o) {
  var defs = outDefs(kind);
  var merged = kind === 'meds' ? 'scientific_name' : kind === 'labs' ? 'code' : '';
  var sel = DB.out[kind], lines = [];
  defs.forEach(function (f) {
    if (f[0] === merged || sel.indexOf(f[0]) < 0) return;
    var v = String(outValue(o, f[0])).trim();
    if (v) lines.push({ l: f[1], v: v });
  });
  return lines;
}
function lineText(x) { return x.l + ': ' + x.v; }
function rowsFor(kind, ids) {
  var src = coll(kind);
  return ids.map(function (id, i) {
    var o = src.find(function (x) { return x.id === id; });
    return o ? { title: outTitle(kind, o, i), lines: outLines(kind, o) } : null;
  }).filter(Boolean);
}
function cartRows(kind) { return rowsFor(kind, DB.cart[kind]); }
function itemsHtml(kind, ids) {
  return rowsFor(kind, ids).map(function (r) {
    return '<div class="rx-item"><div class="rx-name">' + esc(r.title) + '</div>'
      + r.lines.map(function (x) {
        return '<div class="rx-f"><span class="rx-l">' + esc(x.l) + ':</span> ' + esc(x.v) + '</div>';
      }).join('') + '</div>';
  }).join('');
}
function cartItemsHtml(kind) { return itemsHtml(kind, DB.cart[kind]); }

/** الترويسة اختيارية: لا تظهر إطلاقًا ما لم يملأ المستخدم سطرًا منها. */
function headerHtml() {
  var hd = DB.header || {};
  var parts = '';
  if (hd.name) parts += '<div class="lh-n">' + esc(hd.name) + '</div>';
  if (hd.title) parts += '<div class="lh-t">' + esc(hd.title) + '</div>';
  if (hd.contact) parts += '<div class="lh-c">' + esc(hd.contact) + '</div>';
  return parts ? '<div class="lh">' + parts + '</div>' : '';
}

/** تنسيق ورقة الطباعة — مصدر واحد تستعمله الطباعة والمعاينة معًا حتى لا
    تختلف المعاينة عمّا يُطبَع فعلًا. عند تمرير `scope` تُسبَق كل قاعدة به
    فتُحصَر داخل بطاقة المعاينة ولا تسرّب إلى واجهة التطبيق. */
function printCss(scope) {
  var s = scope ? scope + ' ' : '';
  var body = scope ? scope : 'body';
  return (scope ? '' : '@page{size:A4;margin:12mm 10mm}')
    + s + '*{box-sizing:border-box;font-family:Tahoma,Arial,sans-serif}'
    // في المعاينة لا نضبط الهوامش: بطاقة `.paper` تحتفظ بهوامشها في الواجهة.
    + body + '{' + (scope ? '' : 'margin:0;')
    + 'color:#0f172a;font-size:11pt;line-height:1.35;-webkit-print-color-adjust:exact}'
    + s + 'h1{font-size:14pt;color:#0f766e;margin:0}'
    + s + '.sub{color:#64748b;font-size:8.5pt;margin:2px 0 8px;padding-bottom:5px;border-bottom:1.5pt solid #0f766e}'
    + s + '.rx-item{border:0.6pt solid #cbd5e1;border-radius:4pt;padding:4pt 7pt;margin-bottom:4pt;page-break-inside:avoid}'
    + s + '.rx-name{font-weight:bold;font-size:11pt;color:#0f766e;margin-bottom:1pt;line-height:1.3}'
    + s + '.rx-f{font-size:9.5pt;margin:0.5pt 0;line-height:1.35;white-space:pre-wrap}'
    + s + '.rx-l{color:#475569;font-weight:bold}'
    + s + '.lh{border-bottom:1.5pt solid #0f766e;padding-bottom:5pt;margin-bottom:7pt}'
    + s + '.lh-n{font-weight:bold;font-size:13pt;color:#0f766e}'
    + s + '.lh-t{font-size:9.5pt;color:#334155;margin-top:1pt}'
    + s + '.lh-c{font-size:9pt;color:#64748b;margin-top:1pt;direction:ltr;text-align:right}'
    + s + '.ft{margin-top:8pt;font-size:8pt;color:#94a3b8;text-align:center}';
}
/** جسم الورقة (ترويسة + عنوان + تاريخ + المحتوى) — مشترك بين الطباعة والمعاينة. */
function docBody(title, body) {
  return headerHtml()
    + '<h1>' + esc(title) + '</h1>'
    + '<div class="sub">' + new Date().toLocaleDateString('ar-SA-u-nu-latn') + '</div>'
    + body;
}
/** صفحة الطباعة: تخطيط مضغوط الأسطر يتّسع لأكبر عدد في الصفحة بلا ازدحام. */
function printDoc(title, body) {
  return '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title>'
    + '<style>' + printCss('') + '</style></head><body>'
    + docBody(title, body) + '</body></html>';
}
window.printList = function (kind, ids, title) {
  var body = itemsHtml(kind, ids);
  if (!body) return toast('القائمة فارغة', 'er');
  var html = printDoc(title, body);

  // داخل التطبيق: window.open لا يعمل في WebView إطلاقًا، فنمرّر الصفحة
  // لخدمة الطباعة في أندرويد (ومنها «حفظ كـPDF»)
  if (window.AndroidBridge && typeof window.AndroidBridge.printHtml === 'function') {
    window.AndroidBridge.printHtml(html, title);
    return;
  }
  var w = window.open('', '_blank');
  if (!w) return toast('تعذّر فتح نافذة الطباعة', 'er');
  w.document.write(html.replace('</body>',
    '<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},300);};<' + '/script></body>'));
  w.document.close();
};
/* بناء صورة أنيقة للقائمة (Canvas) — الرسم النصي في المتصفح يضبط اتجاه
   وتشكيل الحروف العربية تلقائيًا وبدقة تامة، بخلاف توليد PDF يدويًا الذي
   يحتاج تضمين خطوط وتشكيلًا معقدًا وقد يُخرج حروفًا مفكّكة. الصورة الناتجة
   تُرسَل كملف مرفق حقيقي عبر قائمة مشاركة النظام — تختار منها واتساب وجهة
   الاتصال مباشرة، تمامًا كإرسال ملف. */
/** لفّ النص على أكثر من سطر حتى لا يخرج خارج حدود الصورة. */
function wrapText(ctx, text, maxW) {
  var words = String(text).split(/[ \t]+/), out = [], cur = '';
  words.forEach(function (w) {
    var t = cur ? cur + ' ' + w : w;
    if (!cur || ctx.measureText(t).width <= maxW) cur = t;
    else { out.push(cur); cur = w; }
  });
  if (cur) out.push(cur);
  return out.length ? out : [''];
}
/** يحترم أسطر المستخدم أولًا ثم يلفّ كل سطر على حدة. */
function wrapBlock(ctx, text, maxW) {
  var out = [];
  String(text).split('\n').forEach(function (seg) {
    out = out.concat(wrapText(ctx, seg, maxW));
  });
  return out;
}
var CART_TITLE = { meds: 'قائمة علاجات', labs: 'قائمة تحاليل',
                   imaging: 'طلب أشعة وفحوصات', recipes: 'قائمة وصفات' };
function cartTitle(kind, withIcon) {
  var t = CART_TITLE[kind];
  return withIcon ? kindLbl(kind).icon + ' ' + t : t;
}
function buildCanvas(kind, ids, title) {
  var W = 900, PAD = 28, headH = 108, MAXW = W - PAD * 2 - 22;
  var TITLE_F = 'bold 23px Tahoma, Arial, sans-serif';
  var LINE_F = '16.5px Tahoma, Arial, sans-serif';
  var TITLE_H = 28, LINE_H = 23;

  var c = document.createElement('canvas');
  var ctx = c.getContext('2d');

  // قياس أولًا لمعرفة الارتفاع المطلوب، ثم تحديد أبعاد اللوحة ورسمها
  var rows = rowsFor(kind, ids).map(function (r) {
    ctx.font = TITLE_F;
    var titleLines = wrapText(ctx, r.title, MAXW);
    ctx.font = LINE_F;
    var lines = [];
    r.lines.forEach(function (x) { lines = lines.concat(wrapBlock(ctx, lineText(x), MAXW)); });
    return {
      titleLines: titleLines, lines: lines,
      h: 18 + titleLines.length * TITLE_H + lines.length * LINE_H
    };
  });

  var H = headH + rows.reduce(function (a, r) { return a + r.h; }, 0) + PAD / 2;
  c.width = W; c.height = H;
  ctx = c.getContext('2d');
  ctx.fillStyle = '#f0fdfa'; ctx.fillRect(0, 0, W, H);

  var grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#075e54'); grad.addColorStop(1, '#0f766e');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, headH);
  ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff'; ctx.font = 'bold 31px Tahoma, Arial, sans-serif';
  ctx.fillText(title, W - PAD, 46);
  ctx.font = '15px Tahoma, Arial, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillText(new Date().toLocaleDateString('ar-SA-u-nu-latn'), W - PAD, 78);

  var y = headH;
  rows.forEach(function (r, i) {
    ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#f8fffe';
    ctx.fillRect(PAD / 2, y + 4, W - PAD, r.h - 8);
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
    ctx.strokeRect(PAD / 2, y + 4, W - PAD, r.h - 8);

    var ty = y + 24;
    ctx.fillStyle = '#0f172a'; ctx.font = TITLE_F;
    r.titleLines.forEach(function (t) { ctx.fillText(t, W - PAD - 11, ty); ty += TITLE_H; });
    ctx.fillStyle = '#0f766e'; ctx.font = LINE_F;
    r.lines.forEach(function (l) { ctx.fillText(l, W - PAD - 11, ty); ty += LINE_H; });
    y += r.h;
  });
  return c;
}
/** يبني نفس ورقة الطباعة لكن يُخرجها ملف PDF ويفتح قائمة الإرسال مباشرةً. */
window.pdfList = function (kind, ids, title) {
  var body = itemsHtml(kind, ids);
  if (!body) return toast('القائمة فارغة', 'er');
  if (!(window.AndroidBridge && typeof window.AndroidBridge.sharePdf === 'function')) {
    return toast('إرسال PDF متاح داخل التطبيق', 'er');
  }
  window.AndroidBridge.sharePdf(printDoc(title, body), title);
  toast('📄 يجري تجهيز ملف PDF…');
};

/** نصّ عادي للصق في واتساب أو أي مكان — أخفّ من الصورة وقابل للبحث. */
function listText(kind, ids, title) {
  var hd = DB.header || {}, lines = [];
  if (hd.name) lines.push(hd.name);
  if (hd.title) lines.push(hd.title);
  if (hd.contact) lines.push(hd.contact);
  if (lines.length) lines.push('');
  lines.push(title + ' — ' + new Date().toLocaleDateString('ar-SA-u-nu-latn'));
  lines.push('');
  rowsFor(kind, ids).forEach(function (r) {
    lines.push(r.title);
    r.lines.forEach(function (x) {
      var segs = String(x.v).split('\n');
      lines.push('   • ' + x.l + ': ' + segs[0]);
      for (var i = 1; i < segs.length; i++) lines.push('     ' + segs[i]);
    });
  });
  return lines.join('\n');
}
window.copyList = function (kind, ids, title) {
  if (!ids.length) return toast('القائمة فارغة', 'er');
  var text = listText(kind, ids, title);
  if (window.AndroidBridge && typeof window.AndroidBridge.copyText === 'function') {
    window.AndroidBridge.copyText(text);
    return toast('📋 نُسخ النص — الصقه حيث تشاء');
  }
  try {
    navigator.clipboard.writeText(text).then(function () { toast('📋 نُسخ النص'); },
      function () { toast('تعذّر النسخ', 'er'); });
  } catch (e) { toast('تعذّر النسخ', 'er'); }
};
window.shareList = function (kind, ids, title, imgTitle) {
  if (!ids.length) return toast('القائمة فارغة', 'er');
  var canvas = buildCanvas(kind, ids, imgTitle || (kindLbl(kind).icon + ' ' + title));
  var fname = title.replace(/[ /\\]/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.png';

  // داخل التطبيق الأصلي (APK): جسر Android يستقبل الصورة ويطلق مشاركة نظامية حقيقية
  // (WebView لا يطبّق Web Share API إطلاقًا، بخلاف المتصفح/PWA)
  if (window.AndroidBridge && typeof window.AndroidBridge.shareImageBase64 === 'function') {
    var dataUrl = canvas.toDataURL('image/png');
    window.AndroidBridge.shareImageBase64(dataUrl.split(',')[1], fname);
    return;
  }

  canvas.toBlob(async function (blob) {
    if (!blob) return toast('تعذّر إنشاء الصورة', 'er');
    var file = new File([blob], fname, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; }
      catch (e) { return; /* المستخدم أغلق نافذة المشاركة */ }
    }
    // لا يدعم الجهاز مشاركة ملفات — نزّل الصورة يدويًا كبديل
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    toast('نزّلت الصورة — أرفقها يدويًا في واتساب');
  }, 'image/png');
};

/* ── المعاينة قبل الإرسال ──
   صفحة واحدة تجمع كل مخارج القائمة: تعرض ما سيُرسَل فعلًا — الورقة (نفس
   تنسيق PDF والطباعة حرفيًا) أو الصورة (نفس لوحة الرسم المُرسَلة) — ثم
   شريط إرسال ثابت أسفلها. لا شيء يُرسَل قبل أن يراه المستخدم. */
var PV = null, PV_TAB = 'paper';

/** يفتح المعاينة لقائمة معيّنة (سلة أو مجموعة). */
window.openPreview = function (kind, ids, title, imgTitle) {
  if (!ids || !ids.length) { PV = null; return toast('القائمة فارغة', 'er'); }
  PV = { kind: kind, ids: ids.slice(), title: title,
         imgTitle: imgTitle || (kindLbl(kind).icon + ' ' + title) };
  PV_TAB = 'paper';
  goPage('pv');
};
window.pvTab = function (t) { PV_TAB = t; render(); };

/** تنسيق الورقة يُحقن مرّة واحدة، محصورًا داخل `.paper`. */
var PV_CSS = false;
function ensurePreviewCss() {
  if (PV_CSS) return;
  try {
    var st = document.createElement('style');
    st.id = 'pv-css';
    st.textContent = printCss('.paper');
    (document.head || document.body).appendChild(st);
    PV_CSS = true;
  } catch (e) { /* بيئة بلا DOM كامل — الورقة تظهر بتنسيق الواجهة */ }
}

/** صورة المعاينة = نفس اللوحة المُرسَلة، مصغَّرة داخل الصفحة. */
function pvImgHtml() {
  try {
    var c = buildCanvas(PV.kind, PV.ids, PV.imgTitle);
    return '<div class="pvimg"><img alt="معاينة الصورة" src="' + c.toDataURL('image/png') + '"></div>';
  } catch (e) {
    return emptyBox('🖼️', 'تعذّر توليد الصورة', 'جرّب الورقة أو الإرسال مباشرة');
  }
}

function renderPreview() {
  if (!PV) { h('page', emptyBox('👁️', 'لا يوجد ما يُعرَض', 'اختر عناصر ثم اضغط «عرض وإرسال»')); return; }
  ensurePreviewCss();
  var n = PV.ids.length, L = kindLbl(PV.kind);
  var html = '<div class="pvtabs">'
    + '<button class="pvt' + (PV_TAB === 'paper' ? ' on' : '') + '" onclick="pvTab(\'paper\')">📄 الورقة</button>'
    + '<button class="pvt' + (PV_TAB === 'img' ? ' on' : '') + '" onclick="pvTab(\'img\')">🖼️ الصورة</button>'
    + '</div>'
    + '<div class="hint">' + L.icon + ' ' + esc(PV.title) + ' — '
    + countWord(n, L.one, L.two, L.few, L.many) + '</div>';

  if (PV_TAB === 'img') html += pvImgHtml();
  else html += '<div class="paper">' + docBody(PV.title, itemsHtml(PV.kind, PV.ids)) + '</div>';

  html += '<div class="pvbar">'
    + '<button class="btn wa sm" onclick="pvSend(\'pdf\')">📄 PDF</button>'
    + '<button class="btn wa sm" onclick="pvSend(\'img\')">🖼️ صورة</button>'
    + '<button class="btn white sm" onclick="pvSend(\'print\')">🖨️ طباعة</button>'
    + '<button class="btn white sm" onclick="pvSend(\'copy\')">📋 نسخ</button>'
    + '</div>';
  h('page', html);
}

window.pvSend = function (how) {
  if (!PV) return;
  if (how === 'pdf') pdfList(PV.kind, PV.ids, PV.title);
  else if (how === 'img') shareList(PV.kind, PV.ids, PV.title, PV.imgTitle);
  else if (how === 'print') printList(PV.kind, PV.ids, PV.title);
  else copyList(PV.kind, PV.ids, PV.title);
};

/** مداخل المعاينة: السلة، ومحرّر المجموعة، ومجموعة محفوظة من القائمة. */
window.previewCart = function (kind) {
  openPreview(kind, DB.cart[kind], cartTitle(kind, false), cartTitle(kind, true));
};
window.groupEditPreview = function () {
  openPreview(GRP.kind, GRP.items, GRP.name, '📁 ' + GRP.name);
};
window.groupPreview = function (id) {
  var g = findGroup(id); if (!g) return;
  openPreview(g.kind, g.items, g.name, '📁 ' + g.name);
};

document.addEventListener('DOMContentLoaded', boot);
