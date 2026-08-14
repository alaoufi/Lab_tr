/* ============================================================
   دليلي — أداة شخصية للعلاجات والتحاليل
   كل البيانات محلية على الجهاز فقط — لا خادم ولا إنترنت.
   التخزين داخل التطبيق (APK): قاعدة بيانات SQLite محلية عبر جسر NativeDb.
   عند فتح الملفات في متصفح عادي (بلا الجسر): localStorage كبديل.
   ============================================================ */
'use strict';

var KEY = 'clinic_tool_v1';   /* تخزين الإصدارات السابقة — يُستخدم للترحيل والبديل */
var KINDS = ['meds', 'labs', 'imaging', 'recipes'];
var DB = { pin_hash: null, meds: [], labs: [], imaging: [], recipes: [],
           cart: { meds: [], labs: [], imaging: [], recipes: [] }, groups: [], out: null };
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
function outDefs(kind) { return OUT_ALL[kind]; }
/** مجموعة القسم في الذاكرة. */
function coll(kind) { return DB[kind]; }
function setColl(kind, arr) { DB[kind] = arr; }
var KIND_LBL = {
  meds: { one: 'علاج واحد', two: 'علاجان', few: 'علاجات', many: 'علاجًا', title: 'العلاجات', icon: '💊' },
  labs: { one: 'تحليل واحد', two: 'تحليلان', few: 'تحاليل', many: 'تحليلًا', title: 'التحاليل', icon: '🧪' },
  imaging: { one: 'فحص واحد', two: 'فحصان', few: 'فحوصات', many: 'فحصًا', title: 'الأشعة والفحوصات', icon: '📷' },
  recipes: { one: 'وصفة واحدة', two: 'وصفتان', few: 'وصفات', many: 'وصفة', title: 'الوصفات العلاجية', icon: '🌿' }
};
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
  DB.cart = {}; DB.out = {};
  KINDS.forEach(function (k) {
    setColl(k, Array.isArray(data[k]) ? data[k] : []);
    DB.cart[k] = Array.isArray(c[k]) ? c[k] : [];
    // الحقول المرسلة: من جدول الإعدادات داخل التطبيق، أو من النسخة
    // المحفوظة كاملةً في المتصفح/النسخة الاحتياطية
    DB.out[k] = parseList(o[k] || st['out_' + k], OUT_DEF[k]);
  });
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
  var o = { cart: DB.cart, groups: DB.groups, pin_hash: DB.pin_hash,
            out: DB.out, header: DB.header };
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
  // مغادرة محرّر المجموعة بتعديلات غير محفوظة تعني رجوعها كما كانت — نسأل أولًا
  if (GRP && GRP.dirty && curPage().indexOf('grp:') === 0) {
    confirmBox('لديك تعديلات غير محفوظة على المجموعة. الخروج يعيدها كما كانت.', function () {
      GRP = null; closeModal(); popPage();
    });
    return;
  }
  GRP = null;
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
  'lib:labs': { icon: '📚', title: 'مكتبة التحاليل' },
  'lib:imaging': { icon: '📚', title: 'مكتبة الأشعة والفحوصات' },
  'lib:meds': { icon: '📚', title: 'مكتبة العلاجات' }
};
/** عنوان صفحات المجموعات يُحسَب لأنه يتضمّن اسم القسم أو اسم المجموعة. */
function pageMeta(p) {
  if (PAGES[p]) return PAGES[p];
  if (p.indexOf('grp:') === 0) {
    var a = p.split(':');
    if (a[2]) {
      var g = DB.groups.find(function (x) { return x.id === a[2]; });
      return { icon: '📁', title: (GRP && GRP.id === a[2] ? GRP.name : (g ? g.name : 'مجموعة')) || 'مجموعة' };
    }
    return { icon: '📁', title: 'مجموعات ' + KIND_LBL[a[1]].title };
  }
  return PAGES.home;
}

async function boot() {
  Store.load();
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
    + outBlock('meds', '💊 العلاجات', OUT_MEDS)
    + outBlock('labs', '🧪 التحاليل', OUT_LABS)
    + outBlock('imaging', '📷 الأشعة والفحوصات', OUT_IMAGING)
    + outBlock('recipes', '🌿 الوصفات', OUT_RECIPES)
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
    + '<div class="settings-lbl">إضافة سريعة</div>'
    + '<button class="btn full" onclick="medForm()">💊 + إضافة علاج</button>'
    + '<button class="btn full" onclick="labForm()">🧪 + إضافة تحليل</button>'
    + '<button class="btn full" onclick="imgForm()">📷 + إضافة فحص/أشعة</button>'
    + '<button class="btn full" onclick="recipeForm()">🌿 + إضافة وصفة</button>'
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
    + lib.length + ' ' + KIND_LBL[kind].many + ' في ' + libCats().length + ' تصنيفًا. '
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
  LIB_SEL = {};
  libSyncMine();          // المضاف حديثًا يصير باهتًا فلا يُضاف مرتين
  libCount(); libRender();
  var L = KIND_LBL[kind];
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

/* ── مودال + تأكيد بسيطان ── */
function openModal(title, body) {
  h('modal-title', esc(title)); h('modal-body', body);
  $('modal-bg').className = 'modal-bg on';
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
  else if (p.indexOf('lib:') === 0) renderLibraryPage(p.slice(4));
  else if (p.indexOf('grp:') === 0) {
    var a = p.split(':');
    if (a[2]) renderGroupPage(a[1], a[2]); else renderGroupsPage(a[1]);
  }
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
          ? '<button class="btn white sm" onclick="goPage(\'' + k + '\')">' + KIND_LBL[k].title + ' (' + DB.cart[k].length + ')</button>'
          : '';
      }).join('') + '</div>';
  }

  html += '<div class="hgrid">'
    + KINDS.map(function (k, i) {
      var n = coll(k).length, L = KIND_LBL[k];
      return homeCard(k, L.icon, L.title,
        n ? countWord(n, L.one, L.two, L.few, L.many) : 'لا شيء بعد',
        (i === KINDS.length - 1 && KINDS.length % 2) ? ' wide' : '');
    }).join('')
    + '</div>';
  h('page', html);
}

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
    + '<button class="btn" onclick="goPage(\'grp:meds\')">📁' + (ng ? ' ' + ng : '') + '</button>'
    + '<button class="btn primary" onclick="medForm()">+ إضافة</button></div>';
  if (DB.cart.meds.length) html += cartBar('meds', DB.cart.meds.length);
  if (!list.length) { h('page', html + emptyBox('💊', 'لا توجد علاجات محفوظة', 'أضِف واحدًا، أو استورد من المكتبة الجاهزة في ⚙️')); return; }

  if (q) {
    html += list.map(medRow).join('');
  } else {
    var fav = list.filter(function (m) { return m.default_include; });
    if (fav.length) html += accBlock('⭐ افتراضية', fav.map(medRow).join(''), true);
    var gs = groupBy(list), op = openByDefault(list, gs);
    gs.forEach(function (g) {
      html += accBlock('💊 ' + g.cat + ' (' + g.items.length + ')', g.items.map(medRow).join(''), op);
    });
  }
  h('page', html);
}
/* الطيّ للقوائم الطويلة فقط. قائمة قصيرة كلها مطويّة تعني ألا يرى المستخدم
   اسم عنصر واحد — وهذا ما كان يحدث في الوصفات (نوعان مطويّان بلا أسماء). */
function openByDefault(list, groups) { return groups.length === 1 || list.length <= 40; }

/** تجميع العناصر حسب حقل (تصنيف أو نوع) مع الحفاظ على ترتيب الظهور. */
function groupBy(list, key, fallback) {
  key = key || 'category';
  var order = [], byCat = {};
  list.forEach(function (o) {
    var c = (o[key] || '').trim() || (fallback || 'غير مصنّف');
    if (!byCat[c]) { byCat[c] = []; order.push(c); }
    byCat[c].push(o);
  });
  return order.map(function (c) { return { cat: c, items: byCat[c] }; });
}
function emptyBox(icon, title, sub) {
  return '<div class="empty"><div class="ei">' + icon + '</div><div class="et">' + esc(title) + '</div><div class="es">' + esc(sub) + '</div></div>';
}
function cartBar(kind, n) {
  return '<div class="cartbar">'
    + '<span>📝 المحدد: ' + n + '</span>'
    + '<span class="grow"></span>'
    + '<button class="btn white sm" onclick="printCart(\'' + kind + '\')">🖨️ طباعة/PDF</button>'
    + '<button class="btn wa sm" onclick="shareCart(\'' + kind + '\')">📤 إرسال (صورة)</button>'
    + '<button class="btn white sm" onclick="copyCart(\'' + kind + '\')">📋 نسخ نص</button>'
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
    if (key === 'category') {
      return '<div class="f"><label>' + lbl + '</label><input id="mf-category" class="inp" list="mcat-list" value="' + v + '" placeholder="مثال: مضادات حيوية"></div>'
        + catDatalist('mcat-list', DB.meds);
    }
    return '<div class="f"><label>' + lbl + (key === 'trade_name' ? ' *' : '') + '</label>'
      + (area ? '<textarea id="mf-' + key + '" class="inp ta">' + v + '</textarea>'
        : '<input id="mf-' + key + '" class="inp" value="' + v + '">') + '</div>';
  }).join('');
  body += '<label class="chk-row"><input type="checkbox" id="mf-default" ' + (m.default_include ? 'checked' : '') + '> ⭐ محدَّد افتراضيًا</label>';
  body += '<div class="mft"><button class="btn primary" onclick="medSave(\'' + (id || '') + '\')">حفظ</button><button class="btn" onclick="closeModal()">إلغاء</button></div>';
  openModal(id ? '✏️ تعديل علاج' : '+ إضافة علاج', body);
};
window.medSave = function (id) {
  var body = {};
  MED_FLD.forEach(function (f) { var el = $('mf-' + f[0]); body[f[0]] = el ? el.value.trim() : ''; });
  body.default_include = ($('mf-default') || {}).checked ? 1 : 0;
  if (!body.trade_name) return toast('الاسم التجاري مطلوب', 'er');
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
    var gs = groupBy(list), op = openByDefault(list, gs);
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
  var body = '<div class="f"><label>التصنيف (التخصص)</label><input id="lf-category" class="inp" list="cat-list" value="' + esc(t.category || '') + '" placeholder="مثال: أمراض الدم"></div>'
    + catDatalist('cat-list', DB.labs)
    + '<div class="f"><label>اسم التحليل *</label><input id="lf-name" class="inp" value="' + esc(t.name || '') + '" placeholder="مثال: صورة دم كاملة"></div>'
    + '<div class="f"><label>رمز التحليل (المصطلح)</label><input id="lf-code" class="inp" dir="ltr" value="' + esc(t.code || '') + '" placeholder="مثال: CBC"></div>'
    + '<div class="f"><label>الهدف من التحليل</label><textarea id="lf-purpose" class="inp ta" placeholder="مثال: تقييم فقر الدم والالتهابات">' + esc(t.purpose || '') + '</textarea></div>'
    + '<div class="f"><label>متطلبات التحليل</label><textarea id="lf-requirements" class="inp ta" placeholder="مثال: صيام ٨–١٢ ساعة">' + esc(t.requirements || '') + '</textarea></div>'
    + '<div class="f"><label>ممنوعات التحليل</label><textarea id="lf-prohibitions" class="inp ta" placeholder="مثال: لا يُجرى بعد بدء المضاد الحيوي">' + esc(t.prohibitions || '') + '</textarea></div>'
    + '<label class="chk-row"><input type="checkbox" id="lf-common" ' + (t.is_common ? 'checked' : '') + '> ⭐ تحليل شائع</label>'
    + '<div class="mft"><button class="btn primary" onclick="labSave(\'' + (id || '') + '\')">حفظ</button><button class="btn" onclick="closeModal()">إلغاء</button></div>';
  openModal(id ? '✏️ تعديل تحليل' : '+ إضافة تحليل', body);
};
/** قائمة اقتراحات بالتصنيفات المستخدمة فعلًا، لتوحيدها بلا كتابة يدوية. */
function catDatalist(listId, source) {
  var seen = [];
  source.forEach(function (x) {
    var c = (x.category || '').trim();
    if (c && seen.indexOf(c) < 0) seen.push(c);
  });
  return '<datalist id="' + listId + '">'
    + seen.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>';
}
window.labSave = function (id) {
  var body = {
    category: ($('lf-category') || {}).value.trim(),
    code: ($('lf-code') || {}).value.trim(),
    name: ($('lf-name') || {}).value.trim(),
    purpose: ($('lf-purpose') || {}).value.trim(),
    requirements: ($('lf-requirements') || {}).value.trim(),
    prohibitions: ($('lf-prohibitions') || {}).value.trim(),
    is_common: ($('lf-common') || {}).checked ? 1 : 0
  };
  if (!body.name) return toast('اسم التحليل مطلوب', 'er');
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
var IMG_TYPES = ['أشعة سينية', 'موجات صوتية', 'أشعة مقطعية', 'رنين مغناطيسي',
                 'منظار', 'تخطيط', 'قياس هشاشة', 'طب نووي', 'أخرى'];

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
    + '<button class="btn" onclick="goPage(\'grp:imaging\')">📁' + (ng ? ' ' + ng : '') + '</button>'
    + '<button class="btn primary" onclick="imgForm()">+ إضافة</button></div>';
  if (DB.cart.imaging.length) html += cartBar('imaging', DB.cart.imaging.length);
  if (!list.length) { h('page', html + emptyBox('📷', 'لا توجد فحوصات محفوظة', 'أضِف واحدًا، أو استورد من المكتبة الجاهزة في ⚙️')); return; }

  if (q) {
    html += list.map(imgRow).join('');
  } else {
    var common = list.filter(function (t) { return t.is_common; });
    if (common.length) html += accBlock('⭐ شائعة', common.map(imgRow).join(''), true);
    var gs = groupBy(list, 'category', 'غير مصنّف'), op = openByDefault(list, gs);
    gs.forEach(function (g) {
      html += accBlock('📷 ' + g.cat + ' (' + g.items.length + ')', g.items.map(imgRow).join(''), op);
    });
  }
  h('page', html);
}
window.imgForm = function (id) {
  var t = id ? (DB.imaging.find(function (x) { return x.id === id; }) || {}) : {};
  var cur = t.category || '';
  var body = '<div class="f"><label>نوع الفحص</label><div class="segs wrap">'
    + IMG_TYPES.map(function (v) {
      return '<button type="button" class="seg' + (cur === v ? ' on' : '') + '" data-t="' + esc(v) + '"'
        + ' onclick="imgPickType(this)">' + esc(v) + '</button>';
    }).join('')
    + '</div><input type="hidden" id="if-category" value="' + esc(cur) + '"></div>'
    + '<div class="f"><label>اسم الفحص *</label><input id="if-name" class="inp" value="' + esc(t.name || '') + '" placeholder="مثال: رنين مغناطيسي للعمود القطني"></div>'
    + '<div class="f"><label>المنطقة أو العضو</label><input id="if-region" class="inp" value="' + esc(t.region || '') + '" placeholder="مثال: العمود القطني"></div>'
    + '<div class="f"><label>الهدف من الفحص</label><textarea id="if-purpose" class="inp ta">' + esc(t.purpose || '') + '</textarea></div>'
    + '<div class="f"><label>التحضير المطلوب</label><textarea id="if-requirements" class="inp ta" placeholder="مثال: صيام ٦ ساعات، إحضار فحوصات الكلى">' + esc(t.requirements || '') + '</textarea></div>'
    + '<div class="f"><label>موانع الإجراء</label><textarea id="if-prohibitions" class="inp ta" placeholder="مثال: الحمل، منظّم ضربات القلب">' + esc(t.prohibitions || '') + '</textarea></div>'
    + '<label class="chk-row"><input type="checkbox" id="if-common" ' + (t.is_common ? 'checked' : '') + '> ⭐ فحص شائع</label>'
    + '<div class="mft"><button class="btn primary" onclick="imgSave(\'' + (id || '') + '\')">حفظ</button><button class="btn" onclick="closeModal()">إلغاء</button></div>';
  openModal(id ? '✏️ تعديل فحص' : '+ إضافة فحص/أشعة', body);
};
window.imgPickType = function (btn) {
  var kids = btn.parentNode.children;
  for (var i = 0; i < kids.length; i++) kids[i].className = 'seg';
  btn.className = 'seg on';
  var hidden = $('if-category'); if (hidden) hidden.value = btn.getAttribute('data-t');
};
window.imgSave = function (id) {
  var body = {
    category: ($('if-category') || {}).value.trim(),
    name: ($('if-name') || {}).value.trim(),
    region: ($('if-region') || {}).value.trim(),
    purpose: ($('if-purpose') || {}).value.trim(),
    requirements: ($('if-requirements') || {}).value.trim(),
    prohibitions: ($('if-prohibitions') || {}).value.trim(),
    is_common: ($('if-common') || {}).checked ? 1 : 0
  };
  if (!body.name) return toast('اسم الفحص مطلوب', 'er');
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
    return !q || [r.name, r.type, r.purpose, r.ingredients].join(' ').toLowerCase().indexOf(q) >= 0;
  });
  var ng = groupsOf('recipes').length;
  var html = '<div class="toolbar">'
    + '<input id="srch" class="srch-inp" placeholder="🔎 ابحث بالاسم أو النوع أو المواد…" value="' + esc(q) + '" oninput="renderRecipes()">'
    + '<button class="btn" onclick="goPage(\'grp:recipes\')">📁' + (ng ? ' ' + ng : '') + '</button>'
    + '<button class="btn primary" onclick="recipeForm()">+ إضافة</button></div>';
  if (DB.cart.recipes.length) html += cartBar('recipes', DB.cart.recipes.length);
  if (!list.length) { h('page', html + emptyBox('🌿', 'لا توجد وصفات محفوظة', 'اضغط «+ إضافة» لتبدأ')); return; }

  if (q) {
    html += list.map(recipeRow).join('');
  } else {
    var fav = list.filter(function (r) { return r.is_favorite; });
    if (fav.length) html += accBlock('⭐ مفضّلة', fav.map(recipeRow).join(''), true);
    var gs = groupBy(list, 'type', 'بلا نوع'), op = openByDefault(list, gs);
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
    if (kind === 'type') {
      return '<div class="f"><label>' + lbl + '</label><div class="segs">'
        + RX_TYPES.map(function (t) {
          var on = (r.type || RX_TYPES[0]) === t;
          return '<button type="button" class="seg' + (on ? ' on' : '') + '" data-t="' + esc(t) + '"'
            + ' onclick="rxPickType(this)">' + esc(t) + '</button>';
        }).join('')
        + '</div><input type="hidden" id="rf-type" value="' + esc(r.type || RX_TYPES[0]) + '"></div>';
    }
    return '<div class="f"><label>' + lbl + (key === 'name' ? ' *' : '') + '</label>'
      + (kind === 'area' ? '<textarea id="rf-' + key + '" class="inp ta">' + v + '</textarea>'
        : '<input id="rf-' + key + '" class="inp" value="' + v + '">') + '</div>';
  }).join('');
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
  if (!body.name) return toast('اسم الوصفة مطلوب', 'er');
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
  var gs = groupsOf(kind), L = KIND_LBL[kind];
  var html = '<div class="toolbar">'
    + '<button class="btn primary grow" onclick="groupNew(\'' + kind + '\')">+ مجموعة جديدة</button></div>';
  if (DB.cart[kind].length) {
    html += '<button class="btn full" onclick="groupFromCart(\'' + kind + '\')">💾 حفظ التحديد الحالي كمجموعة ('
      + DB.cart[kind].length + ')</button>';
  }
  if (!gs.length) {
    h('page', html + emptyBox('📁', 'لا توجد مجموعات', 'اجمع ما تطلبه عادةً في مجموعة واحدة باسم تختاره'));
    return;
  }
  html += gs.map(function (g) {
    return '<div class="card"><div class="row">'
      + '<div class="grow" onclick="goPage(\'grp:' + kind + ':' + g.id + '\')">'
      + '<div class="name">📁 ' + esc(g.name) + '</div>'
      + '<div class="sub">' + countWord(g.items.length, L.one, L.two, L.few, L.many) + '</div></div>'
      + '<button class="ic" onclick="groupPrint(\'' + g.id + '\')">🖨️</button>'
      + '<button class="ic" onclick="groupShare(\'' + g.id + '\')">📤</button>'
      + '</div></div>';
  }).join('');
  h('page', html);
}

function findGroup(id) { return DB.groups.find(function (g) { return g.id === id; }); }

window.groupPrint = function (id) {
  var g = findGroup(id); if (!g) return;
  printList(g.kind, g.items, g.name);
};
window.groupShare = function (id) {
  var g = findGroup(id); if (!g) return;
  shareList(g.kind, g.items, g.name, '📁 ' + g.name);
};

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
    + '<button class="btn white sm" onclick="groupEditPrint()">🖨️ طباعة</button>'
    + '<button class="btn wa sm" onclick="groupEditShare()">📤 إرسال</button>'
    + '<button class="btn white sm" onclick="groupEditCopy()">📋 نسخ</button>'
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
window.groupEditPrint = function () { printList(GRP.kind, GRP.items, GRP.name); };
window.groupEditShare = function () { shareList(GRP.kind, GRP.items, GRP.name, '📁 ' + GRP.name); };
window.groupEditCopy = function () { copyList(GRP.kind, GRP.items, GRP.name); };
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
    var v = String(o[f[0]] == null ? '' : o[f[0]]).trim();
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

/** صفحة الطباعة: تخطيط مضغوط الأسطر يتّسع لأكبر عدد في الصفحة بلا ازدحام. */
function printDoc(title, body) {
  return '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title>'
    + '<style>'
    + '@page{size:A4;margin:12mm 10mm}'
    + '*{box-sizing:border-box;font-family:Tahoma,Arial,sans-serif}'
    + 'body{margin:0;color:#0f172a;font-size:11pt;line-height:1.35;-webkit-print-color-adjust:exact}'
    + 'h1{font-size:14pt;color:#0f766e;margin:0}'
    + '.sub{color:#64748b;font-size:8.5pt;margin:2px 0 8px;padding-bottom:5px;border-bottom:1.5pt solid #0f766e}'
    + '.rx-item{border:0.6pt solid #cbd5e1;border-radius:4pt;padding:4pt 7pt;margin-bottom:4pt;page-break-inside:avoid}'
    + '.rx-name{font-weight:bold;font-size:11pt;color:#0f766e;margin-bottom:1pt;line-height:1.3}'
    + '.rx-f{font-size:9.5pt;margin:0.5pt 0;line-height:1.35}'
    + '.rx-l{color:#475569;font-weight:bold}'
    + '.lh{border-bottom:1.5pt solid #0f766e;padding-bottom:5pt;margin-bottom:7pt}'
    + '.lh-n{font-weight:bold;font-size:13pt;color:#0f766e}'
    + '.lh-t{font-size:9.5pt;color:#334155;margin-top:1pt}'
    + '.lh-c{font-size:9pt;color:#64748b;margin-top:1pt;direction:ltr;text-align:right}'
    + '.ft{margin-top:8pt;font-size:8pt;color:#94a3b8;text-align:center}'
    + '</style></head><body>'
    + headerHtml()
    + '<h1>' + esc(title) + '</h1>'
    + '<div class="sub">' + new Date().toLocaleDateString('ar-SA-u-nu-latn') + '</div>'
    + body + '</body></html>';
}
window.printCart = function (kind) { printList(kind, DB.cart[kind], cartTitle(kind, false)); };
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
  var words = String(text).split(/\s+/), out = [], cur = '';
  words.forEach(function (w) {
    var t = cur ? cur + ' ' + w : w;
    if (!cur || ctx.measureText(t).width <= maxW) cur = t;
    else { out.push(cur); cur = w; }
  });
  if (cur) out.push(cur);
  return out;
}
var CART_TITLE = { meds: 'قائمة علاجات', labs: 'قائمة تحاليل',
                   imaging: 'طلب أشعة وفحوصات', recipes: 'قائمة وصفات' };
function cartTitle(kind, withIcon) {
  var t = CART_TITLE[kind];
  return withIcon ? KIND_LBL[kind].icon + ' ' + t : t;
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
    r.lines.forEach(function (x) { lines = lines.concat(wrapText(ctx, lineText(x), MAXW)); });
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
window.shareCart = function (kind) {
  shareList(kind, DB.cart[kind], cartTitle(kind, false), cartTitle(kind, true));
};
window.copyCart = function (kind) { copyList(kind, DB.cart[kind], cartTitle(kind, false)); };

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
    r.lines.forEach(function (x) { lines.push('   • ' + lineText(x)); });
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
  var canvas = buildCanvas(kind, ids, imgTitle || (KIND_LBL[kind].icon + ' ' + title));
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

document.addEventListener('DOMContentLoaded', boot);
