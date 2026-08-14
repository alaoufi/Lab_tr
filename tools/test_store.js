/* ============================================================
   اختبارات «دليلي» — تشغّل app.js الحقيقي داخل vm مع جسر NativeDb وهمي
   يحاكي دلالات DaliliDb (جداول منفصلة، سلة مرتّبة، مجموعات).

   التشغيل:  node tools/test_store.js
   لا تحتاج أي حزم خارجية — Node وحده يكفي.
   ============================================================ */
const fs = require('fs');
const vm = require('vm');

// جسر وهمي يحاكي دلالات DaliliDb (جداول منفصلة + سلة مرتّبة)
function makeBridge() {
  const t = { meds: [], labs: [], imaging: [], recipes: [], groups: [],
              cart: { meds: [], labs: [], imaging: [], recipes: [] }, settings: {} };
  const upsert = (table, o) => {
    const i = t[table].findIndex(x => x.id === o.id);
    if (i >= 0) t[table][i] = Object.assign({}, t[table][i], o); else t[table].push(Object.assign({}, o));
    return true;
  };
  return {
    _t: t,
    loadAll: () => JSON.stringify({ meds: t.meds, labs: t.labs, imaging: t.imaging, recipes: t.recipes,
      groups: t.groups, cart: t.cart, settings: t.settings, pin_hash: t.settings.pin_hash }),
    upsertMany: (kind, j) => { JSON.parse(j).forEach(o => upsert(kind, o)); return true; },
    upsertItem: (kind, j) => upsert(kind, JSON.parse(j)),
    deleteItem: (kind, id) => {
      t[kind] = t[kind].filter(x => x.id !== id);
      t.cart[kind] = t.cart[kind].filter(x => x !== id);
      // كما تفعل DaliliDb.delete: تنظيف المجموعات من الإشارات اليتيمة
      t.groups.forEach(g => { if (g.kind === kind) g.items = g.items.filter(x => x !== id); });
      return true;
    },
    setCart: (kind, j) => { t.cart[kind] = JSON.parse(j); return true; },
    saveGroup: j => {
      const g = JSON.parse(j);
      const i = t.groups.findIndex(x => x.id === g.id);
      if (i >= 0) t.groups[i] = g; else t.groups.push(g);
      return true;
    },
    deleteGroup: id => { t.groups = t.groups.filter(g => g.id !== id); return true; },
    setSetting: (k, v) => { if (v === null || v === undefined) delete t.settings[k]; else t.settings[k] = v; return true; },
    replaceAll: j => {
      const d = JSON.parse(j);
      t.meds = d.meds || []; t.labs = d.labs || []; t.imaging = d.imaging || [];
      t.recipes = d.recipes || []; t.groups = d.groups || [];
      t.cart = d.cart || { meds: [], labs: [], imaging: [], recipes: [] };
      if (d.pin_hash) t.settings.pin_hash = d.pin_hash;
      return true;
    },
    isEmpty: () => t.meds.length + t.labs.length + t.imaging.length + t.recipes.length === 0
  };
}

function makeCtx(bridge, legacyRaw) {
  const els = {};
  const el = id => els[id] || (els[id] = { id, value: '', checked: false, className: '', innerHTML: '', textContent: '', style: {} });
  const store = legacyRaw ? { clinic_tool_v1: legacyRaw } : {};
  const win = {
    NativeDb: bridge,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
      removeItem: k => { delete store[k]; }
    },
    _els: el, _store: store,
    document: {
      getElementById: el,
      querySelectorAll: () => [],
      addEventListener: () => {},
      createElement: () => ({ style: {}, click: () => {}, remove: () => {}, getContext: () => null }),
      body: { appendChild: () => {} }
    },
    setTimeout: () => 0, clearTimeout: () => {}, scrollTo: () => {},
    Date, Math, JSON, Array, Object, String, Number, Blob: function () {}, URL: { createObjectURL: () => '' },
    console
  };
  win.window = win;
  win.localStorage = win.localStorage;
  return vm.createContext(win);
}

function run(name, fn) {
  try { fn(); console.log('✓ ' + name); }
  catch (e) { console.log('✗ ' + name + ' → ' + e.message); process.exitCode = 1; }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || '') + ' got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };

const base = require('path').join(__dirname, '..', 'app', 'src', 'main', 'assets') + require('path').sep;
const src = fs.readFileSync(base + 'app.js', 'utf8');
const libSrc = fs.readFileSync(base + 'library.js', 'utf8');
const load = (bridge, legacy) => {
  const c = makeCtx(bridge, legacy);
  vm.runInContext(libSrc, c);
  vm.runInContext(src, c);
  return c;
};

run('CRUD للعلاجات يمرّ عبر قاعدة البيانات', () => {
  const b = makeBridge(); const c = load(b);
  c.Store.load();
  c._els('mf-trade_name').value = 'بنادول';
  c._els('mf-scientific_name').value = 'Paracetamol';
  c.medSave('');
  eq(b._t.meds.length, 1, 'insert:');
  eq(b._t.meds[0].trade_name, 'بنادول');
  const id = b._t.meds[0].id;

  c._els('mf-trade_name').value = 'بنادول إكسترا';
  c.medSave(id);
  eq(b._t.meds.length, 1, 'update must not duplicate:');
  eq(b._t.meds[0].trade_name, 'بنادول إكسترا');

  c.toggleCart('meds', id);
  eq(b._t.cart.meds, [id], 'cart:');

  c.medDel(id); c._els('cb-yes').onclick();
  eq(b._t.meds.length, 0, 'delete:');
  eq(b._t.cart.meds, [], 'cart cleanup:');
});

run('CRUD للتحاليل', () => {
  const b = makeBridge(); const c = load(b);
  c.Store.load();
  c._els('lf-name').value = 'صورة دم كاملة';
  c._els('lf-code').value = 'CBC';
  c._els('lf-category').value = 'أمراض الدم';
  c.labSave('');
  eq(b._t.labs.length, 1);
  eq(b._t.labs[0].code, 'CBC');
  const id = b._t.labs[0].id;
  c.toggleCart('labs', id);
  c.clearCart('labs');
  eq(b._t.cart.labs, []);
  c.labDel(id); c._els('cb-yes').onclick();
  eq(b._t.labs.length, 0);
});

run('البيانات تبقى بعد إعادة تشغيل التطبيق', () => {
  const b = makeBridge(); let c = load(b);
  c.Store.load();
  c._els('mf-trade_name').value = 'أموكسيل'; c.medSave('');
  const id = b._t.meds[0].id;
  c.toggleCart('meds', id);
  c = load(b);              // «إعادة فتح» التطبيق بنفس القاعدة
  c.Store.load();
  eq(c.DB.meds.length, 1, 'reload meds:');
  eq(c.DB.meds[0].trade_name, 'أموكسيل');
  eq(c.DB.cart.meds, [id], 'reload cart:');
});

run('ترحيل بيانات localStorage القديمة مرّة واحدة', () => {
  const legacy = JSON.stringify({
    pin_hash: 'abc', meds: [{ id: 'm1', trade_name: 'قديم' }],
    labs: [{ id: 'l1', name: 'تحليل قديم' }], cart: { meds: ['m1'], labs: [] }
  });
  const b = makeBridge(); const c = load(b, legacy);
  c.Store.load();
  eq(b._t.meds.length, 1, 'migrated meds:');
  eq(b._t.labs.length, 1, 'migrated labs:');
  eq(b._t.cart.meds, ['m1'], 'migrated cart:');
  eq(b._t.settings.pin_hash, 'abc', 'migrated pin:');
  eq(c._store.clinic_tool_v1, undefined, 'legacy key cleared:');
  eq(c.DB.meds[0].trade_name, 'قديم');

  // إقلاع ثانٍ: لا يعيد الترحيل ولا يطمس البيانات
  const c2 = load(b); c2.Store.load();
  eq(b._t.meds.length, 1, 'no double import:');
});

run('الترحيل لا يطمس قاعدة فيها بيانات', () => {
  const b = makeBridge();
  b.upsertItem('meds', JSON.stringify({ id: 'keep', trade_name: 'موجود' }));
  const legacy = JSON.stringify({ meds: [{ id: 'old', trade_name: 'قديم' }], labs: [] });
  const c = load(b, legacy); c.Store.load();
  eq(b._t.meds.map(m => m.id), ['keep'], 'db untouched:');
});

run('قفل PIN يُحفظ ويُزال في جدول الإعدادات', () => {
  const b = makeBridge(); const c = load(b);
  c.Store.load();
  c.DB.pin_hash = 'hash123'; c.Store.setPin('hash123');
  eq(b._t.settings.pin_hash, 'hash123');
  c.removePin(); c._els('cb-yes').onclick();
  eq(b._t.settings.pin_hash, undefined, 'pin removed:');
});

run('استيراد نسخة احتياطية يستبدل الكل وينظّف السلة', () => {
  const b = makeBridge(); const c = load(b);
  c.Store.load();
  c._els('mf-trade_name').value = 'سيُحذف'; c.medSave('');
  c.toggleCart('meds', b._t.meds[0].id);

  const backup = {
    meds: [{ id: 'n1', trade_name: 'جديد' }],
    labs: [{ id: 'n2', name: 'تحليل' }],
    cart: { meds: ['n1', 'مفقود'], labs: [] }
  };
  // نحاكي ما يفعله importBackup بعد قراءة الملف
  const fake = { files: [{}] };
  let onload;
  c.FileReader = function () { return { readAsText() { onload = this.onload; this.result = JSON.stringify(backup); onload.call(this); }, set onload(f) { this._f = f; }, get onload() { return this._f; } }; };
  vm.runInContext('window.FileReader = FileReader;', c);
  c.importBackup(fake);
  c._els('cb-yes').onclick();
  eq(b._t.meds.map(m => m.id), ['n1'], 'imported meds:');
  eq(b._t.labs.map(l => l.id), ['n2'], 'imported labs:');
  eq(b._t.cart.meds, ['n1'], 'stale cart id dropped:');
});

run('يعمل بلا الجسر (متصفح) عبر localStorage', () => {
  const c = makeCtx(null, null); c.NativeDb = undefined; c.window.NativeDb = undefined;
  vm.runInContext(src, c);
  c.Store.load();
  c._els('mf-trade_name').value = 'متصفح'; c.medSave('');
  const saved = JSON.parse(c._store.clinic_tool_v1);
  eq(saved.meds.length, 1, 'localStorage fallback:');
});

run('حقول التحليل الستة تُحفَظ كلها', () => {
  const b = makeBridge(); const c = load(b);
  c.Store.load();
  c._els('lf-category').value = 'أمراض الدم';
  c._els('lf-name').value = 'صورة دم كاملة';
  c._els('lf-code').value = 'CBC';
  c._els('lf-purpose').value = 'تقييم فقر الدم';
  c._els('lf-requirements').value = 'لا يحتاج تحضيرًا';
  c._els('lf-prohibitions').value = 'العيّنة المتخثرة تُفسد النتيجة';
  c.labSave('');
  const t = b._t.labs[0];
  eq(t.category, 'أمراض الدم'); eq(t.code, 'CBC');
  eq(t.purpose, 'تقييم فقر الدم');
  eq(t.requirements, 'لا يحتاج تحضيرًا');
  eq(t.prohibitions, 'العيّنة المتخثرة تُفسد النتيجة');
});

run('الحقول المرسلة: الافتراضي ثم التغيير يبقى بعد إعادة التشغيل', () => {
  const b = makeBridge(); let c = load(b);
  c.Store.load();
  eq(c.DB.out.meds, ['dosage', 'uses'], 'med default:');
  eq(c.DB.out.labs, ['code', 'requirements'], 'lab default:');

  c.toggleOut('meds', 'cautions');          // إضافة
  c.toggleOut('meds', 'dosage');            // إزالة
  eq(JSON.parse(b._t.settings.out_meds), ['uses', 'cautions'], 'saved:');

  c = load(b); c.Store.load();
  eq(c.DB.out.meds, ['uses', 'cautions'], 'after restart:');
});

run('الطباعة تُخرج الحقول المختارة فقط', () => {
  const b = makeBridge(); const c = load(b);
  c.Store.load();
  c._els('mf-trade_name').value = 'بنادول';
  c._els('mf-scientific_name').value = 'Paracetamol';
  c._els('mf-dosage').value = 'قرص كل ٨ ساعات';
  c._els('mf-uses').value = 'خفض الحرارة';
  c._els('mf-cautions').value = 'حذر مع الكبد';
  c.medSave('');
  c.toggleCart('meds', b._t.meds[0].id);

  let rows = c.cartRows('meds');
  eq(rows[0].title, '1. بنادول', 'sci not selected → not in title:');
  eq(rows[0].lines.map(c.lineText), ['الجرعات: قرص كل ٨ ساعات', 'الاستخدامات: خفض الحرارة'], 'default fields:');

  c.toggleOut('meds', 'cautions');
  c.toggleOut('meds', 'scientific_name');
  rows = c.cartRows('meds');
  eq(rows[0].title, '1. بنادول (Paracetamol)', 'sci merged into title:');
  eq(rows[0].lines.length, 3, 'cautions added:');

  c.toggleOut('meds', 'uses');
  eq(c.cartRows('meds')[0].lines.some(l => l.l === 'الاستخدامات'), false, 'uses removed:');
});

run('إخراج التحاليل: الرمز يُدمج مع الاسم والباقي أسطر', () => {
  const b = makeBridge(); const c = load(b);
  c.Store.load();
  c._els('lf-name').value = 'سكر صائم';
  c._els('lf-code').value = 'FBS';
  c._els('lf-purpose').value = 'تشخيص السكري';
  c._els('lf-requirements').value = 'صيام ٨ ساعات';
  c._els('lf-prohibitions').value = 'ممنوع الأكل قبله';
  c.labSave('');
  c.toggleCart('labs', b._t.labs[0].id);

  let r = c.cartRows('labs')[0];
  eq(r.title, '1. FBS — سكر صائم');
  eq(r.lines.map(c.lineText), ['متطلبات التحليل: صيام ٨ ساعات']);

  c.toggleOut('labs', 'purpose');
  c.toggleOut('labs', 'prohibitions');
  r = c.cartRows('labs')[0];
  eq(r.lines.map(c.lineText), ['الهدف من التحليل: تشخيص السكري', 'متطلبات التحليل: صيام ٨ ساعات', 'ممنوعات التحليل: ممنوع الأكل قبله'], 'canonical order:');
});

run('المكتبة الجاهزة: إضافة المحدد إلى قاعدة البيانات', () => {
  const b = makeBridge(); const c = load(b);
  c.Store.load();
  eq(c.LIBRARY.labs.length > 200, true, 'library loaded:');
  const first = c.LIBRARY.labs[0];

  c.openLibrary('labs');
  c.libToggle(0); c.libToggle(3);
  c.libAdd();
  eq(b._t.labs.length, 2, 'added:');
  eq(b._t.labs[0].code, first.code);
  eq(b._t.labs[0].prohibitions, first.prohibitions, 'all fields copied:');
  eq(!!b._t.labs[0].id, true, 'id assigned:');
  eq(c.DB.labs.length, 2, 'in-memory too:');
});

run('المكتبة: البحث يصفّي والموجود مسبقًا يُقفَل', () => {
  const b = makeBridge(); const c = load(b);
  c.Store.load();
  // نضيف CBC أولًا حتى يظهر في المكتبة باهتًا وغير قابل للتحديد
  c.openLibrary('labs');
  const cbc = c.LIBRARY.labs.findIndex(t => t.code === 'CBC');
  c.libToggle(cbc); c.libAdd();
  eq(b._t.labs.length, 1);

  c.openLibrary('labs');
  c._els('lib-q').value = 'CBC';
  c.libRender();
  const html = c._els('lib-list').innerHTML;
  eq(html.indexOf('lib-i have') >= 0, true, 'existing marked:');
  eq(html.indexOf('disabled') >= 0, true, 'existing disabled:');
  eq(html.indexOf('صورة دم كاملة') >= 0, true, 'match shown:');
  eq(html.indexOf('الكرياتينين') < 0, true, 'non-match hidden:');

  c._els('lib-q').value = 'كلمة لا وجود لها';
  c.libRender();
  eq(c._els('lib-list').innerHTML.indexOf('لا نتائج') >= 0, true, 'empty state:');
});

run('المكتبة: البحث يعمل بالعربي والإنجليزي وبالهدف', () => {
  const c = load(makeBridge());
  c.Store.load();
  c.openLibrary('meds');
  c._els('lib-q').value = 'metformin';
  c.libRender();
  eq(c._els('lib-list').innerHTML.indexOf('جلوكوفاج') >= 0, true, 'by scientific name:');

  c._els('lib-q').value = 'مضادات حيوية';
  c.libRender();
  eq(c._els('lib-list').innerHTML.indexOf('أوجمنتين') >= 0, true, 'by category:');
});

run('كل عناصر المكتبة تحمل الحقول المطلوبة', () => {
  const c = load(makeBridge());
  c.LIBRARY.labs.forEach(function (t, i) {
    ['category', 'code', 'name', 'purpose', 'requirements', 'prohibitions'].forEach(function (f) {
      if (!String(t[f] || '').trim()) throw new Error('lab#' + i + ' (' + t.code + ') ينقصه ' + f);
    });
  });
  c.LIBRARY.meds.forEach(function (m, i) {
    ['category', 'trade_name', 'scientific_name', 'uses', 'cautions'].forEach(function (f) {
      if (!String(m[f] || '').trim()) throw new Error('med#' + i + ' (' + m.trade_name + ') ينقصه ' + f);
    });
    if (m.dosage) throw new Error('med#' + i + ' يحمل جرعة — يجب أن تبقى فارغة');
  });
});

run('لا تكرار في مفاتيح المكتبة', () => {
  const c = load(makeBridge());
  ['labs', 'meds'].forEach(function (kind) {
    const seen = {};
    c.LIBRARY[kind].forEach(function (o) {
      const k = kind === 'meds' ? o.trade_name + '|' + o.scientific_name : o.code + '|' + o.name;
      if (seen[k]) throw new Error('مكرر في ' + kind + ': ' + k);
      seen[k] = 1;
    });
  });
});

run('التنقل: رئيسية ← صفحة داخلية ← رجوع', () => {
  const c = load(makeBridge()); c.Store.load(); c.showApp();   // كما يفعل الإقلاع
  eq(c.curPage(), 'home', 'starts home:');
  eq(c._els('hdr-back').style.display, 'none', 'no back arrow on home:');

  c.goPage('meds');
  eq(c.curPage(), 'meds');
  eq(c._els('hdr-back').style.display, '', 'back arrow shown:');
  eq(c._els('hdr-title').innerHTML, 'العلاجات', 'title follows page:');

  c.goBack();
  eq(c.curPage(), 'home', 'back to home:');
  eq(c._els('hdr-back').style.display, 'none');
});

run('التنقل: المكتبة ترجع لمن دخلت منه', () => {
  const c = load(makeBridge()); c.Store.load();
  c.goPage('settings'); c.goPage('lib:labs');
  c.goBack();
  eq(c.curPage(), 'settings', 'from settings → settings:');

  c.goHome(); c.goPage('lib:meds'); c.goBack();
  eq(c.curPage(), 'home', 'from home → home:');
});

run('زر الرجوع في الجهاز: مودال ثم صفحة ثم خروج', () => {
  const c = load(makeBridge()); c.Store.load();
  eq(c.onAndroidBack(), false, 'home + no modal → let app exit:');

  c.goPage('labs');
  c.labForm();                              // يفتح مودالًا
  eq(c._els('modal-bg').className.indexOf('on') >= 0, true, 'modal open:');
  eq(c.onAndroidBack(), true, 'closes modal:');
  eq(c._els('modal-bg').className.indexOf('on') >= 0, false, 'modal closed:');
  eq(c.curPage(), 'labs', 'page unchanged:');

  eq(c.onAndroidBack(), true, 'then goes back a page:');
  eq(c.curPage(), 'home');
  eq(c.onAndroidBack(), false, 'then lets the app exit:');
});

run('الرئيسية تعرض العدّادات والسلة', () => {
  const b = makeBridge(); const c = load(b); c.Store.load();
  c.goPage('meds');
  c._els('mf-trade_name').value = 'بنادول'; c.medSave('');
  c.toggleCart('meds', b._t.meds[0].id);
  c.goHome();
  const html = c._els('page').innerHTML;
  eq(html.indexOf('العلاجات') >= 0, true, 'meds card:');
  eq(html.indexOf('علاج واحد') >= 0, true, 'count shown:');
  eq(html.indexOf('المحدد: عنصر واحد') >= 0, true, 'cart summary:');
});

run('صياغة الأعداد بالعربية', () => {
  const c = load(makeBridge());
  eq(c.countWord(1, 'تحليل واحد', 'تحليلان', 'تحاليل', 'تحليلًا'), 'تحليل واحد');
  eq(c.countWord(2, 'تحليل واحد', 'تحليلان', 'تحاليل', 'تحليلًا'), 'تحليلان');
  eq(c.countWord(3, 'تحليل واحد', 'تحليلان', 'تحاليل', 'تحليلًا'), '3 تحاليل');
  eq(c.countWord(25, 'تحليل واحد', 'تحليلان', 'تحاليل', 'تحليلًا'), '25 تحليلًا');
});

run('الوصفات: حفظ كل الحقول العشرة واسترجاعها', () => {
  const b = makeBridge(); let c = load(b); c.Store.load(); c.showApp();
  c.goPage('recipes');
  const vals = {
    name: 'شراب الزنجبيل والعسل', type: 'وقائية', purpose: 'تهدئة الحلق',
    ingredients: 'زنجبيل طازج، عسل، ليمون', preparation: 'يُغلى الزنجبيل ١٠ دقائق ثم يُضاف العسل',
    usage: 'يُشرب دافئًا', dose: 'كوب', duration: 'حتى تتحسن الأعراض',
    effects: 'تحسّن تدريجي خلال يومين', precautions: 'يُتجنّب العسل تحت سنة'
  };
  Object.keys(vals).forEach(k => { c._els('rf-' + k).value = vals[k]; });
  c._els('rf-fav').checked = true;
  c.recipeSave('');

  eq(b._t.recipes.length, 1, 'saved:');
  Object.keys(vals).forEach(k => eq(b._t.recipes[0][k], vals[k], k + ':'));
  eq(b._t.recipes[0].is_favorite, 1, 'favorite:');

  c = load(b); c.Store.load();
  eq(c.DB.recipes.length, 1, 'survives restart:');
  eq(c.DB.recipes[0].preparation, vals.preparation);
});

run('الوصفات: السلة والحذف والإخراج', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.goPage('recipes');
  c._els('rf-name').value = 'خلطة الحديد';
  c._els('rf-type').value = 'غذائية';
  c._els('rf-ingredients').value = 'تمر وطحينة';
  c._els('rf-preparation').value = 'تُخلط جيدًا';
  c._els('rf-dose').value = 'ملعقة يوميًا';
  c._els('rf-precautions').value = 'حذر لمرضى السكري';
  c.recipeSave('');
  const id = b._t.recipes[0].id;

  c.toggleCart('recipes', id);
  eq(b._t.cart.recipes, [id], 'cart persisted:');

  let r = c.cartRows('recipes')[0];
  eq(r.title, '1. خلطة الحديد', 'title is the name:');
  eq(r.lines.map(c.lineText), ['المواد المستخدمة: تمر وطحينة', 'طريقة الإعداد: تُخلط جيدًا', 'الجرعة: ملعقة يوميًا'], 'default fields:');

  c.toggleOut('recipes', 'precautions');
  eq(c.cartRows('recipes')[0].lines.slice(-1).map(c.lineText), ['الاحتياطات: حذر لمرضى السكري'], 'canonical order:');

  c.recipeDel(id); c._els('cb-yes').onclick();
  eq(b._t.recipes.length, 0, 'deleted:');
  eq(b._t.cart.recipes, [], 'cart cleaned:');
});

run('الرئيسية: ثلاث خدمات بلا مكتبة ولا إضافة سريعة', () => {
  const c = load(makeBridge()); c.Store.load(); c.showApp();
  const html = c._els('page').innerHTML;
  eq(html.indexOf('الوصفات العلاجية') >= 0, true, 'recipes card:');
  eq(html.indexOf('مكتبة العلاجات') < 0, true, 'library moved out:');
  eq(html.indexOf('+ إضافة علاج') < 0, true, 'quick add moved out:');
  eq(html.indexOf('الإعدادات والنسخ الاحتياطي') < 0, true, 'settings row moved out:');

  c.goPage('settings');
  const st = c._els('page').innerHTML;
  eq(st.indexOf('إضافة سريعة') >= 0, true, 'quick add now in settings:');
  eq(st.indexOf('مكتبة العلاجات') >= 0, true, 'library now in settings:');
  eq(st.indexOf('الوصفات') >= 0, true, 'recipe output fields in settings:');
});

run('النسخة الاحتياطية تحمل الوصفات', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.goPage('recipes');
  c._els('rf-name').value = 'وصفة'; c.recipeSave('');
  const snap = c.snapshot();
  eq(snap.recipes.length, 1, 'in snapshot:');
  eq(!!snap.out.recipes, true, 'out fields in snapshot:');
});

run('الطباعة تمر بجسر أندرويد لا بنافذة منبثقة', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.goPage('recipes');
  c._els('rf-name').value = 'شراب الزنجبيل';
  c._els('rf-ingredients').value = 'زنجبيل وعسل';
  c._els('rf-preparation').value = 'يُغلى ثم يُصفّى';
  c._els('rf-dose').value = 'كوب';
  c.recipeSave('');
  c.toggleCart('recipes', b._t.recipes[0].id);

  const jobs = [];
  c.window.AndroidBridge = { printHtml: (html, name) => jobs.push({ html, name }) };
  let opened = false;
  c.window.open = () => { opened = true; return null; };

  c.printCart('recipes');
  eq(jobs.length, 1, 'went through the bridge:');
  eq(opened, false, 'no popup attempted:');
  eq(jobs[0].name, 'قائمة وصفات', 'job name:');
  eq(jobs[0].html.indexOf('شراب الزنجبيل') >= 0, true, 'item in document:');
  eq(jobs[0].html.indexOf('المواد المستخدمة') >= 0, true, 'labels in document:');
  eq(jobs[0].html.indexOf('@page{size:A4') >= 0, true, 'print stylesheet:');
});

run('الطباعة ترفض القائمة الفارغة', () => {
  const c = load(makeBridge()); c.Store.load();
  const jobs = [];
  c.window.AndroidBridge = { printHtml: h => jobs.push(h) };
  c.printCart('recipes');
  eq(jobs.length, 0, 'nothing printed:');
  eq(c._els('toast').textContent, 'القائمة فارغة');
});

// يبني قسم تحاليل صغيرًا للاختبارات التالية
function seedLabs(c, b, names) {
  c.goPage('labs');
  return names.map(n => {
    c._els('lf-name').value = n; c._els('lf-code').value = n;
    c._els('lf-category').value = 'عام';
    c.labSave('');
    return b._t.labs[b._t.labs.length - 1].id;
  });
}

run('المجموعات: إنشاء من التحديد ثم طباعة وإرسال باسمها', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  const ids = seedLabs(c, b, ['CBC', 'FBS', 'TSH']);
  ids.forEach(id => c.toggleCart('labs', id));

  c.goPage('grp:labs');
  c.groupFromCart('labs');
  c._els('gn').value = 'فحوصات ما قبل الجراحة';
  c.groupCreate('labs');

  eq(b._t.groups.length, 1, 'saved to db:');
  eq(b._t.groups[0].name, 'فحوصات ما قبل الجراحة');
  eq(b._t.groups[0].items.length, 3, 'members:');
  eq(c.curPage().indexOf('grp:labs:') === 0, true, 'opened the editor:');

  const jobs = [];
  c.window.AndroidBridge = { printHtml: (html, name) => jobs.push(name) };
  c.groupPrint(b._t.groups[0].id);
  eq(jobs, ['فحوصات ما قبل الجراحة'], 'printed under its own name:');
});

run('المجموعات: تعديل ثم حفظ يثبّت', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  const ids = seedLabs(c, b, ['CBC', 'FBS', 'TSH']);
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'مجموعتي'; c.groupCreate('labs');

  c.GPICK = {};
  c.groupPickToggle(ids[0]); c.groupPickToggle(ids[1]);
  c.groupPickAdd();
  eq(c.GRP.items.length, 2, 'added to the draft:');
  eq(c.GRP.dirty, true, 'marked dirty:');
  eq(b._t.groups[0].items.length, 0, 'db untouched before save:');

  c.groupSave();
  eq(b._t.groups[0].items.length, 2, 'persisted:');
  eq(c.GRP.dirty, false, 'clean after save:');

  c.groupRemove(ids[0]);
  eq(c.GRP.items.length, 1, 'removed from draft:');
  c.groupSave();
  eq(b._t.groups[0].items.length, 1, 'removal persisted:');
});

run('المجموعات: الخروج بلا حفظ يعيدها كما كانت', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  const ids = seedLabs(c, b, ['CBC', 'FBS', 'TSH']);
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'للإرسال فقط'; c.groupCreate('labs');
  c.GPICK = {}; c.groupPickToggle(ids[0]); c.groupPickAdd();
  c.groupSave();                       // الحالة المحفوظة: عنصر واحد

  // تعديل مؤقت للإرسال فقط
  c.GPICK = {}; c.groupPickToggle(ids[1]); c.groupPickToggle(ids[2]); c.groupPickAdd();
  eq(c.GRP.items.length, 3, 'draft has three:');

  const jobs = [];
  c.window.AndroidBridge = { printHtml: (html, name) => jobs.push({ name, html }) };
  c.groupEditPrint();
  eq(jobs[0].html.split('class="rx-item"').length - 1, 3, 'printed the edited list:');

  c.goBack();                          // يسأل عن التعديلات
  c._els('cb-yes').onclick();          // «تجاهل»
  eq(c.curPage(), 'grp:labs', 'left the editor:');
  eq(b._t.groups[0].items.length, 1, 'group reverted to its saved state:');
  eq(c.GRP, null, 'draft dropped:');
});

run('المجموعات: الحذف لا يمسّ التحاليل نفسها', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  const ids = seedLabs(c, b, ['CBC', 'FBS']);
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'مؤقتة'; c.groupCreate('labs');
  c.GPICK = {}; c.groupPickToggle(ids[0]); c.groupPickAdd(); c.groupSave();

  c.groupDelete(); c._els('cb-yes').onclick();
  eq(b._t.groups.length, 0, 'group deleted:');
  eq(b._t.labs.length, 2, 'labs untouched:');
  eq(c.curPage(), 'grp:labs', 'back to the list:');
});

run('المجموعات تبقى بعد إعادة التشغيل وتدخل النسخة الاحتياطية', () => {
  const b = makeBridge(); let c = load(b); c.Store.load(); c.showApp();
  const ids = seedLabs(c, b, ['CBC']);
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'دورية سنوية'; c.groupCreate('labs');
  c.GPICK = {}; c.groupPickToggle(ids[0]); c.groupPickAdd(); c.groupSave();

  eq(c.snapshot().groups.length, 1, 'in backup:');
  c = load(b); c.Store.load();
  eq(c.DB.groups.length, 1, 'survives restart:');
  eq(c.DB.groups[0].name, 'دورية سنوية');
  eq(c.DB.groups[0].items, [ids[0]]);
});

run('القوائم القصيرة تُعرض مفتوحة فتظهر الأسماء', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('recipes');
  ['شراب الزنجبيل', 'منقوع الكمّون'].forEach((n, i) => {
    c._els('rf-name').value = n;
    c._els('rf-type').value = i ? 'علاجية' : 'وقائية';
    c.recipeSave('');
  });
  const html = c._els('page').innerHTML;
  eq(html.indexOf('شراب الزنجبيل') >= 0, true, 'first name visible:');
  eq(html.indexOf('منقوع الكمّون') >= 0, true, 'second name visible:');
  eq(html.indexOf('<details class="acc" open>') >= 0, true, 'groups start open:');
  eq(html.indexOf('وقائية (1)') >= 0, true, 'count in the group title:');
});

// جسر أندرويد وهمي للنسخ الاحتياطي والحافظة والطباعة
function androidStub() {
  const files = {};
  const stub = {
    _files: files, _clip: null, _jobs: [],
    printHtml: (html, name) => stub._jobs.push({ html, name }),
    copyText: t => { stub._clip = t; },
    writeBackup: (json, stamp) => {
      const name = 'dalili-' + stamp + '.json';
      files[name] = json;
      const names = Object.keys(files).sort().reverse();
      names.slice(5).forEach(n => delete files[n]);
      return name;
    },
    listBackups: () => JSON.stringify(Object.keys(files).sort().reverse()
      .map(n => ({ name: n, size: files[n].length, time: 0 }))),
    readBackup: n => files[n] || '',
    deleteBackup: n => { delete files[n]; return true; },
    shareBackup: () => {}
  };
  return stub;
}

run('الأشعة والفحوصات: حفظ الحقول واسترجاعها', () => {
  const b = makeBridge(); let c = load(b); c.Store.load(); c.showApp();
  c.goPage('imaging');
  c._els('if-category').value = 'رنين مغناطيسي';
  c._els('if-name').value = 'رنين العمود القطني';
  c._els('if-region').value = 'العمود القطني';
  c._els('if-purpose').value = 'تقييم الانزلاق الغضروفي';
  c._els('if-requirements').value = 'خلع كل المعادن';
  c._els('if-prohibitions').value = 'منظّم ضربات القلب';
  c._els('if-common').checked = true;
  c.imgSave('');

  const r = b._t.imaging[0];
  eq(b._t.imaging.length, 1, 'saved:');
  eq(r.category, 'رنين مغناطيسي'); eq(r.region, 'العمود القطني');
  eq(r.prohibitions, 'منظّم ضربات القلب'); eq(r.is_common, 1);

  c = load(b); c.Store.load();
  eq(c.DB.imaging.length, 1, 'survives restart:');
});

run('الأشعة: السلة والإخراج والمجموعات', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.goPage('imaging');
  c._els('if-name').value = 'سونار البطن';
  c._els('if-region').value = 'البطن';
  c._els('if-requirements').value = 'صيام ٦ ساعات';
  c.imgSave('');
  const id = b._t.imaging[0].id;
  c.toggleCart('imaging', id);

  const r = c.cartRows('imaging')[0];
  eq(r.title, '1. سونار البطن', 'title:');
  eq(r.lines.map(c.lineText), ['المنطقة أو العضو: البطن', 'التحضير المطلوب: صيام ٦ ساعات'], 'defaults:');
  eq(c.cartTitle('imaging', false), 'طلب أشعة وفحوصات', 'document title:');

  c.goPage('grp:imaging'); c.groupFromCart('imaging');
  c._els('gn').value = 'فحوصات ما قبل العملية'; c.groupCreate('imaging');
  eq(b._t.groups[0].kind, 'imaging', 'group on the new section:');
  eq(b._t.groups[0].items, [id]);
});

run('حذف عنصر ينظّف المجموعات من الإشارات اليتيمة', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  const ids = seedLabs(c, b, ['CBC', 'FBS']);
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'مجموعة'; c.groupCreate('labs');
  c.GPICK = {}; ids.forEach(i => c.groupPickToggle(i)); c.groupPickAdd(); c.groupSave();
  eq(b._t.groups[0].items.length, 2, 'two members:');

  c.goPage('labs');
  c.labDel(ids[0]); c._els('cb-yes').onclick();
  eq(b._t.groups[0].items, [ids[1]], 'orphan removed from the group:');
});

run('ترويسة الطباعة اختيارية: لا تظهر وهي فارغة', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.goPage('labs');
  c._els('lf-name').value = 'CBC'; c.labSave('');
  c.toggleCart('labs', b._t.labs[0].id);
  const A = androidStub(); c.window.AndroidBridge = A;

  eq(c.DB.header, { name: '', title: '', contact: '' }, 'starts empty:');
  c.printCart('labs');
  eq(A._jobs[0].html.indexOf('class="lh"') < 0, true, 'no letterhead block:');

  c._els('hd-name').value = 'د. محمد';
  c._els('hd-title').value = 'استشاري باطنية';
  c._els('hd-contact').value = '0500000000';
  c.saveHeader();
  eq(b._t.settings.hdr_name, 'د. محمد', 'persisted:');

  c.printCart('labs');
  const html = A._jobs[1].html;
  eq(html.indexOf('د. محمد') >= 0, true, 'name printed:');
  eq(html.indexOf('استشاري باطنية') >= 0, true, 'title printed:');

  c.clearHeader();
  c.printCart('labs');
  eq(A._jobs[2].html.indexOf('class="lh"') < 0, true, 'cleared again:');
});

run('نسخ القائمة كنص', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.goPage('labs');
  c._els('lf-name').value = 'سكر صائم'; c._els('lf-code').value = 'FBS';
  c._els('lf-requirements').value = 'صيام ٨ ساعات';
  c.labSave('');
  c.toggleCart('labs', b._t.labs[0].id);
  const A = androidStub(); c.window.AndroidBridge = A;

  c.copyCart('labs');
  eq(A._clip.indexOf('FBS — سكر صائم') >= 0, true, 'item in text:');
  eq(A._clip.indexOf('• متطلبات التحليل: صيام ٨ ساعات') >= 0, true, 'field in text:');
  eq(A._clip.indexOf('<') < 0, true, 'plain text, no markup:');

  c.clearCart('labs');
  A._clip = null;
  c.copyCart('labs');
  eq(A._clip, null, 'empty list is refused:');
});

run('النسخ الاحتياطي التلقائي: يكتب ويقيّد ويستعيد', () => {
  const b = makeBridge(); let c = load(b);
  const A = androidStub(); c.window.AndroidBridge = A;
  vm.runInContext('AB = window.AndroidBridge;', c);   // كما لو كان موجودًا عند الإقلاع
  c.Store.load(); c.showApp();

  eq(c.autoBackup(false), false, 'no backup when there is no data:');

  c.goPage('labs');
  c._els('lf-name').value = 'CBC'; c.labSave('');
  const name = c.autoBackup(false);
  eq(!!name, true, 'wrote a backup:');
  eq(b._t.settings.backup_at > 0, true, 'timestamp persisted:');
  eq(c.autoBackup(false), false, 'does not repeat within the day:');

  // ٧ كتابات يدوية ⇒ تبقى ٥ فقط
  for (let i = 0; i < 7; i++) A.writeBackup('{}', '2026-01-0' + (i + 1) + '-1200');
  eq(Object.keys(A._files).length <= 5, true, 'keeps only the newest five:');

  // استعادة من نسخة تحمل بيانات مختلفة
  A._files['dalili-2026-02-01-1200.json'] = JSON.stringify({
    labs: [{ id: 'x1', name: 'مستعاد' }], meds: [], imaging: [], recipes: [],
    cart: { meds: [], labs: [], imaging: [], recipes: [] }, groups: []
  });
  c.backupRestore('dalili-2026-02-01-1200.json');
  c._els('cb-yes').onclick();
  eq(c.DB.labs.map(l => l.name), ['مستعاد'], 'restored in memory:');
  eq(b._t.labs.map(l => l.name), ['مستعاد'], 'restored in db:');
});

run('كل عناصر مكتبة الأشعة مكتملة وبلا تكرار', () => {
  const c = load(makeBridge());
  const seen = {};
  c.LIBRARY.imaging.forEach(function (o, i) {
    ['category', 'name', 'region', 'purpose', 'requirements', 'prohibitions'].forEach(function (f) {
      if (!String(o[f] || '').trim()) throw new Error('imaging#' + i + ' (' + o.name + ') ينقصه ' + f);
    });
    const k = o.name + '|' + o.region;
    if (seen[k]) throw new Error('مكرر: ' + k);
    seen[k] = 1;
  });
  eq(c.LIBRARY.imaging.length > 60, true, 'library size:');
});

run('المكتبة الجاهزة تضيف للقسم الصحيح لا لغيره', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.openLibrary('imaging');
  c.libToggle(0); c.libToggle(1);
  c.libAdd();
  eq(b._t.imaging.length, 2, 'reached the db:');
  eq(c.DB.imaging.length, 2, 'reached memory too:');
  eq(c.DB.labs.length, 0, 'did not leak into labs:');
  eq(c.DB.meds.length, 0, 'did not leak into meds:');
  eq(!!b._t.imaging[0].region, true, 'region copied:');

  // والموجود مسبقًا يُقفَل عند إعادة فتح المكتبة
  c.openLibrary('imaging');
  eq(Object.keys(c.LIB_MINE).length, 2, 'existing items recognised:');
});
