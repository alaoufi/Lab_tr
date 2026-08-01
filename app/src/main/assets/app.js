/* ============================================================
   دليلي — أداة شخصية للعلاجات والتحاليل
   كل البيانات محلية على الجهاز فقط — لا خادم ولا إنترنت.
   التخزين داخل التطبيق (APK): قاعدة بيانات SQLite محلية عبر جسر NativeDb.
   عند فتح الملفات في متصفح عادي (بلا الجسر): localStorage كبديل.
   ============================================================ */
'use strict';

var KEY = 'clinic_tool_v1';   /* تخزين الإصدارات السابقة — يُستخدم للترحيل والبديل */
var DB = { pin_hash: null, meds: [], labs: [], cart: { meds: [], labs: [] } };
var NDB = (typeof window.NativeDb === 'object' && window.NativeDb) ? window.NativeDb : null;

function applyData(data) {
  if (!data) return;
  DB.meds = Array.isArray(data.meds) ? data.meds : [];
  DB.labs = Array.isArray(data.labs) ? data.labs : [];
  var c = data.cart || {};
  DB.cart = { meds: Array.isArray(c.meds) ? c.meds : [], labs: Array.isArray(c.labs) ? c.labs : [] };
  DB.pin_hash = data.pin_hash || null;
}
function blobSave() {
  try { localStorage.setItem(KEY, JSON.stringify(DB)); }
  catch (e) { toast('تعذّر الحفظ — الذاكرة ممتلئة؟', 'er'); }
}
function dbFail() { toast('تعذّر الحفظ في قاعدة البيانات', 'er'); return false; }
function snapshot() {
  return { meds: DB.meds, labs: DB.labs, cart: DB.cart, pin_hash: DB.pin_hash };
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
    + '<div class="settings-lbl">النسخ الاحتياطي (يبقى على جهازك فقط)</div>'
    + '<button class="btn full" onclick="exportBackup()">⬇️ تصدير نسخة احتياطية</button>'
    + '<label class="btn full" style="display:block;text-align:center;margin-top:8px;cursor:pointer">⬆️ استيراد نسخة احتياطية'
    + '<input type="file" accept="application/json" onchange="importBackup(this)" style="display:none"></label>'
    + '</div>'
    + '<div class="settings-sec"><div class="settings-lbl">حول</div>'
    + '<div class="muted">جميع بياناتك محفوظة محليًا على هذا الجهاز فقط، ولا تُرسَل لأي خادم مطلقًا.</div></div>'
  );
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
        Store.replaceAll(); closeModal(); renderTabs(); toast('✅ تم الاستيراد');
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
  ['concentration', 'التركيز', false],
  ['dosage', 'الجرعات', false],
  ['duration', 'مدة الاستخدام', false],
  ['uses', 'الاستخدامات', true],
  ['cautions', 'المحاذير', true],
  ['notes', 'ملاحظات', true]
];

function renderMeds() {
  var q = (($('srch') || {}).value || '').trim().toLowerCase();
  var list = DB.meds.filter(function (m) { return !q || (m.trade_name + ' ' + (m.scientific_name || '')).toLowerCase().indexOf(q) >= 0; });
  var cartIds = DB.cart.meds;
  var html = '<div class="toolbar">'
    + '<input id="srch" class="srch-inp" placeholder="🔎 ابحث بالاسم…" value="' + esc(q) + '" oninput="renderMeds()">'
    + '<button class="btn primary" onclick="medForm()">+ إضافة</button></div>';
  if (cartIds.length) html += cartBar('meds', cartIds.length);
  if (!list.length) html += emptyBox('💊', 'لا توجد علاجات محفوظة', 'اضغط «+ إضافة» لتبدأ');
  else list.forEach(function (m) {
    var on = cartIds.indexOf(m.id) >= 0;
    html += '<div class="card' + (on ? ' sel' : '') + '">'
      + '<div class="row">'
      + '<input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="toggleCart(\'meds\',\'' + m.id + '\')">'
      + '<div class="grow" onclick="medForm(\'' + m.id + '\')">'
      + '<div class="name">' + esc(m.trade_name) + (m.default_include ? ' <span class="star">★</span>' : '') + '</div>'
      + (m.scientific_name ? '<div class="sub">' + esc(m.scientific_name) + (m.concentration ? ' • ' + esc(m.concentration) : '') + '</div>' : '')
      + '</div>'
      + '<button class="ic" onclick="medForm(\'' + m.id + '\')">✏️</button>'
      + '<button class="ic" onclick="medDel(\'' + m.id + '\')">🗑️</button>'
      + '</div></div>';
  });
  h('page', html);
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
function renderLabs() {
  var q = (($('srch') || {}).value || '').trim().toLowerCase();
  var cartIds = DB.labs.length ? DB.cart.labs : DB.cart.labs;
  var html = '<div class="toolbar">'
    + '<input id="srch" class="srch-inp" placeholder="🔎 ابحث بالرمز أو الاسم…" value="' + esc(q) + '" oninput="renderLabs()">'
    + '<button class="btn primary" onclick="labForm()">+ إضافة</button></div>';
  if (DB.cart.labs.length) html += cartBar('labs', DB.cart.labs.length);

  var list = DB.labs.filter(function (t) { return !q || ((t.code || '') + ' ' + t.name + ' ' + (t.category || '')).toLowerCase().indexOf(q) >= 0; });
  if (!list.length) { h('page', html + emptyBox('🧪', 'لا توجد تحاليل محفوظة', 'اضغط «+ إضافة» لتبدأ')); return; }

  function row(t) {
    var on = DB.cart.labs.indexOf(t.id) >= 0;
    return '<div class="card' + (on ? ' sel' : '') + '">'
      + '<div class="row">'
      + '<input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="toggleCart(\'labs\',\'' + t.id + '\')">'
      + '<div class="grow" onclick="labForm(\'' + t.id + '\')">'
      + '<div class="name">' + esc(t.code || '') + (t.is_common ? ' <span class="star">★</span>' : '') + '</div>'
      + '<div class="sub">' + esc(t.name) + '</div></div>'
      + '<button class="ic" onclick="labForm(\'' + t.id + '\')">✏️</button>'
      + '<button class="ic" onclick="labDel(\'' + t.id + '\')">🗑️</button>'
      + '</div></div>';
  }
  if (q) {
    html += list.map(row).join('');
  } else {
    var common = list.filter(function (t) { return t.is_common; });
    if (common.length) html += accBlock('⭐ شائعة', common.map(row).join(''), true);
    var cats = Array.from(new Set(list.map(function (t) { return (t.category || 'غير مصنّف').trim(); })));
    cats.forEach(function (c) {
      var items = list.filter(function (t) { return (t.category || 'غير مصنّف').trim() === c; });
      if (items.length) html += accBlock('🧪 ' + c, items.map(row).join(''), false);
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
  var cats = Array.from(new Set(DB.labs.map(function (x) { return (x.category || '').trim(); }).filter(Boolean)));
  var body = '<div class="f"><label>التصنيف</label><input id="lf-category" class="inp" list="cat-list" value="' + esc(t.category || '') + '" placeholder="مثال: كيمياء الدم"></div>'
    + '<datalist id="cat-list">' + cats.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>'
    + '<div class="f"><label>رمز التحليل</label><input id="lf-code" class="inp" dir="ltr" value="' + esc(t.code || '') + '" placeholder="مثال: CBC"></div>'
    + '<div class="f"><label>اسم التحليل *</label><input id="lf-name" class="inp" value="' + esc(t.name || '') + '" placeholder="مثال: صورة دم كاملة"></div>'
    + '<label class="chk-row"><input type="checkbox" id="lf-common" ' + (t.is_common ? 'checked' : '') + '> ⭐ تحليل شائع</label>'
    + '<div class="mft"><button class="btn primary" onclick="labSave(\'' + (id || '') + '\')">حفظ</button><button class="btn" onclick="closeModal()">إلغاء</button></div>';
  openModal(id ? '✏️ تعديل تحليل' : '+ إضافة تحليل', body);
};
window.labSave = function (id) {
  var body = {
    category: ($('lf-category') || {}).value.trim(),
    code: ($('lf-code') || {}).value.trim(),
    name: ($('lf-name') || {}).value.trim(),
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
function cartItemsHtml(kind) {
  if (kind === 'meds') {
    return DB.cart.meds.map(function (id, i) {
      var m = DB.meds.find(function (x) { return x.id === id; }); if (!m) return '';
      var lines = [];
      if (m.concentration) lines.push('التركيز: ' + m.concentration);
      if (m.dosage) lines.push('الجرعات: ' + m.dosage);
      if (m.duration) lines.push('المدة: ' + m.duration);
      if (m.notes) lines.push('ملاحظات: ' + m.notes);
      return '<div class="rx-item"><div class="rx-name">' + (i + 1) + '. ' + esc(m.trade_name) + (m.scientific_name ? ' (' + esc(m.scientific_name) + ')' : '') + '</div>'
        + lines.map(function (l) { return '<div class="rx-f">' + esc(l) + '</div>'; }).join('') + '</div>';
    }).join('');
  }
  return DB.cart.labs.map(function (id, i) {
    var t = DB.labs.find(function (x) { return x.id === id; }); if (!t) return '';
    return '<div class="rx-item"><div class="rx-name">' + (i + 1) + '. ' + esc(t.code ? t.code + ' — ' : '') + esc(t.name) + '</div></div>';
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
function buildCartCanvas(kind) {
  var ids = DB.cart[kind];
  var title = kind === 'meds' ? '💊 قائمة علاجات' : '🧪 قائمة تحاليل';
  var rows = ids.map(function (id, i) {
    if (kind === 'meds') {
      var m = DB.meds.find(function (x) { return x.id === id; }); if (!m) return null;
      var sub = [m.scientific_name, m.concentration].filter(Boolean).join(' • ');
      var extra = [m.dosage ? ('الجرعة: ' + m.dosage) : '', m.duration ? ('المدة: ' + m.duration) : ''].filter(Boolean).join('   |   ');
      return { name: (i + 1) + '. ' + m.trade_name, sub: sub, extra: extra };
    }
    var t = DB.labs.find(function (x) { return x.id === id; }); if (!t) return null;
    return { name: (i + 1) + '. ' + (t.code ? t.code + ' — ' : '') + t.name, sub: t.category || '', extra: '' };
  }).filter(Boolean);

  var W = 900, PAD = 36, rowH = 96, headH = 130;
  var H = headH + rows.length * rowH + PAD;
  var c = document.createElement('canvas'); c.width = W; c.height = H;
  var ctx = c.getContext('2d');
  ctx.fillStyle = '#f0fdfa'; ctx.fillRect(0, 0, W, H);
  // ترويسة
  var grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#075e54'); grad.addColorStop(1, '#0f766e');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, headH);
  ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff'; ctx.font = 'bold 34px Tahoma, Arial, sans-serif';
  ctx.fillText(title, W - PAD, 55);
  ctx.font = '16px Tahoma, Arial, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillText(new Date().toLocaleDateString('ar-SA-u-nu-latn'), W - PAD, 92);
  // الصفوف
  rows.forEach(function (r, i) {
    var y = headH + i * rowH;
    ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#f8fffe';
    ctx.fillRect(PAD / 2, y + 6, W - PAD, rowH - 12);
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1; ctx.strokeRect(PAD / 2, y + 6, W - PAD, rowH - 12);
    ctx.fillStyle = '#0f172a'; ctx.font = 'bold 24px Tahoma, Arial, sans-serif';
    ctx.fillText(r.name, W - PAD - 14, y + 32);
    if (r.sub) { ctx.fillStyle = '#64748b'; ctx.font = '16px Tahoma, Arial, sans-serif'; ctx.fillText(r.sub, W - PAD - 14, y + 60); }
    if (r.extra) { ctx.fillStyle = '#0f766e'; ctx.font = 'bold 15px Tahoma, Arial, sans-serif'; ctx.fillText(r.extra, W - PAD - 14, y + 82); }
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
