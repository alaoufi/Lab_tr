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
           cats: [], groups: [], sections: [], fields: [], sent: [], images: [], out: null };
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
  ['notes', 'ملاحظات'],
  ['img', 'الصورة']
];
var OUT_LABS = [
  ['code', 'رمز التحليل (المصطلح)'],
  ['category', 'التصنيف (التخصص)'],
  ['purpose', 'الهدف من التحليل'],
  ['requirements', 'متطلبات التحليل'],
  ['prohibitions', 'ممنوعات التحليل'],
  ['img', 'الصورة']
];
var OUT_IMAGING = [
  ['category', 'نوع الفحص'],
  ['region', 'المنطقة أو العضو'],
  ['purpose', 'الهدف من الفحص'],
  ['requirements', 'التحضير المطلوب'],
  ['prohibitions', 'موانع الإجراء'],
  ['img', 'الصورة']
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
  ['precautions', 'الاحتياطات'],
  ['img', 'الصورة']
];
/* المؤشَّر افتراضيًا على تثبيتٍ جديد. الصورة ضمنه في الجميع: من يضع صورةً
   لعنصر يريدها أن تصل، ولو لم يفتح صفحة الحقول. */
var OUT_DEF = {
  meds: ['dosage', 'uses', 'img'],
  labs: ['code', 'requirements', 'img'],
  imaging: ['region', 'requirements', 'img'],
  recipes: ['ingredients', 'preparation', 'dose', 'img']
};
var OUT_ALL = { meds: OUT_MEDS, labs: OUT_LABS, imaging: OUT_IMAGING, recipes: OUT_RECIPES };
/** بانيات قوائم الأقسام — تُملأ عند تعريف كل قسم أدناه. */
var SEC_LIST = {};
/**
 * الحقول القابلة للإرسال في قسم: الأصلية المكتوبة في الكود، ثم ما عرّفه
 * المستخدم. حقول المستخدم تُسبَق بـ«x:» فيعرف `outLines` أن قيمتها في
 * `extra` لا في العنصر مباشرةً.
 */
/** الحقل الذي يحمل اسم العنصر — يظهر دائمًا ولا يُلغى، لكن يُذكَر. */
function nameFieldLabel(kind) {
  if (kind === 'meds') return 'الاسم التجاري';
  if (kind === 'labs') return 'اسم التحليل';
  if (kind === 'imaging') return 'اسم الفحص';
  if (kind === 'recipes') return 'اسم الوصفة';
  return 'الاسم';
}
function outDefs(kind) {
  var base = OUT_ALL[kind] ? OUT_ALL[kind].slice() : [['category', 'التصنيف'], ['img', 'الصورة']];
  // العنصر الثالث نوعُ الحقل — يحتاجه بناء السطر المرسَل (الموقع رابطًا)
  var all = base.concat(fieldsOf(kind).map(function (f) { return ['x:' + f.key, f.label, f.type]; }));
  return applyOutOrder(kind, all);
}
/**
 * ترتيب الحقول المرسلة كما رتّبه المستخدم.
 *
 * ترتيب الأسطر على الورقة كان من ترتيب الكود، فلا يملك المستخدم تقديم
 * «المتطلبات» على «الهدف» مثلًا. `DB.outOrder[kind]` قائمة مفاتيح: ما فيها
 * يتقدّم بترتيبه، وما ليس فيها (حقلٌ أُضيف بعدها) يلحق في موضعه الأصلي —
 * فلا يختفي حقلٌ جديد ولا يقفز إلى الصدارة.
 */
function applyOutOrder(kind, defs) {
  var ord = DB.outOrder[kind];
  if (!ord || !ord.length) return defs;
  var known = [], rest = [];
  defs.forEach(function (f) { (ord.indexOf(f[0]) >= 0 ? known : rest).push(f); });
  known.sort(function (a, b) { return ord.indexOf(a[0]) - ord.indexOf(b[0]); });
  return known.concat(rest);
}
/** يحرّك حقلًا في ترتيب الإرسال ويحفظ الترتيب كاملًا. */
window.outMove = function (kind, key, dir) {
  var keys = outDefs(kind).map(function (f) { return f[0]; });
  var i = keys.indexOf(key), j = i + dir;
  if (i < 0 || j < 0 || j >= keys.length) return;
  var t = keys[i]; keys[i] = keys[j]; keys[j] = t;
  DB.outOrder[kind] = keys;
  var ok = Store.setOutOrder(kind);
  render();
  if (ok === false) toast('⚠️ لم يُحفَظ ترتيب الحقول', 'er');
};
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
  DB.cart = {}; DB.out = {}; DB.outOrder = {};
  KINDS.forEach(function (k) {
    setColl(k, Array.isArray(data[k]) ? data[k] : []);
    DB.cart[k] = Array.isArray(c[k]) ? c[k] : [];
    // الحقول المرسلة: من جدول الإعدادات داخل التطبيق، أو من النسخة
    // المحفوظة كاملةً في المتصفح/النسخة الاحتياطية
    DB.out[k] = parseList(o[k] || st['out_' + k], OUT_DEF[k] || ['img']);
    DB.outOrder[k] = parseList((data.outOrder || {})[k] || st['ord_' + k], []);
  });
  DB.cats = Array.isArray(data.cats) ? data.cats : [];
  DB.cats_seeded = Number(data.cats_seeded || st.cats_seeded || 0) || 0;
  DB.fields_out_done = Number(data.fields_out_done || st.fields_out_done || 0) || 0;
  DB.img_out_done = Number(data.img_out_done || st.img_out_done || 0) || 0;
  DB.dense = Number(data.dense || st.dense || 0) || 0;
  DB.mode = (data.mode || st.mode) === 'edit' ? 'edit' : 'send';   // الوضع المحفوظ
  DB.showTitle = Number(data.showTitle || st.showTitle || 0) || 0;   // عنوان الورقة
  DB.showLabels = Number(data.showLabels || st.showLabels || 0) || 0; // أسماء الحقول
  DB.dir_seeded = Number(data.dir_seeded || st.dir_seeded || 0) || 0;   // دليل العناوين
  DB.dir_geo = Number(data.dir_geo || st.dir_geo || 0) || 0;            // حقل الموقع فيه
  DB.updAt = Number(data.updAt || st.upd_at || 0) || 0;                 // آخر فحص للتحديث
  DB.fmt = data.fmt || st.fmt || 'pdf';          // الصيغة المفضّلة للإرسال
  DB.sent = Array.isArray(data.sent) ? data.sent : [];
  DB.images = Array.isArray(data.images) ? data.images : [];
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
function dbFail() { toast('⚠️ تعذّر الحفظ في قاعدة البيانات', 'er'); return false; }
function snapshot() {
  var o = { cart: DB.cart, cats: DB.cats, groups: DB.groups, pin_hash: DB.pin_hash, mode: DB.mode, showTitle: DB.showTitle, showLabels: DB.showLabels,
            dir_seeded: DB.dir_seeded, dir_geo: DB.dir_geo, updAt: DB.updAt,
            sections: DB.sections, fields: DB.fields, sent: DB.sent, images: DB.images,
            out: DB.out, outOrder: DB.outOrder, header: DB.header };
  KINDS.forEach(function (k) { o[k] = DB[k]; });
  return o;
}

/* ── طبقة التخزين: SQLite داخل التطبيق، أو localStorage في المتصفح ── */
var Store = {
  native: !!NDB,

  /* هل نجحت آخر قراءة؟ الفرق بين «لا بيانات» و«لم أستطع القراءة» هو الفرق
     بين شاشةٍ فارغة تُصلَح، وكتابةٍ فوق بياناتٍ لم نرها فتضيع فعلًا. */
  ok: true,
  errors: [],

  load: function () {
    Store.ok = true;
    Store.errors = [];
    if (!NDB) {
      var raw = null;
      try { raw = localStorage.getItem(KEY); }
      catch (e) { Store.ok = false; Store.errors = ['تعذّر الوصول للتخزين المحلي']; }
      if (Store.ok) {
        try { applyData(JSON.parse(raw || 'null')); }
        catch (e) { Store.ok = false; Store.errors = ['بيانات تالفة: ' + e]; }
      }
      if (!Store.ok) applyData(null);
      return;
    }
    var txt = '', d = null;
    try { txt = NDB.loadAll() || ''; }
    catch (e) { Store.ok = false; Store.errors = ['تعذّر نداء قاعدة البيانات: ' + e]; }
    if (Store.ok) {
      try { d = JSON.parse(txt || 'null'); }
      catch (e) { Store.ok = false; Store.errors = ['ردٌّ غير مفهوم من قاعدة البيانات']; }
    }
    // نصٌّ فارغ من الجسر = فشلٌ صامت في إصدارٍ سابق؛ نعامله فشلًا لا فراغًا
    if (Store.ok && !txt) { Store.ok = false; Store.errors = ['قاعدة البيانات لم تُجب']; }
    if (Store.ok && d && d.load_failed) {
      Store.ok = false;
      Store.errors = [d.message || 'تعذّرت قراءة قاعدة البيانات'];
    }
    // أعطابٌ جزئية: الباقي وصل، ونُعلم المستخدم بما نقص بدل أن نبتلعه
    if (Store.ok && d && Array.isArray(d.errors) && d.errors.length) {
      Store.errors = d.errors.slice();
    }
    if (!Store.ok) { applyData(null); return; }
    applyData(d);
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
  /** ترتيب الحقول المرسلة لكل قسم. */
  setOutOrder: function (kind) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setSetting('ord_' + kind, JSON.stringify(DB.outOrder[kind])) || dbFail(); }
    catch (e) { return dbFail(); }
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
  setFmt: function () {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setSetting('fmt', DB.fmt) || dbFail(); } catch (e) { return dbFail(); }
  },
  saveImage: function (im) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.saveImage(JSON.stringify(im)) || dbFail(); } catch (e) { return dbFail(); }
  },
  dropImage: function (id) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.deleteImage(id) || dbFail(); } catch (e) { return dbFail(); }
  },
  addSent: function (rec) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.addSent(JSON.stringify(rec)) || dbFail(); } catch (e) { return dbFail(); }
  },
  clearSent: function () {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.clearSent() || dbFail(); } catch (e) { return dbFail(); }
  },
  setDirSeeded: function () {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setSetting('dir_seeded', '1') || dbFail(); } catch (e) { return dbFail(); }
  },
  setDirGeo: function () {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setSetting('dir_geo', '1') || dbFail(); } catch (e) { return dbFail(); }
  },
  setUpdAt: function () {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setSetting('upd_at', String(DB.updAt)) || dbFail(); } catch (e) { return dbFail(); }
  },
  setShowLabels: function () {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setSetting('showLabels', String(DB.showLabels)) || dbFail(); } catch (e) { return dbFail(); }
  },
  setShowTitle: function () {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setSetting('showTitle', String(DB.showTitle)) || dbFail(); } catch (e) { return dbFail(); }
  },
  setMode: function () {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setSetting('mode', DB.mode) || dbFail(); } catch (e) { return dbFail(); }
  },
  setDense: function () {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setSetting('dense', String(DB.dense)) || dbFail(); } catch (e) { return dbFail(); }
  },
  setFieldsOutDone: function () {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setSetting('fields_out_done', '1') || dbFail(); } catch (e) { return dbFail(); }
  },
  setImgOutDone: function () {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setSetting('img_out_done', '1') || dbFail(); } catch (e) { return dbFail(); }
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
  setItemOrder: function (kind, ids) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setItemOrder(kind, JSON.stringify(ids)) || dbFail(); } catch (e) { return dbFail(); }
  },
  setGroupOrder: function (ids) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.setGroupOrder(JSON.stringify(ids)) || dbFail(); } catch (e) { return dbFail(); }
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

/* درعُ الكتابة: ما دامت القراءة فاشلة لا تمرّ أي كتابة — مهما كان مصدرها.
   هكذا لا يستطيع إقلاعٌ فاشل أن يزرع تصنيفات فوق تصنيفات المستخدم ولا أن
   يستبدل قاعدةً كاملة ظنًّا أنّها فارغة. الاستعادة من نسخة احتياطية تفتح
   الدرع صراحةً لأنها قرار المستخدم نفسه. */
(function () {
  Object.keys(Store).forEach(function (k) {
    if (typeof Store[k] !== 'function' || k === 'load') return;
    var fn = Store[k];
    Store[k] = function () {
      if (!Store.ok) return false;
      return fn.apply(Store, arguments);
    };
  });
}());

/* ترحيل بيانات الإصدارات السابقة (localStorage) إلى قاعدة البيانات — مرّة
   واحدة فقط، وبشرط أن تكون القاعدة فارغة حتى لا يُطمس شيء. */
function migrateLegacy() {
  if (!Store.ok) return;          // قراءة فاشلة ⇒ لا نعرف ما في القاعدة
  var raw;
  try { raw = localStorage.getItem(KEY); } catch (e) { return; }
  if (!raw) return;
  try {
    // شرطان لا شرط: القاعدة تقول إنّها فارغة، وما بين أيدينا فارغ فعلًا.
    if (!NDB.isEmpty()) { localStorage.removeItem(KEY); return; }
    if (liveCount()) { localStorage.removeItem(KEY); return; }
    var old = JSON.parse(raw);
    if (!old || (!Array.isArray(old.meds) && !Array.isArray(old.labs))) return;
    applyData(old);
    if (NDB.replaceAll(JSON.stringify(snapshot()))) localStorage.removeItem(KEY);
  } catch (e) { /* ترحيل فاشل — تبقى النسخة القديمة مكانها بلا ضرر */ }
}

/** كل ما يُعدّ «بيانات المستخدم» — يقرّر إن كان الاستبدال آمنًا أو خسارة. */
function liveCount() {
  var n = KINDS.reduce(function (a, k) { return a + (DB[k] ? DB[k].length : 0); }, 0);
  return n + DB.cats.length + DB.images.length + DB.groups.length
    + DB.sections.filter(function (s) { return !s.builtin; }).length;
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
/** يكتب نسخة الآن. force من زر يدوي، وإلا فبشرط مرور المدة ووجود بيانات.
    نسخةٌ فارغة أسوأ من لا نسخة: لو كُتبت لأزاحت أقدم نسخةٍ صالحة من الخمس. */
window.autoBackup = function (force) {
  if (!AB) return false;
  if (!liveCount()) return false;
  if (!force && Date.now() - (DB.backup_at || 0) < BACKUP_EVERY) return false;
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
  if (!liveCount()) return toast('لا بيانات لحفظها بعد', 'er');
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
  dangerBox({
    title: 'حذف نسخة احتياطية',
    action: '🗑️ احذف النسخة',
    keep: 'بياناتك الحالية وبقيّة النسخ',
    lose: ['النسخة «' + name.replace(/^dalili-|\.json$/g, '') + '» — لن تستعيدها',
           'إن كانت آخر نسخة، فلا مرجع لك عند أي خطأ'],
    onYes: function () {
      if (AB) AB.deleteBackup(name);
      closeModal(); render(); toast('🗑️ حُذفت');
    }
  });
};
window.backupRestore = function (name) {
  dangerBox({
    title: 'استعادة نسخة احتياطية',
    word: 'استبدال',
    action: '↩️ استبدل بياناتي بهذه النسخة',
    keep: 'نسخةُ أمانٍ لما عندك الآن تُؤخَذ قبل الاستبدال',
    lose: ['كل ما في التطبيق الآن: ' + liveCount() + ' عنصرًا وتصنيفًا ومجموعة',
           'ويحلّ محلّها ما في «' + name.replace(/^dalili-|\.json$/g, '') + '»'],
    onYes: function () { doRestore(name); }
  });
};
/** الاستعادة الفعلية: نسخةُ أمانٍ لما هو قائم أولًا، ثم الاستبدال.
    تفتح درع الكتابة لأن المستخدم اختار الاستبدال صراحةً — وهي المخرج
    الوحيد حين تتعذّر قراءة القاعدة. */
function doRestore(name) {
  var raw = AB ? AB.readBackup(name) : '';
  var data;
  try { data = JSON.parse(raw); } catch (e) { data = null; }
  if (!data) { closeModal(); return toast('الملف غير صالح', 'er'); }
  autoBackup(true);                 // لا يكتب شيئًا إن لم يكن ثمّة ما يُحفَظ
  Store.ok = true;
  applyData(data);
  Store.replaceAll();
  KINDS.forEach(function (k) { Store.setOut(k); });
  Store.setHeader();
  closeModal(); goHome(); toast('✅ تمت الاستعادة');
}

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
  // لا سؤال عند الخروج: المجموعة محفوظة أصلًا، وGRP مجرّد إشارة للمفتوحة
  if (curPage().indexOf('grp:') === 0) GRP = null;
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
  if (drawerOpen()) { closeDrawer(); return true; }
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
  if (p === 'sent') return { icon: '🕘', title: 'سجل الإرسالات' };
  if (p === 'imgs') return { icon: '🖼️', title: 'مكتبة الصور' };
  if (p === 'diag') return { icon: '🩺', title: 'فحص قاعدة البيانات' };
  if (p.indexOf('sort:') === 0) return { icon: '↕️', title: 'ترتيب ' + kindLbl(p.slice(5)).title };
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
  // قراءةٌ فاشلة: لا زرعَ ولا ترقيةَ ولا نسخة — شاشةُ إنقاذٍ وحسب. أي كتابة
  // هنا تكتب فوق بياناتٍ لم نرها، وهذا بالضبط ما يبدو للمستخدم «حذفًا».
  if (!Store.ok) return showRecovery();
  dedupeCats();
  pruneOrphans();
  seedCats();            // تصنيفات الأقسام الأصلية أولًا: شرطها «لا تصنيف بعد»،
  seedDirectory();       // فلو سبقها زرعُ الدليل لامتنعت عن الزرع إلى الأبد
  backfillDirGeo();
  backfillFieldOut();
  backfillImgOut();
  // عدّاد التذكير يبدأ من أول تشغيل: النسخة التي بين يديك هي آخر ما فحصت
  if (!DB.updAt) { DB.updAt = Date.now(); Store.setUpdAt(); }
  autoBackup(false);
  if (DB.pin_hash) showLock();
  else showApp();
  // عطبٌ جزئي: الباقي ظهر، لكن السكوت عمّا نقص هو ما يجعله يبدو حذفًا
  if (Store.errors.length) {
    setTimeout(function () {
      toast('⚠️ تعذّرت قراءة جزء من البيانات — راجِع النسخ الاحتياطية', 'er');
    }, 800);
  }
}

/**
 * شاشة الإنقاذ: تظهر حين تتعذّر قراءة القاعدة. تقول الحقيقة — البيانات لم
 * تُحذف، القراءة هي التي فشلت — وتعرض مخرجين: إعادة المحاولة، أو استعادة
 * إحدى النسخ التلقائية. ولا تكتب حرفًا واحدًا في القاعدة قبل أن يختار.
 */
function showRecovery() {
  $('lock').className = 'scr on'; $('app').className = 'scr';
  var list = backupList();
  h('lock', '<div class="lockbox rec">'
    + '<div class="lockicon">🛟</div>'
    + '<div class="lt">تعذّرت قراءة قاعدة البيانات</div>'
    + '<div class="rec-note">بياناتك <b>لم تُحذف</b> — التطبيق لم يستطع قراءتها هذه المرة،'
    + ' ولن يكتب فوقها شيئًا. جرّب إعادة المحاولة أولًا.</div>'
    + '<button class="btn primary" style="width:100%" onclick="location.reload()">🔄 إعادة المحاولة</button>'
    + (list.length
        ? '<div class="rec-h">أو استعِد نسخة احتياطية:</div>'
          + list.map(function (b) {
              return '<button class="btn" style="width:100%;margin-top:6px" onclick="recoverFrom(\''
                + esc(b.name) + '\')">↩️ '
                + esc(b.name.replace(/^dalili-|\.json$/g, '')) + '</button>';
            }).join('')
        : '<div class="rec-h">لا توجد نسخ احتياطية في هذا الجهاز.</div>')
    + '<button class="btn" style="width:100%;margin-top:10px" onclick="recoverDiag()">🩺 فحص قاعدة البيانات</button>'
    + '<details class="rec-d"><summary>تفاصيل تقنية</summary><div class="rec-e">'
    + esc(Store.errors.join('\n') || 'غير معروف') + '</div></details>'
    + '</div>');
}
/** الفحص متاحٌ حتى حين تتعذّر القراءة — فهو أنفع ما يكون هناك بالذات.
    NAV من صفحةٍ واحدة: لا سهم رجوع يقود إلى تطبيقٍ يبدو فارغًا. */
window.recoverDiag = function () { NAV = ['diag']; showApp(); };
/** الاستعادة من شاشة الإنقاذ — بتأكيدٍ صريح ثم دخولٌ للتطبيق. */
window.recoverFrom = function (name) {
  dangerBox({
    title: 'استعادة نسخة احتياطية',
    word: 'استبدال',
    action: '↩️ استبدل ما في القاعدة بهذه النسخة',
    keep: 'لا شيء يُحذف من النسخ الأخرى',
    lose: ['ما في قاعدة البيانات الآن — وهو ما تعذّرت قراءته',
           'ويحلّ محلّه ما في «' + name.replace(/^dalili-|\.json$/g, '') + '»'],
    onYes: function () { doRestore(name); if (Store.ok) showApp(); }
  });
};

/**
 * تنظيفٌ لطيف لأثر عطبٍ سابق: إقلاعٌ فشلت قراءته كان يزرع التصنيفات
 * الافتراضية من جديد فوق تصنيفات المستخدم، فتتكرّر بالاسم نفسه. العناصر
 * مرتبطة بالاسم لا بالمعرّف، فحذف الصفّ المكرّر لا يمسّ عنصرًا واحدًا.
 */
function dedupeCats() {
  var seen = {}, dups = [];
  DB.cats.forEach(function (c) {
    var key = c.kind + '' + (c.name || '').trim();
    if (seen[key]) dups.push(c); else seen[key] = 1;
  });
  if (!dups.length) return;
  DB.cats = DB.cats.filter(function (c) { return dups.indexOf(c) < 0; });
  dups.forEach(function (c) { Store.dropCat(c.id); });
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
/**
 * رقم الإصدار من الحزمة المثبَّتة نفسها — لا ثابت مكتوب هنا.
 *
 * مصدره الوحيد `versionName/versionCode` في `app/build.gradle`، فيتحدّث مع
 * كل بناء بلا تعديل يدوي في مكانين ولا احتمال أن يخالف ما ثبّته المستخدم.
 * في المتصفح (بلا جسر) لا حزمة أصلًا، فنقول ذلك صراحةً بدل رقم مضلّل.
 */
function appVersion() {
  var b = window.AndroidBridge;
  if (b && typeof b.appVersion === 'function') {
    var v = b.appVersion();
    if (v) return v;
  }
  return 'معاينة في المتصفح';
}

/* ── 🔄 التحديث ──────────────────────────────────────────────────────
 * التطبيق بلا صلاحية إنترنت — وهذا اختيارٌ لا نقص: لا يستطيع أن يتصل
 * بشيء، فلا يستطيع أن يسأل «هل صدر إصدار جديد؟». ما يستطيعه أن يسلّم
 * الرابط لمتصفّح النظام بضغطة واحدة فيُنزَّل هناك، وأن يذكّرك إذا طال
 * العهد. الفرق للمستخدم: ضغطتان بدل البحث عن الرابط في كل مرّة.
 */
var APK_URL = 'https://github.com/alaoufi/Lab_tr/raw/HEAD/dist/dalili.apk';
var UPD_DAYS = 30;
/** فتح رابطٍ خارج التطبيق — المتصفّح أو الخرائط يتولّاه، لا نحن. */
function openOut(url) {
  var b = window.AndroidBridge;
  if (b && typeof b.openExternal === 'function') {
    try { b.openExternal(url); return true; } catch (e) { /* يسقط للبديل */ }
  }
  try { window.open(url, '_blank'); return true; } catch (e) { }
  toast('تعذّر فتح الرابط', 'er');
  return false;
}
function updDays() {
  if (!DB.updAt) return 0;
  return Math.floor((Date.now() - DB.updAt) / 864e5);
}
/** هل مضى ما يكفي ليُحتمَل صدور إصدار جديد؟ */
function updDue() { return !!DB.updAt && updDays() >= UPD_DAYS; }
function updStamp(t) {
  if (!t) return '—';
  try { return new Date(t).toLocaleDateString('ar-SA-u-nu-latn'); }
  catch (e) { return new Date(t).toISOString().slice(0, 10); }
}
/** يفتح صفحة التنزيل ويصفّر العدّاد — الفتح نفسه هو «الفحص». */
window.updNow = function () {
  DB.updAt = Date.now();
  Store.setUpdAt();
  openOut(APK_URL);
  render();
  toast('📥 يُنزَّل في المتصفّح — افتح الملف لتثبيته');
};
/** «لاحقًا» تؤجّل أسبوعًا لا تُسكِت التذكير إلى الأبد. */
window.updLater = function () {
  DB.updAt = Date.now() - (UPD_DAYS - 7) * 864e5;
  Store.setUpdAt();
  render();
};
function updBanner() {
  if (!updDue()) return '';
  return '<div class="updbar"><div class="updbar-t">🔄 مضى ' + updDays()
    + ' يومًا على آخر تحديث — ربّما صدرت نسخة أحدث.</div>'
    + '<div class="updbar-a">'
    + '<button class="btn white sm" onclick="updNow()">📥 حدّث الآن</button>'
    + '<button class="btn white sm" onclick="updLater()">لاحقًا</button>'
    + '</div></div>';
}

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
    + '<div class="muted" style="margin-bottom:9px">كل حقول كل قسم هنا — المؤشَّر منها يخرج في الورقة'
    + ' والصورة والنصّ المنسوخ. و🔒 يعني أنّه يظهر دائمًا ولا يُلغى.</div>'
    + KINDS.map(function (k) {
      var L = kindLbl(k);
      return outBlock(k, L.icon + ' ' + L.title, outDefs(k));
    }).join('')
    + '</div>'
    + '<div class="settings-sec">'
    + '<div class="settings-lbl">شكل الورقة المرسلة</div>'
    + '<label class="chk-row"><input type="checkbox" ' + (DB.showTitle ? 'checked' : '')
    + ' onchange="toggleTitle()"> اكتب عنوانًا تلقائيًّا («قائمة تحاليل»…) أعلى الورقة</label>'
    + '<div class="muted" style="margin-bottom:8px">مطفأ افتراضيًّا: العنوان يولّده التطبيق لا أنت.'
    + ' إن أردته، اكتبه بنفسك في حقل «اسم المريض» قبل الاسم.</div>'
    + '<label class="chk-row"><input type="checkbox" ' + (DB.showLabels ? 'checked' : '')
    + ' onchange="toggleLabels()"> اكتب اسم كل حقل قبل قيمته («متطلبات التحليل: صيام»)</label>'
    + '<div class="muted">مطفأ افتراضيًّا: «صيام ٨ ساعات» أوضح للمريض من'
    + ' «متطلبات التحليل: صيام ٨ ساعات».</div>'
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
    + '<button class="btn full" onclick="goPage(\'imgs\')">🖼️ مكتبة الصور (' + DB.images.length + ')</button>'
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
    + '<div class="settings-sec"><div class="settings-lbl">تحديث التطبيق</div>'
    + '<div class="ver"><span class="ver-l">المثبَّت عندك</span>'
    + '<span class="ver-v">' + esc(appVersion()) + '</span></div>'
    + '<div class="ver"><span class="ver-l">آخر تحديث طلبتَه</span>'
    + '<span class="ver-v">' + esc(updStamp(DB.updAt)) + '</span></div>'
    + (updDue()
        ? '<div class="rec-note" style="margin:10px 0">🔄 مضى ' + updDays()
          + ' يومًا — ربّما صدرت نسخة أحدث.</div>' : '')
    + '<button class="btn full primary" onclick="updNow()">📥 نزّل آخر إصدار</button>'
    + '<div class="muted">التطبيق لا يملك صلاحية إنترنت، فلا يستطيع أن يفحص بنفسه'
    + ' هل صدر إصدار جديد. هذا الزر يسلّم رابط التنزيل لمتصفّح جهازك فينزّله هناك،'
    + ' ثم تفتح الملف لتثبيته فوق نسختك — بياناتك تبقى كما هي. ونذكّرك كل '
    + UPD_DAYS + ' يومًا.</div></div>'
    + '<div class="settings-sec"><div class="settings-lbl">حول</div>'
    + '<div class="ver"><span class="ver-l">إصدار التطبيق</span>'
    + '<span class="ver-v">' + esc(appVersion()) + '</span></div>'
    + (Store.errors.length
        ? '<div class="rec-note" style="margin:10px 0">⚠️ تعذّرت قراءة جزء من بياناتك في آخر فتح.'
          + ' افتح «فحص قاعدة البيانات» لترى ما لم يُقرأ.</div>' : '')
    + '<button class="btn full" onclick="goPage(\'diag\')">🩺 فحص قاعدة البيانات</button>'
    + '<div class="muted">جميع بياناتك محفوظة في قاعدة بيانات محلية على هذا الجهاز فقط، ولا تُرسَل لأي خادم مطلقًا. التطبيق لا يملك صلاحية إنترنت أصلًا.</div></div>'
  );
}

/* ── 🩺 فحص قاعدة البيانات ─────────────────────────────────────────
   «القسم فارغ» و«تعذّرت قراءة القسم» يبدوان واحدًا على الشاشة، وهما ليسا
   كذلك: الأول لا شيء فيه، والثاني فيه كل شيء ولا نراه. هذه الصفحة تسأل
   SQLite مباشرةً فتفصل بينهما، وتُنسَخ بضغطة لتصل لمن يصلح. */
function renderDiag() {
  var d = {};
  try { d = NDB ? JSON.parse(NDB.diagnose() || '{}') : {}; } catch (e) { d = { fatal: String(e) }; }

  var html = (Store.ok ? ''
      : '<button class="btn full" onclick="showRecovery()">↩️ العودة لشاشة الإنقاذ</button>')
    + '<div class="hint">ما في قاعدتك كما يراه SQLite نفسه — لا كما عرضته الشاشة.</div>';

  if (!NDB) {
    h('page', html + emptyBox('🩺', 'الفحص داخل التطبيق فقط',
      'هذه الصفحة تقرأ قاعدة البيانات مباشرةً، ولا قاعدة في المتصفح'));
    return;
  }

  if (Store.errors.length) {
    html += '<div class="rec-note"><b>أخطاء القراءة في آخر فتح:</b><div class="rec-e">'
      + esc(Store.errors.join('\n')) + '</div></div>';
  } else {
    html += '<div class="hint">✅ لا أخطاء قراءة في آخر فتح.</div>';
  }
  if (d.fatal) html += '<div class="rec-note">⛔ ' + esc(d.fatal) + '</div>';

  html += '<div class="settings-sec"><div class="settings-lbl">الجداول</div>';
  (d.tables || []).forEach(function (t) {
    // الحالة الحرجة: صفوفٌ في الجدول ولا شيء يصل الواجهة
    var bad = t.read_error || (t.rows > 0 && t.readable === 0);
    html += '<div class="card"><div class="row">'
      + '<div class="grow"><div class="name">' + (bad ? '⚠️ ' : '') + esc(t.name) + '</div>'
      + '<div class="sub">' + (t.rows < 0 ? 'تعذّر العدّ' : t.rows + ' صفًّا')
      + (t.readable !== undefined ? ' · يُقرأ منها ' + t.readable : '') + '</div>'
      + '<div class="rec-e">' + esc(t.cols || t.cols_error || '') + '</div>'
      + (t.read_error ? '<div class="rec-e">⛔ ' + esc(t.read_error) + '</div>' : '')
      + (t.count_error ? '<div class="rec-e">⛔ ' + esc(t.count_error) + '</div>' : '')
      + '</div></div></div>';
  });
  html += '</div>';

  html += '<div class="settings-sec"><div class="settings-lbl">معلومات</div>'
    + '<div class="ver"><span class="ver-l">إصدار المخطط</span><span class="ver-v">'
    + esc(String(d.version)) + ' / المتوقَّع ' + esc(String(d.expected_version)) + '</span></div>'
    + '<div class="ver"><span class="ver-l">حجم الملف</span><span class="ver-v">'
    + esc(fmtBytes(d.size || 0)) + '</span></div>'
    + '<div class="rec-e">' + esc(d.path || '') + '</div></div>';

  html += '<button class="btn full primary" onclick="diagCopy()">📋 نسخ التقرير</button>';
  h('page', html);
  DIAG = d;
}
var DIAG = null;
/** التقرير نصًّا — لا يحوي بياناتك، فقط أسماء الجداول وأعدادها وأعمدتها. */
window.diagCopy = function () {
  var lines = ['دليلي ' + appVersion(),
               'مخطط: ' + (DIAG && DIAG.version) + ' / متوقَّع ' + (DIAG && DIAG.expected_version),
               'أخطاء القراءة: ' + (Store.errors.join(' | ') || 'لا شيء'), ''];
  ((DIAG && DIAG.tables) || []).forEach(function (t) {
    lines.push(t.name + ': ' + t.rows + ' صفًّا'
      + (t.readable !== undefined ? ', يُقرأ ' + t.readable : '')
      + (t.read_error ? ', خطأ: ' + t.read_error : ''));
    lines.push('   [' + (t.cols || t.cols_error || '') + ']');
  });
  var txt = lines.join('\n');
  try {
    if (AB && AB.copyText) { AB.copyText(txt); return toast('📋 نُسخ التقرير'); }
  } catch (e) { /* يسقط للأسفل */ }
  toast('تعذّر النسخ', 'er');
};
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
    + '<label class="chk-row locked">🔒 ' + esc(nameFieldLabel(kind)) + '</label>'
    + fields.map(function (f) {
      return '<label class="chk-row"><input type="checkbox" ' + (sel.indexOf(f[0]) >= 0 ? 'checked' : '')
        + ' onchange="toggleOut(\'' + kind + '\',\'' + f[0] + '\')"> ' + esc(f[1]) + '</label>';
    }).join('') + '</div>';
}
window.toggleTitle = function () {
  DB.showTitle = DB.showTitle ? 0 : 1;
  Store.setShowTitle();
  toast(DB.showTitle ? '✅ العنوان يظهر على الورقة' : '🚫 لا عنوان — اسم المريض والتاريخ وحدهما');
};
window.toggleLabels = function () {
  DB.showLabels = DB.showLabels ? 0 : 1;
  Store.setShowLabels();
  toast(DB.showLabels ? '✅ أسماء الحقول تظهر' : '🚫 القيم وحدها بلا أسماء');
};
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
  dangerBox({
    title: 'إزالة رمز القفل',
    action: '🔓 أزِل الرمز',
    keep: 'كل بياناتك كما هي',
    lose: ['حماية التطبيق — يفتحه بعدها كل من يمسك الجهاز'],
    onYes: function () { DB.pin_hash = null; Store.setPin(null); closeModal(); toast('تمت الإزالة'); }
  });
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
      dangerBox({
        title: 'استيراد نسخة من ملف',
        word: 'استبدال',
        action: '📥 استبدل بياناتي بهذا الملف',
        keep: 'نسخةُ أمانٍ لما عندك الآن تُؤخَذ قبل الاستبدال',
        lose: ['كل ما في التطبيق الآن: ' + liveCount() + ' عنصرًا وتصنيفًا ومجموعة',
               'ويحلّ محلّها ما في الملف المختار'],
        onYes: function () {
        var keep = DB.pin_hash;
        autoBackup(true);          // نسخة أمانٍ للقائم قبل أن يحلّ محلّه غيره
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
        }
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

/** حذف عنصر: يسمّيه، ويعدّ ما يتبعه من مجموعاتٍ وتحديد. */
function itemDangerBox(kind, id, onYes) {
  var o = coll(kind).find(function (x) { return x.id === id; });
  var inGrp = DB.groups.filter(function (g) {
    return g.kind === kind && g.items.indexOf(id) >= 0;
  }).length;
  dangerBox({
    title: 'حذف «' + (o ? itemLabel(kind, o) : 'عنصر') + '»',
    action: '🗑️ احذفه',
    keep: 'بقيّة ' + kindLbl(kind).title + ' وتصنيفاتها',
    lose: [
      'العنصر وكل ما كُتب في حقوله',
      DB.cart[kind].indexOf(id) >= 0 ? 'إزالته من قائمتك المحدَّدة' : '',
      inGrp ? 'إزالته من ' + countWord(inGrp, 'مجموعة واحدة', 'مجموعتين', 'مجموعات', 'مجموعة') : ''
    ],
    onYes: onYes
  });
}

/**
 * صندوق ما لا رجعة فيه.
 *
 * «حذف هذا العنصر؟ [تأكيد]» لا يقول ماذا يُحذف ولا كم، ولا يفرّق بين حذف
 * سطرٍ وحذف قسمٍ بكل ما فيه. هنا يُعدّ المفقود صراحةً، ويُذكَر ما يبقى
 * سالمًا، والزرّ يحمل اسم الفعل لا كلمة «تأكيد».
 *
 * @param o.title   عنوان الصندوق
 * @param o.lose    أسطر بما سيُفقَد — بأعداده
 * @param o.keep    ما يبقى سالمًا (طمأنةٌ صادقة تمنع التردّد في الحذف الصغير)
 * @param o.word    كلمةٌ يكتبها المستخدم ليُفعَّل الزرّ — للأفعال الأثقل وحدها
 * @param o.action  نصّ الزرّ الأحمر
 */
function dangerBox(o) {
  var lose = (o.lose || []).filter(Boolean);
  var needWord = !!o.word;
  openModal('⚠️ ' + o.title,
    '<div class="dz">'
    + (lose.length
        ? '<div class="dz-h">سيُحذف نهائيًا:</div><ul class="dz-l">'
          + lose.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'
        : '')
    + '<div class="dz-w">لا يمكن التراجع عن هذا.</div></div>'
    + (o.keep ? '<div class="dz-k">✅ يبقى سالمًا: ' + esc(o.keep) + '</div>' : '')
    + (needWord
        ? '<div class="f" style="margin-top:12px"><label>اكتب <b>' + esc(o.word)
          + '</b> للتأكيد</label><input id="dz-in" class="inp" autocomplete="off"'
          + ' oninput="dzCheck()" placeholder="' + esc(o.word) + '"></div>'
        : '')
    + '<div class="mft"><button class="btn danger" id="cb-yes"'
    + (needWord ? ' disabled' : '') + '>' + esc(o.action || 'احذف نهائيًا') + '</button>'
    + '<button class="btn" onclick="closeModal()">إلغاء</button></div>');
  DZ_WORD = o.word || '';
  var b = $('cb-yes');
  if (b) b.onclick = function () {
    if (DZ_WORD && String((($('dz-in') || {}).value) || '').trim() !== DZ_WORD) return;
    o.onYes();
  };
}
var DZ_WORD = '';
/** الزرّ لا يُفعَّل حتى تُكتب الكلمة بالضبط — تعمّدٌ لا نقرة عابرة. */
window.dzCheck = function () {
  var b = $('cb-yes'), e = $('dz-in');
  if (!b || !e) return;
  b.disabled = String(e.value || '').trim() !== DZ_WORD;
};

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
  else if (p === 'sent') renderSentPage();
  else if (p === 'imgs') renderImagesPage();
  else if (p === 'diag') renderDiag();
  else if (p.indexOf('sort:') === 0) renderSortPage(p.slice(5));
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

  // تحذير ثابت لا يزول مع إشعارٍ عابر: ما لم يُقرأ يجب أن يُرى في كل فتح
  if (Store.errors.length) {
    html += '<div class="rec-note"><b>⚠️ تعذّرت قراءة جزء من بياناتك.</b><br>'
      + 'لم يُحذف شيء، ولن يكتب التطبيق فوق ما لم يقرأه. <b>لا تُعِد الإدخال</b>'
      + ' قبل أن تفحص.</div>'
      + '<button class="btn full primary" onclick="goPage(\'diag\')">🩺 افحص قاعدة البيانات</button>';
  }

  html += updBanner();

  // الوضع ظاهرٌ من الرئيسية أيضًا: يُعرَف قبل الدخول لا بعده
  html += modeBar();

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
  if (DB.sent.length) {
    html += '<button class="btn full" style="margin-bottom:12px" onclick="goPage(\'sent\')">'
      + '🕘 آخر ما أرسلت (' + DB.sent.length + ')</button>';
  }
  html += '<div class="hgrid">'
    + KINDS.map(function (k, i) {
      var n = coll(k).length, L = kindLbl(k);
      return homeCard(k, L.icon, L.title,
        n ? countWord(n, L.one, L.two, L.few, L.many)
          : (kindFailed(k) ? '⚠️ تعذّرت القراءة' : 'لا شيء بعد'),
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
/* ── تسهيل الإضافة ──────────────────────────────────────────────
   إدخال عشرة عناصر كان يعني فتح النموذج وإغلاقه عشر مرات، وإعادة اختيار
   التصنيف في كل مرة. ثلاثة أشياء تختصر ذلك: «حفظ ومتابعة» يُبقيك في
   النموذج، وآخر تصنيف يُقترح تلقائيًا، و«تكرار» ينسخ عنصرًا شبيهًا. */

/** آخر تصنيف استُعمل في كل قسم — يُقترح في النموذج التالي وفي الإضافة السريعة. */
var LAST_CAT = {};
/** مصدر النسخ عند «تكرار عنصر» — يُستهلك أول ما يُفتح النموذج. */
var DUP = null;

/** يفتح نموذج القسم أيًّا كان أصليًّا أو منشأً. */
function openForm(kind, id) {
  if (kind === 'meds') return medForm(id);
  if (kind === 'labs') return labForm(id);
  if (kind === 'imaging') return imgForm(id);
  if (kind === 'recipes') return recipeForm(id);
  return secItemForm(kind, id);
}
window.quickAdd = function (kind) { openForm(kind); };

/** القيم المبدئية لعنصر جديد: نسخة عنصر قائم، أو آخر تصنيف استُعمل. */
function newItem(kind) {
  if (DUP) { var d = DUP; DUP = null; return d; }
  return { category: LAST_CAT[kind] || '' };
}
/** «⧉ تكرار»: يفتح النموذج مملوءًا بنسخة العنصر بلا معرّف، فتعدّل ما اختلف. */
window.dupItem = function (kind, id) {
  var o = coll(kind).find(function (x) { return x.id === id; });
  if (!o) return;
  DUP = {};
  Object.keys(o).forEach(function (k) { if (k !== 'id') DUP[k] = o[k]; });
  if (DUP.extra) {
    var x = {}; Object.keys(DUP.extra).forEach(function (k) { x[k] = DUP.extra[k]; });
    DUP.extra = x;
  }
  openForm(kind);
};

/** ذيل النموذج: «حفظ ومتابعة» يظهر عند الإضافة فقط لا عند التعديل. */
function mft(saveFn, id) {
  var call = saveFn + '(\'' + (id || '') + '\'';
  return '<div class="mft"><button class="btn primary" onclick="' + call + ')">حفظ</button>'
    + (id ? '' : '<button class="btn wa" onclick="' + call + ',1)">💾 حفظ ومتابعة</button>')
    + '<button class="btn" onclick="closeModal()">إلغاء</button></div>';
}
/** ما بعد الحفظ: إمّا نغلق، أو نُبقي المستخدم في نموذج جديد جاهز للتالي. */
/**
 * `ok` نتيجة الكتابة في القاعدة لا في الذاكرة.
 *
 * كانت تُهمَل: فيظهر «تعذّر الحفظ» من `dbFail` ثم تطمسه «✅ تم الحفظ» بعده
 * بلحظة، ويُغلق النموذج، ويبدو العنصر معدَّلًا — حتى تُعيد التشغيل فيعود
 * كما كان. وهذا بالضبط ما يُسمّى «لا يحفظ التعديلات». الآن الفشل يُقال،
 * ويبقى النموذج مفتوحًا بما كتبتَه فلا يضيع.
 */
function afterSave(kind, again, id, ok) {
  if (ok === false) {
    toast('⚠️ لم يُحفَظ — راجِع 🩺 فحص قاعدة البيانات', 'er');
    return;
  }
  var caught = grpCatch(kind);    // عنصرٌ أُنشئ لأجل مجموعة يدخلها فورًا
  if (again && !id) {
    render();
    openForm(kind);
    if (!caught) toast('✅ حُفظ — أضِف التالي');
    return;
  }
  closeModal();
  if (!caught) toast('✅ تم الحفظ');
  // العودة لصفحة المجموعة لا لصفحة القسم حين كان الإنشاء لأجلها
  var back = GRP_CATCH ? 'grp:' + GRP_CATCH.kind + ':' + GRP_CATCH.id : kind;
  GRP_CATCH = null;
  if (curPage() !== back) goPage(back); else render();
}

/** حقل الاسم يختلف في العلاجات وحدها. */
function nameKey(kind) { return kind === 'meds' ? 'trade_name' : 'name'; }

/** بحثٌ بلا نتيجة هو أسرع مدخل للإضافة: الاسم مكتوب أصلًا في خانة البحث. */
function noHit(kind, q) {
  var cat = LAST_CAT[kind];
  // الإضافة فعلُ إدخال: في وضع الإرسال نعرض الطريق إليها لا الفعل نفسه
  if (mode() !== 'edit') {
    return '<div class="empty"><div class="ei">🔎</div>'
      + '<div class="et">لا نتيجة لـ«' + esc(q) + '»</div>'
      + '<button class="btn primary full" style="margin-top:11px" onclick="setMode(\'edit\')">'
      + '📝 انتقل لوضع الإدخال لإضافته</button></div>';
  }
  return '<div class="empty"><div class="ei">🔎</div>'
    + '<div class="et">لا نتيجة لـ«' + esc(q) + '»</div>'
    + '<button class="btn primary full" style="margin-top:11px" onclick="addNamed(\'' + kind + '\')">'
    + '➕ أضِفه بهذا الاسم' + (cat ? ' إلى «' + esc(cat) + '»' : '') + '</button>'
    + '<div class="es" style="margin-top:9px">أو «➕ إضافة عنصر» لملء بقيّة الحقول</div></div>';
}
/** إضافة بالاسم وحده — تُكمَّل تفاصيله متى شئت. */
window.addNamed = function (kind) {
  var el = $('srch'), q = el ? String(el.value || '').trim() : '';
  if (!q) return;
  var rec = { id: uid(), category: LAST_CAT[kind] || '', extra: {} };
  rec[nameKey(kind)] = q;
  coll(kind).push(rec);
  catEnsure(kind, rec.category);
  Store.upsert(kind, rec);
  if (el) el.value = '';          // القائمة تعود كاملة والحقل جاهز للتالي
  render();
  toast('✅ أُضيف «' + q + '»');
};

/** الحقول الأقل استعمالًا تُطوى فيبقى النموذج قصيرًا على الجوال. */
function moreBlock(inner) {
  return inner ? '<details class="more"><summary>المزيد من الحقول ▾</summary>'
    + '<div class="more-b">' + inner + '</div></details>' : '';
}

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
  var nc = DB.cats.filter(function (c) { return c.kind === id; }).length;
  var nf = fieldsOf(id).length;
  var ng = groupsOf(id).length;
  dangerBox({
    title: 'حذف قسم «' + s.title + '»',
    word: s.title,                 // أثقل حذفٍ في التطبيق: يُكتب اسمه
    action: '🗑️ احذف القسم وكل ما فيه',
    keep: 'بقيّة الأقسام وبياناتها',
    lose: [
      'القسم «' + s.title + '» بالكامل',
      n ? countWord(n, 'عنصر واحد', 'عنصران', 'عناصر', 'عنصرًا') : '',
      nc ? countWord(nc, 'تصنيف واحد', 'تصنيفان', 'تصنيفات', 'تصنيفًا') : '',
      nf ? countWord(nf, 'حقل واحد', 'حقلان', 'حقول', 'حقلًا') + ' وما كُتب فيها' : '',
      ng ? countWord(ng, 'مجموعة واحدة', 'مجموعتان', 'مجموعات', 'مجموعة') : ''
    ],
    onYes: function () {
    autoBackup(true);   // أكثر حذفٍ كلفةً في التطبيق — نسخةُ أمانٍ قبله
    DB.sections = DB.sections.filter(function (x) { return x.id !== id; });
    DB.cats = DB.cats.filter(function (c) { return c.kind !== id; });
    DB.fields = DB.fields.filter(function (f) { return f.kind !== id; });
    DB.groups = DB.groups.filter(function (g) { return g.kind !== id; });
    delete DB[id]; delete DB.cart[id]; delete DB.out[id];
    KINDS = DB.sections.map(function (x) { return x.id; });
    Store.dropSection(id);
      closeModal(); goPage('secs'); toast('🗑️ حُذف القسم');
    }
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
  return itemCard(kind, o,
    '<div class="name">' + esc(o.name) + (o.flag ? ' <span class="star">★</span>' : '') + '</div>'
    + (o.category ? '<div class="sub">' + esc(o.category) + '</div>' : '')
    + extraRow(kind, o),
    "secItemForm('" + kind + "','" + o.id + "')",
    "secItemDel('" + kind + "','" + o.id + "')");
}
function renderCustomSection(kind) {
  var L = kindLbl(kind);
  var q = (($('srch') || {}).value || '').trim().toLowerCase();
  var html = sectionBar(kind, q, '🔎 ابحث…', "secItemForm('" + kind + "')");
  if (mode() === 'send' && DB.cart[kind].length) html += cartBar(kind, DB.cart[kind].length);
  h('page', html + listBox(secListHtml(kind, q)));
}
/** قائمة قسمٍ أنشأه المستخدم — نفس بنية الأصلية، بلا جدولٍ خاص بها. */
function secListHtml(kind, q) {
  var L = kindLbl(kind);
  var list = coll(kind).filter(function (o) {
    if (!q) return true;
    var hay = [o.name, o.category].concat(fieldsOf(kind).map(function (f) {
      return (o.extra || {})[f.key] || '';
    })).join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  });
  if (!list.length) {
    return q ? noHit(kind, q)
      : emptyBox(L.icon, 'لا شيء في ' + L.title,
          fieldsOf(kind).length ? 'اضغط «➕ إضافة عنصر» لتبدأ'
            : 'أضِف حقولًا لهذا القسم من 🧩 الحقول');
  }
  if (q) return list.map(function (o) { return secRow(kind, o); }).join('');
  var out = '';
  var fav = list.filter(function (o) { return o.flag; });
  if (fav.length) out += accBlock('⭐ مفضّلة', fav.map(function (o) { return secRow(kind, o); }).join(''), true,
    'pickFlag(&#39;' + kind + '&#39;)');
  var gs = groupBy(list, kind), op = openByDefault(list, gs);
  gs.forEach(function (g) {
    out += accBlock(L.icon + ' ' + g.cat + ' (' + g.items.length + ')',
      g.items.map(function (o) { return secRow(kind, o); }).join(''), op,
      pickCall(kind, g.cat), kind, g.cat);
  });
  return out;
}
window.secItemForm = function (kind, id) {
  var o = id ? (coll(kind).find(function (x) { return x.id === id; }) || {}) : newItem(kind);
  var L = kindLbl(kind);
  var body = '<div class="f"><label>الاسم *</label>'
    + '<input id="cf-name" class="inp" value="' + esc(o.name || '') + '"></div>'
    + catField('cf', kind, o.category)
    + imgField('cf', o.img)
    + extraFields('cf', kind, o)
    + addFieldPanel('cf', kind)
    + '<label class="chk-row"><input type="checkbox" id="cf-flag" ' + (o.flag ? 'checked' : '') + '> ⭐ مفضّل</label>'
    + '<div class="mft"><button class="btn primary" onclick="secItemSave(\'' + kind + '\',\'' + (id || '') + '\')">حفظ</button>'
    + (id ? '' : '<button class="btn wa" onclick="secItemSave(\'' + kind + '\',\'\',1)">💾 حفظ ومتابعة</button>')
    + '<button class="btn" onclick="closeModal()">إلغاء</button></div>';
  openModal((id ? '✏️ تعديل — ' : '+ إضافة — ') + L.title, body);
};
window.secItemSave = function (kind, id, again) {
  var body = {
    name: (($('cf-name') || {}).value || '').trim(),
    category: (($('cf-category') || {}).value || '').trim(),
    extra: readExtra('cf', kind),
    img: (($('cf-img') || {}).value || '').trim(),
    flag: ($('cf-flag') || {}).checked ? 1 : 0
  };
  if (!body.name) return toast('الاسم مطلوب', 'er');
  catEnsure(kind, body.category);
  LAST_CAT[kind] = body.category;
  var rec;
  if (id) { rec = coll(kind).find(function (x) { return x.id === id; }); Object.assign(rec, body); }
  else { body.id = uid(); coll(kind).push(body); rec = body; }
  var ok = Store.upsert(kind, rec);
  afterSave(kind, again, id, ok);
};
window.secItemDel = function (kind, id) {
  itemDangerBox(kind, id, function () {
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
/** مصغّرة صورة العنصر على بطاقته. */
function thumb(o) {
  return (o && o.img && imgByCode(o.img))
    ? '<img class="cardpic" src="' + imgData(o.img) + '" alt="">' : '';
}
/** قيم الحقول الإضافية كما تظهر على بطاقة العنصر داخل القائمة. */
function extraRow(kind, o) {
  var x = (o && o.extra) || {};
  return fieldsOf(kind).map(function (f) {
    var v = x[f.key];
    if (!v) return '';
    // الموقع يُفتح من البطاقة نفسها: قراءته إحداثياتٍ لا تفيد أحدًا
    var u = f.type === 'geo' ? geoLink(v) : '';
    var body = u
      ? '<a class="geo-a" href="#" onclick="return geoTap(event,\'' + jsq(u) + '\')">📍 افتح الخريطة</a>'
      : esc(v);
    return '<div class="xf"><span class="xf-l">' + esc(f.label) + ':</span> ' + body + '</div>';
  }).join('');
}
/** مفتاح ثابت لا يتغيّر بتغيّر التسمية، فلا تضيع القيم عند إعادة التسمية. */
function fieldKey() { return 'f' + uid(); }

/**
 * صفحة الحقول — مكانٌ واحد يحكم ما يخرج من القسم وبأي ترتيب.
 *
 * كان ظهور الحقل في العرض والإرسال يُضبَط في الإعدادات، وترتيبه هنا،
 * وحقول القسم الأصلية في موضعٍ ثالث. ثلاثة أماكن لقرارٍ واحد. الآن كلّها
 * هنا: كل حقلٍ — أصليًّا كان أو مضافًا — بسطره وزرّ ظهوره وسهمَي ترتيبه.
 */
/**
 * صفحة الحقول — مكانٌ واحد يحكم ما يخرج من القسم وبأي ترتيب.
 *
 * قائمةٌ واحدة بكل حقول الإرسال — الأصلية والمضافة معًا — بترتيبها على
 * الورقة. لكل سطر: زرّ ظهورٍ (👁️/🚫)، وسهما ترتيبٍ يحرّكانه بين كل
 * الحقول لا بين أقرانه فقط، و✏️🗑️ للمضاف وحده. وكان هذا موزّعًا على
 * ثلاثة أماكن ولا ترتيب فيه للأصلية إطلاقًا.
 */
function renderFieldsPage(kind) {
  var L = kindLbl(kind);
  var defs = outDefs(kind);
  var custom = {};
  fieldsOf(kind).forEach(function (f) { custom['x:' + f.key] = f; });

  var html = '<button class="btn full primary" onclick="fldNew(\'' + kind + '\')">➕ حقل جديد</button>'
    + '<div class="hint">هذه هي أسطر الورقة بترتيبها. 👁️ يُظهر الحقل في العرض'
    + ' والإرسال و🚫 يُخفيه، والسهمان يقدّمانه ويؤخّرانه.</div>'
    + '<div class="card"><div class="row">'
    + '<span class="eye on lock">🔒</span>'
    + '<div class="grow"><div class="name">' + esc(nameFieldLabel(kind)) + '</div>'
    + '<div class="sub">يظهر دائمًا في العنوان — لا يُلغى ولا يُحرَّك</div></div></div></div>';

  html += defs.map(function (f, i) {
    var cf = custom[f[0]];
    return '<div class="card"><div class="row">'
      + outEyeBtn(kind, f[0])
      + '<div class="grow"><div class="name">' + (cf ? '🧩 ' : '') + esc(f[1]) + '</div>'
      + '<div class="sub">' + (outHas(kind, f[0]) ? 'سطرٌ في الورقة' : 'مخفيّ عن الإرسال')
      + (cf ? ' · ' + fldTypeLbl(cf.type) + ' · أضفتَه أنت' : '')
      + '</div></div>'
      + '<button class="ic"' + (i === 0 ? ' disabled' : '')
      + ' onclick="outMove(\'' + kind + '\',\'' + f[0] + '\',-1)">▲</button>'
      + '<button class="ic"' + (i === defs.length - 1 ? ' disabled' : '')
      + ' onclick="outMove(\'' + kind + '\',\'' + f[0] + '\',1)">▼</button>'
      + (cf
          ? '<button class="ic" onclick="fldEdit(\'' + kind + '\',\'' + cf.id + '\')">✏️</button>'
            + '<button class="ic" onclick="fldDel(\'' + kind + '\',\'' + cf.id + '\')">🗑️</button>'
          : '')
      + '</div></div>';
  }).join('');

  html += '<button class="btn full" onclick="goPage(\'cat:' + kind + '\')">🏷️ تصنيفات '
    + esc(L.title) + '</button>';
  h('page', html);
}
/** هل هذا الحقل ضمن ما يخرج في العرض والإرسال؟ */
function outHas(kind, key) {
  return (DB.out[kind] || []).indexOf(key) >= 0;
}
/** زرّ الظهور — حالته مقروءة من شكله لا من ذاكرة المستخدم. */
function outEyeBtn(kind, key) {
  var on = outHas(kind, key);
  return '<button class="eye' + (on ? ' on' : '') + '"'
    + ' onclick="fldEye(\'' + kind + '\',\'' + key + '\')"'
    + ' title="' + (on ? 'يظهر — اضغط لإخفائه' : 'مخفيّ — اضغط لإظهاره') + '">'
    + (on ? '👁️' : '🚫') + '</button>';
}
window.fldEye = function (kind, key) {
  toggleOut(kind, key);
  render();
  toast(outHas(kind, key) ? '👁️ يظهر في العرض والإرسال' : '🚫 أُخفي عن العرض والإرسال');
};
/**
 * أنواع الحقول — مصدرٌ واحد تقرؤه لوحتا الإضافة وصفحة الحقول معًا، فلا
 * يُضاف نوعٌ في مكانٍ ويغيب عن الآخر.
 */
var FLD_TYPES = [
  ['text', 'سطر واحد'],
  ['area', 'نصّ طويل'],
  ['geo', '📍 موقع على الخريطة']
];
function fldTypeLbl(t) {
  for (var i = 0; i < FLD_TYPES.length; i++) if (FLD_TYPES[i][0] === t) return FLD_TYPES[i][1];
  return FLD_TYPES[0][1];
}
/** أزرار اختيار النوع — `hid` معرّف الحقل المخفيّ الذي تكتب فيه. */
function fldTypeSegs(t, hid) {
  return '<div class="f"><label>نوع الحقل</label><div class="segs">'
    + FLD_TYPES.map(function (o) {
      return '<button type="button" class="seg' + (t === o[0] ? ' on' : '') + '"'
        + ' data-t="' + o[0] + '" onclick="fldPickType(this)">' + o[1] + '</button>';
    }).join('')
    + '</div><input type="hidden" id="' + hid + '" value="' + esc(t) + '"></div>';
}
function fldFormBody(f) {
  return '<div class="f"><label>اسم الحقل *</label>'
    + '<input id="ff-label" class="inp" value="' + esc(f.label || '') + '" placeholder="مثال: الشركة المصنّعة"></div>'
    + fldTypeSegs(f.type || 'text', 'ff-type');
}
window.fldPickType = function (btn) {
  var kids = btn.parentNode.children;
  for (var i = 0; i < kids.length; i++) kids[i].className = 'seg';
  btn.className = 'seg on';
  /* الحقل المخفيّ جارُ الأزرار، لا ذو معرّفٍ ثابت: نفس اللوحة تُفتح من
     صفحة الحقول (`ff-type`) ومن داخل نموذج العنصر (`<pfx>-nt`)، فربطُها
     بمعرّفٍ واحد كان يجعل اختيار النوع في الثانية بلا أثر — كل حقل
     يُضاف من داخل النموذج يخرج «سطرًا واحدًا» مهما اخترت. */
  var box = btn.parentNode.parentNode;
  var hidden = (box && box.querySelector) ? box.querySelector('input[type=hidden]') : null;
  if (!hidden) hidden = $('ff-type');
  if (hidden) hidden.value = btn.getAttribute('data-t');
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
  // يُدرَج في الحقول المرسلة فورًا: من أنشأ حقلًا يريده أن يظهر، ولو لم
  // يُدرَج لبقي ما يكتبه فيه غائبًا عن الطباعة والصورة بلا سبب ظاهر.
  DB.out[kind] = (DB.out[kind] || []).concat('x:' + f.key);
  Store.setOut(kind);
  closeModal(); render(); toast('✅ أُضيف الحقل — ويظهر في الإرسال');
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
  dangerBox({
    title: 'حذف حقل «' + f.label + '»',
    action: '🗑️ احذف الحقل',
    keep: 'العناصر نفسها وبقيّة حقولها',
    lose: ['الحقل من كل عناصر ' + kindLbl(kind).title,
           'ما كُتب فيه داخلها — لن يظهر بعدها'],
    onYes: function () {
      DB.fields = DB.fields.filter(function (x) { return x.id !== id; });
      DB.out[kind] = (DB.out[kind] || []).filter(function (k) { return k !== 'x:' + f.key; });
      Store.dropField(id); Store.setOut(kind);
      closeModal(); render(); toast('🗑️ حُذف الحقل');
    }
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

/**
 * ترقية لمرّة واحدة: الحقول التي عُرِّفت قبل أن يصير الإدراج تلقائيًا بقيت
 * خارج «الحقول المرسلة»، فكان ما يُكتب فيها يظهر على البطاقة ولا يصل
 * الورقة ولا الصورة. نُدرجها هنا مرّةً واحدة تحرسها علامة في الإعدادات،
 * حتى يبقى أي إلغاء تأشير يفعله المستخدم بعدها ثابتًا.
 */
/**
 * الصورة صارت حقلًا يُؤشَّر — وكانت تخرج دائمًا بلا خيار.
 * فنؤشّرها مرّةً واحدة لمن كان يستعمل التطبيق قبل ذلك، وإلّا اختفت صوره
 * من الورقة فجأةً بلا سبب يراه.
 */
function backfillImgOut() {
  if (DB.img_out_done) return;
  KINDS.forEach(function (k) {
    var arr = DB.out[k];
    if (arr && arr.indexOf('img') < 0) { arr.push('img'); Store.setOut(k); }
  });
  DB.img_out_done = 1;
  Store.setImgOutDone();
}
function backfillFieldOut() {
  if (DB.fields_out_done) return;
  var touched = {};
  DB.fields.forEach(function (f) {
    var key = 'x:' + f.key, arr = DB.out[f.kind];
    if (arr && arr.indexOf(key) < 0) { arr.push(key); touched[f.kind] = 1; }
  });
  Object.keys(touched).forEach(function (k) { Store.setOut(k); });
  DB.fields_out_done = 1;
  Store.setFieldsOutDone();
}

/** اختيار صورة العنصر من المكتبة — قائمة منسدلة ومعاينة صغيرة. */
function imgField(pfx, cur) {
  cur = cur || '';
  if (!DB.images.length) {
    return '<div class="f"><label>الصورة</label>'
      + '<div class="es">لا صور في المكتبة بعد — أضِفها من ⚙️ الإعدادات ← مكتبة الصور.</div>'
      + '<input type="hidden" id="' + pfx + '-img" value=""></div>';
  }
  return '<div class="f"><label>الصورة</label>'
    + '<select id="' + pfx + '-imgsel" class="inp sel" onchange="imgSel(\'' + pfx + '\')">'
    + '<option value=""' + (cur ? '' : ' selected') + '>— بلا صورة —</option>'
    + DB.images.map(function (im) {
      return '<option value="' + esc(im.code) + '"' + (cur === im.code ? ' selected' : '') + '>'
        + esc(im.name || im.code) + '</option>';
    }).join('')
    + '</select>'
    + '<div id="' + pfx + '-imgprev" class="imgprev sm"' + (cur ? '' : ' style="display:none"') + '>'
    + (cur ? '<img src="' + imgData(cur) + '" alt="">' : '') + '</div>'
    + '<input type="hidden" id="' + pfx + '-img" value="' + esc(cur) + '"></div>';
}
window.imgSel = function (pfx) {
  var sel = $(pfx + '-imgsel'), hid = $(pfx + '-img'), pv = $(pfx + '-imgprev');
  if (!sel || !hid) return;
  hid.value = sel.value;
  if (!pv) return;
  if (sel.value) { pv.innerHTML = '<img src="' + imgData(sel.value) + '" alt="">'; pv.style.display = ''; }
  else { pv.innerHTML = ''; pv.style.display = 'none'; }
};

/** حقول المستخدم داخل نموذج العنصر — تُقرأ وتُكتب في o.extra. */
/* ── 📍 الموقع على الخريطة ───────────────────────────────────────────
 * العنوان المكتوب يصف المكان، والرابط يفتحه — والمريض يحتاج الاثنين.
 * نقبل ما يصل المستخدمَ فعلًا: إحداثيات ينسخها من تطبيق الخرائط، أو
 * رابطًا يشاركه به أحد. وما عدا ذلك يبقى نصًّا كما كُتب — لا نخترع
 * موقعًا لا نعرفه ولا نرسل رابطًا يقود إلى مكانٍ خطأ.
 *
 * ولا شيء من هذا يفتح اتصالًا: الرابط نصٌّ نكتبه ونرسله، ومن يضغطه هو
 * تطبيق الخرائط عند المستلِم أو عندك.
 */
var GEO_NUM = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,،]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
function geoLink(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  var m = s.match(GEO_NUM);
  if (m) {
    var la = parseFloat(m[1]), lo = parseFloat(m[2]);
    if (la < -90 || la > 90 || lo < -180 || lo > 180) return '';
    return 'https://maps.google.com/?q=' + m[1] + ',' + m[2];
  }
  if (/^https?:\/\/\S+$/i.test(s) || /^geo:\S+$/i.test(s)) return s;
  return '';
}
/** نصّ تحت الحقل يقول بصراحة: هل سيصل هذا موقعًا يُفتح أم سطرَ نصّ؟ */
function geoHint(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return 'الصق إحداثيات (24.7136, 46.6753) أو رابط موقع من تطبيق الخرائط.';
  return geoLink(s)
    ? '✅ سيُرسَل رابطًا يفتح الخريطة عند من يستلمه.'
    : '⚠️ ليست إحداثيات ولا رابطًا — سيُرسَل نصًّا كما كتبته.';
}
window.geoEcho = function (id) {
  var el = $(id), out = $(id + '-e');
  if (el && out) out.innerHTML = esc(geoHint(el.value));
};
/** يفتح الموقع في تطبيق الخرائط عبر نيّة نظام — لا اتصال من التطبيق. */
window.geoOpen = function (v) {
  var u = geoLink(v);
  if (!u) return toast('لا يوجد موقع يُفتح — الصق إحداثيات أو رابطًا', 'er');
  openOut(u);
};
window.geoOpenFrom = function (id) { var el = $(id); geoOpen(el ? el.value : ''); };
/**
 * ضغطة الوصلة على البطاقة: البطاقة نفسها تستمع للضغط — تفتح التعديل في
 * وضع الإدخال وتؤشّر في وضع الإرسال — فبلا إيقاف التصعيد يفتح الموقعُ
 * نموذجًا خلفه أو يؤشّر عنصرًا لم يقصده أحد.
 */
window.geoTap = function (e, u) {
  if (e) {
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
  }
  geoOpen(u);
  return false;
};
/**
 * تمرير نصّ إلى سلسلةٍ مفردة داخل سمة HTML: `esc` وحدها لا تكفي هنا،
 * فهي تحوّل `'` إلى `&#39;` ويفكّها المتصفّح *قبل* أن يقرأ جافاسكربت
 * السلسلة — فتنكسر. نهرّب لجافاسكربت أولًا ثم لـHTML.
 */
function jsq(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    .replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
}
function geoField(id, label, val) {
  return '<div class="f"><label>' + esc(label) + '</label>'
    + '<div class="georow">'
    + '<input id="' + id + '" class="inp" dir="ltr" value="' + esc(val || '') + '"'
    + ' placeholder="24.7136, 46.6753" oninput="geoEcho(\'' + id + '\')">'
    + '<button type="button" class="btn geo-b" onclick="geoOpenFrom(\'' + id + '\')"'
    + ' title="افتح في الخرائط">📍</button></div>'
    + '<div class="es" id="' + id + '-e">' + esc(geoHint(val)) + '</div></div>';
}
function oneExtra(pfx, f, val) {
  var id = pfx + '-x-' + f.key;
  if (f.type === 'area') return taField(id, f.label, val || '');
  if (f.type === 'geo') return geoField(id, f.label, val || '');
  return '<div class="f"><label>' + esc(f.label) + '</label>'
    + '<input id="' + id + '" class="inp" value="' + esc(val || '') + '"></div>';
}
function extraFields(pfx, kind, o) {
  var x = (o && o.extra) || {};
  return '<div id="' + pfx + '-xf">'
    + fieldsOf(kind).map(function (f) { return oneExtra(pfx, f, x[f.key]); }).join('')
    + '</div>';
}

/**
 * إضافة حقل من داخل النموذج نفسه — وأنت تُدخل عنصرًا فتحتاج حقلًا ليس
 * موجودًا. اللوحة تُدرَج في الصفحة لا في مودال آخر، والحقل الجديد يُحقَن
 * في مكانه مباشرةً، فلا يضيع شيء ممّا كتبته حتى الآن.
 */
function addFieldPanel(pfx, kind) {
  return '<details class="more addf"><summary>➕ إضافة حقل لهذا القسم</summary>'
    + '<div class="more-b">'
    + '<div class="f"><label>اسم الحقل</label>'
    + '<input id="' + pfx + '-nf" class="inp" placeholder="مثال: الشركة المصنّعة"></div>'
    + fldTypeSegs('text', pfx + '-nt')
    + '<button type="button" class="btn primary full" onclick="fldInline(\'' + kind + '\',\'' + pfx + '\')">'
    + 'أضِف الحقل الآن</button>'
    + '<div class="es">يُضاف للقسم كله ويظهر في الإرسال، ويبقى ما كتبته هنا كما هو.</div>'
    + '</div></details>';
}
window.fldInline = function (kind, pfx) {
  var lbl = (($(pfx + '-nf') || {}).value || '').trim();
  if (!lbl) return toast('اسم الحقل مطلوب', 'er');
  var f = { id: uid(), kind: kind, key: fieldKey(), label: lbl,
            type: (($(pfx + '-nt') || {}).value) || 'text' };
  DB.fields.push(f); Store.saveField(f);
  DB.out[kind] = (DB.out[kind] || []).concat('x:' + f.key);
  Store.setOut(kind);
  var nf = $(pfx + '-nf'); if (nf) nf.value = '';   // جاهزة للتالي أيًّا كان ما يلي
  // نحقن الحقل بدل إعادة رسم النموذج، حفاظًا على ما أدخله المستخدم
  try {
    var box = $(pfx + '-xf');
    if (box) {
      box.insertAdjacentHTML('beforeend', oneExtra(pfx, f, ''));
      var el = $(pfx + '-x-' + f.key);
      if (el) { grow(el); el.focus(); }
    }
  } catch (e) { /* بيئة بلا DOM كامل */ }
  toast('✅ أُضيف «' + lbl + '»');
};
function readExtra(pfx, kind) {
  var out = {};
  fieldsOf(kind).forEach(function (f) {
    var el = $(pfx + '-x-' + f.key);
    var v = el ? String(el.value || '').trim() : '';
    if (v) out[f.key] = v;
  });
  return out;
}

/* ════════════════════════ 🖼️ مكتبة الصور ════════════════════════
   صورة واحدة تُغني عن فقرة: رسم موضع الحقن، أو شكل الحبّة، أو خطوات
   الضماد. لكل صورة رمز تكتبه داخل أي نصّ بين قوسين — {arf} — فتظهر
   الصورة مكانها في المعاينة والورقة والـPDF والطباعة والصورة المُرسَلة.

   تُحفَظ نصًّا (data URL) لا ملفًّا: عارض الطباعة WebView منفصل لا يرى
   ملفات التطبيق، ولوحة الصورة تحتاجها في نفس اللحظة، والنسخة الاحتياطية
   تحملها معها. والصورة تُصغَّر قبل الحفظ فلا تنتفخ القاعدة. */

var IMG_MAX = 900;        // أطول ضلع بعد التصغير
var IMG_Q = 0.72;         // جودة JPEG — كافية لصورة توضيحية

function imgByCode(code) {
  return DB.images.find(function (x) { return x.code === code; });
}
function imgData(code) {
  var im = imgByCode(code);
  return im ? im.data : '';
}
/** الرمز: حروف وأرقام وشرطة فقط، فلا يلتبس بنصّ عادي بين قوسين. */
function cleanCode(v) {
  return String(v || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

/** يصغّر الصورة المختارة ويعيدها data URL — بلا رفع ولا شبكة. */
function shrinkImage(file, cb) {
  var fr = new FileReader();
  fr.onload = function () {
    var im = new Image();
    im.onload = function () {
      var w = im.naturalWidth, h = im.naturalHeight;
      var k = Math.min(1, IMG_MAX / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * k));
      c.height = Math.max(1, Math.round(h * k));
      var x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);   // شفافية PNG تصير بيضاء لا سوداء
      x.drawImage(im, 0, 0, c.width, c.height);
      try { cb(c.toDataURL('image/jpeg', IMG_Q)); }
      catch (e) { cb(''); }
    };
    im.onerror = function () { cb(''); };
    im.src = fr.result;
  };
  fr.onerror = function () { cb(''); };
  fr.readAsDataURL(file);
}

window.imgPickFile = function (input) {
  var file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  toast('⏳ يجري تجهيز الصورة…');
  shrinkImage(file, function (data) {
    if (!data) return toast('تعذّرت قراءة الصورة', 'er');
    imgForm2('', data);
  });
};
/** نموذج الصورة — الرمز يُختار مرّة ولا يتغيّر حتى لا تنكسر {الرموز} في النصوص. */
function imgForm2(id, data) {
  var im = id ? DB.images.find(function (x) { return x.id === id; }) : null;
  var src = im ? im.data : data;
  openModal(im ? '✏️ تعديل الصورة' : '🖼️ صورة جديدة',
    '<div class="imgprev"><img src="' + src + '" alt=""></div>'
    + '<div class="f"><label>الرمز' + (im ? '' : ' *') + '</label>'
    + (im ? '<div class="code-fix">{' + esc(im.code) + '}</div>'
      : '<input id="im-code" class="inp" dir="ltr" placeholder="arf">')
    + '<div class="es" style="margin-top:5px">تكتبه داخل أي نصّ هكذا: '
    + '<b dir="ltr">{' + esc(im ? im.code : 'arf') + '}</b> فتظهر الصورة مكانه'
    + (im ? ' — الرمز لا يتغيّر حتى لا تنكسر النصوص التي تستعمله.' : '.') + '</div></div>'
    + '<div class="f"><label>الاسم</label>'
    + '<input id="im-name" class="inp" value="' + esc(im ? im.name : '') + '" placeholder="مثال: موضع الحقن"></div>'
    + '<input type="hidden" id="im-data" value="' + esc(src) + '">'
    + '<div class="mft"><button class="btn primary" onclick="imgSave2(\'' + (id || '') + '\')">حفظ</button>'
    + '<button class="btn" onclick="closeModal()">إلغاء</button></div>');
}
window.imgEdit = function (id) { imgForm2(id, ''); };
window.imgSave2 = function (id) {
  var name = (($('im-name') || {}).value || '').trim();
  if (id) {
    var im = DB.images.find(function (x) { return x.id === id; });
    if (!im) return;
    im.name = name; Store.saveImage(im);
    closeModal(); render(); toast('✅ حُفظت');
    return;
  }
  var code = cleanCode(($('im-code') || {}).value);
  if (!code) return toast('الرمز مطلوب — حروف إنجليزية وأرقام', 'er');
  if (imgByCode(code)) return toast('الرمز مستعمل', 'er');
  var rec = { id: uid(), code: code, name: name,
              data: (($('im-data') || {}).value || '') };
  if (!rec.data) return toast('لا توجد صورة', 'er');
  DB.images.push(rec); Store.saveImage(rec);
  closeModal(); render(); toast('✅ أُضيفت — استعملها بـ{' + code + '}');
};
window.imgDel2 = function (id) {
  var im = DB.images.find(function (x) { return x.id === id; });
  if (!im) return;
  confirmBox('حذف صورة «' + (im.name || im.code) + '»؟ ما يشير إليها بـ{'
    + im.code + '} سيظهر كما هو نصًّا.', function () {
    DB.images = DB.images.filter(function (x) { return x.id !== id; });
    Store.dropImage(id);
    closeModal(); render(); toast('🗑️ حُذفت');
  });
};

function renderImagesPage() {
  var html = '<label class="btn full primary" style="display:block;text-align:center;cursor:pointer">'
    + '🖼️ إضافة صورة من الجهاز'
    + '<input type="file" accept="image/*" onchange="imgPickFile(this)" style="display:none"></label>'
    + '<div class="hint">لكل صورة رمز تكتبه داخل أي نصّ — مثل <b dir="ltr">{arf}</b> —'
    + ' فتظهر الصورة مكانه في المعاينة والطباعة والـPDF والصورة المُرسَلة.</div>';

  if (!DB.images.length) {
    h('page', html + emptyBox('🖼️', 'المكتبة فارغة', 'أضِف صورة ثم استعمل رمزها في نصوصك'));
    return;
  }
  html += '<div class="imgrid">' + DB.images.map(function (im) {
    return '<div class="imgcard">'
      + '<img src="' + im.data + '" alt="" onclick="imgEdit(\'' + im.id + '\')">'
      + '<div class="imgcode" dir="ltr">{' + esc(im.code) + '}</div>'
      + (im.name ? '<div class="imgname">' + esc(im.name) + '</div>' : '')
      + '<div class="imgact">'
      + '<button class="ic" onclick="imgEdit(\'' + im.id + '\')">✏️</button>'
      + '<button class="ic" onclick="imgDel2(\'' + im.id + '\')">🗑️</button>'
      + '</div></div>';
  }).join('') + '</div>';
  h('page', html);
}

/* ── الرمز داخل النصّ ── */
var IMG_RE = /\{([a-z0-9_-]{1,32})\}/gi;

/** يقسّم النصّ إلى مقاطع: نصّ عادي، ورموز صور موجودة فعلًا في المكتبة. */
function segsOf(text) {
  var out = [], last = 0, m;
  IMG_RE.lastIndex = 0;
  while ((m = IMG_RE.exec(String(text))) !== null) {
    if (!imgByCode(m[1].toLowerCase())) continue;      // رمز غير معروف يبقى نصًّا
    if (m.index > last) out.push({ t: 'x', v: String(text).slice(last, m.index) });
    out.push({ t: 'img', code: m[1].toLowerCase() });
    last = m.index + m[0].length;
  }
  if (last < String(text).length) out.push({ t: 'x', v: String(text).slice(last) });
  return out.length ? out : [{ t: 'x', v: String(text) }];
}
/** هل في النصّ رمز صورة معروف؟ */
function hasImgRef(text) {
  return segsOf(text).some(function (g) { return g.t === 'img'; });
}
/** النصّ بعد استبدال الرموز بصورها — للمخارج التي تفهم HTML. */
function textHtml(v) {
  return segsOf(v).map(function (g) {
    return g.t === 'img'
      ? '<img class="rx-pic" src="' + imgData(g.code) + '" alt="">'
      : esc(g.v);
  }).join('');
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
/* ════════════════════════ 📇 دليل العناوين ════════════════════════
   قسمٌ جاهز يُزرَع مرّة واحدة، مبنيٌّ على آلية الأقسام المُنشأة نفسها —
   لا جدول له ولا كود خاص به: عناصره في `items`، وحقوله في `fields`،
   وتصنيفاته في `cats`. فيرث الترتيب والمجموعات والمعاينة والإرسال
   والنسخ الاحتياطي كلّها بلا سطرٍ واحد إضافي.

   ويُحذَف كأي قسمٍ آخر، ولا يعود: `dir_seeded` تحرس ذلك. */
var DIR_KIND = 'sec_dir';
var DIR_TITLE = 'دليل العناوين';
var DIR_CATS = [
  'المنشآت الصحية والعيادات',
  'الأفراد (الأطباء والمعالجون)',
  'الطب البديل',
  'الأجهزة والمنتجات الطبية'
];
/* الهاتف أولًا بعد الاسم: هو ما يُطلب من دليلٍ قبل كل شيء. */
var DIR_FIELDS = [
  ['الهاتف', 'text'],
  ['التخصص أو الخدمة', 'text'],
  ['العنوان', 'area'],
  ['الموقع على الخريطة', 'geo'],
  ['ساعات العمل', 'text'],
  ['ملاحظات', 'area']
];
function seedDirectory() {
  if (DB.dir_seeded) return;
  if (!secOf(DIR_KIND)) {
    var sec = { id: DIR_KIND, title: DIR_TITLE, icon: '📇', builtin: 0 };
    DB.sections.push(sec);
    DB[DIR_KIND] = []; DB.cart[DIR_KIND] = []; DB.out[DIR_KIND] = ['category'];
    KINDS = DB.sections.map(function (x) { return x.id; });
    Store.saveSection(sec);
    DIR_FIELDS.forEach(function (d) {
      var f = { id: uid(), kind: DIR_KIND, key: fieldKey(), label: d[0], type: d[1] };
      DB.fields.push(f); Store.saveField(f);
      DB.out[DIR_KIND].push('x:' + f.key);
    });
    Store.setOut(DIR_KIND);
    DIR_CATS.forEach(function (n) { catEnsure(DIR_KIND, n); });
  }
  DB.dir_seeded = 1;
  Store.setDirSeeded();
}
/**
 * من نال الدليل قبل أن يوجد حقل الموقع يناله الآن — مرّةً واحدة تحرسها
 * `dir_geo`، فلا تُعاد إضافته لمن حذفه. وما رتّبه أو أخفاه لا يُمَسّ:
 * الحقل يلحق بآخر القائمة لا يتصدّرها.
 */
function backfillDirGeo() {
  if (DB.dir_geo) return;
  if (secOf(DIR_KIND) && !fieldsOf(DIR_KIND).some(function (f) { return f.type === 'geo'; })) {
    var f = { id: uid(), kind: DIR_KIND, key: fieldKey(),
              label: 'الموقع على الخريطة', type: 'geo' };
    DB.fields.push(f); Store.saveField(f);
    DB.out[DIR_KIND] = (DB.out[DIR_KIND] || []).concat('x:' + f.key);
    Store.setOut(DIR_KIND);
  }
  DB.dir_geo = 1;
  Store.setDirGeo();
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
  var nf = fieldsOf(kind).length;
  var html = '<button class="btn full primary" onclick="catNew(\'' + kind + '\')">➕ تصنيف جديد</button>'
    + '<button class="btn full" onclick="goPage(\'fld:' + kind + '\')">🧩 حقول ' + esc(L.title)
    + (nf ? ' (' + nf + ')' : '') + ' — أضِف حقلًا لبياناتها</button>';

  if (!cats.length && !orphans.length) {
    h('page', html + emptyBox('🏷️', 'لا توجد تصنيفات', 'أنشئ تصنيفًا ثم أسنِد إليه عناصرك'));
    return;
  }
  // تصنيفاتٌ كلّها «فارغ» لأنّ عناصر القسم لم تُقرأ: قل ذلك هنا أيضًا
  if (kindFailed(kind)) {
    html += '<div class="rec-note"><b>⚠️ عناصر هذا القسم لم تُقرأ</b> — لذلك تبدو'
      + ' التصنيفات كلّها فارغة. بياناتك لم تُحذف. <b>لا تُعِد الإدخال.</b></div>'
      + '<button class="btn full primary" onclick="goPage(\'diag\')">🩺 افحص قاعدة البيانات</button>';
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
  dangerBox({
    title: 'حذف تصنيف «' + c.name + '»',
    action: '🗑️ احذف التصنيف',
    keep: n ? countWord(n, 'عنصره', 'عنصراه', 'عناصره', 'عنصرًا منه') + ' — تعود «غير مصنّف»'
            : 'كل عناصر القسم',
    lose: ['التصنيف نفسه وموضعه في الترتيب'],
    onYes: function () {
      DB.cats = DB.cats.filter(function (x) { return x.id !== id; });
      coll(kind).forEach(function (o) { if ((o.category || '').trim() === c.name) o.category = ''; });
      Store.moveCatItems(kind, c.name, '');
      Store.dropCat(id);
      closeModal(); render(); toast('🗑️ حُذف التصنيف');
    }
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
/* العمود الثالث: حقل نصّ طويل؟ — والرابع: يُطوى ضمن «المزيد»؟ */
var MED_FLD = [
  ['trade_name', 'الاسم التجاري', false],
  ['category', 'التصنيف', false],
  ['dosage', 'الجرعات', false],
  ['scientific_name', 'الاسم العلمي', false, 1],
  ['concentration', 'التركيز', false, 1],
  ['duration', 'مدة الاستخدام', false, 1],
  ['uses', 'الاستخدامات', true],
  ['cautions', 'المحاذير', true, 1],
  ['notes', 'ملاحظات', true, 1]
];

function medRow(m) {
  return itemCard('meds', m,
    '<div class="name">' + esc(m.trade_name) + (m.default_include ? ' <span class="star">★</span>' : '') + '</div>'
    + (m.scientific_name ? '<div class="sub">' + esc(m.scientific_name) + (m.concentration ? ' • ' + esc(m.concentration) : '') + '</div>' : '')
    + (m.dosage ? '<div class="req">💊 ' + esc(m.dosage) + '</div>' : '')
    + extraRow('meds', m),
    "medForm('" + m.id + "')", "medDel('" + m.id + "')");
}
function renderMeds() {
  var q = (($('srch') || {}).value || '').trim().toLowerCase();
  var list = DB.meds.filter(function (m) {
    return !q || (m.trade_name + ' ' + (m.scientific_name || '') + ' ' + (m.category || '')).toLowerCase().indexOf(q) >= 0;
  });
  var html = sectionBar('meds', q, '🔎 ابحث بالاسم أو التصنيف…', "medForm()");
  if (mode() === 'send' && DB.cart.meds.length) html += cartBar('meds', DB.cart.meds.length);
  h('page', html + listBox(medsList(q)));
}
SEC_LIST.meds = medsList;
function medsList(q) {
  var list = DB.meds.filter(function (m) {
    return !q || (m.trade_name + ' ' + (m.scientific_name || '') + ' ' + (m.category || '')).toLowerCase().indexOf(q) >= 0;
  });
  if (!list.length) {
    return q ? noHit('meds', q)
      : emptyOrFailed('meds', '💊', 'لا توجد علاجات محفوظة', 'أضِف واحدًا، أو استورد من المكتبة الجاهزة في ⚙️');
  }
  if (q) return list.map(medRow).join('');
  var out = '';
  var fav = list.filter(function (m) { return m.default_include; });
  if (fav.length) out += accBlock('⭐ افتراضية', fav.map(medRow).join(''), true, 'pickFlag(&#39;meds&#39;)');
  var gs = groupBy(list, 'meds'), op = openByDefault(list, gs);
  gs.forEach(function (g) {
    out += accBlock('💊 ' + g.cat + ' (' + g.items.length + ')',
      g.items.map(medRow).join(''), op, pickCall('meds', g.cat), 'meds', g.cat);
  });
  return out;
}
/**
 * قائمة القسم تُرسَم في وعاءٍ خاص — لا مع الصفحة كلّها.
 *
 * كان `oninput` يعيد رسم `#page` كاملةً، فيُهدَم حقل البحث نفسه مع كل
 * حرف ويضيع التركيز: لا يُكتب فيه إلا حرفٌ واحد. الآن الشريط يُرسَم مرّة
 * والقائمة وحدها تُحدَّث، فيبقى الحقل ومعه مؤشّر الكتابة ولوحة المفاتيح.
 */
window.secSearch = function (kind) {
  var q = (($('srch') || {}).value || '').trim().toLowerCase();
  h('sec-list', SEC_LIST[kind] ? SEC_LIST[kind](q) : secListHtml(kind, q));
};
/** وعاء القائمة — يُلحَق بالشريط فتُحدَّث وحدها بعدها. */
function listBox(inner) { return '<div id="sec-list">' + inner + '</div>'; }

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
/* ── ترتيبٌ واحد في كل مكان ─────────────────────────────────────────
   ما يراه المستخدم في القسم هو ما يجب أن يخرج في الورقة. وكانت السلة
   تحفظ ترتيب النقر: يؤشّر من أسفل القائمة ثم من أعلاها فتخرج الورقة
   معكوسة عمّا أمامه. الترتيب المعتمد الآن واحد: ترتيب العرض في القسم —
   التصنيفات كما رتّبها، وداخل كل تصنيف ترتيب العناصر كما هي. */

/** كل معرّفات القسم بترتيب عرضها على الشاشة: تصنيفًا بعد تصنيف. */
function displayOrder(kind) {
  var out = [];
  groupBy(coll(kind), kind).forEach(function (g) {
    g.items.forEach(function (o) { out.push(o.id); });
  });
  return out;
}
/** يرتّب مجموعة معرّفات بترتيب العرض. المجهول يبقى في ذيل القائمة. */
function orderOf(kind, ids) {
  var seq = displayOrder(kind);
  return ids.slice().sort(function (a, c) {
    var ia = seq.indexOf(a), ic = seq.indexOf(c);
    if (ia < 0) ia = seq.length;
    if (ic < 0) ic = seq.length;
    return ia - ic;
  });
}
/* ════════════════ صفحة الترتيب ════════════════
   زرٌّ واحد صريح في كل قسم يفتح شاشةً لا تفعل شيئًا إلا الترتيب: كل
   العناصر مفرودةً بتصنيفاتها، بأسهمٍ كبيرة، وكل حركة تُكتب في القاعدة
   **ويُتحقَّق من كتابتها بقراءتها** قبل أن يُقال «حُفظ». */
function renderSortPage(kind) {
  var L = kindLbl(kind), all = coll(kind);
  if (all.length < 2) {
    h('page', emptyBox('↕️', 'لا شيء يُرتَّب', 'أضِف عنصرين على الأقل'));
    return;
  }
  var html = '<div class="rec-note" style="margin-bottom:10px">'
    + '✅ <b>كل حركة تُحفَظ فورًا</b> — ويُتحقَّق من حفظها في قاعدة البيانات.'
    + ' وهذا الترتيب هو المعتمد في السلة والورقة وPDF والصورة والنصّ المنسوخ.</div>';

  var gs = groupBy(all, kind);
  gs.forEach(function (g, gi) {
    html += '<div class="sortcat"><div class="sortcat-h">'
      + '<span class="grow">' + esc(g.cat) + ' (' + g.items.length + ')</span>'
      + (g.cat === UNCAT ? '' :
          '<button class="ic"' + (gi === 0 ? ' disabled' : '')
          + ' onclick="catMoveNamed(\'' + kind + '\',\'' + esc(g.cat).replace(/'/g, '') + '\',-1)">▲</button>'
          + '<button class="ic"' + (gi === gs.length - 1 ? ' disabled' : '')
          + ' onclick="catMoveNamed(\'' + kind + '\',\'' + esc(g.cat).replace(/'/g, '') + '\',1)">▼</button>')
      + '</div>';
    html += g.items.map(function (o, i) {
      return '<div class="card"><div class="row">'
        + '<span class="idx">' + (i + 1) + '</span>'
        + '<div class="grow"><div class="name">' + esc(itemLabel(kind, o)) + '</div></div>'
        + '<button class="ic big"' + (i === 0 ? ' disabled' : '')
        + ' onclick="itemMove(\'' + kind + '\',\'' + o.id + '\',-1)">▲</button>'
        + '<button class="ic big"' + (i === g.items.length - 1 ? ' disabled' : '')
        + ' onclick="itemMove(\'' + kind + '\',\'' + o.id + '\',1)">▼</button>'
        + '</div></div>';
    }).join('') + '</div>';
  });
  html += '<button class="btn full primary" onclick="sortDone(\'' + kind + '\')">✅ تم</button>';
  h('page', html);
}
/** «تم»: يؤكّد الحفظ بقراءةٍ جديدة من القاعدة قبل أن يغادر الصفحة. */
window.sortDone = function (kind) {
  var want = coll(kind).map(function (x) { return x.id; });
  var ok = Store.setItemOrder(kind, want);
  if (ok === false) return toast('⚠️ لم يُحفَظ الترتيب — راجِع 🩺 الفحص', 'er');
  goBack();
  toast('✅ حُفظ الترتيب');
};

/* ════════════════ وضعان لا وضعٌ واحد مُشوَّش ════════════════
   التطبيق يخدم عملين مختلفين: **بناء الدليل** (إضافة وتعديل وتصنيف)،
   و**إرسال قائمة لمريض** (تأشير وعرض وإرسال). وكانا مختلطين في شاشة
   واحدة: مربع تأشير وقلم وسلة ونجمة في كل بطاقة، وشريطٌ فيه أربعة أزرار
   مختلفة الغرض — فلا يُعرف «وين الإدخال ووين العرض والإرسال».

   الآن وضعٌ واحد في كل مرّة، ظاهرٌ في أعلى كل قسم، ويُحفَظ فلا يُعاد
   اختياره في كل فتح. */
var MODES = {
  send: { icon: '📤', label: 'إرسال', hint: 'أشِّر ما تريد إرساله' },
  edit: { icon: '📝', label: 'إدخال وتعديل', hint: 'أضِف عناصرك وعدّلها ونظّمها' }
};
function mode() { return DB.mode === 'edit' ? 'edit' : 'send'; }
window.setMode = function (m) {
  if (mode() === m) return;
  DB.mode = m; Store.setMode();
  render();
  toast(MODES[m].icon + ' وضع ' + MODES[m].label);
};
/** شريط الوضعين — يتصدّر كل قسم فيُعرَف أين أنت قبل أن تضغط شيئًا. */
function modeBar() {
  var m = mode();
  return '<div class="modebar">'
    + Object.keys(MODES).map(function (k) {
        return '<button class="mb' + (k === m ? ' on' : '') + '" onclick="setMode(\'' + k + '\')">'
          + MODES[k].icon + ' ' + MODES[k].label + '</button>';
      }).join('')
    + '</div><div class="modehint">' + MODES[m].hint + '</div>';
}
/** أدوات البناء — تظهر في وضع الإدخال وحده، حيث مكانها. */
function editTools(kind) {
  var hasLib = ((window.LIBRARY || {})[kind] || []).length > 0;
  return '<div class="etools">'
    + '<button class="btn sm" onclick="goPage(\'cat:' + kind + '\')">🏷️ التصنيفات</button>'
    + '<button class="btn sm" onclick="goPage(\'fld:' + kind + '\')">🧩 الحقول</button>'
    + (hasLib ? '<button class="btn sm" onclick="openLibrary(\'' + kind + '\')">📚 المكتبة</button>' : '')
    + '</div>';
}
/**
 * شريط أدوات القسم — واحدٌ لكل الأقسام، يتبدّل بتبدّل الوضع.
 * `addCall` نداء فتح نموذج الإضافة في هذا القسم.
 */
function sectionBar(kind, q, placeholder, addCall) {
  var ng = groupsOf(kind).length;
  var html = modeBar()
    + '<div class="toolbar">'
    + '<input id="srch" class="srch-inp" placeholder="' + esc(placeholder) + '" value="' + esc(q)
    + '" oninput="secSearch(\'' + kind + '\')">';
  if (mode() === 'edit') {
    html += '<button class="btn primary" onclick="' + addCall + '">➕ إضافة عنصر</button></div>'
      + editTools(kind);
  } else {
    html += '<button class="btn" onclick="goPage(\'grp:' + kind + '\')">📁 المجموعات'
      + (ng ? ' ' + ng : '') + '</button></div>';
  }
  // الترتيب في الوضعين: هو حاجةٌ قائمة سواء كنت تُدخِل أو تُرسِل
  if (coll(kind).length > 1) {
    html += '<button class="btn full sort-entry" onclick="goPage(\'sort:' + kind + '\')">'
      + '↕️ ترتيب ' + esc(kindLbl(kind).title) + '</button>';
  }
  return html;
}
/**
 * بطاقة عنصر — واحدة لكل الأقسام.
 * في الإرسال: مربع تأشير واسمٌ وحسب، فالصفّ كلّه يؤشّر.
 * في الإدخال: تعديل وتكرار وحذف، بلا مربع تأشير يشوّش.
 */
function itemCard(kind, o, body, editCall, delCall) {
  var sending = mode() === 'send';
  var on = DB.cart[kind].indexOf(o.id) >= 0;
  return '<div class="card' + (on && sending ? ' sel' : '') + '"><div class="row">'
    + (sending
        ? '<label class="pvck"><input type="checkbox" ' + (on ? 'checked' : '')
          + ' onchange="toggleCart(\'' + kind + '\',\'' + o.id + '\')"></label>'
        : '')
    + '<div class="grow"' + (sending
        ? ' onclick="toggleCart(\'' + kind + '\',\'' + o.id + '\')"'
        : ' onclick="' + editCall + '"') + '>' + body + '</div>'
    + thumb(o)
    + (sending ? '' : orderBtns(kind, o)
        + '<button class="ic" onclick="' + editCall + '">✏️</button>'
        + '<button class="ic" onclick="dupItem(\'' + kind + '\',\'' + o.id + '\')" title="تكرار">⧉</button>'
        + '<button class="ic" onclick="' + delCall + '">🗑️</button>')
    + '</div></div>';
}
/**
 * أسهم الترتيب — على البطاقة نفسها، ظاهرةً أوّل ما تُفتح القائمة.
 *
 * كان ترتيب العناصر غير ممكن أصلًا، وترتيب التصنيفات مخفيًّا خلف صفحة
 * أخرى. والترتيب هنا هو مصدر الترتيب في كل مكان: السلة والورقة والصورة
 * والنصّ المنسوخ تقرأ كلّها من `displayOrder`.
 */
function orderBtns(kind, o) {
  var sibs = sibsOf(kind, o);
  var i = sibs.indexOf(o.id);
  return '<button class="ic"' + (i <= 0 ? ' disabled' : '')
    + ' onclick="itemMove(\'' + kind + '\',\'' + o.id + '\',-1)" title="أعلى">▲</button>'
    + '<button class="ic"' + (i < 0 || i === sibs.length - 1 ? ' disabled' : '')
    + ' onclick="itemMove(\'' + kind + '\',\'' + o.id + '\',1)" title="أسفل">▼</button>';
}
/** جيران العنصر داخل تصنيفه — وهم من يتبادل معهم الموضع. */
function sibsOf(kind, o) {
  var cat = (o.category || '').trim();
  return coll(kind).filter(function (x) {
    return ((x.category || '').trim()) === cat;
  }).map(function (x) { return x.id; });
}
/**
 * يحرّك العنصر بين جيرانه في تصنيفه، ويكتب ترتيب القسم **كاملًا**.
 * التبديل على القائمة الكاملة لا المعروضة، فيثبت الترتيب مهما كان
 * المعروض مرشَّحًا ببحثٍ أو مطويًّا في تصنيف.
 */
window.itemMove = function (kind, id, dir) {
  var all = coll(kind);
  var o = all.find(function (x) { return x.id === id; });
  if (!o) return;
  var sibs = sibsOf(kind, o);
  var i = sibs.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= sibs.length) return;
  var a = all.findIndex(function (x) { return x.id === id; });
  var b = all.findIndex(function (x) { return x.id === sibs[j]; });
  var t = all[a]; all[a] = all[b]; all[b] = t;
  setColl(kind, all);
  var ok = Store.setItemOrder(kind, all.map(function (x) { return x.id; }));
  DB.cart[kind] = orderOf(kind, DB.cart[kind]);   // السلة تتبع فورًا
  Store.setCart(kind);
  render();
  // الجسر يتحقّق من الكتابة بقراءتها، فـfalse هنا فشلٌ مؤكَّد لا ظنّ
  if (ok === false) toast('⚠️ لم يُحفَظ الترتيب — راجِع 🩺 الفحص', 'er');
};
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
  DB.cart[kind] = orderOf(kind, arr);      // لا ترتيب النقر
  Store.setCart(kind); render();
};
window.clearCart = function (kind) {
  var n = DB.cart[kind].length;
  if (!n) return;
  dangerBox({
    title: 'مسح التحديد',
    action: '🧹 امسح التحديد',
    keep: 'كل عناصرك — لا يُحذف منها شيء، إنّما يُلغى تأشيرها',
    lose: ['تأشير ' + countWord(n, 'عنصر واحد', 'عنصرين', 'عناصر', 'عنصرًا')
           + ' — تعيد اختيارها من جديد'],
    onYes: function () {
      DB.cart[kind] = []; Store.setCart(kind); closeModal(); render();
      toast('🧹 مُسح التحديد');
    }
  });
};

window.medForm = function (id) {
  var m = id ? (DB.meds.find(function (x) { return x.id === id; }) || {}) : newItem('meds');
  function fld(f) {
    var key = f[0], lbl = f[1], area = f[2];
    if (key === 'category') return catField('mf', 'meds', m.category);
    if (area) return taField('mf-' + key, lbl, m[key] || '');
    return '<div class="f"><label>' + lbl + (key === 'trade_name' ? ' *' : '') + '</label>'
      + '<input id="mf-' + key + '" class="inp" value="' + esc(m[key] || '') + '"></div>';
  }
  var body = MED_FLD.filter(function (f) { return !f[3]; }).map(fld).join('');
  body += imgField('mf', m.img) + extraFields('mf', 'meds', m);
  body += moreBlock(MED_FLD.filter(function (f) { return f[3]; }).map(fld).join(''));
  body += addFieldPanel('mf', 'meds');
  body += '<label class="chk-row"><input type="checkbox" id="mf-default" ' + (m.default_include ? 'checked' : '') + '> ⭐ محدَّد افتراضيًا</label>';
  body += mft('medSave', id);
  openModal(id ? '✏️ تعديل علاج' : '+ إضافة علاج', body);
};
window.medSave = function (id, again) {
  var body = {};
  MED_FLD.forEach(function (f) { var el = $('mf-' + f[0]); body[f[0]] = el ? el.value.trim() : ''; });
  body.default_include = ($('mf-default') || {}).checked ? 1 : 0;
  body.extra = readExtra('mf', 'meds');
  body.img = (($('mf-img') || {}).value || '').trim();
  if (!body.trade_name) return toast('الاسم التجاري مطلوب', 'er');
  catEnsure('meds', body.category);
  LAST_CAT.meds = body.category;
  var rec;
  if (id) { rec = DB.meds.find(function (x) { return x.id === id; }); Object.assign(rec, body); }
  else { body.id = uid(); DB.meds.push(body); rec = body; }
  var ok = Store.upsert('meds', rec);
  afterSave('meds', again, id, ok);
};
window.medDel = function (id) {
  itemDangerBox('meds', id, function () {
    DB.meds = DB.meds.filter(function (x) { return x.id !== id; });
    DB.cart.meds = DB.cart.meds.filter(function (x) { return x !== id; });
    Store.remove('meds', id); closeModal(); toast('🗑️ تم الحذف'); render();
  });
};

/* ════════════════════════ 🧪 التحاليل ════════════════════════ */
function labRow(t) {
  return itemCard('labs', t,
    '<div class="name">' + esc(t.code || t.name) + (t.is_common ? ' <span class="star">★</span>' : '') + '</div>'
    + (t.code ? '<div class="sub">' + esc(t.name) + '</div>' : '')
    + (t.requirements ? '<div class="req">📋 ' + esc(t.requirements) + '</div>' : '')
    + (t.prohibitions ? '<div class="ban">⛔ ' + esc(t.prohibitions) + '</div>' : '')
    + extraRow('labs', t),
    "labForm('" + t.id + "')", "labDel('" + t.id + "')");
}
function renderLabs() {
  var q = (($('srch') || {}).value || '').trim().toLowerCase();
  var html = sectionBar('labs', q, '🔎 ابحث بالرمز أو الاسم أو التخصص…', "labForm()");
  if (mode() === 'send' && DB.cart.labs.length) html += cartBar('labs', DB.cart.labs.length);
  h('page', html + listBox(labsList(q)));
}
SEC_LIST.labs = labsList;
function labsList(q) {
  var list = DB.labs.filter(function (t) {
    return !q || ((t.code || '') + ' ' + t.name + ' ' + (t.category || '') + ' ' + (t.purpose || '')).toLowerCase().indexOf(q) >= 0;
  });
  if (!list.length) {
    return q ? noHit('labs', q)
      : emptyOrFailed('labs', '🧪', 'لا توجد تحاليل محفوظة', 'أضِف واحدًا، أو استورد من المكتبة الجاهزة في ⚙️');
  }
  if (q) return list.map(labRow).join('');
  var out = '';
  var common = list.filter(function (t) { return t.is_common; });
  if (common.length) out += accBlock('⭐ شائعة', common.map(labRow).join(''), true, 'pickFlag(&#39;labs&#39;)');
  var gs = groupBy(list, 'labs'), op = openByDefault(list, gs);
  gs.forEach(function (g) {
    out += accBlock('🧪 ' + g.cat + ' (' + g.items.length + ')',
      g.items.map(labRow).join(''), op, pickCall('labs', g.cat), 'labs', g.cat);
  });
  return out;
}
var _accSeq = 0;
/** `pick` نداءُ «تحديد الكل» — يُوضع داخل الرأس ويمنع طيّ المجموعة عند نقره. */
/**
 * رأس التصنيف يحمل أدوات الوضع الحالي:
 * في الإرسال «☑️ تحديد الكل»، وفي الإدخال ▲▼ لتحريك التصنيف كلّه.
 * وكان تحريك التصنيف مخفيًّا في صفحةٍ أخرى لا يصلها إلا من يعرف مكانها.
 */
function accBlock(title, inner, open, pick, kind, cat) {
  var tools = '';
  if (mode() === 'send') {
    tools = pick ? '<button class="acc-pick" onclick="event.stopPropagation();event.preventDefault();'
      + pick + '" title="تحديد الكل">☑️</button>' : '';
  } else if (kind && cat) {
    tools = catMoveBtns(kind, cat);
  }
  return '<details class="acc"' + (open ? ' open' : '') + '><summary>' + esc(title)
    + tools + '<span class="arrow">▾</span></summary><div class="acc-b">' + inner + '</div></details>';
}
/** أسماء التصنيفات التي فيها عناصر — وهي وحدها ما يظهر في القسم. */
function catsShown(kind) {
  return groupBy(coll(kind), kind)
    .map(function (g) { return g.cat; })
    .filter(function (n) { return n !== UNCAT; });
}
/** سهما تحريك التصنيف في رأسه. «غير مصنّف» ليس تصنيفًا فلا يُحرَّك. */
function catMoveBtns(kind, cat) {
  if (cat === UNCAT) return '';
  var shown = catsShown(kind), i = shown.indexOf(cat);
  var stop = 'event.stopPropagation();event.preventDefault();';
  var call = function (d) {
    return stop + 'catMoveNamed(&#39;' + kind + '&#39;,&#39;'
      + esc(cat).replace(/&#39;/g, '\\&#39;') + '&#39;,' + d + ')';
  };
  return '<button class="acc-pick"' + (i <= 0 ? ' disabled' : '')
    + ' onclick="' + call(-1) + '" title="أعلى">▲</button>'
    + '<button class="acc-pick"' + (i < 0 || i === shown.length - 1 ? ' disabled' : '')
    + ' onclick="' + call(1) + '" title="أسفل">▼</button>';
}
/**
 * تحريك تصنيف من رأسه في القسم — بين التصنيفات **الظاهرة** وحدها.
 *
 * التبديل مع الجار الخام كان قد يقع مع تصنيفٍ فارغ لا يظهر في القسم، فلا
 * يتغيّر شيء أمام المستخدم ويظنّ أنّ الترتيب لم يُحفَظ. وهو محفوظ، لكنّه
 * غير مرئي. فنبدّل مع الجار الذي يراه، ونكتب الترتيب كاملًا.
 *
 * واسمٌ مكتوبٌ داخل العناصر وحدها (بلا صفّ في `cats`) يُسجَّل أولًا: ما
 * يراه المستخدم تصنيفًا يجب أن يتصرّف كتصنيف.
 */
window.catMoveNamed = function (kind, name, dir) {
  var shown = catsShown(kind);
  var i = shown.indexOf(name), j = i + dir;
  if (i < 0 || j < 0 || j >= shown.length) return;
  // نسجّل غير المسجَّل **بترتيب الظهور** لا بترتيب النداء، وإلا وُلِد
  // الصفّان مقلوبين فجاء التبديل معكوسًا
  shown.forEach(function (n) { catEnsure(kind, n); });
  var list = catsRaw(kind);
  var a = list.findIndex(function (x) { return x.name === name; });
  var b = list.findIndex(function (x) { return x.name === shown[j]; });
  if (a < 0 || b < 0) return;
  var t = list[a]; list[a] = list[b]; list[b] = t;
  DB.cats = DB.cats.filter(function (c) { return c.kind !== kind; }).concat(list);
  var ok = Store.setCatOrder(DB.cats.map(function (c) { return c.id; }));
  if (ok === false) return toast('⚠️ لم يُحفَظ الترتيب', 'er');
  DB.cart[kind] = orderOf(kind, DB.cart[kind]);
  Store.setCart(kind);
  render();
};
/** تحديد كل عناصر تصنيف — أو رفعُ التحديد عنها إن كانت كلها محدَّدة. */
function toggleIds(kind, ids) {
  if (!ids.length) return;
  var arr = DB.cart[kind];
  var allIn = ids.every(function (id) { return arr.indexOf(id) >= 0; });
  if (allIn) DB.cart[kind] = arr.filter(function (id) { return ids.indexOf(id) < 0; });
  else {
    ids.forEach(function (id) { if (arr.indexOf(id) < 0) arr.push(id); });
    DB.cart[kind] = orderOf(kind, arr);
  }
  Store.setCart(kind); render();
}
window.pickCat = function (kind, cat) {
  toggleIds(kind, coll(kind).filter(function (o) {
    return ((o.category || '').trim() || UNCAT) === cat;
  }).map(function (o) { return o.id; }));
};
window.pickFlag = function (kind) {
  var f = kind === 'meds' ? 'default_include'
    : (kind === 'labs' || kind === 'imaging') ? 'is_common'
    : (isBuiltin(kind) ? 'is_favorite' : 'flag');
  toggleIds(kind, coll(kind).filter(function (o) { return o[f]; }).map(function (o) { return o.id; }));
};
/** نداء «تحديد الكل» لتصنيف — الاسم يمرّ عبر esc فلا تكسره علامة اقتباس. */
function pickCall(kind, cat) {
  return 'pickCat(&#39;' + kind + '&#39;,&#39;' + esc(cat).replace(/&#39;/g, '\\&#39;') + '&#39;)';
}
window.labForm = function (id) {
  var t = id ? (DB.labs.find(function (x) { return x.id === id; }) || {}) : newItem('labs');
  var body = catField('lf', 'labs', t.category)
    + '<div class="f"><label>اسم التحليل *</label><input id="lf-name" class="inp" value="' + esc(t.name || '') + '" placeholder="مثال: صورة دم كاملة"></div>'
    + '<div class="f"><label>رمز التحليل (المصطلح)</label><input id="lf-code" class="inp" dir="ltr" value="' + esc(t.code || '') + '" placeholder="مثال: CBC"></div>'
    + taField('lf-requirements', 'متطلبات التحليل', t.requirements, 'مثال: صيام ٨–١٢ ساعة')
    + imgField('lf', t.img) + extraFields('lf', 'labs', t)
    + moreBlock(taField('lf-purpose', 'الهدف من التحليل', t.purpose, 'مثال: تقييم فقر الدم والالتهابات')
      + taField('lf-prohibitions', 'ممنوعات التحليل', t.prohibitions, 'مثال: لا يُجرى بعد بدء المضاد الحيوي'))
    + addFieldPanel('lf', 'labs')
    + '<label class="chk-row"><input type="checkbox" id="lf-common" ' + (t.is_common ? 'checked' : '') + '> ⭐ تحليل شائع</label>'
    + mft('labSave', id);
  openModal(id ? '✏️ تعديل تحليل' : '+ إضافة تحليل', body);
};
window.labSave = function (id, again) {
  var body = {
    category: ($('lf-category') || {}).value.trim(),
    code: ($('lf-code') || {}).value.trim(),
    name: ($('lf-name') || {}).value.trim(),
    purpose: ($('lf-purpose') || {}).value.trim(),
    requirements: ($('lf-requirements') || {}).value.trim(),
    prohibitions: ($('lf-prohibitions') || {}).value.trim(),
    is_common: ($('lf-common') || {}).checked ? 1 : 0,
    img: (($('lf-img') || {}).value || '').trim(),
    extra: readExtra('lf', 'labs')
  };
  if (!body.name) return toast('اسم التحليل مطلوب', 'er');
  catEnsure('labs', body.category);
  LAST_CAT.labs = body.category;
  var rec;
  if (id) { rec = DB.labs.find(function (x) { return x.id === id; }); Object.assign(rec, body); }
  else { body.id = uid(); DB.labs.push(body); rec = body; }
  var ok = Store.upsert('labs', rec);
  afterSave('labs', again, id, ok);
};
window.labDel = function (id) {
  itemDangerBox('labs', id, function () {
    DB.labs = DB.labs.filter(function (x) { return x.id !== id; });
    DB.cart.labs = DB.cart.labs.filter(function (x) { return x !== id; });
    Store.remove('labs', id); closeModal(); toast('🗑️ تم الحذف'); render();
  });
};

/* ════════════════════════ 📷 الأشعة والفحوصات ════════════════════════
   تصوير ومناظير وتخطيط — بنيتها كالتحاليل مع «المنطقة أو العضو» بدل الرمز. */
function imgRow(t) {
  return itemCard('imaging', t,
    '<div class="name">' + esc(t.name) + (t.is_common ? ' <span class="star">★</span>' : '')
    + (t.region ? ' <span class="chip">' + esc(t.region) + '</span>' : '') + '</div>'
    + (t.purpose ? '<div class="sub">' + esc(t.purpose) + '</div>' : '')
    + (t.requirements ? '<div class="req">📋 ' + esc(t.requirements) + '</div>' : '')
    + (t.prohibitions ? '<div class="ban">⛔ ' + esc(t.prohibitions) + '</div>' : '')
    + extraRow('imaging', t),
    "imgForm('" + t.id + "')", "imgDel('" + t.id + "')");
}
function renderImaging() {
  var q = (($('srch') || {}).value || '').trim().toLowerCase();
  var html = sectionBar('imaging', q, '🔎 ابحث بالاسم أو النوع أو المنطقة…', "imgForm()");
  if (mode() === 'send' && DB.cart.imaging.length) html += cartBar('imaging', DB.cart.imaging.length);
  h('page', html + listBox(imagingList(q)));
}
SEC_LIST.imaging = imagingList;
function imagingList(q) {
  var list = DB.imaging.filter(function (t) {
    return !q || [t.name, t.category, t.region, t.purpose, t.requirements].join(' ').toLowerCase().indexOf(q) >= 0;
  });
  if (!list.length) {
    return q ? noHit('imaging', q)
      : emptyOrFailed('imaging', '📷', 'لا توجد فحوصات محفوظة', 'أضِف واحدًا، أو استورد من المكتبة الجاهزة في ⚙️');
  }
  if (q) return list.map(imgRow).join('');
  var out = '';
  var common = list.filter(function (t) { return t.is_common; });
  if (common.length) out += accBlock('⭐ شائعة', common.map(imgRow).join(''), true, 'pickFlag(&#39;imaging&#39;)');
  var gs = groupBy(list, 'imaging'), op = openByDefault(list, gs);
  gs.forEach(function (g) {
    out += accBlock('📷 ' + g.cat + ' (' + g.items.length + ')',
      g.items.map(imgRow).join(''), op, pickCall('imaging', g.cat), 'imaging', g.cat);
  });
  return out;
}
window.imgForm = function (id) {
  var t = id ? (DB.imaging.find(function (x) { return x.id === id; }) || {}) : newItem('imaging');
  var body = catField('if', 'imaging', t.category)
    + '<div class="f"><label>اسم الفحص *</label><input id="if-name" class="inp" value="' + esc(t.name || '') + '" placeholder="مثال: رنين مغناطيسي للعمود القطني"></div>'
    + '<div class="f"><label>المنطقة أو العضو</label><input id="if-region" class="inp" value="' + esc(t.region || '') + '" placeholder="مثال: العمود القطني"></div>'
    + taField('if-requirements', 'التحضير المطلوب', t.requirements, 'مثال: صيام ٦ ساعات، إحضار فحوصات الكلى')
    + imgField('if', t.img) + extraFields('if', 'imaging', t)
    + moreBlock(taField('if-purpose', 'الهدف من الفحص', t.purpose, 'مثال: تقييم الانزلاق الغضروفي')
      + taField('if-prohibitions', 'موانع الإجراء', t.prohibitions, 'مثال: الحمل، منظّم ضربات القلب'))
    + addFieldPanel('if', 'imaging')
    + '<label class="chk-row"><input type="checkbox" id="if-common" ' + (t.is_common ? 'checked' : '') + '> ⭐ فحص شائع</label>'
    + mft('imgSave', id);
  openModal(id ? '✏️ تعديل فحص' : '+ إضافة فحص/أشعة', body);
};
window.imgSave = function (id, again) {
  var body = {
    category: ($('if-category') || {}).value.trim(),
    name: ($('if-name') || {}).value.trim(),
    region: ($('if-region') || {}).value.trim(),
    purpose: ($('if-purpose') || {}).value.trim(),
    requirements: ($('if-requirements') || {}).value.trim(),
    prohibitions: ($('if-prohibitions') || {}).value.trim(),
    is_common: ($('if-common') || {}).checked ? 1 : 0,
    img: (($('if-img') || {}).value || '').trim(),
    extra: readExtra('if', 'imaging')
  };
  if (!body.name) return toast('اسم الفحص مطلوب', 'er');
  catEnsure('imaging', body.category);
  LAST_CAT.imaging = body.category;
  var rec;
  if (id) { rec = DB.imaging.find(function (x) { return x.id === id; }); Object.assign(rec, body); }
  else { body.id = uid(); DB.imaging.push(body); rec = body; }
  var ok = Store.upsert('imaging', rec);
  afterSave('imaging', again, id, ok);
};
window.imgDel = function (id) {
  itemDangerBox('imaging', id, function () {
    DB.imaging = DB.imaging.filter(function (x) { return x.id !== id; });
    DB.cart.imaging = DB.cart.imaging.filter(function (x) { return x !== id; });
    Store.remove('imaging', id); closeModal(); toast('🗑️ تم الحذف'); render();
  });
};

/* ════════════════════════ 🌿 الوصفات العلاجية ════════════════════════ */
var RX_TYPES = ['علاجية', 'وقائية', 'غذائية'];
/* العمود الرابع: يُطوى ضمن «المزيد»؟ — الوصفة أطول نموذج في التطبيق. */
var RX_FLD = [
  ['category', 'التصنيف', 'cat'],
  ['name', 'اسم الوصفة', 'text'],
  ['type', 'نوع الوصفة', 'type'],
  ['ingredients', 'المواد المستخدمة', 'area'],
  ['preparation', 'طريقة الإعداد', 'area'],
  ['dose', 'الجرعة', 'text'],
  ['purpose', 'الهدف', 'area', 1],
  ['usage', 'الاستخدام', 'area', 1],
  ['duration', 'مدة الاستخدام', 'text', 1],
  ['effects', 'الأعراض المتوقعة', 'area', 1],
  ['precautions', 'الاحتياطات', 'area', 1]
];

function recipeRow(r) {
  return itemCard('recipes', r,
    '<div class="name">' + esc(r.name) + (r.is_favorite ? ' <span class="star">★</span>' : '')
    + (r.type ? ' <span class="chip">' + esc(r.type) + '</span>' : '') + '</div>'
    + (r.purpose ? '<div class="sub">' + esc(r.purpose) + '</div>' : '')
    + (r.dose ? '<div class="req">⚖️ ' + esc(r.dose) + '</div>' : '')
    + (r.precautions ? '<div class="ban">⛔ ' + esc(r.precautions) + '</div>' : '')
    + extraRow('recipes', r),
    "recipeForm('" + r.id + "')", "recipeDel('" + r.id + "')");
}
function renderRecipes() {
  var q = (($('srch') || {}).value || '').trim().toLowerCase();
  var html = sectionBar('recipes', q, '🔎 ابحث بالاسم أو النوع أو المواد…', "recipeForm()");
  if (mode() === 'send' && DB.cart.recipes.length) html += cartBar('recipes', DB.cart.recipes.length);
  h('page', html + listBox(recipesList(q)));
}
SEC_LIST.recipes = recipesList;
function recipesList(q) {
  var list = DB.recipes.filter(function (r) {
    return !q || [r.name, r.category, r.type, r.purpose, r.ingredients].join(' ').toLowerCase().indexOf(q) >= 0;
  });
  if (!list.length) {
    return q ? noHit('recipes', q)
      : emptyOrFailed('recipes', '🌿', 'لا توجد وصفات محفوظة', 'اضغط «+ إضافة» لتبدأ');
  }
  if (q) return list.map(recipeRow).join('');
  var out = '';
  var fav = list.filter(function (r) { return r.is_favorite; });
  if (fav.length) out += accBlock('⭐ مفضّلة', fav.map(recipeRow).join(''), true, 'pickFlag(&#39;recipes&#39;)');
  var gs = groupBy(list, 'recipes'), op = openByDefault(list, gs);
  gs.forEach(function (g) {
    out += accBlock('🌿 ' + g.cat + ' (' + g.items.length + ')',
      g.items.map(recipeRow).join(''), op, pickCall('recipes', g.cat), 'recipes', g.cat);
  });
  return out;
}
window.recipeForm = function (id) {
  var r = id ? (DB.recipes.find(function (x) { return x.id === id; }) || {}) : newItem('recipes');
  function fld(f) {
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
  }
  var body = RX_FLD.filter(function (f) { return !f[3]; }).map(fld).join('');
  body += imgField('rf', r.img) + extraFields('rf', 'recipes', r);
  body += moreBlock(RX_FLD.filter(function (f) { return f[3]; }).map(fld).join(''));
  body += addFieldPanel('rf', 'recipes');
  body += '<label class="chk-row"><input type="checkbox" id="rf-fav" ' + (r.is_favorite ? 'checked' : '') + '> ⭐ وصفة مفضّلة</label>';
  body += mft('recipeSave', id);
  openModal(id ? '✏️ تعديل وصفة' : '+ إضافة وصفة', body);
};
/** اختيار النوع بأزرار بدل قائمة منسدلة — أوضح على الجوال. */
window.rxPickType = function (btn) {
  var wrap = btn.parentNode, kids = wrap.children;
  for (var i = 0; i < kids.length; i++) kids[i].className = 'seg';
  btn.className = 'seg on';
  var hidden = $('rf-type'); if (hidden) hidden.value = btn.getAttribute('data-t');
};
window.recipeSave = function (id, again) {
  var body = {};
  RX_FLD.forEach(function (f) { var el = $('rf-' + f[0]); body[f[0]] = el ? el.value.trim() : ''; });
  body.is_favorite = ($('rf-fav') || {}).checked ? 1 : 0;
  body.extra = readExtra('rf', 'recipes');
  body.img = (($('rf-img') || {}).value || '').trim();
  if (!body.name) return toast('اسم الوصفة مطلوب', 'er');
  catEnsure('recipes', body.category);
  LAST_CAT.recipes = body.category;
  var rec;
  if (id) { rec = DB.recipes.find(function (x) { return x.id === id; }); Object.assign(rec, body); }
  else { body.id = uid(); DB.recipes.push(body); rec = body; }
  var ok = Store.upsert('recipes', rec);
  afterSave('recipes', again, id, ok);
};
window.recipeDel = function (id) {
  itemDangerBox('recipes', id, function () {
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
  var c = coll(kind);
  return c && c.find(function (x) { return x.id === id; });
}
/**
 * هل تعذّرت قراءة جدول هذا القسم في آخر فتح؟
 *
 * «القسم فارغ» و«تعذّرت قراءة القسم» يبدوان واحدًا على الشاشة وهما نقيضان:
 * الأول لا شيء فيه، والثاني فيه كل شيء ولا نراه. وصندوق «لا توجد تحاليل
 * محفوظة» فوق جدولٍ عامر كذبةٌ تدفع المستخدم لإعادة الإدخال فوق بياناته.
 */
function kindFailed(kind) {
  return Store.errors.some(function (e) { return String(e).indexOf(kind + ':') === 0; });
}
/** صندوق الفراغ الصادق: يفرّق بين لا شيء وبين ما لم نستطع قراءته. */
function emptyOrFailed(kind, icon, title, hint) {
  if (!kindFailed(kind)) {
    if (mode() === 'edit') return emptyBox(icon, title, hint);
    return emptyBox(icon, title, hint)
      + '<button class="btn full primary" onclick="setMode(\'edit\')">📝 انتقل لوضع الإدخال وابدأ</button>';
  }
  return '<div class="rec-note" style="margin:12px 0">'
    + '<b>⚠️ هذا القسم ليس فارغًا — تعذّرت قراءته.</b><br>'
    + 'بياناتك ما زالت في قاعدة البيانات، والتطبيق لم يستطع قراءتها هذه المرة'
    + ' ولن يكتب فوقها شيئًا. <b>لا تُعِد إدخالها.</b></div>'
    + '<button class="btn full primary" onclick="goPage(\'diag\')">🩺 افحص قاعدة البيانات</button>'
    + '<button class="btn full" onclick="goPage(\'settings\')">↩️ استعادة نسخة احتياطية</button>'
    + '<div class="rec-e">' + esc(Store.errors.join('\n')) + '</div>';
}
/** من قائمة معرّفات: ما له عنصرٌ قائم فعلًا، بترتيبه كما هو. */
function liveIds(kind, ids) {
  return (ids || []).filter(function (id) { return !!itemById(kind, id); });
}

/**
 * تنظيف الإشارات اليتيمة: معرّفٌ في السلة أو في مجموعة بلا عنصرٍ يقابله.
 *
 * يعمل **فقط** بعد قراءةٍ نظيفة تمامًا. لو فشلت قراءة جدول العناصر وحده
 * لبدت كل إشاراته يتيمة، فيحذف هذا التنظيف تحديدَ المستخدم ومجموعاته
 * بناءً على قراءةٍ خاطئة — وهو الخطأ نفسه الذي كلّفنا قسمًا ووصفات.
 */
function pruneOrphans() {
  if (!Store.ok || Store.errors.length) return;
  KINDS.forEach(function (k) {
    // تنظيفٌ وترتيبٌ معًا: سلالٌ حُفظت بترتيب النقر تعود لترتيب العرض
    var live = orderOf(k, liveIds(k, DB.cart[k]));
    if (live.join() === DB.cart[k].join()) return;
    DB.cart[k] = live;
    Store.setCart(k);
  });
  DB.groups.forEach(function (g) {
    var live = liveIds(g.kind, g.items);
    if (live.length === g.items.length) return;
    g.items = live;
    Store.saveGroup(g);
  });
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
  html += gs.map(function (g, i) { return groupCard(g, i, gs.length); }).join('');
  h('page', html);
}

/**
 * بطاقة المجموعة بإجراءاتها الثلاثة مكتوبةً لا مرموزة.
 *
 * كانت الإجراءات مخبّأة: الضغط على الاسم يرسل، وقلمٌ صغير يحرّر، ولا سبيل
 * لإضافة عنصر إلا بالدخول ثم البحث عن زر. والثلاثة التي يحتاجها المستخدم
 * فعلًا — أضِف، اعرض، أرسِل — تستحق أن تُقرأ لا أن تُخمَّن.
 */
function groupCard(g, i, n) {
  var L = kindLbl(g.kind);
  var live = liveIds(g.kind, g.items).length;
  return '<div class="card gcard">'
    + '<div class="row">'
    + '<div class="grow"><div class="name">📁 ' + esc(g.name) + '</div>'
    + '<div class="sub">' + L.icon + ' ' + countWord(live, L.one, L.two, L.few, L.many) + '</div></div>'
    + '<button class="ic" onclick="groupMove(\'' + g.id + '\',-1)"' + (i ? '' : ' disabled') + '>▲</button>'
    + '<button class="ic" onclick="groupMove(\'' + g.id + '\',1)"'
    + (i === n - 1 ? ' disabled' : '') + '>▼</button>'
    + '</div>'
    + '<div class="gacts">'
    + '<button class="btn sm" onclick="groupAddTo(\'' + g.id + '\')">➕ إضافة عنصر</button>'
    + '<button class="btn sm" onclick="groupOpen(\'' + g.id + '\')">👁️ عرض</button>'
    + '<button class="btn wa sm" onclick="groupPreview(\'' + g.id + '\')"'
    + (live ? '' : ' disabled') + '>📤 إرسال</button>'
    + '</div></div>';
}
/** «عرض»: يفتح المجموعة لترى ما فيها وترتّبه وتحذف منه. */
window.groupOpen = function (id) {
  var g = findGroup(id); if (!g) return;
  closeDrawer();
  goPage('grp:' + g.kind + ':' + g.id);
};
/** «إضافة عنصر»: يفتح المجموعة ثم منتقيها مباشرةً — من أي قائمة كنت. */
window.groupAddTo = function (id) {
  var g = findGroup(id); if (!g) return;
  closeDrawer();
  goPage('grp:' + g.kind + ':' + g.id);
  groupPick();
};
/** ترتيب المجموعات: التبديل يقع في DB.groups كاملةً فيثبت عبر الأقسام. */
window.groupMove = function (id, dir) {
  var i = DB.groups.findIndex(function (g) { return g.id === id; });
  var gs = groupsOf(groupsPageKind()), j = gs.findIndex(function (g) { return g.id === id; }) + dir;
  if (i < 0 || j < 0 || j >= gs.length) return;
  var k = DB.groups.indexOf(gs[j]);
  var t = DB.groups[i]; DB.groups[i] = DB.groups[k]; DB.groups[k] = t;
  Store.setGroupOrder(DB.groups.map(function (g) { return g.id; }));
  if (drawerOpen()) renderDrawer(); else render();
};
/** القسم الذي تعرضه صفحة المجموعات الحالية، أو الدرج ('all'). */
function groupsPageKind() {
  var p = curPage();
  return p.indexOf('grp:') === 0 ? p.split(':')[1] : 'all';
}

/* ── الدرج الجانبي ─────────────────────────────────────────────────
   المجموعة تُحفَظ لتُرسَل مرارًا، وكان الوصول إليها ثلاث ضغطات: رجوع
   للرئيسية ← «مجموعاتي» ← المجموعة. الدرج يجعلها ضغطتين من أي صفحة،
   والثانية هي الإرسال نفسه. */
window.openDrawer = function () {
  renderDrawer();
  var bg = $('dw-bg'), dw = $('dw');
  if (bg) bg.className = 'dw-bg on';
  if (dw) dw.className = 'dw on';
};
window.closeDrawer = function () {
  var bg = $('dw-bg'), dw = $('dw');
  if (bg) bg.className = 'dw-bg';
  if (dw) dw.className = 'dw';
};
function drawerOpen() {
  var dw = $('dw');
  return !!dw && dw.className.indexOf('on') >= 0;
}
/**
 * يُعاد رسمه عند كل فتح — ترتيبه ومحتواه يتغيّران من داخله.
 *
 * قائمة واحدة واضحة لكل شيء: الأقسام أولًا (العلاجات، التحاليل، … وما
 * أنشأه المستخدم) بعدد عناصر كل قسم، ثم المجموعات المحفوظة. هكذا لا يحتاج
 * الرجوع إلى الرئيسية ليتنقّل، ولا يحفظ أين يسكن كل شيء.
 */
function renderDrawer() {
  // كل قسمٍ يفتح على أعماله الأربعة: إدخال، إرسال، ترتيب، وحقول الإرسال.
  // قبلها كان الضغط يذهب للقسم وحسب، وبقيّة الأعمال موزّعةً على صفحاته.
  var html = '<div class="dw-g">الأقسام</div>'
    + KINDS.map(function (k) { return drawerSection(k); }).join('')
    + '<div class="dw-g">أدوات</div>'
    + '<button class="dwi" onclick="drawerGo(\'sent\')"><span class="dwi-i">🕘</span>'
    + '<span class="dwi-t">آخر ما أرسلت</span>'
    + '<span class="dwi-n">' + (DB.sent.length || '—') + '</span></button>'
    + '<button class="dwi" onclick="drawerGo(\'imgs\')"><span class="dwi-i">🖼️</span>'
    + '<span class="dwi-t">مكتبة الصور</span>'
    + '<span class="dwi-n">' + (DB.images.length || '—') + '</span></button>'
    + '<button class="dwi" onclick="drawerGo(\'settings\')"><span class="dwi-i">⚙️</span>'
    + '<span class="dwi-t">الإعدادات</span></button>'
    + '<div class="dw-g">المجموعات المحفوظة</div>';

  var gs = DB.groups;
  if (!gs.length) {
    h('dw-body', html + '<div class="es">لا مجموعات بعد — احفظ ما تطلبه عادةً'
      + ' مجموعةً باسم تختاره، فترسلها من هنا بضغطة.</div>');
    return;
  }
  h('dw-body', html + gs.map(function (g, i) { return groupCard(g, i, gs.length); }).join('')
    + '<button class="btn full" onclick="closeDrawer();goPage(\'grp:all\')">🗂️ إدارة المجموعات</button>');
}
/** قسمٌ في القائمة: رأسٌ يطوي ويفتح، وتحته أعماله الأربعة مسمّاة. */
function drawerSection(k) {
  var L = kindLbl(k), n = coll(k).length;
  var hasLib = ((window.LIBRARY || {})[k] || []).length > 0;
  return '<details class="dws"><summary class="dwi">'
    + '<span class="dwi-i">' + L.icon + '</span>'
    + '<span class="dwi-t">' + esc(L.title) + '</span>'
    + '<span class="dwi-n">' + (n || '—') + '</span>'
    + '<span class="dws-a">▾</span></summary><div class="dws-b">'
    + '<button class="dwa" onclick="dwGo(\'' + k + '\',\'edit\')">📝 إضافة وتعديل العناصر</button>'
    + (hasLib
        ? '<button class="dwa sub" onclick="dwLib(\'' + k + '\')">📚 إضافة من المكتبة الجاهزة</button>'
        : '')
    + '<button class="dwa" onclick="dwGo(\'' + k + '\',\'send\')">📤 عرض وإرسال</button>'
    + '<button class="dwa" onclick="drawerGo(\'sort:' + k + '\')">↕️ ترتيب العناصر</button>'
    + '<button class="dwa" onclick="drawerGo(\'fld:' + k + '\')">🖨️ الحقول المرسلة وترتيبها</button>'
    + '</div></details>';
}
/** يدخل القسم في الوضع المطلوب — فيرى شكل الإرسال وحده أو أدوات الإدخال. */
window.dwGo = function (kind, m) { setMode(m); closeDrawer(); goPage(kind); };
window.dwLib = function (kind) { setMode('edit'); closeDrawer(); openLibrary(kind); };
window.drawerSend = function (id) { closeDrawer(); groupPreview(id); };
window.drawerGo = function (p) { closeDrawer(); goPage(p); };

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

/**
 * المحرّر يكتب فور كل تعديل.
 *
 * كان يعمل على مسوّدة في `GRP` تحتاج ضغط «حفظ»، والنتيجة أنّ من يضيف
 * عناصر ثم يخرج يجدها ضاعت — وهو بلاغٌ وصل فعلًا: «ما يحفظ العناصر».
 * المسوّدة كانت لخدمة «عدّل ثم أرسل بلا حفظ»، وهذا صار داخل المعاينة
 * نفسها (تعديل القائمة هناك لا يمسّ المجموعة)، فلم يبقَ لها مبرّر.
 */
function renderGroupPage(kind, id) {
  var g = findGroup(id);
  if (!g) { h('page', emptyBox('📁', 'المجموعة غير موجودة', '')); return; }
  GRP = { id: id, kind: kind, name: g.name };     // للمنتقي والمعاينة فقط

  var html = '<div class="gbar">'
    + '<button class="btn wa sm grow" onclick="groupEditPreview()">👁️ عرض وإرسال</button>'
    + '<button class="btn sm" onclick="groupRename()">✏️</button>'
    + '<button class="btn danger sm" onclick="groupDelete()">🗑️</button>'
    + '</div>'
    + '<button class="btn full" onclick="groupPick()">➕ إضافة عناصر</button>';

  // لا تُعرض إلا العناصر القائمة؛ إشارةٌ بلا عنصر ليست صفًّا ناقصًا بل لا شيء
  var live = liveIds(kind, g.items);
  if (!live.length) {
    h('page', html + emptyBox('📁', 'المجموعة فارغة', 'اضغط «إضافة عناصر»'));
    return;
  }
  // الترتيب هنا هو ترتيب الورقة والرسالة، فأسهم الرفع والخفض تُغيّره
  html += live.map(function (iid, i) {
    var o = itemById(kind, iid);
    return '<div class="card"><div class="row">'
      + '<span class="idx">' + (i + 1) + '</span>'
      + '<div class="grow"><div class="name">' + esc(itemLabel(kind, o)) + '</div></div>'
      + '<button class="ic" onclick="groupItemMove(\'' + iid + '\',-1)"' + (i ? '' : ' disabled') + '>▲</button>'
      + '<button class="ic" onclick="groupItemMove(\'' + iid + '\',1)"'
      + (i === live.length - 1 ? ' disabled' : '') + '>▼</button>'
      + '<button class="ic" onclick="groupRemove(\'' + iid + '\')">✖️</button>'
      + '</div></div>';
  }).join('');
  h('page', html + '<div class="muted" style="text-align:center">يُحفظ كل تعديل فور حدوثه.</div>');
}
/** كل تعديل على المجموعة: عدّل الكائن الحيّ، اكتبه، ثم أعِد الرسم. */
function grpEdit(fn) {
  var g = findGroup(GRP ? GRP.id : ''); if (!g) return;
  fn(g);
  GRP.name = g.name;
  Store.saveGroup(g);
  render();
}
window.groupRemove = function (iid) {
  grpEdit(function (g) { g.items = g.items.filter(function (x) { return x !== iid; }); });
};
window.groupItemMove = function (iid, dir) {
  grpEdit(function (g) {
    var i = g.items.indexOf(iid), j = i + dir;
    if (i < 0 || j < 0 || j >= g.items.length) return;
    var t = g.items[i]; g.items[i] = g.items[j]; g.items[j] = t;
  });
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
  closeModal();
  grpEdit(function (g) { g.name = name; });
  toast('✅ حُفظ الاسم');
};
window.groupDelete = function () {
  dangerBox({
    title: 'حذف مجموعة «' + (GRP ? GRP.name : '') + '»',
    action: '🗑️ احذف المجموعة',
    keep: 'كل العناصر التي فيها — لا يُحذف منها شيء',
    lose: ['المجموعة وترتيب ما فيها'],
    onYes: function () {
      var id = GRP.id, kind = GRP.kind;
      DB.groups = DB.groups.filter(function (g) { return g.id !== id; });
      Store.dropGroup(id);
      GRP = null; closeModal(); toast('🗑️ حُذفت المجموعة');
      NAV.pop(); render();
    }
  });
};

/* منتقي العناصر: نفس فكرة المكتبة — بحث وقائمة تأشير، والموجود مقفل */
var GPICK = {};
/** تبويب المنتقي: عناصري، أم المكتبة الجاهزة المدمجة في التطبيق. */
var GP_TAB = 'mine';
window.groupPick = function () {
  if (!GRP) return;
  GPICK = {}; LIB_SEL = {}; GP_TAB = 'mine';
  LIB_KIND = GRP.kind; libSyncMine();
  var hasLib = ((window.LIBRARY || {})[GRP.kind] || []).length > 0;
  openModal('➕ إضافة إلى ' + GRP.name,
    (hasLib ? '<div class="pvtabs">'
      + '<button class="pvt on" id="gp-t-mine" onclick="gpTab(\'mine\')">📋 عندي</button>'
      + '<button class="pvt" id="gp-t-lib" onclick="gpTab(\'lib\')">📚 المكتبة الجاهزة</button>'
      + '</div>' : '')
    + '<div class="lib-bar">'
    + '<button class="btn primary full" style="margin:0" onclick="groupPickAdd()">➕ إضافة المحدد: <span id="gp-n">0</span></button>'
    + '<input id="gp-q" class="srch-inp" style="width:100%;margin-top:8px" placeholder="🔎 ابحث…" oninput="groupPickRender()">'
    + '</div><div id="gp-list"></div>');
  groupPickRender();
};
window.gpTab = function (t) {
  GP_TAB = t;
  var a = $('gp-t-mine'), b = $('gp-t-lib'), q = $('gp-q');
  if (a) a.className = 'pvt' + (t === 'mine' ? ' on' : '');
  if (b) b.className = 'pvt' + (t === 'lib' ? ' on' : '');
  if (q) q.value = '';
  groupPickRender();
};
window.groupPickRender = function () {
  var cur = findGroup(GRP.id) || { items: [] };
  var kind = GRP.kind, q = norm(($('gp-q') || {}).value);

  // تعذّرت قراءة القسم ⇒ لا إضافة من أي تبويب: ما لم نقرأه قد يكون موجودًا،
  // والإضافة فوقه تصنع نسخًا مكرّرة لعناصر لم تختفِ أصلًا.
  if (kindFailed(kind)) {
    h('gp-list', '<div class="rec-note">⚠️ <b>عناصر ' + esc(kindLbl(kind).title)
      + ' لم تُقرأ هذه المرة</b> — ليست محذوفة. افحص قاعدة البيانات قبل أن تضيف شيئًا.</div>'
      + '<button class="btn full primary" onclick="closeModal();goPage(\'diag\')">🩺 افحص قاعدة البيانات</button>');
    return;
  }

  if (GP_TAB === 'lib') return gpLibRender(q, cur);

  var list = coll(kind).filter(function (o) {
    return !q || norm(itemLabel(kind, o) + ' ' + (o.category || o.type || '')).indexOf(q) >= 0;
  });
  if (!list.length) {
    // «لا نتائج» وحدها طريقٌ مسدود: إمّا القسم فارغ أصلًا أو الاسم جديد —
    // ولكلٍّ مخرجه هنا، ومعهما المكتبة الجاهزة، بلا مغادرة المودال.
    var L = kindLbl(kind);
    var toLib = ((window.LIBRARY || {})[kind] || []).length
      ? '<button class="btn full" style="margin-top:8px" onclick="gpTab(\'lib\')">'
        + '📚 أو اختر من المكتبة الجاهزة</button>' : '';
    if (q) {
      h('gp-list', '<div class="empty"><div class="ei">🔎</div>'
        + '<div class="et">لا نتيجة لـ«' + esc(($('gp-q') || {}).value) + '»</div>'
        + '<button class="btn primary full" style="margin-top:11px" onclick="groupAddNamed()">'
        + '➕ أنشئه وأضِفه للمجموعة</button>' + toLib + '</div>');
      return;
    }
    h('gp-list', '<div class="empty"><div class="ei">' + L.icon + '</div>'
      + '<div class="et">لا ' + esc(L.title) + ' محفوظة بعد</div>'
      + '<div class="es">المجموعة تُجمَّع من عناصر القسم، فابدأ بإنشاء عنصر.</div>'
      + '<button class="btn primary full" style="margin-top:11px" onclick="groupAddNew()">'
      + '➕ أنشئ عنصرًا جديدًا وأضِفه</button>' + toLib + '</div>');
    return;
  }
  h('gp-list', list.map(function (o) {
    var have = cur.items.indexOf(o.id) >= 0;
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
  if (GP_TAB === 'lib') return groupLibAdd();
  var add = Object.keys(GPICK);
  if (!add.length) return toast('لم تحدد شيئًا بعد', 'er');
  GPICK = {}; closeModal();
  grpAddItems(add);
};

/* ── المكتبة الجاهزة من داخل المجموعة ───────────────────────────────
   المجموعة تُجمَّع من عناصر القسم، وكان على من قسمُه فارغ أن يغادرها إلى
   الإعدادات ← المكتبة، يستورد، ثم يعود ويبحث. تبويبٌ هنا يختصر الثلاثة:
   ما تختاره يُستورَد للقسم ويدخل المجموعة في خطوة واحدة. */
function gpLibRender(q, cur) {
  var kind = GRP.kind, lib = (window.LIBRARY || {})[kind] || [];
  LIB_KIND = kind;
  var hits = [];
  lib.forEach(function (o, i) { if (!q || libHay(o).indexOf(q) >= 0) hits.push(i); });
  if (!hits.length) {
    h('gp-list', emptyBox('🔎', 'لا نتائج في المكتبة', 'جرّب كلمة أخرى'));
    return;
  }
  // الموجود عندي أصلًا ليس ممنوعًا: يُضاف للمجموعة بمعرّفه بلا نسخة ثانية
  h('gp-list', '<div class="muted" style="margin:0 0 8px">'
    + hits.length + ' من ' + lib.length + ' في المكتبة. ما تختاره يدخل'
    + ' «' + esc(kindLbl(kind).title) + '» والمجموعة معًا.</div>'
    + hits.map(function (i) {
        var o = lib[i];
        var mine = libMineOf(kind, o);
        var inGrp = mine && cur.items.indexOf(mine.id) >= 0;
        var nm = kind === 'meds' ? o.trade_name
          : kind === 'imaging' ? (o.region ? o.name + ' (' + o.region + ')' : o.name)
          : (o.code ? o.code + ' — ' + o.name : o.name);
        return '<label class="lib-i' + (inGrp ? ' have' : '') + '">'
          + '<input type="checkbox"' + (inGrp ? ' disabled' : '')
          + (LIB_SEL[i] ? ' checked' : '') + ' onchange="gpLibToggle(' + i + ')">'
          + '<span><span class="lib-t">' + esc(nm) + '</span>'
          + '<span class="lib-s"><br>' + esc(o.category || '')
          + (mine ? ' • عندك مسبقًا' : '') + '</span></span></label>';
      }).join(''));
}
/** العنصر المقابل في بيانات المستخدم، إن كان قد استورده من قبل. */
function libMineOf(kind, src) {
  var key = libKey(kind, src);
  return coll(kind).find(function (o) { return libKey(kind, o) === key; });
}
window.gpLibToggle = function (i) {
  if (LIB_SEL[i]) delete LIB_SEL[i]; else LIB_SEL[i] = 1;
  var e = $('gp-n'); if (e) e.textContent = Object.keys(LIB_SEL).length;
};
/** يستورد المحدد من المكتبة (ما لم يكن عنده) ثم يضيفه كلّه للمجموعة. */
window.groupLibAdd = function () {
  var kind = GRP.kind, lib = (window.LIBRARY || {})[kind] || [];
  var add = [], fresh = [];
  Object.keys(LIB_SEL).forEach(function (k) {
    var src = lib[parseInt(k, 10)]; if (!src) return;
    var mine = libMineOf(kind, src);
    if (mine) { add.push(mine.id); return; }       // لا نسخة ثانية لما عنده
    var o = {};
    for (var f in src) if (Object.prototype.hasOwnProperty.call(src, f)) o[f] = src[f];
    o.id = uid();
    fresh.push(o); add.push(o.id);
  });
  if (!add.length) return toast('لم تحدد شيئًا بعد', 'er');
  if (fresh.length) {
    setColl(kind, coll(kind).concat(fresh));
    Store.addMany(kind, fresh);
    fresh.forEach(function (o) { catEnsure(kind, o.category); });
  }
  LIB_SEL = {}; closeModal();
  grpEdit(function (g) {
    orderOf(g.kind, add).forEach(function (id) {
      if (g.items.indexOf(id) < 0) g.items.push(id);
    });
  });
  var L = kindLbl(kind);
  toast('✅ ' + countWord(add.length, L.one, L.two, L.few, L.many)
    + (fresh.length ? ' — أُضيفت للقسم وللمجموعة' : ' — أُضيفت للمجموعة'));
};
/** يضيف معرّفات للمجموعة المفتوحة ويحفظ — بلا تكرار.
    الدفعة الجديدة تدخل بترتيب عرض القسم؛ وما في المجموعة يبقى كما رتّبه. */
function grpAddItems(ids) {
  grpEdit(function (g) {
    orderOf(g.kind, ids).forEach(function (id) {
      if (g.items.indexOf(id) < 0) g.items.push(id);
    });
  });
  toast('✅ أُضيفت وحُفظت');
}
/** «أنشئه وأضِفه»: عنصر بالاسم المكتوب في خانة البحث، ثم يدخل المجموعة. */
window.groupAddNamed = function () {
  var kind = GRP.kind;
  var q = String((($('gp-q') || {}).value) || '').trim();
  if (!q) return;
  var rec = { id: uid(), category: LAST_CAT[kind] || '', extra: {} };
  rec[nameKey(kind)] = q;
  coll(kind).push(rec);
  catEnsure(kind, rec.category);
  Store.upsert(kind, rec);
  closeModal();
  grpAddItems([rec.id]);
};
/**
 * «أنشئ عنصرًا جديدًا وأضِفه»: يفتح نموذج القسم كاملًا، وما يُحفَظ منه
 * يدخل المجموعة تلقائيًا. بلا هذا كان على من قسمُه فارغ أن يغادر المجموعة،
 * ينشئ عنصرًا، ثم يعود — وهو ما جعل «إضافة عناصر» تبدو معطّلة.
 */
var GRP_CATCH = null;
window.groupAddNew = function () {
  if (!GRP) return;
  GRP_CATCH = { id: GRP.id, kind: GRP.kind, before: coll(GRP.kind).map(function (o) { return o.id; }) };
  closeModal();
  openForm(GRP.kind);
};
/** يُنادى بعد كل حفظ: ما استُحدث أثناء انتظار المجموعة يدخلها. */
function grpCatch(kind) {
  if (!GRP_CATCH || GRP_CATCH.kind !== kind) return false;
  var fresh = coll(kind).filter(function (o) { return GRP_CATCH.before.indexOf(o.id) < 0; });
  GRP_CATCH.before = coll(kind).map(function (o) { return o.id; });
  if (!fresh.length) return false;
  var g = findGroup(GRP_CATCH.id); if (!g) return false;
  fresh.forEach(function (o) { if (g.items.indexOf(o.id) < 0) g.items.push(o.id); });
  Store.saveGroup(g);
  toast('✅ حُفظ وأُضيف إلى «' + g.name + '»');
  return true;
}

/* ════════════════════════ طباعة/PDF + مشاركة واتساب ════════════════════════ */
/* الاسم دائمًا في السطر الأول؛ الرمز (للتحاليل) والاسم العلمي (للعلاجات)
   يُدمجان معه إن اختيرا، وبقية الحقول المختارة تنزل أسطرًا تحته. */
/** اسم العنصر كما يظهر في المخرجات — بلا رقم: الرقم يُرسَم مستقلًّا. */
function outTitle(kind, o) {
  var sel = DB.out[kind];
  if (kind === 'meds') {
    return o.trade_name
      + (sel.indexOf('scientific_name') >= 0 && o.scientific_name ? ' (' + o.scientific_name + ')' : '');
  }
  if (kind === 'labs') {
    return (sel.indexOf('code') >= 0 && o.code ? o.code + ' — ' : '') + o.name;
  }
  return o.name;
}
/**
 * اتجاه نصٍّ بحسب أول حرفٍ ذي اتجاه فيه: عربيٌّ ⇒ rtl، لاتينيٌّ ⇒ ltr.
 *
 * الأرقام وعلامات الترقيم لا اتجاه لها، لذلك «1. Urea» في فقرةٍ عربية كان
 * يُرسَم «Urea .1» — الرقم في الطرف الخطأ والنقطة قبله. نفس ما يفعله
 * `dir="auto"` في HTML، ونحتاجه هنا للوحة الرسم والنصّ المنسوخ أيضًا.
 */
function dirOf(t) {
  var m = String(t == null ? '' : t)
    .match(/[A-Za-z\u00C0-\u024F\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/);
  if (!m) return 'rtl';
  return /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(m[0])
    ? 'rtl' : 'ltr';
}
function outLines(kind, o) {
  var defs = outDefs(kind);
  var merged = kind === 'meds' ? 'scientific_name' : kind === 'labs' ? 'code' : '';
  var sel = DB.out[kind], lines = [];
  defs.forEach(function (f) {
    if (f[0] === merged || sel.indexOf(f[0]) < 0) return;
    var v = String(outValue(o, f[0])).trim();
    if (!v) return;
    var line = { l: f[1], v: v };
    /* الموقع يُرسَل رابطًا لا إحداثيات: «24.7136, 46.6753» لا تفتح شيئًا
       في واتساب، والرابط يُضغَط فيفتح الخريطة على المكان مباشرةً. */
    if (f[2] === 'geo') {
      var u = geoLink(v);
      if (u) { line.v = u; line.url = u; }
    }
    lines.push(line);
  });
  return lines;
}
/** سطر الحقل كما يُرسَم ويُنسَخ — باسمه إن طلبه المستخدم، وإلا بقيمته. */
function lineText(x) { return DB.showLabels ? x.l + ': ' + x.v : x.v; }
/** النصّ العادي لا يحمل صورًا، فيُذكَر اسمها بدل رمزها ليبقى المعنى. */
function plainText(v) {
  return segsOf(v).map(function (g) {
    if (g.t !== 'img') return g.v;
    var im = imgByCode(g.code);
    return '[صورة: ' + (im.name || im.code) + ']';
  }).join('');
}
function rowsFor(kind, ids) {
  var src = coll(kind);
  return ids.map(function (id, i) {
    var o = src.find(function (x) { return x.id === id; });
    // الصورة حقلٌ كغيره: لا تخرج إلا إن كانت ضمن الحقول المرسلة
    var show = (DB.out[kind] || []).indexOf('img') >= 0;
    return o ? { n: i + 1, title: outTitle(kind, o), lines: outLines(kind, o),
                 img: (show && o.img && imgByCode(o.img)) ? o.img : '' } : null;
  }).filter(Boolean);
}
function cartRows(kind) { return rowsFor(kind, DB.cart[kind]); }
/*
 * الاتجاه على كل سطرٍ لا على الورقة: `dir="auto"` يجعل المتصفّح يستنتجه من
 * أول حرفٍ ذي اتجاه. فاسمٌ لاتيني يُرسَم من اليسار ورقمُه عن يساره، واسمٌ
 * عربي من اليمين ورقمُه عن يمينه — وسطور الحقول تبقى عربية لأن عناوينها
 * عربية، مهما كانت لغة الاسم فوقها.
 */
function itemsHtml(kind, ids) {
  return rowsFor(kind, ids).map(function (r) {
    return '<div class="rx-item">'
      + '<div class="rx-name" dir="auto"><span class="rx-n">' + r.n + '.</span>'
      + '<span class="rx-t">' + esc(r.title) + '</span></div>'
      + (r.img ? '<img class="rx-pic" src="' + imgData(r.img) + '" alt="">' : '')
      + r.lines.map(function (x) {
        // نصّ الحقل يمرّ بـtextHtml لا esc: الرمز {code} يصير صورةً مكانه
        return '<div class="rx-f" dir="auto">'
          + (DB.showLabels ? '<span class="rx-l">' + esc(x.l) + ':</span> ' : '')
          // الموقع وصلةٌ تُضغَط في ملف الـPDF، ونصّه هو الرابط نفسه
          + (x.url ? '<a class="rx-u" href="' + esc(x.url) + '">' + esc(x.v) + '</a>' : textHtml(x.v))
          + '</div>';
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
/**
 * `dense` يضغط المقاسات فتدخل قائمة أطول في الصفحة الواحدة — الفرق في
 * حجم الخط والهوامش فقط، فلا يتغيّر شيء في المحتوى ولا في ترتيبه.
 */
function printCss(scope, dense) {
  var s = scope ? scope + ' ' : '';
  var body = scope ? scope : 'body';
  var F = dense ? { base: '9.5pt', h1: '12pt', name: '9.5pt', line: '8.5pt',
                    pad: '3pt 5pt', gap: '2.5pt', lh: '1.25' }
                : { base: '11pt', h1: '14pt', name: '11pt', line: '9.5pt',
                    pad: '4pt 7pt', gap: '4pt', lh: '1.35' };
  return (scope ? '' : '@page{size:A4;margin:12mm 10mm}')
    + s + '*{box-sizing:border-box;font-family:Tahoma,Arial,sans-serif}'
    // في المعاينة لا نضبط الهوامش: بطاقة `.paper` تحتفظ بهوامشها في الواجهة.
    + body + '{' + (scope ? '' : 'margin:0;')
    + 'color:#0f172a;font-size:' + F.base + ';line-height:' + F.lh + ';-webkit-print-color-adjust:exact}'
    + s + 'h1{font-size:' + F.h1 + ';color:#0f766e;margin:0}'
    // الاسم والتاريخ طرفا سطرٍ واحد، بينهما فراغ لا فاصلة
    + s + '.sub{color:#64748b;font-size:8.5pt;margin:2px 0 8px;padding-bottom:5px;'
    + 'border-bottom:1.5pt solid #0f766e;display:flex;justify-content:space-between;align-items:baseline}'
    + s + '.sub .who{font-weight:bold;color:#0f172a;font-size:' + (dense ? '10pt' : '11.5pt') + '}'
    + s + '.sub.solo{margin-top:0}'
    // خلفية سطرٍ وسطر: العين تتبع الصفّ بلا أن تزيغ، وهو أهمّ ما في قائمةٍ طويلة
    + s + '.rx-item{border:0.6pt solid #cbd5e1;border-radius:4pt;padding:' + F.pad
    + ';margin-bottom:' + F.gap + ';page-break-inside:avoid;background:#ffffff}'
    + s + '.rx-item:nth-child(even){background:#f1f5f9}'
    // الرقم عمودٌ ثابت العرض فتصطفّ الأسماء تحت بعضها، والصندوق يتبع
    // اتجاه الاسم (dir=auto) فيقع الرقم في الطرف الصحيح من السطر دائمًا
    + s + '.rx-name{display:flex;gap:' + (dense ? '3pt' : '5pt') + ';align-items:baseline;'
    + 'font-weight:bold;font-size:' + F.name + ';color:#0f766e;margin-bottom:1pt;line-height:1.3}'
    + s + '.rx-n{flex:none;min-width:' + (dense ? '7pt' : '9pt') + ';text-align:start;color:#64748b}'
    + s + '.rx-t{flex:1;min-width:0}'
    + s + '.rx-f{font-size:' + F.line + ';margin:0.5pt 0;line-height:' + F.lh + ';white-space:pre-wrap}'
    // الموقع وصلة: تُضغَط في الـPDF، وتُقرأ عنوانًا كاملًا على الورق المطبوع
    + s + '.rx-u{color:#0f766e;text-decoration:underline;word-break:break-all}'
    + s + '.rx-l{color:#475569;font-weight:bold}'
    + s + '.rx-pic{display:block;max-width:' + (dense ? '38mm' : '52mm')
    + ';max-height:' + (dense ? '30mm' : '42mm') + ';margin:2pt 0;border:0.4pt solid #cbd5e1;border-radius:3pt}'
    + s + '.lh{border-bottom:1.5pt solid #0f766e;padding-bottom:5pt;margin-bottom:7pt}'
    + s + '.lh-n{font-weight:bold;font-size:13pt;color:#0f766e}'
    + s + '.lh-t{font-size:9.5pt;color:#334155;margin-top:1pt}'
    + s + '.lh-c{font-size:9pt;color:#64748b;margin-top:1pt;direction:ltr;text-align:right}'
    + s + '.ft{margin-top:8pt;font-size:8pt;color:#94a3b8;text-align:center}';
}
/** جسم الورقة (ترويسة + عنوان + تاريخ + المحتوى) — مشترك بين الطباعة والمعاينة. */
/**
 * عنوان الورقة اختياري ومطفأ افتراضيًّا.
 *
 * «قائمة تحاليل» عنوانٌ يولّده التطبيق لا المستخدم، ولا يضيف للمريض شيئًا
 * — فحذفُه يترك الورقة لاسم المريض وتاريخه وحدهما. ومن أراده كتبه بنفسه
 * في حقل الاسم. ويبقى العنوان مستعمَلًا في اسم الملف وفي سجل الإرسالات.
 */
function docBody(title, body, who) {
  // الاسم طرفًا والتاريخ الطرف الآخر — لا ملتصقين بفاصلة بينهما
  var head = (DB.showTitle ? '<h1>' + esc(title) + '</h1>' : '')
    + '<div class="sub' + (DB.showTitle ? '' : ' solo') + '">'
    + '<span class="who">' + (who ? esc(who) : '') + '</span>'
    + '<span class="when">' + new Date().toLocaleDateString('ar-SA-u-nu-latn') + '</span></div>';
  return headerHtml() + head + body;
}
/** صفحة الطباعة: تخطيط مضغوط الأسطر يتّسع لأكبر عدد في الصفحة بلا ازدحام. */
function printDoc(title, body, who) {
  return '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title>'
    + '<style>' + printCss('', DB.dense) + '</style></head><body>'
    + docBody(title, body, who) + '</body></html>';
}
/** اسم الملف وعنوان مهمّة الطباعة: العنوان ومعه اسم المريض إن كُتِب. */
function outName(title, who) {
  return String(title || 'دليلي') + (who ? ' - ' + who : '');
}
window.printList = function (kind, ids, title, who) {
  var body = itemsHtml(kind, ids);
  if (!body) return toast('القائمة فارغة', 'er');
  var html = printDoc(title, body, who);
  title = outName(title, who);

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
/** عنوان القائمة المُرسَلة. الأقسام التي ينشئها المستخدم لا عنوان جاهز
    لها في CART_TITLE، فاسم القسم نفسه هو العنوان — وبلا هذا كانت الورقة
    تخرج بعنوان فارغ واسم الملف «undefined». */
function cartTitle(kind, withIcon) {
  var L = kindLbl(kind), t = CART_TITLE[kind] || L.title;
  return withIcon ? L.icon + ' ' + t : t;
}
/** رموز الصور المستعملة في قائمة: صورة العنصر وما داخل نصوصه. */
function imgsUsed(kind, ids) {
  var out = [];
  rowsFor(kind, ids).forEach(function (r) {
    if (r.img && out.indexOf(r.img) < 0) out.push(r.img);
    r.lines.forEach(function (x) {
      segsOf(x.v).forEach(function (g) {
        if (g.t === 'img' && out.indexOf(g.code) < 0) out.push(g.code);
      });
    });
  });
  return out;
}
/**
 * تحميل الصور قبل رسم اللوحة. `drawImage` تحتاج صورة محمَّلة، وقياس
 * الارتفاع يحتاج أبعادها — فلا مفرّ من انتظارها قبل البناء.
 */
function loadImgs(codes, cb) {
  var out = {}, left = codes.length;
  if (!left) return cb(out);
  codes.forEach(function (code) {
    var im = new Image();
    im.onload = function () { out[code] = im; if (!--left) cb(out); };
    im.onerror = function () { if (!--left) cb(out); };
    im.src = imgData(code);
  });
}

function buildCanvas(kind, ids, title, pics, who) {
  pics = pics || {};
  var W = 900, PAD = 28, headH = 108, MAXW = W - PAD * 2 - 22;
  var TITLE_F = 'bold 23px Tahoma, Arial, sans-serif';
  var LINE_F = '16.5px Tahoma, Arial, sans-serif';
  var TITLE_H = 28, LINE_H = 23;

  var c = document.createElement('canvas');
  var ctx = c.getContext('2d');

  // قياس أولًا لمعرفة الارتفاع المطلوب، ثم تحديد أبعاد اللوحة ورسمها
  // سطر الصورة يحمل أبعادها المصغَّرة؛ وسطر النصّ نصٌّ عادي كما كان
  function picLine(code) {
    var im = pics[code];
    if (!im || !im.naturalWidth) return null;
    var w = Math.min(MAXW, im.naturalWidth, 320);
    var h = Math.round(im.naturalHeight * (w / im.naturalWidth));
    return { im: im, w: Math.round(w), h: h };
  }
  var rows = rowsFor(kind, ids).map(function (r) {
    ctx.font = TITLE_F;
    // الرقم يأخذ عرضه من الهامش فتصطفّ الأسماء تحت بعضها مهما طال الرقم
    var num = r.n + '.';
    var numW = Math.max(ctx.measureText('99.').width, ctx.measureText(num).width) + 10;
    var titleLines = wrapText(ctx, r.title, MAXW - numW);
    ctx.font = LINE_F;
    var lines = [], hh = 0;
    var top = r.img ? picLine(r.img) : null;
    if (top) hh += top.h + 8;
    r.lines.forEach(function (x) {
      segsOf(lineText(x)).forEach(function (g) {
        if (g.t === 'img') {
          var pl = picLine(g.code);
          if (pl) { lines.push(pl); hh += pl.h + 8; }
          return;
        }
        wrapBlock(ctx, g.v, MAXW).forEach(function (l) { lines.push(l); hh += LINE_H; });
      });
    });
    return {
      num: num, numW: numW, dir: dirOf(r.title),
      titleLines: titleLines, lines: lines, top: top,
      h: 18 + titleLines.length * TITLE_H + hh
    };
  });

  var H = headH + rows.reduce(function (a, r) { return a + r.h; }, 0) + PAD / 2;
  c.width = W; c.height = H;
  ctx = c.getContext('2d');
  ctx.fillStyle = '#f0fdfa'; ctx.fillRect(0, 0, W, H);

  var grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#075e54'); grad.addColorStop(1, '#0f766e');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, headH);
  ctx.direction = 'rtl'; ctx.textBaseline = 'middle';
  var when = new Date().toLocaleDateString('ar-SA-u-nu-latn');
  if (DB.showTitle) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff'; ctx.font = 'bold 31px Tahoma, Arial, sans-serif';
    ctx.fillText(title, W - PAD, 42);
  }
  // الاسم والتاريخ طرفا سطرٍ واحد — لا ملتصقين بفاصلة
  var y2 = DB.showTitle ? 80 : 54;
  ctx.font = (DB.showTitle ? '' : 'bold ') + (DB.showTitle ? 16 : 22)
    + 'px Tahoma, Arial, sans-serif';
  ctx.fillStyle = DB.showTitle ? 'rgba(255,255,255,.9)' : '#fff';
  if (who) { ctx.textAlign = 'right'; ctx.fillText(who, W - PAD, y2); }
  ctx.font = '15px Tahoma, Arial, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.textAlign = 'left';
  ctx.fillText(when, PAD, y2);
  ctx.textAlign = 'right';

  var y = headH;
  rows.forEach(function (r, i) {
    ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#f8fffe';
    ctx.fillRect(PAD / 2, y + 4, W - PAD, r.h - 8);
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
    ctx.strokeRect(PAD / 2, y + 4, W - PAD, r.h - 8);

    var ty = y + 24;
    ctx.fillStyle = '#0f172a'; ctx.font = TITLE_F;
    var R = W - PAD - 11, Lx = PAD + 11;          // حافّتا السطر
    if (r.dir === 'ltr') {
      ctx.direction = 'ltr'; ctx.textAlign = 'left';
      ctx.fillText(r.num, Lx, ty);
      r.titleLines.forEach(function (t) { ctx.fillText(t, Lx + r.numW, ty); ty += TITLE_H; });
      ctx.direction = 'rtl'; ctx.textAlign = 'right';
    } else {
      ctx.fillText(r.num, R, ty);
      r.titleLines.forEach(function (t) { ctx.fillText(t, R - r.numW, ty); ty += TITLE_H; });
    }
    if (r.top) {
      ctx.drawImage(r.top.im, W - PAD - 11 - r.top.w, ty - 8, r.top.w, r.top.h);
      ty += r.top.h + 8;
    }
    ctx.fillStyle = '#0f766e'; ctx.font = LINE_F;
    r.lines.forEach(function (l) {
      if (typeof l === 'string') { ctx.fillText(l, W - PAD - 11, ty); ty += LINE_H; return; }
      ctx.drawImage(l.im, W - PAD - 11 - l.w, ty - 8, l.w, l.h);
      ty += l.h + 8;
    });
    y += r.h;
  });
  return c;
}
/** يبني نفس ورقة الطباعة لكن يُخرجها ملف PDF ويفتح قائمة الإرسال مباشرةً. */
window.pdfList = function (kind, ids, title, who) {
  var body = itemsHtml(kind, ids);
  if (!body) return toast('القائمة فارغة', 'er');
  if (!(window.AndroidBridge && typeof window.AndroidBridge.sharePdf === 'function')) {
    return toast('إرسال PDF متاح داخل التطبيق', 'er');
  }
  window.AndroidBridge.sharePdf(printDoc(title, body, who), outName(title, who));
  toast('📄 يجري تجهيز ملف PDF…');
};

/** نصّ عادي للصق في واتساب أو أي مكان — أخفّ من الصورة وقابل للبحث. */
function listText(kind, ids, title, who) {
  var hd = DB.header || {}, lines = [];
  if (hd.name) lines.push(hd.name);
  if (hd.title) lines.push(hd.title);
  if (hd.contact) lines.push(hd.contact);
  if (lines.length) lines.push('');
  lines.push((DB.showTitle ? title + ' — ' : '') + (who ? who + ' — ' : '')
    + new Date().toLocaleDateString('ar-SA-u-nu-latn'));
  lines.push('');
  rowsFor(kind, ids).forEach(function (r) {
    // LRM/RLM قبل الرقم: محرف غير مرئي يثبّت ترتيب السطر في واتساب وغيره
    var mark = dirOf(r.title) === 'ltr' ? '\u200E' : '\u200F';
    lines.push(mark + r.n + '. ' + r.title);
    r.lines.forEach(function (x) {
      var segs = plainText(x.v).split('\n');
      lines.push('   • ' + (DB.showLabels ? x.l + ': ' : '') + segs[0]);
      for (var i = 1; i < segs.length; i++) lines.push('     ' + segs[i]);
    });
  });
  return lines.join('\n');
}
window.copyList = function (kind, ids, title, who) {
  if (!ids.length) return toast('القائمة فارغة', 'er');
  var text = listText(kind, ids, title, who);
  if (window.AndroidBridge && typeof window.AndroidBridge.copyText === 'function') {
    window.AndroidBridge.copyText(text);
    return toast('📋 نُسخ النص — الصقه حيث تشاء');
  }
  try {
    navigator.clipboard.writeText(text).then(function () { toast('📋 نُسخ النص'); },
      function () { toast('تعذّر النسخ', 'er'); });
  } catch (e) { toast('تعذّر النسخ', 'er'); }
};
window.shareList = function (kind, ids, title, imgTitle, who) {
  if (!ids.length) return toast('القائمة فارغة', 'er');
  var name = outName(title || kindLbl(kind).title, who);
  var head = imgTitle || (kindLbl(kind).icon + ' ' + (title || name));
  var fname = name.replace(/[ /\\]/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.png';
  loadImgs(imgsUsed(kind, ids), function (pics) {
    sendCanvas(buildCanvas(kind, ids, head, pics, who), fname);
  });
};
/** إرسال اللوحة: جسر أندرويد، أو مشاركة الويب، أو تنزيل — كما كان. */
function sendCanvas(canvas, fname) {

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
}

/* ── المعاينة قبل الإرسال ──
   صفحة واحدة تجمع كل مخارج القائمة: تعرض ما سيُرسَل فعلًا — الورقة (نفس
   تنسيق PDF والطباعة حرفيًا) أو الصورة (نفس لوحة الرسم المُرسَلة) — ثم
   شريط إرسال ثابت أسفلها. لا شيء يُرسَل قبل أن يراه المستخدم. */
var PV = null, PV_TAB = 'paper';

/**
 * يفتح المعاينة لقائمة معيّنة (سلة أو مجموعة أو إرسالٌ سابق).
 *
 * لا يدخل هنا إلا معرّفٌ له عنصرٌ قائم. كان الصفّ الذي لا يُعثر على عنصره
 * يُرسم «(عنصر محذوف)» فيرى المستخدم عشرة أشباح في قائمةٍ من عشرة —
 * والإشارة إلى ما لا وجود له ليست عنصرًا ناقصًا، بل لا شيء.
 */
window.openPreview = function (kind, ids, title, imgTitle) {
  var live = liveIds(kind, ids);
  if (!live.length) { PV = null; return toast('لا عناصر في هذه القائمة', 'er'); }
  title = title || kindLbl(kind).title;
  PV = { kind: kind, ids: live, off: {}, title: title,
         imgTitle: imgTitle || (kindLbl(kind).icon + ' ' + title) };
  PV_TAB = 'paper';
  goPage('pv');
  if (live.length < (ids || []).length) toast('أُسقطت عناصر لم تعد موجودة');
};
window.pvTab = function (t) { PV_TAB = t; render(); };
/** الصيغ الأربع — الأولى في الشريط هي آخر ما استعمله المستخدم. */
var FMTS = [['pdf', '📄 PDF', 'wa'], ['img', '🖼️ صورة', 'wa'],
            ['print', '🖨️ طباعة', 'white'], ['copy', '📋 نسخ', 'white']];
/**
 * يُقرأ من الحقل مباشرةً، ويُحدَّث سطر الورقة وحده لا الصفحة كلها: إعادة
 * الرسم تكتب innerHTML من جديد فيفقد الحقل تركيزه وسط الكتابة.
 */
window.pvWho = function () {
  var e = $('pv-who');
  if (!PV || !e) return;
  PV.who = String(e.value || '').trim();
  // نكتب في خانة الاسم وحدها: كتابة نصّ في `.sub` كلّها تطمس بنيتها
  // (خانة الاسم وخانة التاريخ) فيلتصق الاثنان ويضيع التباعد بينهما
  try {
    var who = document.querySelector('.paper .sub .who');
    if (who) who.textContent = PV.who;
  } catch (err) { /* بيئة بلا DOM كامل */ }
};

/** تنسيق الورقة محصورًا داخل `.paper` — يُعاد بناؤه إذا تغيّرت الكثافة. */
var PV_CSS = null;
function ensurePreviewCss() {
  var want = DB.dense ? 'd' : 'n';
  if (PV_CSS === want) return;
  try {
    var st = document.getElementById('pv-css');
    if (!st) {
      st = document.createElement('style');
      st.id = 'pv-css';
      (document.head || document.body).appendChild(st);
    }
    st.textContent = printCss('.paper', DB.dense);
    PV_CSS = want;
  } catch (e) { /* بيئة بلا DOM كامل — الورقة تظهر بتنسيق الواجهة */ }
}
window.pvDense = function () {
  DB.dense = DB.dense ? 0 : 1;
  Store.setDense();
  render();
  toast(DB.dense ? '🗜️ ورقة مضغوطة' : '📄 ورقة عادية');
};

/**
 * صورة المعاينة = نفس اللوحة المُرسَلة. تُبنى بعد تحميل صورها فنعرض مكانها
 * لحظةً ثم نحقنها — لأن الرسم يحتاج صورًا محمَّلة وأبعادها.
 */
function pvImgHtml() {
  return '<div class="pvimg" id="pv-img"><div class="es">⏳ يجري تجهيز الصورة…</div></div>';
}
function pvImgFill() {
  if (!PV) return;
  try {
    var ids = pvOn();
    loadImgs(imgsUsed(PV.kind, ids), function (pics) {
      var box = $('pv-img');
      if (!box || PV_TAB !== 'img') return;
      try {
        var c = buildCanvas(PV.kind, ids, PV.imgTitle, pics, PV.who);
        box.innerHTML = '<img alt="معاينة الصورة" src="' + c.toDataURL('image/png') + '">';
      } catch (e) {
        box.innerHTML = '<div class="es">تعذّر توليد الصورة — جرّب الورقة أو الإرسال مباشرة</div>';
      }
    });
  } catch (e) { /* بيئة بلا لوحة رسم */ }
}

function renderPreview() {
  if (!PV) { h('page', emptyBox('👁️', 'لا يوجد ما يُعرَض', 'اختر عناصر ثم اضغط «عرض وإرسال»')); return; }
  ensurePreviewCss();
  var on = pvOn(), n = on.length, all = PV.ids.length, L = kindLbl(PV.kind);
  var html = '<div class="pvtabs">'
    + '<button class="pvt' + (PV_TAB === 'paper' ? ' on' : '') + '" onclick="pvTab(\'paper\')">📄 الورقة</button>'
    + '<button class="pvt' + (PV_TAB === 'img' ? ' on' : '') + '" onclick="pvTab(\'img\')">🖼️ الصورة</button>'
    + '<button class="pvt' + (PV_TAB === 'list' ? ' on' : '') + '" onclick="pvTab(\'list\')">☑️ اختر وأعِد الترتيب</button>'
    + '</div>'
    + '<div class="hint">' + L.icon + ' ' + esc(PV.title) + ' — '
    + (n === all ? countWord(n, L.one, L.two, L.few, L.many)
                 : '<b>' + n + ' من ' + all + '</b> ' + L.few)
    + (PV_TAB === 'paper' ? '<button class="btn white sm" style="margin-right:auto"'
        + ' onclick="pvDense()">' + (DB.dense ? '📄 عادي' : '🗜️ مضغوط') + '</button>' : '')
    + '</div>';

  // اسم المريض اختياري بالكامل: فارغ = لا يظهر شيء في الورقة ولا اسم الملف
  html += '<div class="f pvwho"><label>اسم المريض (اختياري)</label>'
    + '<input id="pv-who" class="inp" value="' + esc(PV.who || '') + '"'
    + ' placeholder="يظهر في الورقة وفي اسم الملف" oninput="pvWho()"></div>';

  if (PV_TAB === 'img') html += pvImgHtml();
  else if (PV_TAB === 'list') html += pvListHtml();
  else html += '<div class="paper">' + docBody(PV.title, itemsHtml(PV.kind, on), PV.who) + '</div>';

  html += '<div class="pvbar">' + FMTS.slice()
    .sort(function (a, b) {                       // المفضّلة أولًا
      return (b[0] === DB.fmt ? 1 : 0) - (a[0] === DB.fmt ? 1 : 0);
    })
    .map(function (f, i) {
      return '<button class="btn ' + (i === 0 ? 'primary' : f[2]) + ' sm"'
        + ' onclick="pvSend(\'' + f[0] + '\')">' + f[1] + '</button>';
    }).join('') + '</div>';
  h('page', html);
  if (PV_TAB === 'img') pvImgFill();
}

/**
 * تبويب «اختر وأعِد الترتيب»: تأشيرٌ لا حذف.
 *
 * الطريقة العملية التي يحتاجها الطبيب: مجموعة واحدة شاملة تصلح للغالب، ثم
 * لكل مريض يؤشّر ما يرسله منها. الحذف كان يُلزمه بإزالة خمسة عشر عنصرًا
 * ليرسل خمسة؛ التأشير يجعلها خمس لمسات. والإلغاء هنا لا يمسّ المجموعة
 * المحفوظة ولا تحديدك في القسم — المعاينة نافذة على ما سيخرج الآن.
 */
function pvListHtml() {
  if (!PV.ids.length) return emptyBox('☑️', 'لا عناصر', 'ارجع وحدّد من جديد');
  var on = pvOn().length, all = PV.ids.length;
  return '<div class="hint">أشِّر ما تريد إرساله الآن. الإلغاء والترتيب هنا'
    + ' لهذا الإرسال وحده — المجموعة المحفوظة لا تتغيّر.</div>'
    + '<div class="pvsel">'
    + '<button class="btn sm" onclick="pvAll(1)">☑️ تحديد الكل</button>'
    + '<button class="btn sm" onclick="pvAll(0)">⬜ إلغاء الكل</button>'
    + '<span class="pvsel-n">' + on + ' / ' + all + '</span></div>'
    + '<button class="btn full" onclick="pvKeepOrder()">💾 احفظ هذا الترتيب للقسم</button>'
    + PV.ids.map(function (id, i) {
      var o = itemById(PV.kind, id), off = !!(PV.off && PV.off[id]);
      return '<div class="card pvrow' + (off ? ' off' : '') + '"><div class="row">'
        + '<label class="pvck"><input type="checkbox"' + (off ? '' : ' checked')
        + ' onchange="pvPick(\'' + id + '\')"></label>'
        + '<div class="grow" onclick="pvPick(\'' + id + '\')">'
        + '<div class="name">' + esc(itemLabel(PV.kind, o)) + '</div></div>'
        + '<button class="ic"' + (i === 0 ? ' disabled' : '') + ' onclick="pvMove(' + i + ',-1)">⬆️</button>'
        + '<button class="ic"' + (i === PV.ids.length - 1 ? ' disabled' : '') + ' onclick="pvMove(' + i + ',1)">⬇️</button>'
        + '</div></div>';
    }).join('')
    + '<div class="pvpad"></div>';
}
/** المؤشَّر منها بترتيبه — هو وحده ما يُطبع ويُرسل ويُسجَّل. */
function pvOn() {
  if (!PV) return [];
  return PV.ids.filter(function (id) { return !(PV.off && PV.off[id]); });
}
window.pvPick = function (id) {
  if (!PV) return;
  PV.off = PV.off || {};
  if (PV.off[id]) delete PV.off[id]; else PV.off[id] = 1;
  render();
};
window.pvAll = function (on) {
  if (!PV) return;
  PV.off = {};
  if (!on) PV.ids.forEach(function (id) { PV.off[id] = 1; });
  render();
};
/**
 * «احفظ هذا الترتيب للقسم».
 *
 * ترتيب المعاينة مؤقّتٌ بطبعه — وهذا مقصود. لكن من رتّب هنا ورضي الترتيب
 * كان عليه أن يعيده في القسم من جديد، فيظنّ أنّ الترتيب «لا يُحفَظ». هذا
 * الزرّ يثبّت ما أمامه: يُعطي المؤشَّر مواضعه الأولى ثم يُلحِق الباقي،
 * فيصير ترتيب القسم — والسلة والورقة معه.
 */
window.pvKeepOrder = function () {
  if (!PV) return;
  var kind = PV.kind;
  var want = PV.ids.slice();
  coll(kind).forEach(function (o) { if (want.indexOf(o.id) < 0) want.push(o.id); });
  var by = {};
  coll(kind).forEach(function (o) { by[o.id] = o; });
  setColl(kind, want.map(function (id) { return by[id]; }).filter(Boolean));
  var ok = Store.setItemOrder(kind, want);
  if (ok === false) return toast('⚠️ لم يُحفَظ الترتيب — راجِع 🩺 الفحص', 'er');
  DB.cart[kind] = orderOf(kind, DB.cart[kind]);
  Store.setCart(kind);
  toast('✅ صار هذا ترتيب ' + kindLbl(kind).title);
};
window.pvMove = function (i, dir) {
  var j = i + dir;
  if (!PV || j < 0 || j >= PV.ids.length) return;
  var t = PV.ids[i]; PV.ids[i] = PV.ids[j]; PV.ids[j] = t;
  render();
};

window.pvSend = function (how) {
  if (!PV) return;
  var ids = pvOn();
  if (!ids.length) return toast('لم تؤشّر شيئًا للإرسال', 'er');
  pvWho();
  var who = PV.who || '';
  if (how === 'pdf') pdfList(PV.kind, ids, PV.title, who);
  else if (how === 'img') shareList(PV.kind, ids, PV.title, PV.imgTitle, who);
  else if (how === 'print') printList(PV.kind, ids, PV.title, who);
  else copyList(PV.kind, ids, PV.title, who);
  if (DB.fmt !== how) { DB.fmt = how; Store.setFmt(); }
  logSent(PV.kind, ids, PV.title, who);
};

/* ── سجل الإرسالات ──────────────────────────────────────────────
   لقطة لما أُرسِل فعلًا: تعيده بضغطة بلا إعادة تحديد. لا يحفظ العناصر
   نفسها بل معرّفاتها، فما حُذف منها لاحقًا يُستبعَد عند الاسترجاع. */
function logSent(kind, ids, title, who) {
  var rec = { id: uid(), kind: kind, title: title || '', who: who || '',
              ids: ids.slice(), ts: Date.now() };
  DB.sent.unshift(rec);
  DB.sent = DB.sent.slice(0, 10);
  Store.addSent(rec);
}
function renderSentPage() {
  if (!DB.sent.length) {
    h('page', emptyBox('🕘', 'لا إرسالات بعد', 'كل قائمة ترسلها تُحفَظ هنا لتعيدها بضغطة'));
    return;
  }
  var html = '<div class="hint">آخر ' + DB.sent.length + ' قوائم أرسلتها. اضغط أيّها لتفتحه في'
    + ' المعاينة جاهزًا للإرسال من جديد.</div>';
  html += DB.sent.map(function (r) {
    var L = kindLbl(r.kind);
    var live = r.ids.filter(function (id) { return itemById(r.kind, id); });
    var gone = r.ids.length - live.length;
    return '<div class="card"><div class="row">'
      + '<div class="grow" onclick="sentOpen(\'' + r.id + '\')">'
      + '<div class="name">' + L.icon + ' ' + esc(r.title || L.title)
      + (r.who ? ' <span class="chip">' + esc(r.who) + '</span>' : '') + '</div>'
      + '<div class="sub">' + countWord(live.length, L.one, L.two, L.few, L.many)
      + (gone ? ' • ' + gone + ' محذوف' : '') + ' • ' + sentWhen(r.ts) + '</div></div>'
      + '<button class="btn primary sm" onclick="sentOpen(\'' + r.id + '\')">👁️ فتح</button>'
      + '</div></div>';
  }).join('');
  html += '<button class="btn full" onclick="sentClear()">🧹 إفراغ السجل</button>';
  h('page', html);
}
/** تاريخ مختصر — اليوم/أمس ثم التاريخ. */
function sentWhen(ts) {
  var d = new Date(ts), now = new Date();
  var day = 24 * 60 * 60 * 1000;
  var a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  var b = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  var t = d.toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
  if (b === a) return 'اليوم ' + t;
  if (b === a - day) return 'أمس ' + t;
  return d.toLocaleDateString('ar-SA-u-nu-latn');
}
window.sentOpen = function (id) {
  var r = DB.sent.find(function (x) { return x.id === id; });
  if (!r) return;
  var live = r.ids.filter(function (i) { return itemById(r.kind, i); });
  if (!live.length) return toast('عناصر هذه القائمة لم تعد موجودة', 'er');
  openPreview(r.kind, live, r.title, null);
  if (PV) PV.who = r.who || '';
  if (live.length < r.ids.length) toast('بعض العناصر حُذفت — عُرِض الباقي');
  render();
};
window.sentClear = function () {
  dangerBox({
    title: 'إفراغ سجل الإرسالات',
    action: '🧹 أفرِغ السجل',
    keep: 'كل عناصرك ومجموعاتك — لا يُحذف منها شيء',
    lose: [countWord(DB.sent.length, 'إرسالًا واحدًا', 'إرسالين', 'إرسالات', 'إرسالًا')
           + ' من السجل، فلا تعيدها بضغطة بعدها'],
    onYes: function () {
      DB.sent = []; Store.clearSent();
      closeModal(); render(); toast('🧹 أُفرِغ السجل');
    }
  });
};

/** مداخل المعاينة: السلة، ومحرّر المجموعة، ومجموعة محفوظة من القائمة. */
window.previewCart = function (kind) {
  openPreview(kind, DB.cart[kind], cartTitle(kind, false), cartTitle(kind, true));
};
window.groupEditPreview = function () { groupPreview(GRP.id); };
window.groupPreview = function (id) {
  var g = findGroup(id); if (!g) return;
  openPreview(g.kind, g.items, g.name, '📁 ' + g.name);
};

document.addEventListener('DOMContentLoaded', boot);
