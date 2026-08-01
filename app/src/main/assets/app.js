/* ============================================================
   دليلي — أداة شخصية للعلاجات والتحاليل
   كل البيانات محلية على الجهاز فقط — لا خادم ولا إنترنت.
   التخزين داخل التطبيق (APK): قاعدة بيانات SQLite محلية عبر جسر NativeDb.
   عند فتح الملفات في متصفح عادي (بلا الجسر): localStorage كبديل.
   ============================================================ */
'use strict';

var KEY = 'clinic_tool_v1';   /* تخزين الإصدارات السابقة — يُستخدم للترحيل والبديل */
var DB = { pin_hash: null, meds: [], labs: [], cart: { meds: [], labs: [] }, out: null };

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
var OUT_DEF = { meds: ['dosage', 'uses'], labs: ['code', 'requirements'] };
var NDB = (typeof window.NativeDb === 'object' && window.NativeDb) ? window.NativeDb : null;

function parseList(raw, fallback) {
  if (Array.isArray(raw)) return raw.slice();
  try { var v = JSON.parse(raw); return Array.isArray(v) ? v : fallback.slice(); }
  catch (e) { return fallback.slice(); }
}
function applyData(data) {
  if (!data) return;
  DB.meds = Array.isArray(data.meds) ? data.meds : [];
  DB.labs = Array.isArray(data.labs) ? data.labs : [];
  var c = data.cart || {};
  DB.cart = { meds: Array.isArray(c.meds) ? c.meds : [], labs: Array.isArray(c.labs) ? c.labs : [] };
  DB.pin_hash = data.pin_hash || null;
  // الحقول المرسلة: من جدول الإعدادات داخل التطبيق، أو من النسخة المحفوظة
  // كاملةً في المتصفح/النسخة الاحتياطية
  var st = data.settings || {}, o = data.out || {};
  DB.out = {
    meds: parseList(o.meds || st.out_meds, OUT_DEF.meds),
    labs: parseList(o.labs || st.out_labs, OUT_DEF.labs)
  };
}
function blobSave() {
  try { localStorage.setItem(KEY, JSON.stringify(DB)); }
  catch (e) { toast('تعذّر الحفظ — الذاكرة ممتلئة؟', 'er'); }
}
function dbFail() { toast('تعذّر الحفظ في قاعدة البيانات', 'er'); return false; }
function snapshot() {
  return { meds: DB.meds, labs: DB.labs, cart: DB.cart, pin_hash: DB.pin_hash, out: DB.out };
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

  upsertMed: function (m) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.upsertMed(JSON.stringify(m)) || dbFail(); } catch (e) { return dbFail(); }
  },
  upsertLab: function (t) {
    if (!NDB) { blobSave(); return true; }
    try { return NDB.upsertLab(JSON.stringify(t)) || dbFail(); } catch (e) { return dbFail(); }
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

/* ── قفل PIN محلي (SHA-256 عبر Web Crypto المدمجة — بلا مكتبات) ── */
async function sha256(text) {
  var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}
var TAB = 'meds';

async function boot() {
  Store.load();
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
  renderTabs();
}

/* ── إعدادات: تعيين/تغيير/إزالة رمز القفل + نسخ احتياطي ── */
window.openSettings = function () {
  var hasPin = !!DB.pin_hash;
  openModal('⚙️ الإعدادات',
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
    + '</div>'
    + '<div class="settings-sec">'
    + '<div class="settings-lbl">المكتبة الجاهزة (مدمجة داخل التطبيق)</div>'
    + '<button class="btn full" onclick="openLibrary(\'labs\')">🧪 إضافة من مكتبة التحاليل</button>'
    + '<button class="btn full" onclick="openLibrary(\'meds\')">💊 إضافة من مكتبة العلاجات</button>'
    + '</div>'
    + '<div class="settings-sec">'
    + '<div class="settings-lbl">النسخ الاحتياطي (يبقى على جهازك فقط)</div>'
    + '<button class="btn full" onclick="exportBackup()">⬇️ تصدير نسخة احتياطية</button>'
    + '<label class="btn full" style="display:block;text-align:center;margin-top:8px;cursor:pointer">⬆️ استيراد نسخة احتياطية'
    + '<input type="file" accept="application/json" onchange="importBackup(this)" style="display:none"></label>'
    + '</div>'
    + '<div class="settings-sec"><div class="settings-lbl">حول</div>'
    + '<div class="muted">جميع بياناتك محفوظة محليًا على هذا الجهاز فقط، ولا تُرسَل لأي خادم مطلقًا.</div></div>'
  );
};
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

/* ── المكتبة الجاهزة: نسخ عناصر مصنّفة إلى قاعدة بيانات المستخدم ── */
var LIB_SEL = {};
function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
function libKey(kind, o) {
  return kind === 'meds'
    ? norm(o.trade_name) + '|' + norm(o.scientific_name)
    : norm(o.code) + '|' + norm(o.name);
}
window.openLibrary = function (kind) {
  var lib = (window.LIBRARY || {})[kind] || [];
  if (!lib.length) return toast('المكتبة غير متوفرة', 'er');
  LIB_SEL = {};
  var mine = {};
  (kind === 'meds' ? DB.meds : DB.labs).forEach(function (o) { mine[libKey(kind, o)] = 1; });

  var cats = [];
  lib.forEach(function (o) { if (cats.indexOf(o.category) < 0) cats.push(o.category); });

  var body = '<div class="lib-bar">'
    + '<button class="btn primary full" style="margin:0" onclick="libAdd(\'' + kind + '\')">'
    + '➕ إضافة المحدد (<span id="lib-n">0</span>)</button>'
    + '<div class="muted" style="margin-top:7px">العناصر الباهتة مضافة عندك مسبقًا.'
    + (kind === 'meds' ? ' الجرعات فارغة عمدًا — أضِفها بنفسك بعد الإضافة.' : '') + '</div></div>';

  cats.forEach(function (cat, ci) {
    var inner = '<div style="padding:4px 6px 8px"><button class="btn sm" onclick="libAll(\'' + kind + '\',' + ci + ')">تحديد كل التصنيف</button></div>';
    lib.forEach(function (o, i) {
      if (o.category !== cat) return;
      var have = !!mine[libKey(kind, o)];
      var nm = kind === 'meds' ? o.trade_name : (o.code ? o.code + ' — ' + o.name : o.name);
      var sub = kind === 'meds' ? (o.scientific_name || '') : (o.purpose || o.requirements || '');
      inner += '<label class="lib-i' + (have ? ' have' : '') + '" data-cat="' + ci + '">'
        + '<input type="checkbox" id="lib-c-' + i + '"' + (have ? ' disabled' : '')
        + ' onchange="libToggle(\'' + kind + '\',' + i + ')">'
        + '<span><span class="lib-t">' + esc(nm) + '</span>'
        + (sub ? '<span class="lib-s"><br>' + esc(sub) + '</span>' : '') + '</span></label>';
    });
    body += accBlock('📁 ' + cat, inner, false);
  });
  openModal(kind === 'meds' ? '📚 مكتبة العلاجات' : '📚 مكتبة التحاليل', body);
};
window.libToggle = function (kind, i) {
  if (LIB_SEL[i]) delete LIB_SEL[i]; else LIB_SEL[i] = 1;
  var e = $('lib-n'); if (e) e.textContent = Object.keys(LIB_SEL).length;
};
window.libAll = function (kind, ci) {
  var boxes = document.querySelectorAll('.lib-i[data-cat="' + ci + '"] input:not([disabled])');
  for (var k = 0; k < boxes.length; k++) {
    boxes[k].checked = true;
    LIB_SEL[parseInt(boxes[k].id.slice(6), 10)] = 1;
  }
  var e = $('lib-n'); if (e) e.textContent = Object.keys(LIB_SEL).length;
};
window.libAdd = function (kind) {
  var lib = (window.LIBRARY || {})[kind] || [];
  var items = Object.keys(LIB_SEL).map(function (k) {
    var src = lib[parseInt(k, 10)]; if (!src) return null;
    var o = {}; for (var f in src) if (Object.prototype.hasOwnProperty.call(src, f)) o[f] = src[f];
    o.id = uid();
    return o;
  }).filter(Boolean);
  if (!items.length) return toast('لم تحدد شيئًا بعد', 'er');
  if (kind === 'meds') DB.meds = DB.meds.concat(items); else DB.labs = DB.labs.concat(items);
  Store.addMany(kind, items);
  LIB_SEL = {}; closeModal(); renderTabs();
  toast('✅ أُضيف ' + items.length + (kind === 'meds' ? ' علاجًا' : ' تحليلًا'));
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
      if (!data || (!Array.isArray(data.meds) && !Array.isArray(data.labs))) throw new Error('bad');
      confirmBox('استيراد هذه النسخة سيستبدل بياناتك الحالية. متابعة؟', function () {
        var keep = DB.pin_hash;
        applyData(data);
        DB.pin_hash = data.pin_hash || keep;
        // السلة تشير لمعرّفات قد تكون اختفت في النسخة المستوردة
        DB.cart.meds = DB.cart.meds.filter(function (id) { return DB.meds.some(function (m) { return m.id === id; }); });
        DB.cart.labs = DB.cart.labs.filter(function (id) { return DB.labs.some(function (t) { return t.id === id; }); });
        Store.replaceAll(); Store.setOut('meds'); Store.setOut('labs');
        closeModal(); renderTabs(); toast('✅ تم الاستيراد');
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

/* ── التبويبات ── */
window.goTab = function (t) { TAB = t; renderTabs(); };
function renderTabs() {
  h('tabbar', ['meds', 'labs'].map(function (t) {
    var lbl = t === 'meds' ? '💊 العلاجات' : '🧪 التحاليل';
    return '<button class="tab' + (TAB === t ? ' on' : '') + '" onclick="goTab(\'' + t + '\')">' + lbl + '</button>';
  }).join(''));
  if (TAB === 'meds') renderMeds(); else renderLabs();
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
  var html = '<div class="toolbar">'
    + '<input id="srch" class="srch-inp" placeholder="🔎 ابحث بالاسم أو التصنيف…" value="' + esc(q) + '" oninput="renderMeds()">'
    + '<button class="btn primary" onclick="medForm()">+ إضافة</button></div>';
  if (DB.cart.meds.length) html += cartBar('meds', DB.cart.meds.length);
  if (!list.length) { h('page', html + emptyBox('💊', 'لا توجد علاجات محفوظة', 'أضِف واحدًا، أو استورد من المكتبة الجاهزة في ⚙️')); return; }

  if (q) {
    html += list.map(medRow).join('');
  } else {
    var fav = list.filter(function (m) { return m.default_include; });
    if (fav.length) html += accBlock('⭐ افتراضية', fav.map(medRow).join(''), true);
    groupBy(list).forEach(function (g) {
      html += accBlock('💊 ' + g.cat, g.items.map(medRow).join(''), false);
    });
  }
  h('page', html);
}
/** تجميع العناصر حسب التصنيف مع الحفاظ على ترتيب ظهور التصنيفات. */
function groupBy(list) {
  var order = [], byCat = {};
  list.forEach(function (o) {
    var c = (o.category || 'غير مصنّف').trim() || 'غير مصنّف';
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
    + '<button class="btn ghost sm" onclick="clearCart(\'' + kind + '\')">مسح</button>'
    + '</div>';
}
window.toggleCart = function (kind, id) {
  var arr = DB.cart[kind]; var i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1); else arr.push(id);
  Store.setCart(kind); renderTabs();
};
window.clearCart = function (kind) { DB.cart[kind] = []; Store.setCart(kind); renderTabs(); };

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
  Store.upsertMed(rec); closeModal(); toast('✅ تم الحفظ'); renderTabs();
};
window.medDel = function (id) {
  confirmBox('حذف هذا العلاج؟', function () {
    DB.meds = DB.meds.filter(function (x) { return x.id !== id; });
    DB.cart.meds = DB.cart.meds.filter(function (x) { return x !== id; });
    Store.remove('meds', id); closeModal(); toast('🗑️ تم الحذف'); renderTabs();
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
  var html = '<div class="toolbar">'
    + '<input id="srch" class="srch-inp" placeholder="🔎 ابحث بالرمز أو الاسم أو التخصص…" value="' + esc(q) + '" oninput="renderLabs()">'
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
    groupBy(list).forEach(function (g) {
      html += accBlock('🧪 ' + g.cat, g.items.map(labRow).join(''), false);
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
  Store.upsertLab(rec); closeModal(); toast('✅ تم الحفظ'); renderTabs();
};
window.labDel = function (id) {
  confirmBox('حذف هذا التحليل؟', function () {
    DB.labs = DB.labs.filter(function (x) { return x.id !== id; });
    DB.cart.labs = DB.cart.labs.filter(function (x) { return x !== id; });
    Store.remove('labs', id); closeModal(); toast('🗑️ تم الحذف'); renderTabs();
  });
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
  return (i + 1) + '. ' + (sel.indexOf('code') >= 0 && o.code ? o.code + ' — ' : '') + o.name;
}
function outLines(kind, o) {
  var defs = kind === 'meds' ? OUT_MEDS : OUT_LABS;
  var merged = kind === 'meds' ? 'scientific_name' : 'code';
  var sel = DB.out[kind], lines = [];
  defs.forEach(function (f) {
    if (f[0] === merged || sel.indexOf(f[0]) < 0) return;
    var v = String(o[f[0]] == null ? '' : o[f[0]]).trim();
    if (v) lines.push(f[1] + ': ' + v);
  });
  return lines;
}
function cartRows(kind) {
  var src = kind === 'meds' ? DB.meds : DB.labs;
  return DB.cart[kind].map(function (id, i) {
    var o = src.find(function (x) { return x.id === id; });
    return o ? { title: outTitle(kind, o, i), lines: outLines(kind, o) } : null;
  }).filter(Boolean);
}
function cartItemsHtml(kind) {
  return cartRows(kind).map(function (r) {
    return '<div class="rx-item"><div class="rx-name">' + esc(r.title) + '</div>'
      + r.lines.map(function (l) { return '<div class="rx-f">' + esc(l) + '</div>'; }).join('') + '</div>';
  }).join('');
}
window.printCart = function (kind) {
  var body = cartItemsHtml(kind);
  if (!body) return toast('القائمة فارغة', 'er');
  var title = kind === 'meds' ? 'قائمة علاجات' : 'قائمة تحاليل';
  var w = window.open('', '_blank');
  if (!w) return toast('اسمح بالنوافذ المنبثقة', 'er');
  w.document.write('<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>' + title + '</title>'
    + '<style>*{font-family:Tahoma,Arial,sans-serif;box-sizing:border-box}body{padding:26px;color:#0f172a}'
    + 'h1{font-size:20px;color:#075e54;margin:0 0 4px}.sub{color:#64748b;font-size:12px;margin-bottom:16px;border-bottom:2px solid #0f766e;padding-bottom:10px}'
    + '.rx-item{border:1px solid #e2e8f0;border-radius:10px;padding:11px 13px;margin-bottom:10px;page-break-inside:avoid}'
    + '.rx-name{font-weight:800;font-size:15px;color:#0f766e;margin-bottom:4px}.rx-f{font-size:13px;margin:2px 0}</style></head><body>'
    + '<h1>' + title + '</h1><div class="sub">' + new Date().toLocaleDateString('ar-SA-u-nu-latn') + '</div>'
    + body + '<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},400);};<' + '/script></body></html>');
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
function buildCartCanvas(kind) {
  var title = kind === 'meds' ? '💊 قائمة علاجات' : '🧪 قائمة تحاليل';
  var W = 900, PAD = 36, headH = 130, MAXW = W - PAD * 2 - 28;
  var TITLE_F = 'bold 24px Tahoma, Arial, sans-serif';
  var LINE_F = '17px Tahoma, Arial, sans-serif';

  var c = document.createElement('canvas');
  var ctx = c.getContext('2d');

  // قياس أولًا لمعرفة الارتفاع المطلوب، ثم تحديد أبعاد اللوحة ورسمها
  var rows = cartRows(kind).map(function (r) {
    ctx.font = TITLE_F;
    var titleLines = wrapText(ctx, r.title, MAXW);
    ctx.font = LINE_F;
    var lines = [];
    r.lines.forEach(function (l) { lines = lines.concat(wrapText(ctx, l, MAXW)); });
    return { titleLines: titleLines, lines: lines, h: 26 + titleLines.length * 32 + lines.length * 26 };
  });

  var H = headH + rows.reduce(function (a, r) { return a + r.h; }, 0) + PAD;
  c.width = W; c.height = H;
  ctx = c.getContext('2d');
  ctx.fillStyle = '#f0fdfa'; ctx.fillRect(0, 0, W, H);

  var grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#075e54'); grad.addColorStop(1, '#0f766e');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, headH);
  ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff'; ctx.font = 'bold 34px Tahoma, Arial, sans-serif';
  ctx.fillText(title, W - PAD, 55);
  ctx.font = '16px Tahoma, Arial, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillText(new Date().toLocaleDateString('ar-SA-u-nu-latn'), W - PAD, 92);

  var y = headH;
  rows.forEach(function (r, i) {
    ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#f8fffe';
    ctx.fillRect(PAD / 2, y + 6, W - PAD, r.h - 12);
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
    ctx.strokeRect(PAD / 2, y + 6, W - PAD, r.h - 12);

    var ty = y + 30;
    ctx.fillStyle = '#0f172a'; ctx.font = TITLE_F;
    r.titleLines.forEach(function (t) { ctx.fillText(t, W - PAD - 14, ty); ty += 32; });
    ctx.fillStyle = '#0f766e'; ctx.font = LINE_F;
    r.lines.forEach(function (l) { ctx.fillText(l, W - PAD - 14, ty); ty += 26; });
    y += r.h;
  });
  return c;
}
window.shareCart = function (kind) {
  var ids = DB.cart[kind]; if (!ids.length) return toast('القائمة فارغة', 'er');
  var canvas = buildCartCanvas(kind);
  var fname = (kind === 'meds' ? 'قائمة_علاجات' : 'قائمة_تحاليل') + '_' + new Date().toISOString().slice(0, 10) + '.png';

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
