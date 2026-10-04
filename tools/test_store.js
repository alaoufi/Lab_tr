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
  const t = { meds: [], labs: [], imaging: [], recipes: [], groups: [], cats: [],
              sections: [], fields: [], items: [], sent: [], images: [],
              cart: { meds: [], labs: [], imaging: [], recipes: [] }, settings: {} };
  // عناصر الأقسام التي ينشئها المستخدم تعيش في items كما في DaliliDb
  const isCustom = k => !['meds', 'labs', 'imaging', 'recipes'].includes(k);
  const rows = k => (isCustom(k) ? t.items.filter(o => o.section === k) : t[k]);
  const upsert = (table, o) => {
    if (isCustom(table)) {
      const rec = Object.assign({}, o, { section: table });
      const j = t.items.findIndex(x => x.id === o.id);
      if (j >= 0) t.items[j] = Object.assign({}, t.items[j], rec); else t.items.push(rec);
      return true;
    }
    const i = t[table].findIndex(x => x.id === o.id);
    if (i >= 0) t[table][i] = Object.assign({}, t[table][i], o); else t[table].push(Object.assign({}, o));
    return true;
  };
  const orders = {};              // آخر ترتيب وصل لكل جدول — للتحقّق في الاختبارات
  return {
    _t: t, _order: orders,
    loadAll: () => {
      const out = { meds: t.meds, labs: t.labs, imaging: t.imaging, recipes: t.recipes,
        groups: t.groups, cats: t.cats, sections: t.sections, fields: t.fields,
        sent: t.sent, images: t.images, cart: t.cart, settings: t.settings,
        pin_hash: t.settings.pin_hash };
      t.sections.filter(s => isCustom(s.id)).forEach(s => { out[s.id] = rows(s.id); });
      return JSON.stringify(out);
    },
    upsertMany: (kind, j) => { JSON.parse(j).forEach(o => upsert(kind, o)); return true; },
    upsertItem: (kind, j) => upsert(kind, JSON.parse(j)),
    deleteItem: (kind, id) => {
      if (isCustom(kind)) t.items = t.items.filter(x => !(x.id === id && x.section === kind));
      else t[kind] = t[kind].filter(x => x.id !== id);
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
    // كما في DaliliDb: يكتب ثم **يتحقّق بقراءة** قبل أن يقول «نجح»
    setItemOrder: (kind, j) => {
      const ids = JSON.parse(j);
      const rows = isCustom(kind) ? t.items.filter(o => o.section === kind) : t[kind];
      ids.forEach((id, i) => { const o = rows.find(x => x.id === id); if (o) o.sort_order = i + 1; });
      const rank = o => (o.sort_order === undefined ? 1e9 : o.sort_order);
      if (isCustom(kind)) t.items.sort((a, b2) => rank(a) - rank(b2));
      else t[kind].sort((a, b2) => rank(a) - rank(b2));
      orders[kind] = ids;
      return ids.every((id, i) => {
        const o = rows.find(x => x.id === id);
        return !!o && o.sort_order === i + 1;
      });
    },
    setGroupOrder: j => {
      const ids = JSON.parse(j);
      t.groups.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      orders.groups = ids;
      return true;
    },
    // التصنيفات — بنفس دلالات DaliliDb: الربط بالاسم، والنقل تحديث واحد
    saveCat: j => {
      const c = JSON.parse(j);
      const i = t.cats.findIndex(x => x.id === c.id);
      if (i >= 0) t.cats[i] = Object.assign({}, t.cats[i], c); else t.cats.push(Object.assign({}, c));
      return true;
    },
    deleteCat: id => { t.cats = t.cats.filter(c => c.id !== id); return true; },
    moveCatItems: (kind, from, to) => {
      rows(kind).forEach(o => { if ((o.category || '') === from) o.category = to || ''; });
      return true;
    },
    // سجل الإرسالات — الأحدث أولًا، ويُقصّ على عشرة كما في DaliliDb
    addSent: j => {
      t.sent.unshift(JSON.parse(j));
      t.sent = t.sent.slice(0, 10);
      return true;
    },
    clearSent: () => { t.sent = []; return true; },
    saveImage: j => {
      const im = JSON.parse(j);
      const i = t.images.findIndex(x => x.id === im.id);
      if (i >= 0) t.images[i] = Object.assign({}, t.images[i], im); else t.images.push(im);
      return true;
    },
    deleteImage: id => { t.images = t.images.filter(x => x.id !== id); return true; },
    saveSection: j => {
      const sec = JSON.parse(j);
      const i = t.sections.findIndex(x => x.id === sec.id);
      if (i >= 0) t.sections[i] = Object.assign({}, t.sections[i], sec);
      else t.sections.push(Object.assign({}, sec));
      return true;
    },
    deleteSection: id => {
      t.sections = t.sections.filter(s => s.id !== id);
      t.items = t.items.filter(o => o.section !== id);
      t.fields = t.fields.filter(f => f.kind !== id);
      t.cats = t.cats.filter(c => c.kind !== id);
      t.groups = t.groups.filter(g => g.kind !== id);
      delete t.cart[id];
      return true;
    },
    setSectionOrder: j => {
      const ids = JSON.parse(j);
      t.sections.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      return true;
    },
    saveField: j => {
      const f = JSON.parse(j);
      const i = t.fields.findIndex(x => x.id === f.id);
      if (i >= 0) t.fields[i] = Object.assign({}, t.fields[i], f); else t.fields.push(Object.assign({}, f));
      return true;
    },
    deleteField: id => { t.fields = t.fields.filter(f => f.id !== id); return true; },
    setFieldOrder: j => {
      const ids = JSON.parse(j);
      t.fields.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      return true;
    },
    setCatOrder: j => {
      const ids = JSON.parse(j);
      t.cats.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      return true;
    },
    setSetting: (k, v) => { if (v === null || v === undefined) delete t.settings[k]; else t.settings[k] = v; return true; },
    replaceAll: j => {
      const d = JSON.parse(j);
      t.meds = d.meds || []; t.labs = d.labs || []; t.imaging = d.imaging || [];
      t.recipes = d.recipes || []; t.groups = d.groups || []; t.cats = d.cats || [];
      t.sections = d.sections || []; t.fields = d.fields || []; t.sent = d.sent || [];
      t.images = d.images || [];
      t.items = [];
      t.sections.filter(s => isCustom(s.id)).forEach(s => {
        (d[s.id] || []).forEach(o => t.items.push(Object.assign({}, o, { section: s.id })));
      });
      t.cart = d.cart || { meds: [], labs: [], imaging: [], recipes: [] };
      if (d.pin_hash) t.settings.pin_hash = d.pin_hash;
      return true;
    },
    // كما في DaliliDb.isEmpty: تعدّ كذلك عناصر أقسام المستخدم وصوره وتصنيفاته
    isEmpty: () => t.meds.length + t.labs.length + t.imaging.length + t.recipes.length
      + t.items.length + t.images.length + t.cats.length + t.groups.length
      + t.sections.filter(s => !s.builtin).length === 0
  };
}

/** جسر تفشل قراءته — كما تفعل DbBridge حين يتعذّر فتح القاعدة أو قراءتها. */
function brokenBridge(mode) {
  const b = makeBridge();
  b.loadAll = () => {
    if (mode === 'throw') throw new Error('no such column: extra');
    if (mode === 'empty') return '';
    return JSON.stringify({ load_failed: true, message: 'no such column: extra' });
  };
  return b;
}

function makeCtx(bridge, legacyRaw) {
  const els = {};
  const el = id => els[id] || (els[id] = {
    id, value: '', checked: false, className: '', innerHTML: '', textContent: '',
    style: {}, scrollHeight: 0, focus() {},
    insertAdjacentHTML(where, html) { this.innerHTML += html; }
  });
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
      // لوحة رسم مصغّرة تكفي buildCanvas: القياس ثم الرسم ثم إخراج الصورة
      createElement: tag => tag === 'canvas'
        ? { width: 0, height: 0, style: {},
            getContext: () => ({
              font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
              direction: '', textAlign: '', textBaseline: '',
              measureText: t => ({ width: String(t).length * 8 }),
              fillText() {}, fillRect() {}, strokeRect() {},
              createLinearGradient: () => ({ addColorStop() {} })
            }),
            toDataURL: () => 'data:image/png;base64,STUB' }
        : { style: {}, click: () => {}, remove: () => {}, getContext: () => null },
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
  c.clearCart('labs'); c._els('cb-yes').onclick();
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
  c._els('dz-in').value = 'استبدال'; c.dzCheck();
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
  eq(rows[0].title, 'بنادول', 'sci not selected → not in title:');
  eq(rows[0].n, 1, 'and the number is a field of its own, not glued to it:');
  eq(rows[0].lines.map(c.lineText), ['الجرعات: قرص كل ٨ ساعات', 'الاستخدامات: خفض الحرارة'], 'default fields:');

  c.toggleOut('meds', 'cautions');
  c.toggleOut('meds', 'scientific_name');
  rows = c.cartRows('meds');
  eq(rows[0].title, 'بنادول (Paracetamol)', 'sci merged into title:');
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
  eq(r.title, 'FBS — سكر صائم'); eq(r.n, 1);
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
  eq(r.title, 'خلطة الحديد', 'title is the name:');
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

  c.previewCart('recipes'); c.pvSend('print');
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
  c.previewCart('recipes'); c.pvSend('print');
  eq(jobs.length, 0, 'nothing printed:');
  eq(c._els('toast').textContent, 'لا عناصر في هذه القائمة');
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
  c.groupPreview(b._t.groups[0].id); c.pvSend('print');
  eq(jobs, ['فحوصات ما قبل الجراحة'], 'printed under its own name:');
});

run('المجموعات: كل تعديل يُحفَظ فور حدوثه بلا زرّ حفظ', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  const ids = seedLabs(c, b, ['CBC', 'FBS', 'TSH']);
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'مجموعتي'; c.groupCreate('labs');

  c.GPICK = {};
  c.groupPickToggle(ids[0]); c.groupPickToggle(ids[1]);
  c.groupPickAdd();
  eq(b._t.groups[0].items.length, 2, 'in the database the moment they are added:');

  c.groupRemove(ids[0]);
  eq(b._t.groups[0].items.length, 1, 'and the removal too:');

  c._els('gn').value = 'باسمٍ آخر'; c.groupRenameSave();
  eq(b._t.groups[0].name, 'باسمٍ آخر', 'and the rename:');

  // لا زرّ حفظ ولا تحذير مسوّدة — لم يعد لهما وجود
  eq(typeof c.window.groupSave, 'undefined', 'no save button behind it:');
  eq(c._els('page').innerHTML.indexOf('غير محفوظة') < 0, true, 'and nothing claims to be unsaved:');
});

run('المجموعات: الخروج لا يسأل ولا يُسقِط شيئًا', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  const ids = seedLabs(c, b, ['CBC', 'FBS', 'TSH']);
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'ما قبل الجراحة'; c.groupCreate('labs');
  c.GPICK = {}; ids.forEach(i => c.groupPickToggle(i)); c.groupPickAdd();

  const jobs = [];
  c.window.AndroidBridge = { printHtml: (html, name) => jobs.push({ name, html }) };
  c.groupEditPreview(); c.pvSend('print');
  eq(jobs[0].html.split('class="rx-item"').length - 1, 3, 'sends what the group holds:');

  c.goBack();
  eq(c.curPage().indexOf('grp:labs:') === 0, true, 'preview returns to the editor:');
  c.goBack();
  eq(c.curPage(), 'grp:labs', 'and out, with no question asked:');
  eq(b._t.groups[0].items.length, 3, 'the three items are still there:');

  // وبعد إعادة تشغيل كاملة
  const c2 = load(b); c2.Store.load(); c2.showApp();
  eq(c2.DB.groups[0].items.length, 3, 'and survive a restart:');
});

run('المجموعات: ترتيب العناصر وترتيب المجموعات يُحفظان', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  const ids = seedLabs(c, b, ['CBC', 'FBS', 'TSH']);
  c.goPage('grp:labs');
  c.groupNew('labs'); c._els('gn').value = 'الأولى'; c.groupCreate('labs');
  c.GPICK = {}; ids.forEach(i => c.groupPickToggle(i)); c.groupPickAdd();

  // ترتيب العناصر داخل المجموعة — هو ترتيب الورقة والرسالة
  c.groupItemMove(ids[2], -1);
  eq(b._t.groups[0].items, [ids[0], ids[2], ids[1]], 'item moved up and persisted:');
  c.groupItemMove(ids[0], -1);
  eq(b._t.groups[0].items, [ids[0], ids[2], ids[1]], 'the first one cannot go higher:');

  // ترتيب المجموعات نفسها
  c.goBack();
  c.groupNew('labs'); c._els('gn').value = 'الثانية'; c.groupCreate('labs');
  c.goBack();
  eq(c.DB.groups.map(g => g.name), ['الأولى', 'الثانية'], 'order of creation:');
  c.groupMove(c.DB.groups[1].id, -1);
  eq(c.DB.groups.map(g => g.name), ['الثانية', 'الأولى'], 'the second moved up:');
  eq(b._order.groups.length, 2, 'and the new order reached the database:');

  const c2 = load(b); c2.Store.load();
  eq(c2.DB.groups.map(g => g.name), ['الثانية', 'الأولى'], 'and it survives a restart:');
});

run('المجموعات: الدرج الجانبي يصل إليها من أي صفحة بضغطة', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  const ids = seedLabs(c, b, ['CBC', 'FBS']);
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'متابعة سكري'; c.groupCreate('labs');
  c.GPICK = {}; ids.forEach(i => c.groupPickToggle(i)); c.groupPickAdd();

  // من صفحة بعيدة تمامًا
  c.goPage('recipes');
  c.openDrawer();
  const dw = c._els('dw-body').innerHTML;
  eq(dw.indexOf('متابعة سكري') >= 0, true, 'the group is listed in the drawer:');
  eq(dw.indexOf('📤 إرسال') >= 0, true, 'with a send button spelled out:');
  eq(dw.indexOf('➕ إضافة عنصر') >= 0, true, 'and one to add an item:');
  eq(dw.indexOf('👁️ عرض') >= 0, true, 'and one to look inside:');
  eq(c._els('dw').className.indexOf('on') >= 0, true, 'the drawer is open:');

  // ضغطة واحدة = شاشة الإرسال
  c.drawerSend(c.DB.groups[0].id);
  eq(c._els('dw').className.indexOf('on') < 0, true, 'the drawer closed behind it:');
  eq(c.curPage(), 'pv', 'and landed straight on the send screen:');

  // زرّ الرجوع في الجهاز يغلق الدرج قبل أن يغادر الصفحة
  c.openDrawer();
  eq(c.onAndroidBack(), true, 'back closes the drawer:');
  eq(c._els('dw').className.indexOf('on') < 0, true, 'and it is shut:');
  eq(c.curPage(), 'pv', 'without leaving the page:');
});

run('المجموعات: الحذف لا يمسّ التحاليل نفسها', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  const ids = seedLabs(c, b, ['CBC', 'FBS']);
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'مؤقتة'; c.groupCreate('labs');
  c.GPICK = {}; c.groupPickToggle(ids[0]); c.groupPickAdd();

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
  c.GPICK = {}; c.groupPickToggle(ids[0]); c.groupPickAdd();

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
    c._els('rf-category').value = i ? 'تغذية علاجية' : 'أعشاب ومشروبات';
    c.recipeSave('');
  });
  const html = c._els('page').innerHTML;
  eq(html.indexOf('شراب الزنجبيل') >= 0, true, 'first name visible:');
  eq(html.indexOf('منقوع الكمّون') >= 0, true, 'second name visible:');
  eq(html.indexOf('<details class="acc" open>') >= 0, true, 'groups start open:');
  eq(html.indexOf('أعشاب ومشروبات (1)') >= 0, true, 'count in the group title:');
});

// جسر أندرويد وهمي للنسخ الاحتياطي والحافظة والطباعة
function androidStub() {
  const files = {};
  const stub = {
    _files: files, _clip: null, _jobs: [], _pdfs: [], _imgs: [], _shared: null, _picked: false,
    _dir: 'مجلد التطبيق الخاص (يزول مع إلغاء التثبيت)',
    printHtml: (html, name) => stub._jobs.push({ html, name }),
    sharePdf: (html, name) => stub._pdfs.push({ html, name }),
    shareImageBase64: (b64, name) => stub._imgs.push({ b64, name }),
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
    shareBackup: n => { stub._shared = n; },
    backupDir: () => stub._dir,
    backupDirIsCustom: () => stub._dir !== 'مجلد التطبيق الخاص (يزول مع إلغاء التثبيت)',
    pickBackupDir: () => { stub._picked = true; },
    resetBackupDir: () => { stub._dir = 'مجلد التطبيق الخاص (يزول مع إلغاء التثبيت)'; }
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
  eq(r.title, 'سونار البطن', 'title:');
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
  c.GPICK = {}; ids.forEach(i => c.groupPickToggle(i)); c.groupPickAdd();
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
  c.previewCart('labs'); c.pvSend('print');
  eq(A._jobs[0].html.indexOf('class="lh"') < 0, true, 'no letterhead block:');

  c._els('hd-name').value = 'د. محمد';
  c._els('hd-title').value = 'استشاري باطنية';
  c._els('hd-contact').value = '0500000000';
  c.saveHeader();
  eq(b._t.settings.hdr_name, 'د. محمد', 'persisted:');

  c.previewCart('labs'); c.pvSend('print');
  const html = A._jobs[1].html;
  eq(html.indexOf('د. محمد') >= 0, true, 'name printed:');
  eq(html.indexOf('استشاري باطنية') >= 0, true, 'title printed:');

  c.clearHeader();
  c.previewCart('labs'); c.pvSend('print');
  eq(A._jobs[2].html.indexOf('class="lh"') < 0, true, 'cleared again:');
});

run('نسخ القائمة كنص', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.goPage('labs');
  c._els('lf-name').value = 'سكر صائم'; c._els('lf-code').value = 'FBS';
  c._els('lf-requirements').value = 'صيام ٨ ساعات';
  c.labSave('');
  c.toggleCart('labs', b._t.labs[0].id);
  const A = androidStub(); c.window.AndroidBridge = A;

  c.previewCart('labs'); c.pvSend('copy');
  eq(A._clip.indexOf('FBS — سكر صائم') >= 0, true, 'item in text:');
  eq(A._clip.indexOf('• متطلبات التحليل: صيام ٨ ساعات') >= 0, true, 'field in text:');
  eq(A._clip.indexOf('<') < 0, true, 'plain text, no markup:');

  c.clearCart('labs'); c._els('cb-yes').onclick();
  A._clip = null;
  c.previewCart('labs'); c.pvSend('copy');
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
  c._els('dz-in').value = 'استبدال'; c.dzCheck();
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

run('مكان النسخ الاحتياطية: عرض وتغيير وعودة ومشاركة', () => {
  const b = makeBridge(); const c = load(b);
  const A = androidStub(); c.window.AndroidBridge = A;
  vm.runInContext('AB = window.AndroidBridge;', c);
  c.Store.load(); c.showApp();
  c.goPage('settings');

  let html = c._els('page').innerHTML;
  eq(html.indexOf('مكان الحفظ') >= 0, true, 'location shown:');
  eq(html.indexOf('يُحذف مع إلغاء تثبيت') >= 0, true, 'warns about the default folder:');
  eq(html.indexOf('العودة لمجلد التطبيق') < 0, true, 'no reset button while default:');

  c.backupPickDir();
  eq(A._picked, true, 'opened the system picker:');

  // كما لو اختار المستخدم مجلدًا ثم أعلمت أندرويد الواجهة
  A._dir = 'Documents/دليلي';
  c.onBackupDirPicked();
  html = c._els('page').innerHTML;
  eq(html.indexOf('Documents/دليلي') >= 0, true, 'new location shown:');
  eq(html.indexOf('يُحذف مع إلغاء تثبيت') < 0, true, 'warning gone:');
  eq(html.indexOf('العودة لمجلد التطبيق') >= 0, true, 'reset offered:');

  // مشاركة نسخة — لا تُكتب نسخة إلا وفيها بيانات
  c.DB.labs.push({ id: 'x1', name: 'CBC' });
  c.autoBackup(true);
  const name = JSON.parse(A.listBackups())[0].name;
  c.backupShare(name);
  eq(A._shared, name, 'shared the right file:');

  c.backupResetDir(); c._els('cb-yes').onclick();
  eq(A._dir.indexOf('مجلد التطبيق') >= 0, true, 'back to the default folder:');
});

run('حقول النص: إدراج نقطة وترقيم وسطر جديد', () => {
  const c = load(makeBridge()); c.Store.load();
  const el = c._els('rf-preparation');
  el.value = ''; el.selectionStart = el.selectionEnd = 0;

  c.taBullet('rf-preparation');
  eq(el.value, '• ', 'bullet inserted:');

  el.value = '• اغسل الزنجبيل'; el.selectionStart = el.selectionEnd = el.value.length;
  c.taNewline('rf-preparation');
  eq(el.value, '• اغسل الزنجبيل\n', 'newline inserted:');

  el.value = '1. أولًا'; el.selectionStart = el.selectionEnd = el.value.length;
  c.taNumber('rf-preparation');
  eq(el.value, '1. أولًا\n2. ', 'numbering continues:');
});

run('حقول النص: Enter يُكمل القائمة ويُنهيها', () => {
  const c = load(makeBridge()); c.Store.load();
  const el = c._els('rf-ingredients');
  const ev = { key: 'Enter', preventDefault() {} };

  el.value = '• زنجبيل'; el.selectionStart = el.selectionEnd = el.value.length;
  eq(c.taKey(ev, el), false, 'handled:');
  eq(el.value, '• زنجبيل\n• ', 'continues the bullet list:');

  // Enter على علامة فارغة يُنهي القائمة
  eq(c.taKey(ev, el), false);
  eq(el.value, '• زنجبيل\n', 'ends the list:');

  // سطر عادي يترك Enter لسلوكه الطبيعي
  el.value = 'نص عادي'; el.selectionStart = el.selectionEnd = el.value.length;
  eq(c.taKey(ev, el), true, 'plain line untouched:');

  el.value = '3) ثالثًا'; el.selectionStart = el.selectionEnd = el.value.length;
  c.taKey(ev, el);
  eq(el.value, '3) ثالثًا\n4. ', 'numeric list continues:');
});

run('الأسطر الجديدة تصل للطباعة والنص المنسوخ', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.goPage('recipes');
  c._els('rf-name').value = 'خلطة';
  c._els('rf-preparation').value = '1. اغلِ الماء\n2. أضف العسل\n3. صفِّ الخليط';
  c.recipeSave('');
  c.toggleCart('recipes', b._t.recipes[0].id);
  const A = androidStub(); c.window.AndroidBridge = A;

  c.previewCart('recipes'); c.pvSend('print');
  eq(A._jobs[0].html.indexOf('white-space:pre-wrap') >= 0, true, 'print keeps line breaks:');
  eq(A._jobs[0].html.indexOf('2. أضف العسل') >= 0, true, 'all steps printed:');

  c.previewCart('recipes'); c.pvSend('copy');
  const lines = A._clip.split('\n');
  eq(lines.some(l => l.indexOf('• طريقة الإعداد: 1. اغلِ الماء') >= 0), true, 'first step on the label line:');
  eq(lines.some(l => l === '     2. أضف العسل'), true, 'later steps indented on their own lines:');
});

run('إرسال PDF مباشرة بلا مربع الطباعة', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.goPage('labs');
  c._els('lf-name').value = 'CBC'; c.labSave('');
  c.toggleCart('labs', b._t.labs[0].id);
  const A = androidStub(); c.window.AndroidBridge = A;

  c.previewCart('labs'); c.pvSend('pdf');
  eq(A._pdfs.length, 1, 'went to the pdf bridge:');
  eq(A._jobs.length, 0, 'did not open the print dialog:');
  eq(A._pdfs[0].name, 'قائمة تحاليل', 'file name:');
  eq(A._pdfs[0].html.indexOf('CBC') >= 0, true, 'content included:');

  c.clearCart('labs'); c._els('cb-yes').onclick();
  c.previewCart('labs'); c.pvSend('pdf');
  eq(A._pdfs.length, 1, 'empty list refused:');
});

run('مجموعاتي: صفحة جامعة لكل الأقسام مع PDF', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  const ids = seedLabs(c, b, ['CBC', 'FBS']);
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'دورية'; c.groupCreate('labs');
  c.GPICK = {}; ids.forEach(i => c.groupPickToggle(i)); c.groupPickAdd();

  c.goHome();
  eq(c._els('page').innerHTML.indexOf('مجموعاتي المحفوظة (1)') >= 0, true, 'shortcut on home:');

  c.goPage('grp:all');
  const html = c._els('page').innerHTML;
  eq(html.indexOf('دورية') >= 0, true, 'group listed:');
  eq(html.indexOf('+ مجموعة جديدة') < 0, true, 'no per-section create here:');
  eq(c._els('hdr-title').innerHTML, 'مجموعاتي المحفوظة', 'page title:');

  const A = androidStub(); c.window.AndroidBridge = A;
  c.groupPreview(b._t.groups[0].id); c.pvSend('pdf');
  eq(A._pdfs[0].name, 'دورية', 'group pdf uses its own name:');
});

run('المعاينة: تعرض الورقة نفسها التي ستُرسَل', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  const ids = seedLabs(c, b, ['CBC', 'FBS', 'TSH']);
  ids.forEach(i => c.toggleCart('labs', i));

  c.previewCart('labs');
  eq(c.curPage(), 'pv', 'opened the preview page:');
  eq(c._els('hdr-title').innerHTML, 'معاينة قبل الإرسال', 'page title:');
  eq(c.PV_CSS, 'n', 'paper stylesheet injected for the current density:');

  const html = c._els('page').innerHTML;
  eq(html.split('class="rx-item"').length - 1, 3, 'every selected item shown:');
  eq(html.indexOf('class="paper"') >= 0, true, 'rendered as a paper sheet:');
  eq(html.indexOf('CBC') >= 0, true, 'item names visible:');
  eq(html.indexOf('pvbar') >= 0, true, 'send bar present:');

  // المعروض = المُرسَل حرفيًا: نفس بناء الورقة يذهب للطباعة وPDF
  const A = androidStub(); c.window.AndroidBridge = A;
  c.pvSend('pdf');
  const sent = A._pdfs[0].html;
  eq(sent.split('class="rx-item"').length - 1, 3, 'sent list matches the preview:');
  eq(sent.indexOf('@page{size:A4') >= 0, true, 'print stylesheet only in the sent document:');
  eq(html.indexOf('@page') < 0, true, 'preview does not leak @page into the app:');
});

run('المعاينة: تبويب الصورة ثم الإرسال بأي صيغة', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  const ids = seedLabs(c, b, ['CBC', 'FBS']);
  ids.forEach(i => c.toggleCart('labs', i));
  const A = androidStub(); c.window.AndroidBridge = A;

  c.previewCart('labs');
  c.pvTab('img');
  const html = c._els('page').innerHTML;
  eq(html.indexOf('class="pvimg"') >= 0, true, 'image tab rendered:');
  eq(html.indexOf('class="paper"') < 0, true, 'paper hidden on the image tab:');
  // اللوحة تُبنى بعد تحميل صورها ثم تُحقن في مكانها
  eq(c._els('pv-img').innerHTML.indexOf('data:image/png;base64,') >= 0, true,
    'the canvas itself is injected:');

  c.pvSend('img');
  eq(A._imgs.length, 1, 'image sent:');
  c.pvSend('print');
  eq(A._jobs.length, 1, 'print job sent:');
  c.pvSend('copy');
  eq(A._clip.indexOf('CBC') >= 0, true, 'text copied:');
  c.pvSend('pdf');
  eq(A._pdfs.length, 1, 'pdf sent:');
});

run('المعاينة: ترفض القائمة الفارغة ولا تحتفظ بقائمة قديمة', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  const ids = seedLabs(c, b, ['CBC']);
  c.toggleCart('labs', ids[0]);
  const A = androidStub(); c.window.AndroidBridge = A;

  c.previewCart('labs');
  eq(c.PV.ids.length, 1, 'preview loaded:');

  c.clearCart('labs'); c._els('cb-yes').onclick();
  c.previewCart('labs');
  eq(c._els('toast').textContent, 'لا عناصر في هذه القائمة', 'refused:');
  eq(c.PV, null, 'stale list dropped:');
  c.pvSend('pdf');
  eq(A._pdfs.length, 0, 'nothing sent after a refusal:');
});

run('التصنيفات: إنشاء وإسناد ثم ظهورها مجموعةً في القسم', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();

  c.goPage('cat:meds');
  eq(c._els('hdr-title').innerHTML, 'تصنيفات العلاجات', 'page title:');
  c.catNew('meds'); c._els('cn').value = 'العيون'; c.catCreate('meds');
  c.catNew('meds'); c._els('cn').value = 'الأذن'; c.catCreate('meds');
  eq(b._t.cats.length, 2, 'persisted to the db:');
  eq(b._t.cats.map(x => x.name), ['العيون', 'الأذن'], 'in creation order:');
  eq(c._els('page').innerHTML.indexOf('فارغ') >= 0, true, 'empty category is listed:');

  // تصنيف فارغ لا يظهر في القسم — يظهر حين يسكنه عنصر
  c.goPage('meds');
  eq(c._els('page').innerHTML.indexOf('العيون') < 0, true, 'empty category not in the section:');

  c._els('mf-trade_name').value = 'قطرة توبرين';
  c._els('mf-category').value = 'العيون';
  c.medSave('');
  const html = c._els('page').innerHTML;
  eq(html.indexOf('💊 العيون (1)') >= 0, true, 'grouped under its category:');
  eq(b._t.meds[0].category, 'العيون', 'stored on the item:');
  eq(b._t.cats.length, 2, 'no duplicate category created:');
});

run('التصنيفات: تصنيف جديد من داخل نموذج العنصر', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('labs');
  c._els('lf-name').value = 'صورة دم كاملة';
  c._els('lf-category').value = 'كيمياء الدم';   // لم يُسجَّل من قبل
  c.labSave('');
  eq(b._t.cats.map(x => x.name), ['كيمياء الدم'], 'category registered on save:');
  eq(b._t.cats[0].kind, 'labs', 'under the right section:');

  c.goPage('cat:labs');
  eq(c._els('page').innerHTML.indexOf('تحليل واحد') >= 0, true, 'counted in the manager:');
});

run('التصنيفات: إعادة التسمية تنقل كل العناصر', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('labs');
  ['CBC', 'ESR'].forEach(n => {
    c._els('lf-name').value = n; c._els('lf-category').value = 'المناعة'; c.labSave('');
  });
  const id = b._t.cats[0].id;
  c.goPage('cat:labs');
  c.catRename('labs', id);
  c._els('cn').value = 'المناعة والأمصال';
  c.catRenameSave('labs', id);

  eq(b._t.cats[0].name, 'المناعة والأمصال', 'category renamed:');
  eq(b._t.labs.map(l => l.category), ['المناعة والأمصال', 'المناعة والأمصال'], 'items moved with it:');
  c.goPage('labs');
  eq(c._els('page').innerHTML.indexOf('🧪 المناعة والأمصال (2)') >= 0, true, 'section shows the new name:');
});

run('التصنيفات: الحذف يبقي العناصر ويعيدها غير مصنّفة', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('imaging');
  c._els('if-name').value = 'رنين للركبة';
  c._els('if-category').value = 'رنين مغناطيسي';
  c.imgSave('');
  const id = b._t.cats[0].id;

  c.goPage('cat:imaging');
  c.catDel('imaging', id); c._els('cb-yes').onclick();
  eq(b._t.cats.length, 0, 'category gone:');
  eq(b._t.imaging.length, 1, 'the exam itself survives:');
  eq(b._t.imaging[0].category, '', 'and became uncategorised:');

  c.goPage('imaging');
  eq(c._els('page').innerHTML.indexOf('غير مصنّف') >= 0, true, 'shown under «غير مصنّف»:');
});

run('التصنيفات: الترتيب يتحكّم بترتيب المجموعات في القسم', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('meds');
  [['العيون', 'قطرة'], ['الأذن', 'نقط أذن']].forEach(([cat, name]) => {
    c._els('mf-trade_name').value = name; c._els('mf-category').value = cat; c.medSave('');
  });
  const before = c._els('page').innerHTML;
  eq(before.indexOf('العيون') < before.indexOf('الأذن'), true, 'creation order first:');

  c.goPage('cat:meds');
  c.catMove('meds', b._t.cats[1].id, -1);       // «الأذن» تصعد
  eq(b._t.cats.map(x => x.name), ['الأذن', 'العيون'], 'order persisted:');

  c.goPage('meds');
  const after = c._els('page').innerHTML;
  eq(after.indexOf('الأذن') < after.indexOf('العيون'), true, 'section follows the new order:');
});

run('التصنيفات: الزرع مرّة واحدة، والقاعدة العامرة لا تُزرع فوقها', () => {
  const b = makeBridge(); let c = load(b); c.Store.load();
  c.seedCats();
  const n = b._t.cats.length;
  eq(n > 0, true, 'seeded on a fresh db:');
  eq(b._t.settings.cats_seeded, '1', 'flag stored:');
  eq(b._t.cats.some(x => x.kind === 'imaging' && x.name === 'رنين مغناطيسي'), true, 'imaging seeds:');

  // حذف تصنيف مزروع ثم إعادة التشغيل: لا يعود
  c.catDel('meds', b._t.cats[0].id); c._els('cb-yes').onclick();
  c = load(b); c.Store.load(); c.seedCats();
  eq(b._t.cats.length, n - 1, 'deleted seed stays deleted:');
});

run('التصنيفات تدخل النسخة الاحتياطية وتعود منها', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('meds');
  c._els('mf-trade_name').value = 'قطرة'; c._els('mf-category').value = 'العيون'; c.medSave('');
  const backup = JSON.parse(JSON.stringify(c.DB));
  eq(backup.cats.length, 1, 'in the backup blob:');

  const b2 = makeBridge(); const c2 = load(b2); c2.Store.load();
  c2.applyData(backup); c2.Store.replaceAll();
  eq(b2._t.cats.map(x => x.name), ['العيون'], 'restored into the db:');
  eq(c2.catNames('meds'), ['العيون'], 'and visible to the ui:');
});

run('التصنيف: قائمة منسدلة لا شرائح', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('labs');
  ['كيمياء الدم', 'المناعة'].forEach(n => {
    c._els('lf-name').value = 'ت-' + n; c._els('lf-category').value = n; c.labSave('');
  });
  const html = c.catField('lf', 'labs', 'المناعة');
  eq(html.indexOf('<select') >= 0, true, 'renders a select:');
  eq(html.indexOf('class="seg"') < 0, true, 'no chips any more:');
  eq(html.split('<option').length - 1, 4, 'blank + two categories + «new»:');
  eq(html.indexOf('<option value="المناعة" selected>') >= 0, true, 'current one preselected:');
  eq(html.indexOf('➕ تصنيف جديد') >= 0, true, 'create option present:');

  // قيمة غير مسجّلة (نسخة قديمة) تُعرض في حقل «الجديد» فلا تضيع
  const orphan = c.catField('lf', 'labs', 'تصنيف قديم');
  eq(orphan.indexOf('value="تصنيف قديم"') >= 0, true, 'unknown value kept:');
  eq(orphan.indexOf('display:none') < 0, true, 'and its box is open:');
});

run('الحقول الإضافية: تعريف وحفظ وطباعة', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('fld:meds');
  c.fldNew('meds'); c._els('ff-label').value = 'الشركة المصنّعة';
  c._els('ff-type').value = 'text'; c.fldCreate('meds');
  c.fldNew('meds'); c._els('ff-label').value = 'ملاحظات الصيدلية';
  c._els('ff-type').value = 'area'; c.fldCreate('meds');
  eq(b._t.fields.length, 2, 'persisted:');
  eq(b._t.fields.map(f => f.kind), ['meds', 'meds'], 'under the right section:');
  const keys = b._t.fields.map(f => f.key);

  // تظهر في النموذج وتُحفَظ داخل extra
  c.goPage('meds');
  c.medForm();
  eq(c._els('page').innerHTML !== null, true);
  c._els('mf-trade_name').value = 'أوجمنتين';
  c._els('mf-x-' + keys[0]).value = 'GSK';
  c._els('mf-x-' + keys[1]).value = 'يُحفظ مبرّدًا';
  c.medSave('');
  eq(b._t.meds[0].extra[keys[0]], 'GSK', 'value stored in extra:');
  eq(b._t.meds[0].extra[keys[1]], 'يُحفظ مبرّدًا');

  // تظهر في الإرسال بلا أي خطوة إضافية — الحقل الجديد مُدرَج منذ إنشائه
  eq(c.outDefs('meds').some(f => f[0] === 'x:' + keys[0]), true, 'offered as a sendable field:');
  eq(c.DB.out.meds.indexOf('x:' + keys[0]) >= 0, true, 'included by default:');
  eq(b._t.settings.out_meds.indexOf('x:' + keys[0]) >= 0, true, 'and persisted:');
  const html = c.itemsHtml('meds', [b._t.meds[0].id]);
  eq(html.indexOf('الشركة المصنّعة') >= 0 && html.indexOf('GSK') >= 0, true, 'printed:');
  eq(html.indexOf('يُحفظ مبرّدًا') >= 0, true, 'the long one too:');

  // وتظهر على بطاقة العنصر في القائمة نفسها
  c.goPage('meds');
  const card = c._els('page').innerHTML;
  eq(card.indexOf('class="xf"') >= 0, true, 'rendered on the card:');
  eq(card.indexOf('GSK') >= 0, true, 'with its value:');

  // إعادة التسمية تُبقي القيمة (المفتاح لا يتغيّر)
  c.fldEdit('meds', b._t.fields[0].id);
  c._els('ff-label').value = 'المصنّع';
  c.fldSave(b._t.fields[0].id);
  eq(b._t.fields[0].key, keys[0], 'key unchanged:');
  eq(c.DB.meds[0].extra[keys[0]], 'GSK', 'value survived the rename:');

  // الحذف ينظّف الحقول المرسلة
  c.fldDel('meds', b._t.fields[0].id); c._els('cb-yes').onclick();
  eq(b._t.fields.length, 1, 'field gone:');
  eq(c.DB.out.meds.indexOf('x:' + keys[0]), -1, 'removed from the sent fields:');
});

run('الأقسام: إنشاء قسم كامل يعمل كالأصلية', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('secs');
  eq(b._t.sections.length, 4, 'the four builtins are registered:');

  c.secNew(); c._els('sf-title').value = 'اللقاحات'; c._els('sf-icon').value = '💉';
  c.secCreate();
  const k = c.DB.sections[4].id;
  eq(c.DB.sections.length, 5, 'section added:');
  eq(c.curPage(), k, 'opened it:');
  eq(c.KINDS.indexOf(k) >= 0, true, 'joined KINDS:');

  // حقل خاص به ثم عنصر
  c.fldNew(k); c._els('ff-label').value = 'عمر الجرعة'; c.fldCreate(k);
  const fk = c.fieldsOf(k)[0].key;
  c.secItemForm(k);
  c._els('cf-name').value = 'لقاح الإنفلونزا';
  c._els('cf-category').value = 'لقاحات موسمية';
  c._els('cf-x-' + fk).value = 'من ٦ أشهر';
  c.secItemSave(k, '');
  eq(b._t.items.length, 1, 'stored in the generic items table:');
  eq(b._t.items[0].section, k, 'tagged with its section:');
  eq(c.DB[k][0].extra[fk], 'من ٦ أشهر', 'custom field stored:');
  eq(c.catNames(k), ['لقاحات موسمية'], 'category auto-registered:');

  // السلة والمعاينة والطباعة بلا سطر إضافي
  const A = androidStub(); c.window.AndroidBridge = A;
  c.DB.out[k] = ['category', 'x:' + fk];
  c.toggleCart(k, c.DB[k][0].id);
  c.previewCart(k); c.pvSend('pdf');
  eq(A._pdfs.length, 1, 'pdf sent:');
  eq(A._pdfs[0].html.indexOf('من ٦ أشهر') >= 0, true, 'custom field in the document:');
  eq(A._pdfs[0].html.indexOf('لقاح الإنفلونزا') >= 0, true, 'item in the document:');
});

run('الأقسام: تسمية الأصلي وترتيبه وحذف المُنشأ', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();

  // تسمية قسم أصلي: ألفاظ العدّ ترجع محايدة فتبقى الجملة صحيحة
  eq(c.kindLbl('recipes').few, 'وصفات', 'specific words while unnamed:');
  c.secEdit('recipes'); c._els('sf-title').value = 'الخلطات'; c.secSave('recipes');
  eq(c.kindLbl('recipes').title, 'الخلطات', 'renamed:');
  eq(c.kindLbl('recipes').few, 'عناصر', 'falls back to neutral counting words:');
  eq(b._t.sections.find(s => s.id === 'recipes').title, 'الخلطات', 'persisted:');

  // الترتيب
  c.secMove('labs', -1);
  eq(c.KINDS.slice(0, 2), ['labs', 'meds'], 'reordered:');
  eq(b._t.sections.map(s => s.id).slice(0, 2), ['labs', 'meds'], 'order persisted:');

  // قسم مُنشأ: حذفه ينظّف كل ما يتبعه
  c.secNew(); c._els('sf-title').value = 'مؤقّت'; c.secCreate();
  const k = c.DB.sections[c.DB.sections.length - 1].id;
  c.fldNew(k); c._els('ff-label').value = 'حقل'; c.fldCreate(k);
  c.secItemForm(k); c._els('cf-name').value = 'عنصر'; c._els('cf-category').value = 'تص';
  c.secItemSave(k, '');
  c.goPage('grp:' + k); c.groupNew(k); c._els('gn').value = 'مج'; c.groupCreate(k);
  eq(b._t.items.length, 1);

  // حذف القسم صار يطلب كتابة اسمه — نقرةٌ وحدها لا تكفي
  c.secDel(k);
  c._els('cb-yes').onclick();
  eq(c.DB.sections.length, 5, 'a bare tap does nothing:');
  c._els('dz-in').value = c.secOf(k).title; c.dzCheck();
  c._els('cb-yes').onclick();
  eq(c.DB.sections.length, 4, 'section removed once the name is typed:');
  eq(b._t.items.length, 0, 'its items too:');
  eq(b._t.fields.filter(f => f.kind === k).length, 0, 'its fields:');
  eq(b._t.cats.filter(x => x.kind === k).length, 0, 'its categories:');
  eq(b._t.groups.filter(g => g.kind === k).length, 0, 'its groups:');
  eq(c.KINDS.indexOf(k), -1, 'and it left KINDS:');

  // الأصلية لا تُحذف
  c.secDel('meds');
  eq(c.DB.sections.length, 4, 'builtin refused deletion:');
});

run('الأقسام والحقول تبقى بعد إعادة التشغيل وتدخل النسخة الاحتياطية', () => {
  const b = makeBridge(); let c = load(b); c.Store.load(); c.showApp();
  c.secNew(); c._els('sf-title').value = 'اللقاحات'; c._els('sf-icon').value = '💉';
  c.secCreate();
  const k = c.DB.sections[4].id;
  c.fldNew(k); c._els('ff-label').value = 'عمر الجرعة'; c.fldCreate(k);
  const fk = c.fieldsOf(k)[0].key;
  c.secItemForm(k); c._els('cf-name').value = 'لقاح'; c._els('cf-x-' + fk).value = 'سنة';
  c.secItemSave(k, '');

  c = load(b); c.Store.load();                 // «إعادة فتح» التطبيق
  eq(c.DB.sections.length, 5, 'sections reloaded:');
  eq(c.kindLbl(k).title + c.kindLbl(k).icon, 'اللقاحات💉', 'name and icon kept:');
  eq(c.DB[k].length, 1, 'its items reloaded:');
  eq(c.DB[k][0].extra[fk], 'سنة', 'custom values reloaded:');

  // نسخة احتياطية → قاعدة جديدة
  const backup = JSON.parse(JSON.stringify(c.DB));
  const b2 = makeBridge(); const c2 = load(b2); c2.Store.load();
  c2.applyData(backup); c2.Store.replaceAll();
  eq(b2._t.sections.length, 5, 'sections restored:');
  eq(b2._t.fields.length, 1, 'fields restored:');
  eq(b2._t.items.length, 1, 'custom items restored:');
  eq(c2.DB[k][0].extra[fk], 'سنة', 'with their values:');
});

run('رقم الإصدار يُقرأ من الحزمة لا من ثابت في الواجهة', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();

  // بلا جسر (معاينة في المتصفح): لا يُختلق رقم
  c.window.AndroidBridge = undefined;
  eq(c.appVersion(), 'معاينة في المتصفح', 'no invented number in the browser:');

  // داخل التطبيق: ما تقوله الحزمة حرفيًا
  const A = androidStub();
  A.appVersion = () => '2.3 (14)';
  c.window.AndroidBridge = A;
  eq(c.appVersion(), '2.3 (14)', 'reported verbatim:');

  c.goPage('settings');
  const html = c._els('page').innerHTML;
  eq(html.indexOf('إصدار التطبيق') >= 0, true, 'shown in settings:');
  eq(html.indexOf('2.3 (14)') >= 0, true, 'with the value:');

  // بناء لاحق يرفع الرقم: الواجهة تتبعه بلا تعديل فيها
  A.appVersion = () => '9.9 (99)';
  c.goPage('home'); c.goPage('settings');
  eq(c._els('page').innerHTML.indexOf('9.9 (99)') >= 0, true, 'follows the build:');

  // جسر بلا الدالة (نسخة أقدم من الغلاف) لا يكسر الصفحة
  delete A.appVersion;
  eq(c.appVersion(), 'معاينة في المتصفح', 'degrades safely:');
});

run('الحقل الإضافي يظهر في العرض بلا ضبط يدوي', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();

  // قسم أصلي
  c.goPage('labs');
  c._els('lf-name').value = 'CBC'; c.labSave('');
  c.fldNew('labs'); c._els('ff-label').value = 'المختبر المفضّل'; c.fldCreate('labs');
  const lk = c.fieldsOf('labs')[0].key;
  c.labForm(b._t.labs[0].id);
  c._els('lf-name').value = 'CBC';
  c._els('lf-x-' + lk).value = 'مختبر الشفاء';
  c.labSave(b._t.labs[0].id);

  const A = androidStub(); c.window.AndroidBridge = A;
  c.toggleCart('labs', b._t.labs[0].id);
  c.previewCart('labs'); c.pvSend('pdf');
  eq(A._pdfs[0].html.indexOf('المختبر المفضّل') >= 0, true, 'label in the sent document:');
  eq(A._pdfs[0].html.indexOf('مختبر الشفاء') >= 0, true, 'value in the sent document:');
  eq(A._pdfs[0].html.indexOf('CBC') >= 0, true, 'alongside the built-in fields:');

  // نصّ الحافظة يحمله أيضًا
  c.pvSend('copy');
  eq(A._clip.indexOf('• المختبر المفضّل: مختبر الشفاء') >= 0, true, 'in the copied text:');

  // قسم أنشأه المستخدم
  c.secNew(); c._els('sf-title').value = 'اللقاحات'; c.secCreate();
  const k = c.DB.sections[4].id;
  c.fldNew(k); c._els('ff-label').value = 'عمر الجرعة'; c.fldCreate(k);
  const fk = c.fieldsOf(k)[0].key;
  eq(c.DB.out[k].indexOf('x:' + fk) >= 0, true, 'included for a new section too:');
  c.secItemForm(k);
  c._els('cf-name').value = 'لقاح'; c._els('cf-x-' + fk).value = 'من ٦ أشهر';
  c.secItemSave(k, '');
  eq(c._els('page').innerHTML.indexOf('من ٦ أشهر') >= 0, true, 'on its card:');
  c.toggleCart(k, c.DB[k][0].id);
  c.previewCart(k); c.pvSend('pdf');
  eq(A._pdfs[1].html.indexOf('من ٦ أشهر') >= 0, true, 'and in its document:');

  // إلغاء التأشير يخفيه — الاختيار يبقى بيد المستخدم
  c.toggleOut('labs', 'x:' + lk);
  eq(c.itemsHtml('labs', [b._t.labs[0].id]).indexOf('مختبر الشفاء') < 0, true, 'still user-controlled:');
});

run('حقول عُرِّفت قبل التحديث تُدرَج في الإرسال مرّةً واحدة', () => {
  const b = makeBridge(); let c = load(b); c.Store.load(); c.showApp();

  // حالة نسخة سابقة: حقل موجود في القاعدة وليس في الحقول المرسلة
  b._t.fields.push({ id: 'f1', kind: 'meds', key: 'kOLD', label: 'الشركة المصنّعة', type: 'text' });
  c = load(b); c.Store.load();
  eq(c.DB.out.meds.indexOf('x:kOLD'), -1, 'starts unticked, as it was:');

  c.backfillFieldOut();
  eq(c.DB.out.meds.indexOf('x:kOLD') >= 0, true, 'backfilled:');
  eq(b._t.settings.out_meds.indexOf('x:kOLD') >= 0, true, 'persisted:');
  eq(b._t.settings.fields_out_done, '1', 'guarded by a flag:');

  // القيمة تصل المستند الآن
  c.goPage('meds');
  c._els('mf-trade_name').value = 'أوجمنتين';
  c._els('mf-x-kOLD').value = 'GSK';
  c.medSave('');
  eq(c.itemsHtml('meds', [b._t.meds[0].id]).indexOf('GSK') >= 0, true, 'reaches the document:');

  // إلغاء التأشير بعدها يبقى — لا تعيده الترقية في الإقلاع التالي
  c.toggleOut('meds', 'x:kOLD');
  c = load(b); c.Store.load(); c.backfillFieldOut();
  eq(c.DB.out.meds.indexOf('x:kOLD'), -1, 'a deliberate untick sticks:');
});

run('مخرجات قسم أنشأه المستخدم: عنوان صحيح وصورة تُرسَل', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.secNew(); c._els('sf-title').value = 'النصائح'; c.secCreate();
  const k = c.DB.sections[4].id;
  c.fldNew(k); c._els('ff-label').value = 'النصيحة'; c.fldCreate(k);
  const fk = c.fieldsOf(k)[0].key;
  c.secItemForm(k);
  c._els('cf-name').value = 'العناية بالجرح';
  c._els('cf-x-' + fk).value = 'نظّف الجرح مرّتين يوميًا';
  c.secItemSave(k, '');

  // اسم القسم هو عنوان القائمة — لا 'undefined'
  eq(c.cartTitle(k, false), 'النصائح', 'list title:');
  eq(c.cartTitle(k, true).indexOf('undefined'), -1, 'image title clean:');

  const A = androidStub(); c.window.AndroidBridge = A;
  c.toggleCart(k, c.DB[k][0].id);
  c.previewCart(k);
  eq(c.PV.title, 'النصائح', 'preview carries it:');
  eq(c._els('page').innerHTML.indexOf('undefined'), -1, 'nothing undefined on screen:');

  // الصيغ الأربع تخرج سليمة — «صورة» كانت تنهار على عنوان مفقود
  c.pvSend('pdf');
  eq(A._pdfs[0].name, 'النصائح', 'pdf file name:');
  eq(A._pdfs[0].html.indexOf('نظّف الجرح') >= 0, true, 'field value in the pdf:');
  eq(A._pdfs[0].html.indexOf('النصائح') >= 0, true, 'heading printed:');
  c.pvSend('img');
  eq(A._imgs.length, 1, 'image actually sent:');
  eq(A._imgs[0].name.indexOf('undefined'), -1, 'with a real file name:');
  c.pvSend('print');
  eq(A._jobs[0].name, 'النصائح', 'print job name:');
  c.pvSend('copy');
  eq(A._clip.indexOf('النصائح') >= 0 && A._clip.indexOf('نظّف الجرح') >= 0, true, 'copied text:');
});

run('الإضافة: «حفظ ومتابعة» يُبقيك في النموذج ويقترح التصنيف', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('labs');

  c.labForm();
  c._els('lf-name').value = 'CBC';
  c._els('lf-category').value = 'أمراض الدم';
  c.labSave('', 1);                       // حفظ ومتابعة
  eq(b._t.labs.length, 1, 'saved:');
  eq(c._els('modal-bg').className.indexOf('on') >= 0, true, 'form stayed open:');
  eq(c.LAST_CAT.labs, 'أمراض الدم', 'category remembered:');

  // النموذج التالي يأتي بالتصنيف نفسه فلا يُعاد اختياره
  eq(c._els('modal-body').innerHTML.indexOf('id="lf-category" value="أمراض الدم"') >= 0,
    true, 'prefilled for the next one:');
  c._els('lf-name').value = 'ESR';
  c.labSave('', 1);
  eq(b._t.labs.map(l => l.name), ['CBC', 'ESR'], 'second one in:');
  eq(b._t.labs[1].category, 'أمراض الدم', 'same category without re-picking:');

  // الحفظ العادي يغلق
  c._els('lf-name').value = 'TSH';
  c.labSave('');
  eq(b._t.labs.length, 3, 'third saved:');
  eq(c._els('modal-bg').className.indexOf('on') < 0, true, 'and the form closed:');

  // «حفظ ومتابعة» لا يظهر عند التعديل
  c.labForm(b._t.labs[0].id);
  eq(c._els('modal-body').innerHTML.indexOf('حفظ ومتابعة') < 0, true, 'not offered while editing:');
  c.labForm();
  eq(c._els('modal-body').innerHTML.indexOf('حفظ ومتابعة') >= 0, true, 'but offered while adding:');
});

run('الإضافة: ⧉ تكرار عنصر يفتح نسخة قابلة للتعديل', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('imaging');
  c.imgForm();
  c._els('if-name').value = 'رنين للركبة اليمنى';
  c._els('if-category').value = 'رنين مغناطيسي';
  c._els('if-requirements').value = 'إحضار فحوصات الكلى';
  c.imgSave('');
  const src = b._t.imaging[0];

  c.dupItem('imaging', src.id);
  const dup = c._els('modal-body').innerHTML;
  eq(b._t.imaging.length, 1, 'nothing saved yet — it is a draft:');
  eq(dup.indexOf('value="رنين للركبة اليمنى"') >= 0, true, 'name copied:');
  eq(dup.indexOf('id="if-category" value="رنين مغناطيسي"') >= 0, true, 'category copied:');
  eq(dup.indexOf('إحضار فحوصات الكلى') >= 0, true, 'details copied:');
  eq(dup.indexOf('حفظ ومتابعة') >= 0, true, 'and it is an add, not an edit:');

  c._els('if-name').value = 'رنين للركبة اليسرى';
  c.imgSave('');
  eq(b._t.imaging.length, 2, 'saved as a new one:');
  eq(b._t.imaging[1].id !== src.id, true, 'with its own id:');
  eq(b._t.imaging[0].name, 'رنين للركبة اليمنى', 'original untouched:');

  // النسخة تُستهلك مرّة واحدة فلا تتسرّب للنموذج التالي
  c.imgForm();
  eq(c._els('modal-body').innerHTML.indexOf('id="if-name" class="inp" value=""') >= 0,
    true, 'a fresh form afterwards:');
});

run('الإضافة: بحثٌ بلا نتيجة يضيف بالاسم مباشرةً', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.setMode('edit');                    // الإضافة فعلُ إدخال
  c.goPage('meds');
  c.medForm(); c._els('mf-trade_name').value = 'بنادول';
  c._els('mf-category').value = 'مسكنات'; c.medSave('');

  c._els('srch').value = 'أوجمنتين';
  c.renderMeds();
  const html = c._els('page').innerHTML;
  eq(html.indexOf('لا نتيجة') >= 0, true, 'says there is no hit:');
  eq(html.indexOf('أضِفه بهذا الاسم') >= 0, true, 'offers to add it:');
  eq(html.indexOf('مسكنات') >= 0, true, 'and names the category it will land in:');

  c.addNamed('meds');
  eq(b._t.meds.length, 2, 'added:');
  eq(b._t.meds[1].trade_name, 'أوجمنتين', 'with the searched name:');
  eq(b._t.meds[1].category, 'مسكنات', 'in the last-used category:');
  eq(c._els('srch').value, '', 'search cleared for the next one:');

  // اسم التحليل يختلف عن اسم العلاج
  c.goPage('labs');
  c._els('srch').value = 'فيتامين د';
  c.renderLabs();
  c.addNamed('labs');
  eq(b._t.labs[0].name, 'فيتامين د', 'labs use `name` not `trade_name`:');
});

run('الإضافة: الحقول قليلة الاستعمال مطويّة ولا تضيع قيمها', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('recipes');
  c.recipeForm();
  const html = c._els('modal-body').innerHTML;
  eq(html.indexOf('المزيد من الحقول') >= 0, true, 'the fold exists:');
  // الأساسية خارج الطيّة، والباقي داخلها
  const fold = html.indexOf('<details class="more"');
  eq(html.indexOf('rf-ingredients') < fold, true, 'ingredients stay visible:');
  eq(html.indexOf('rf-precautions') > fold, true, 'precautions are folded:');

  // القيم داخل الطيّة تُقرأ عند الحفظ كغيرها
  c._els('rf-name').value = 'شراب الزنجبيل';
  c._els('rf-ingredients').value = 'زنجبيل وعسل';
  c._els('rf-precautions').value = 'يُتجنّب دون سنة';
  c.recipeSave('');
  eq(b._t.recipes[0].ingredients, 'زنجبيل وعسل', 'visible field saved:');
  eq(b._t.recipes[0].precautions, 'يُتجنّب دون سنة', 'folded field saved too:');
});

run('العرض: تحديد كل التصنيف بضغطة', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('labs');
  [['CBC', 'أمراض الدم'], ['ESR', 'أمراض الدم'], ['FBS', 'كيمياء الدم']].forEach(([n, cat]) => {
    c._els('lf-name').value = n; c._els('lf-category').value = cat; c.labSave('');
  });
  eq(c._els('page').innerHTML.indexOf('acc-pick') >= 0, true, 'the button is in the group header:');

  c.pickCat('labs', 'أمراض الدم');
  eq(b._t.cart.labs.length, 2, 'the whole category selected:');
  eq(c.DB.labs.filter(l => b._t.cart.labs.indexOf(l.id) >= 0).map(l => l.name),
    ['CBC', 'ESR'], 'the right two:');

  c.pickCat('labs', 'أمراض الدم');
  eq(b._t.cart.labs.length, 0, 'pressing again clears them:');

  // لا يمسّ تصنيفًا آخر
  c.pickCat('labs', 'كيمياء الدم');
  c.pickCat('labs', 'أمراض الدم');
  eq(b._t.cart.labs.length, 3, 'categories add up:');
  c.pickCat('labs', 'كيمياء الدم');
  eq(b._t.cart.labs.length, 2, 'and clear independently:');
});

run('العرض: التأشير والترتيب من داخل المعاينة لا يمسّان التحديد', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('labs');
  ['CBC', 'ESR', 'FBS'].forEach(n => { c._els('lf-name').value = n; c.labSave(''); });
  c.DB.labs.forEach(l => c.toggleCart('labs', l.id));
  c.previewCart('labs');
  eq(c.PV.ids.length, 3, 'three in the preview:');

  c.pvTab('list');
  eq(c._els('page').innerHTML.indexOf('لهذا الإرسال وحده') >= 0, true, 'says it is temporary:');
  eq(c._els('page').innerHTML.indexOf('تحديد الكل') >= 0, true, 'with select-all at hand:');

  c.pvMove(0, 1);
  eq(c.PV.ids[0], c.DB.labs[1].id, 'reordered:');

  // التأشير: الإلغاء يستثني ولا يحذف
  c.pvPick(c.PV.ids[0]);
  eq(c.pvOn().length, 2, 'unticked one is excluded from this send:');
  eq(c.PV.ids.length, 3, 'but stays on the list to be re-ticked:');
  eq(b._t.cart.labs.length, 3, 'and the selection is untouched:');

  const A = androidStub(); c.window.AndroidBridge = A;
  c.pvSend('pdf');
  eq(A._pdfs[0].html.split('class="rx-item"').length - 1, 2, 'sends only the ticked ones:');

  // «إلغاء الكل» ثم محاولة إرسال
  c.pvAll(0);
  eq(c.pvOn().length, 0, 'none ticked:');
  c.pvSend('pdf');
  eq(A._pdfs.length, 1, 'and sending is refused:');
  eq(c._els('toast').textContent, 'لم تؤشّر شيئًا للإرسال', 'with a clear reason:');

  // «تحديد الكل» يعيدها جميعًا
  c.pvAll(1);
  eq(c.pvOn().length, 3, 'all back:');
});

run('العرض: مجموعة شاملة — أرسِل بعضها اليوم وبعضها غدًا', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  const ids = seedLabs(c, b, ['CBC', 'FBS', 'TSH', 'Vit D', 'HbA1c']);
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'الفحص الشامل'; c.groupCreate('labs');
  c.GPICK = {}; ids.forEach(i => c.groupPickToggle(i)); c.groupPickAdd();

  const A = androidStub(); c.window.AndroidBridge = A;

  // مريض أوّل: اثنان فقط من الخمسة
  c.groupPreview(c.DB.groups[0].id);
  c._els('pv-who').value = 'أحمد'; c.pvWho();
  c.pvPick(ids[2]); c.pvPick(ids[3]); c.pvPick(ids[4]);
  eq(c.pvOn().length, 2, 'two ticked for this patient:');
  c.pvSend('pdf');
  eq(A._pdfs[0].html.split('class="rx-item"').length - 1, 2, 'and two went out:');
  eq(A._pdfs[0].name.indexOf('أحمد') >= 0, true, 'under the patient name:');
  eq(A._pdfs[0].html.indexOf('أحمد') >= 0, true, 'which is on the paper too:');

  // والمجموعة لم تتغيّر — مريض ثانٍ يأخذ غيرها
  eq(b._t.groups[0].items.length, 5, 'the group still holds all five:');
  c.goBack();
  c.groupPreview(c.DB.groups[0].id);
  eq(c.pvOn().length, 5, 'and the next patient starts from all five:');
  c._els('pv-who').value = 'سارة'; c.pvWho();
  c.pvPick(ids[0]);
  c.pvSend('pdf');
  eq(A._pdfs[1].html.split('class="rx-item"').length - 1, 4, 'four for the second patient:');
  eq(A._pdfs[1].name.indexOf('سارة') >= 0, true, 'under their own name:');
});

run('العرض: ورقة مضغوطة تصغّر المقاسات وتُحفَظ', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('labs'); c._els('lf-name').value = 'CBC'; c.labSave('');
  c.toggleCart('labs', b._t.labs[0].id);
  const A = androidStub(); c.window.AndroidBridge = A;

  c.previewCart('labs'); c.pvSend('pdf');
  eq(A._pdfs[0].html.indexOf('font-size:11pt') >= 0, true, 'normal density by default:');

  c.pvDense();
  eq(c.DB.dense, 1, 'toggled:');
  eq(b._t.settings.dense, '1', 'persisted:');
  c.pvSend('pdf');
  eq(A._pdfs[1].html.indexOf('font-size:9.5pt') >= 0, true, 'compact sizes:');
  eq(A._pdfs[1].html.indexOf('CBC') >= 0, true, 'same content:');

  c.pvDense();
  eq(c.DB.dense, 0, 'back to normal:');
});

run('الإرسال: الصيغة المفضّلة تتصدّر الشريط', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('labs'); c._els('lf-name').value = 'CBC'; c.labSave('');
  c.toggleCart('labs', b._t.labs[0].id);
  const A = androidStub(); c.window.AndroidBridge = A;

  c.previewCart('labs');
  eq(c.DB.fmt, 'pdf', 'pdf to begin with:');
  let bar = c._els('page').innerHTML;
  eq(bar.indexOf('📄 PDF') < bar.indexOf('🖼️ صورة'), true, 'pdf first:');

  c.pvSend('img');
  eq(c.DB.fmt, 'img', 'remembers what was used:');
  eq(b._t.settings.fmt, 'img', 'persisted:');
  c.render();
  bar = c._els('page').innerHTML;
  eq(bar.indexOf('🖼️ صورة') < bar.indexOf('📄 PDF'), true, 'image moved to the front:');
  eq(bar.split('btn primary sm').length - 1, 1, 'and it is the highlighted one:');
});

run('الإرسال: اسم المريض في الورقة واسم الملف والنص', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('labs'); c._els('lf-name').value = 'CBC'; c.labSave('');
  c.toggleCart('labs', b._t.labs[0].id);
  const A = androidStub(); c.window.AndroidBridge = A;

  c.previewCart('labs');
  c._els('pv-who').value = 'سعد العتيبي';
  c.pvWho();
  c.pvSend('pdf');
  eq(A._pdfs[0].html.indexOf('سعد العتيبي') >= 0, true, 'in the paper:');
  eq(A._pdfs[0].name, 'قائمة تحاليل - سعد العتيبي', 'in the file name:');

  c.pvSend('copy');
  eq(A._clip.indexOf('سعد العتيبي') >= 0, true, 'in the copied text:');

  // فارغ = لا أثر له إطلاقًا
  c._els('pv-who').value = ''; c.pvWho();
  c.pvSend('pdf');
  eq(A._pdfs[1].name, 'قائمة تحاليل', 'no trace when left empty:');
  eq(A._pdfs[1].html.indexOf('سعد') < 0, true, 'and none in the paper:');
});

run('الإرسال: السجل يحفظ آخر عشرة ويعيدها بضغطة', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('labs');
  ['CBC', 'ESR'].forEach(n => { c._els('lf-name').value = n; c.labSave(''); });
  const A = androidStub(); c.window.AndroidBridge = A;
  c.DB.labs.forEach(l => c.toggleCart('labs', l.id));

  c.previewCart('labs');
  c._els('pv-who').value = 'سعد'; c.pvWho();
  c.pvSend('pdf');
  eq(b._t.sent.length, 1, 'recorded:');
  eq(b._t.sent[0].ids.length, 2, 'with its items:');
  eq(b._t.sent[0].who, 'سعد', 'and the patient:');

  c.goHome();
  eq(c._els('page').innerHTML.indexOf('آخر ما أرسلت (1)') >= 0, true, 'shortcut on home:');

  // إعادة الفتح
  c.clearCart('labs'); c._els('cb-yes').onclick();
  c.goPage('sent');
  eq(c._els('page').innerHTML.indexOf('اليوم') >= 0, true, 'shows when it was sent:');
  c.sentOpen(c.DB.sent[0].id);
  eq(c.curPage(), 'pv', 'opened the preview:');
  eq(c.PV.ids.length, 2, 'with the same list:');
  eq(c.PV.who, 'سعد', 'and the same patient:');
  eq(b._t.cart.labs.length, 0, 'without touching the cart:');

  // عنصر حُذف بعد الإرسال يُستبعَد ولا ينهار السجل
  c.labDel(c.DB.labs[0].id); c._els('cb-yes').onclick();
  c.sentOpen(c.DB.sent[0].id);
  eq(c.PV.ids.length, 1, 'deleted items are skipped:');

  // القصّ على عشرة
  for (let i = 0; i < 12; i++) { c.previewCart; c.logSent('labs', [c.DB.labs[0].id], 'ق' + i, ''); }
  eq(c.DB.sent.length, 10, 'capped at ten:');
  eq(b._t.sent.length, 10, 'in the db too:');

  c.sentClear(); c._els('cb-yes').onclick();
  eq(c.DB.sent.length, 0, 'cleared:');
  eq(b._t.labs.length, 1, 'and no item was harmed:');
});

// صورة صغيرة صالحة (١×١ بكسل) للاختبارات
const PIX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////'
  + '////////////////////////////////////////////////////2wBDAf//////////////'
  + '////////////////////////////////////////////////////wAARCAABAAEDASIAAhEB'
  + 'AxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAA'
  + 'AAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAAAf/Z';

function addPic(c, code, name) {
  const rec = { id: c.uid(), code, name: name || '', data: PIX };
  c.DB.images.push(rec); c.Store.saveImage(rec);
  return rec;
}

run('الصور: رمز داخل النصّ يصير صورة في الورقة', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  addPic(c, 'arf', 'موضع الحقن');
  eq(b._t.images.length, 1, 'stored in the library:');

  c.goPage('recipes');
  c._els('rf-name').value = 'ضمادة الجرح';
  c._els('rf-ingredients').value = 'نظّف الجرح {arf} ثم ضع الشاش';
  c.recipeSave('');
  c.DB.out.recipes = ['ingredients'];

  const html = c.itemsHtml('recipes', [b._t.recipes[0].id]);
  eq(html.indexOf('class="rx-pic"') >= 0, true, 'the code became an image:');
  eq(html.indexOf('{arf}') < 0, true, 'and the code itself is gone:');
  eq(html.indexOf('نظّف الجرح') >= 0 && html.indexOf('ثم ضع الشاش') >= 0, true,
    'the text around it survives:');

  // رمز غير معروف يبقى نصًّا كما كتبه المستخدم
  c._els('rf-name').value = 'أخرى';
  c._els('rf-ingredients').value = 'شيء {غير} موجود {zzz}';
  c.recipeSave('');
  const h2 = c.itemsHtml('recipes', [b._t.recipes[1].id]);
  eq(h2.indexOf('{zzz}') >= 0, true, 'unknown code left as text:');
  eq(h2.indexOf('class="rx-pic"') < 0, true, 'and no image invented:');
});

run('الصور: صورة العنصر تُختار من المكتبة وتظهر في الورقة والبطاقة', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  addPic(c, 'pill', 'شكل الحبّة');

  c.goPage('meds');
  c.medForm();
  eq(c._els('modal-body').innerHTML.indexOf('id="mf-imgsel"') >= 0, true, 'picker offered:');
  c._els('mf-trade_name').value = 'بنادول';
  c._els('mf-img').value = 'pill';
  c.medSave('');
  eq(b._t.meds[0].img, 'pill', 'stored on the item:');

  eq(c._els('page').innerHTML.indexOf('class="cardpic"') >= 0, true, 'thumbnail on the card:');
  eq(c.itemsHtml('meds', [b._t.meds[0].id]).indexOf('class="rx-pic"') >= 0, true, 'in the paper:');

  // صورة محذوفة لا تكسر شيئًا
  c.imgDel2(c.DB.images[0].id); c._els('cb-yes').onclick();
  eq(c.itemsHtml('meds', [b._t.meds[0].id]).indexOf('class="rx-pic"') < 0, true,
    'a deleted picture simply disappears:');
  eq(b._t.meds[0].trade_name, 'بنادول', 'and the item is untouched:');
});

run('الصور: النصّ المنسوخ يذكر اسم الصورة بدل رمزها', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  addPic(c, 'arf', 'موضع الحقن');
  c.goPage('recipes');
  c._els('rf-name').value = 'الحقن';
  c._els('rf-ingredients').value = 'احقن هنا {arf} ببطء';
  c.recipeSave('');
  c.DB.out.recipes = ['ingredients'];

  const A = androidStub(); c.window.AndroidBridge = A;
  c.toggleCart('recipes', b._t.recipes[0].id);
  c.previewCart('recipes'); c.pvSend('copy');
  eq(A._clip.indexOf('[صورة: موضع الحقن]') >= 0, true, 'named in plain text:');
  eq(A._clip.indexOf('{arf}') < 0, true, 'not the raw code:');
});

run('الصور: الرمز فريد ولا يتغيّر، والمكتبة تدخل النسخة الاحتياطية', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('imgs');

  // إنشاء عبر النموذج
  c.imgForm2('', PIX);
  c._els('im-code').value = 'ARF!!'; c._els('im-name').value = 'موضع الحقن';
  c._els('im-data').value = PIX;
  c.imgSave2('');
  eq(b._t.images[0].code, 'arf', 'code normalised to safe characters:');

  // الرمز مستعمل
  c.imgForm2('', PIX);
  c._els('im-code').value = 'arf'; c._els('im-data').value = PIX;
  c.imgSave2('');
  eq(b._t.images.length, 1, 'duplicate code refused:');
  eq(c._els('toast').textContent, 'الرمز مستعمل');

  // التعديل يغيّر الاسم لا الرمز
  c.imgEdit(b._t.images[0].id);
  eq(c._els('modal-body').innerHTML.indexOf('id="im-code"') < 0, true, 'code not editable:');
  c._els('im-name').value = 'موضع الإبرة';
  c.imgSave2(b._t.images[0].id);
  eq(b._t.images[0].name, 'موضع الإبرة', 'name changed:');
  eq(b._t.images[0].code, 'arf', 'code kept so {arf} keeps working:');

  // النسخة الاحتياطية
  const backup = JSON.parse(JSON.stringify(c.DB));
  eq(backup.images.length, 1, 'in the backup:');
  const b2 = makeBridge(); const c2 = load(b2); c2.Store.load();
  c2.applyData(backup); c2.Store.replaceAll();
  eq(b2._t.images[0].code, 'arf', 'restored:');
  eq(c2.imgData('arf').indexOf('data:image/jpeg') === 0, true, 'with its data:');
});

run('الحقول: إضافة حقل من داخل النموذج بلا فقد ما كُتب', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('meds');
  c.medForm();
  eq(c._els('modal-body').innerHTML.indexOf('إضافة حقل لهذا القسم') >= 0, true,
    'the panel is right there in the form:');

  // المستخدم يملأ ثم يحتاج حقلًا ليس موجودًا
  c._els('mf-trade_name').value = 'أوجمنتين';
  c._els('mf-nf').value = 'الشركة المصنّعة';
  c._els('mf-nt').value = 'text';
  c.fldInline('meds', 'mf');

  eq(b._t.fields.length, 1, 'field created:');
  const key = b._t.fields[0].key;
  eq(c.DB.out.meds.indexOf('x:' + key) >= 0, true, 'and offered in the output at once:');
  eq(c._els('mf-trade_name').value, 'أوجمنتين', 'what was typed survived:');
  eq(c._els('mf-nf').value, '', 'the panel cleared for the next one:');
  eq(c._els('mf-xf').innerHTML.indexOf('mf-x-' + key) >= 0, true,
    'and the field was injected into the open form:');

  // الحقل الجديد قابل للتعبئة والحفظ فورًا
  c._els('mf-x-' + key).value = 'GSK';
  c.medSave('');
  eq(b._t.meds[0].trade_name, 'أوجمنتين', 'item saved:');
  eq(b._t.meds[0].extra[key], 'GSK', 'with the brand-new field filled:');

  // بلا اسم لا يُنشأ شيء
  c.medForm();
  c._els('mf-nf').value = '   ';
  c.fldInline('meds', 'mf');
  eq(b._t.fields.length, 1, 'blank name refused:');
});

run('الحقول: الوصول إليها من صفحة التصنيفات وبالعكس', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  c.goPage('cat:labs');
  const cats = c._els('page').innerHTML;
  eq(cats.indexOf("goPage('fld:labs')") >= 0, true, 'fields reachable from categories:');
  eq(cats.indexOf('أضِف حقلًا لبياناتها') >= 0, true, 'and it says what it does:');

  c.goPage('fld:labs');
  eq(c._els('page').innerHTML.indexOf("goPage('cat:labs')") >= 0, true, 'and back again:');
});

/* ── تأمين البيانات: قراءةٌ فاشلة لا يجوز أن تصير حذفًا ────────────── */

run('الأمان: قراءة فاشلة لا تكتب حرفًا ولا تزرع تصنيفات', () => {
  ['throw', 'empty', 'flag'].forEach(mode => {
    const b = brokenBridge(mode);
    // بياناتٌ قائمة في القاعدة: يجب أن تبقى كما هي بعد إقلاعٍ فاشل
    b._t.labs.push({ id: 'L1', name: 'CBC', category: 'أمراض الدم' });
    b._t.sections.push({ id: 'sec1', title: 'نصائح', icon: '💡', builtin: 0 });
    b._t.items.push({ id: 'i1', section: 'sec1', name: 'اشرب ماءً' });
    b._t.cats.push({ id: 'c1', kind: 'labs', name: 'أمراض الدم' });
    const before = JSON.stringify(b._t);

    const c = load(b);
    c.boot();

    eq(c.Store.ok, false, mode + ': the failure is recognised:');
    eq(JSON.stringify(b._t), before, mode + ': not one byte was written:');
    eq(c._els('lock').className.indexOf('on') >= 0, true, mode + ': recovery screen shown:');
    eq(c._els('app').className.indexOf('on') < 0, true, mode + ': the app itself stays shut:');
    const html = c._els('lock').innerHTML;
    eq(html.indexOf('لم تُحذف') >= 0, true, mode + ': it says the data is not gone:');
    eq(html.indexOf('إعادة المحاولة') >= 0, true, mode + ': retry offered:');
  });
});

run('الأمان: درع الكتابة يردّ كل محاولة بعد قراءة فاشلة', () => {
  const b = brokenBridge('flag');
  b._t.labs.push({ id: 'L1', name: 'CBC' });
  const before = JSON.stringify(b._t);
  const c = load(b);
  c.boot();

  eq(c.Store.saveCat({ id: 'z', kind: 'labs', name: 'جديد' }), false, 'saveCat refused:');
  eq(c.Store.upsert('labs', { id: 'z', name: 'x' }), false, 'upsert refused:');
  eq(c.Store.replaceAll(), false, 'replaceAll refused:');
  eq(c.Store.dropSection('sec1'), false, 'dropSection refused:');
  eq(JSON.stringify(b._t), before, 'the database is untouched:');
});

run('الأمان: الاستعادة من شاشة الإنقاذ تفتح الدرع وتُدخل التطبيق', () => {
  // نبني نسخة احتياطية من جلسة سليمة، ثم نُقلع على قاعدة معطوبة
  const good = makeBridge(); const g = load(good); g.Store.load(); g.showApp();
  const A = androidStub(); g.window.AndroidBridge = A;
  vm.runInContext('AB = window.AndroidBridge;', g);
  g.DB.labs.push({ id: 'L1', name: 'CBC', category: 'أمراض الدم' });
  g.secNew(); g._els('sf-title').value = 'نصائح'; g._els('sf-icon').value = '💡';
  g.secCreate();
  const k = g.DB.sections[4].id;
  g.secItemForm(k); g._els('cf-name').value = 'اشرب ماءً'; g.secItemSave(k, '');
  const backupName = g.autoBackup(true);
  eq(!!backupName, true, 'a backup exists to restore from:');

  const b = brokenBridge('flag');
  const c = load(b);
  c.window.AndroidBridge = A;
  vm.runInContext('AB = window.AndroidBridge;', c);
  c.boot();
  eq(c._els('lock').innerHTML.indexOf('recoverFrom') >= 0, true, 'the backup is offered:');

  c.recoverFrom(backupName);
  c._els('dz-in').value = 'استبدال'; c.dzCheck();
  c._els('cb-yes').onclick();
  eq(c.Store.ok, true, 'the shield is opened by the user’s own choice:');
  eq(b._t.labs.length, 1, 'the lab came back:');
  eq(b._t.items.length, 1, 'and the item of the created section too:');
  eq(c._els('app').className.indexOf('on') >= 0, true, 'and the app is in:');
});

run('الأمان: نسخة احتياطية فارغة لا تُكتب ولا تُزيح نسخةً صالحة', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  const A = androidStub(); c.window.AndroidBridge = A;
  vm.runInContext('AB = window.AndroidBridge;', c);

  eq(c.autoBackup(true), false, 'nothing to save, nothing written:');
  eq(JSON.parse(A.listBackups()).length, 0, 'no empty file left behind:');

  c.DB.images.push({ id: 'm1', code: 'arf', name: 'صورة', data: 'data:,' });
  eq(!!c.autoBackup(true), true, 'a library of images alone is data enough:');
});

run('الأمان: نسخة قبل حذف قسم كامل', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  const A = androidStub(); c.window.AndroidBridge = A;
  vm.runInContext('AB = window.AndroidBridge;', c);

  c.secNew(); c._els('sf-title').value = 'نصائح'; c._els('sf-icon').value = '💡';
  c.secCreate();
  const id = c.DB.sections[4].id;
  c.secItemForm(id); c._els('cf-name').value = 'اشرب ماءً'; c.secItemSave(id, '');

  c.secDel(id);
  c._els('dz-in').value = 'نصائح'; c.dzCheck();
  c._els('cb-yes').onclick();
  eq(b._t.sections.filter(s => !s.builtin).length, 0, 'the section is gone as asked:');
  const files = JSON.parse(A.listBackups());
  eq(files.length, 1, 'but a safety copy was taken first:');
  eq(JSON.parse(A.readBackup(files[0].name))[id].length, 1, 'and it still holds the item:');
});

run('الأمان: الترحيل القديم لا يستبدل قاعدةً فيها بيانات المستخدم', () => {
  const legacy = JSON.stringify({ meds: [{ id: 'old', trade_name: 'قديم' }], labs: [] });
  const b = makeBridge();
  // بيانات المستخدم كلها في قسمٍ أنشأه هو — الجداول الأربعة فارغة
  b._t.sections.push({ id: 'sec1', title: 'نصائح', icon: '💡', builtin: 0 });
  b._t.items.push({ id: 'i1', section: 'sec1', name: 'اشرب ماءً' });
  const c = load(b, legacy);
  c.boot();

  eq(b._t.items.length, 1, 'the created section kept its item:');
  eq(b._t.meds.length, 0, 'and the legacy blob did not replace it:');
});

run('الأمان: عطبٌ في جدولٍ واحد لا يُخفي بقيّة البيانات', () => {
  const b = makeBridge();
  b._t.labs.push({ id: 'L1', name: 'CBC' });
  const inner = b.loadAll;
  // كما تفعل DaliliDb: الجدول المعطوب يعود فارغًا ويُسجَّل في errors
  b.loadAll = () => {
    const d = JSON.parse(inner());
    d.images = []; d.errors = ['images: no such column: data'];
    return JSON.stringify(d);
  };
  const c = load(b); c.boot();

  eq(c.Store.ok, true, 'a partial fault is not a total failure:');
  eq(c._els('app').className.indexOf('on') >= 0, true, 'the app opens on what did load:');
  eq(c.DB.labs.length, 1, 'and shows it:');
  eq(c.Store.errors.length, 1, 'while the fault is remembered, not swallowed:');
});

run('الأمان: تصنيفات تكرّرت بأثر عطبٍ سابق تُنظَّف مرّة', () => {
  const b = makeBridge();
  b._t.labs.push({ id: 'L1', name: 'CBC', category: 'أمراض الدم' });
  b._t.cats.push({ id: 'c1', kind: 'labs', name: 'أمراض الدم' });
  b._t.cats.push({ id: 'c2', kind: 'labs', name: 'أمراض الدم' });
  b._t.cats.push({ id: 'c3', kind: 'labs', name: 'كيمياء الدم' });
  const c = load(b); c.boot();

  eq(b._t.cats.length, 2, 'the duplicate row is gone:');
  eq(b._t.cats.map(x => x.id).sort(), ['c1', 'c3'], 'the first of each name stays:');
  eq(b._t.labs[0].category, 'أمراض الدم', 'and not one item lost its category:');
});

/* ── «إمّا موجود أو غير موجود»: لا أشباح في أي قائمة ──────────────── */

run('الأشباح: معرّف بلا عنصر لا يُعرَض ولا يُرسَل', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  const ids = seedLabs(c, b, ['CBC', 'FBS']);

  // سلة فيها الحقيقيان وثلاثة معرّفات لا عناصر لها (حالة لقطة المستخدم)
  c.DB.cart.labs = ids.concat(['ghostA', 'ghostB', 'ghostC']);
  c.previewCart('labs');
  eq(c.curPage(), 'pv', 'the preview still opens on what is real:');
  eq(c.PV.ids, ids, 'and carries only the living ones:');

  c.pvTab('list');
  eq(c._els('page').innerHTML.indexOf('عنصر محذوف') < 0, true, 'no ghost rows on screen:');

  // ولا شيء حقيقي البتّة ⇒ لا تُفتَح أصلًا
  c.goHome();
  c.DB.cart.labs = ['ghostA', 'ghostB'];
  c.previewCart('labs');
  eq(c.curPage(), 'home', 'an all-ghost list does not open at all:');
  eq(c._els('toast').textContent, 'لا عناصر في هذه القائمة', 'and says so plainly:');
});

run('الأشباح: تُنظَّف من السلة والمجموعات عند إقلاعٍ نظيف', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  const ids = seedLabs(c, b, ['CBC', 'FBS']);
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'مجموعة'; c.groupCreate('labs');
  c.GPICK = {}; ids.forEach(i => c.groupPickToggle(i)); c.groupPickAdd();

  // كما لو حُذفت العناصر من خارج التطبيق وبقيت الإشارات إليها
  b._t.labs = [];
  b._t.cart.labs = ids.concat('ghost');
  b._t.groups[0].items = ids.concat('ghost');

  const c2 = load(b); c2.boot();
  eq(c2.Store.ok, true, 'the read itself was clean:');
  eq(b._t.cart.labs, [], 'the cart was swept:');
  eq(b._t.groups[0].items, [], 'and so was the group:');
});

run('الأشباح: قراءةٌ معطوبة لا تُشرِّع حذف التحديد', () => {
  const b = makeBridge();
  b._t.labs.push({ id: 'L1', name: 'CBC' });
  b._t.cart.labs = ['L1', 'L2', 'L3'];
  const inner = b.loadAll;
  b.loadAll = () => {                     // جدول العناصر تعذّر، والسلة وصلت
    const d = JSON.parse(inner());
    d.labs = []; d.errors = ['labs: Row too big to fit into CursorWindow'];
    return JSON.stringify(d);
  };
  const c = load(b); c.boot();

  eq(c.Store.errors.length, 1, 'the fault is known:');
  eq(b._t.cart.labs, ['L1', 'L2', 'L3'], 'and the selection is left alone — a bad read is no licence to delete:');
});

run('القائمة: الدرج يسرد الأقسام والأدوات والمجموعات معًا', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  seedLabs(c, b, ['CBC', 'FBS', 'TSH']);

  c.goPage('recipes');
  c.openDrawer();
  const dw = c._els('dw-body').innerHTML;
  ['العلاجات', 'التحاليل', 'الأشعة والفحوصات', 'الوصفات العلاجية'].forEach(t => {
    eq(dw.indexOf(t) >= 0, true, 'section listed — ' + t + ':');
  });
  eq(dw.indexOf('آخر ما أرسلت') >= 0, true, 'and the tools:');
  eq(dw.indexOf('مكتبة الصور') >= 0, true, 'image library too:');
  eq(dw.indexOf('>3<') >= 0, true, 'with how many each section holds:');

  c.drawerGo('labs');
  eq(c.curPage(), 'labs', 'one tap takes you to the section:');
  eq(c._els('dw').className.indexOf('on') < 0, true, 'and shuts the drawer behind it:');
});

/* ── «فارغ» لا يجوز أن تعني «لم أستطع القراءة» ───────────────────── */

run('الصدق: قسمٌ تعذّرت قراءته لا يُعرَض فارغًا', () => {
  const b = makeBridge();
  b._t.labs.push({ id: 'L1', name: 'CBC', category: 'كيمياء الدم' });
  b._t.cats.push({ id: 'c1', kind: 'labs', name: 'كيمياء الدم' });
  b._t.cart.labs = ['L1'];
  const inner = b.loadAll;
  b.loadAll = () => {                        // جدول التحاليل وحده تعذّر
    const d = JSON.parse(inner());
    d.labs = []; d.errors = ['labs: no such column: sort_order'];
    return JSON.stringify(d);
  };
  const c = load(b); c.boot();

  // صفحة القسم
  c.goPage('labs');
  let html = c._els('page').innerHTML;
  eq(html.indexOf('لا توجد تحاليل محفوظة') < 0, true, 'does not claim to be empty:');
  eq(html.indexOf('ليس فارغًا') >= 0, true, 'says the opposite, plainly:');
  eq(html.indexOf('لا تُعِد إدخالها') >= 0, true, 'and warns against re-typing over it:');
  eq(html.indexOf("goPage('diag')") >= 0, true, 'with a way to look:');

  // صفحة التصنيفات — حيث رآها المستخدم «فارغ» سطرًا بعد سطر
  c.goPage('cat:labs');
  html = c._els('page').innerHTML;
  eq(html.indexOf('عناصر هذا القسم لم تُقرأ') >= 0, true, 'the categories page says why they all read empty:');

  // الرئيسية
  c.goHome();
  html = c._els('page').innerHTML;
  eq(html.indexOf('تعذّرت قراءة جزء من بياناتك') >= 0, true, 'a standing banner, not a passing toast:');
  eq(html.indexOf('⚠️ تعذّرت القراءة') >= 0, true, 'and the card says so too:');

  // ولا كتابة ولا تنظيف
  eq(b._t.cart.labs, ['L1'], 'and nothing was swept away on a bad read:');
});

run('الصدق: قسمٌ فارغ فعلًا يبقى فارغًا بلا تهويل', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.goPage('labs');
  const html = c._els('page').innerHTML;
  eq(html.indexOf('لا توجد تحاليل محفوظة') >= 0, true, 'a truly empty section reads empty:');
  eq(html.indexOf('ليس فارغًا') < 0, true, 'with no alarm:');
  c.goHome();
  eq(c._els('page').innerHTML.indexOf('تعذّرت قراءة') < 0, true, 'and no banner on the home page:');
});

/* ── إضافة عنصر للمجموعة: ثلاثة طرق، ولا طريق مسدود ───────────────── */

run('المجموعة: منتقٍ فارغ يقود لإنشاء عنصر لا لطريق مسدود', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'عامة'; c.groupCreate('labs');

  // القسم فارغ تمامًا — المنتقي كان يعرض «لا نتائج» وحسب
  c.groupPick();
  const html = c._els('gp-list').innerHTML;
  eq(html.indexOf('لا نتائج') < 0, true, 'no bare dead end:');
  eq(html.indexOf('groupAddNew') >= 0, true, 'it offers to create one instead:');
  eq(html.indexOf('المجموعة تُجمَّع من عناصر القسم') >= 0, true, 'and explains why it is empty:');
});

run('المجموعة: «أنشئ عنصرًا وأضِفه» يحفظ العنصر ويدخله المجموعة', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'عامة'; c.groupCreate('labs');

  c.groupPick();
  c.groupAddNew();                       // يفتح نموذج القسم
  c._els('lf-name').value = 'CBC';
  c.labSave('');

  eq(b._t.labs.length, 1, 'the item itself was saved to the section:');
  eq(b._t.groups[0].items.length, 1, 'and joined the group:');
  eq(b._t.groups[0].items[0], b._t.labs[0].id, 'the very one:');
  eq(c.curPage().indexOf('grp:labs:') === 0, true, 'and we are back in the group, not the section:');
});

run('المجموعة: بحثٌ بلا نتيجة يُنشئ بالاسم ويضيف', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  const ids = seedLabs(c, b, ['CBC']);
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'عامة'; c.groupCreate('labs');

  c.groupPick();
  c._els('gp-q').value = 'فيتامين د';
  c.groupPickRender();
  eq(c._els('gp-list').innerHTML.indexOf('groupAddNamed') >= 0, true, 'offers to create it by that name:');

  c.groupAddNamed();
  eq(b._t.labs.length, 2, 'created:');
  eq(b._t.labs[1].name, 'فيتامين د', 'with the name typed:');
  eq(b._t.groups[0].items.length, 1, 'and added to the group:');
  eq(ids.length, 1, '(the pre-existing one untouched)');
});

run('المجموعة: الإضافة لا تكرّر عنصرًا موجودًا', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  const ids = seedLabs(c, b, ['CBC', 'FBS']);
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'عامة'; c.groupCreate('labs');
  c.GPICK = {}; ids.forEach(i => c.groupPickToggle(i)); c.groupPickAdd();
  eq(b._t.groups[0].items.length, 2, 'two in:');

  c.GPICK = {}; c.groupPickToggle(ids[0]); c.groupPickAdd();
  eq(b._t.groups[0].items.length, 2, 'adding the same one again changes nothing:');
});

run('المجموعة: «إضافة عنصر» و«عرض» تعملان من القائمة مباشرةً', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  const ids = seedLabs(c, b, ['CBC']);
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'عامة'; c.groupCreate('labs');
  const gid = c.DB.groups[0].id;

  c.goPage('meds');                      // من صفحة بعيدة
  c.groupOpen(gid);
  eq(c.curPage(), 'grp:labs:' + gid, '«عرض» opens the group:');

  c.goPage('meds');
  c.groupAddTo(gid);
  eq(c.curPage(), 'grp:labs:' + gid, '«إضافة عنصر» goes to the group:');
  eq(c._els('modal-bg').className.indexOf('on') >= 0, true, 'and opens the picker right away:');
  eq(c._els('gp-list').innerHTML.indexOf('CBC') >= 0, true, 'with the section items ready:');
});

run('المجموعة: «إرسال» معطّل ما دامت فارغة', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'عامة'; c.groupCreate('labs');
  c.goBack();
  const html = c._els('page').innerHTML;
  eq(/📤 إرسال<\/button>/.test(html.replace(/\s+disabled/g, '')), true, 'the button is there:');
  eq(html.indexOf('disabled>📤 إرسال') >= 0, true, 'but disabled while there is nothing to send:');
});

/* ── الإضافة مباشرةً من المكتبة الجاهزة إلى المجموعة ──────────────── */

run('المكتبة ← المجموعة: استيراد وإضافة في خطوة واحدة', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'عامة'; c.groupCreate('labs');
  eq(c.DB.labs.length, 0, 'the section starts empty:');

  c.groupPick();
  eq(c._els('modal-body').innerHTML.indexOf('📚 المكتبة الجاهزة') >= 0, true, 'a library tab is offered:');
  eq(c._els('gp-list').innerHTML.indexOf('gpTab') >= 0, true, 'and the empty state points at it too:');

  c.gpTab('lib');
  const list = c._els('gp-list').innerHTML;
  eq(list.indexOf('gpLibToggle') >= 0, true, 'the library is listed:');
  eq(list.indexOf('والمجموعة معًا') >= 0, true, 'and says where the picks will land:');

  c.gpLibToggle(0); c.gpLibToggle(1);
  c.groupPickAdd();

  eq(c.DB.labs.length, 2, 'both were imported into the section:');
  eq(b._t.labs.length, 2, 'and persisted:');
  eq(b._t.groups[0].items.length, 2, 'and both joined the group:');
  eq(b._t.cats.filter(x => x.kind === 'labs').length > 0, true, 'their categories were registered too:');

  // وبعد إعادة التشغيل
  const c2 = load(b); c2.Store.load();
  eq(c2.DB.groups[0].items.length, 2, 'and it all survives a restart:');
});

run('المكتبة ← المجموعة: ما عندي لا يُستنسخ', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  // استورد واحدًا من المكتبة بالطريق المعتاد أولًا
  c.goPage('lib:labs'); c.libToggle(0); c.libAdd();
  eq(c.DB.labs.length, 1, 'one imported the usual way:');
  const existingId = c.DB.labs[0].id;

  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'عامة'; c.groupCreate('labs');
  c.groupPick(); c.gpTab('lib');
  c.gpLibToggle(0); c.gpLibToggle(1);     // الأول عنده، الثاني لا
  c.groupPickAdd();

  eq(c.DB.labs.length, 2, 'only the genuinely new one was added to the section:');
  eq(b._t.groups[0].items.length, 2, 'but both are in the group:');
  eq(b._t.groups[0].items.indexOf(existingId) >= 0, true, 'the existing one by its own id, not a copy:');
});

run('المكتبة ← المجموعة: ممنوعة ما دامت قراءة القسم معطوبة', () => {
  const b = makeBridge();
  b._t.labs.push({ id: 'L1', code: 'FBS', name: 'سكر الدم صائم' });
  b._t.groups.push({ id: 'g1', kind: 'labs', name: 'عامة', items: [] });
  const inner = b.loadAll;
  b.loadAll = () => {
    const d = JSON.parse(inner());
    d.labs = []; d.errors = ['labs: no such column: sort_order'];
    return JSON.stringify(d);
  };
  const c = load(b); c.boot();
  c.goPage('grp:labs:g1');
  c.groupPick();
  const html = c._els('gp-list').innerHTML;
  eq(html.indexOf('لم تُقرأ هذه المرة') >= 0, true, 'it refuses and explains:');
  eq(html.indexOf('gpLibToggle') < 0, true, 'and offers no library import over unread data:');
  eq(b._t.labs.length, 1, 'nothing was duplicated:');
});

run('الوضعان: كل قسم يقول أين أنت وأدواتُه تتبع ذلك', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  ['meds', 'labs', 'imaging', 'recipes'].forEach(k => {
    // وضع الإرسال — الافتراضي
    c.setMode('send'); c.goPage(k);
    let html = c._els('page').innerHTML;
    eq(html.indexOf('📤 إرسال') >= 0 && html.indexOf('📝 إدخال وتعديل') >= 0, true,
       k + ': both modes are on screen:');
    eq(html.indexOf('أشِّر ما تريد إرساله') >= 0, true, k + ': and it says what this one does:');
    eq(html.indexOf('📁 المجموعات') >= 0, true, k + ': sending reaches the groups:');
    eq(html.indexOf('إضافة عنصر') < 0, true, k + ': and offers no adding — that is the other mode:');
    eq(html.indexOf('🏷️ التصنيفات') < 0, true, k + ': nor the building tools:');

    // وضع الإدخال
    c.setMode('edit'); c.goPage(k);
    html = c._els('page').innerHTML;
    eq(html.indexOf('➕ إضافة عنصر') >= 0, true, k + ': adding is here, named in full:');
    eq(html.indexOf('🏷️ التصنيفات') >= 0, true, k + ': with the categories:');
    eq(html.indexOf('🧩 الحقول') >= 0, true, k + ': and the fields:');
    eq(html.indexOf('أضِف عناصرك وعدّلها') >= 0, true, k + ': and it says so:');
  });
});

run('الوضعان: البطاقة تعرض ما يخصّ الوضع وحده', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.setMode('edit'); c.goPage('labs');
  c._els('lf-name').value = 'CBC'; c.labSave('');

  let html = c._els('page').innerHTML;
  eq(html.indexOf('✏️') >= 0 && html.indexOf('🗑️') >= 0, true, 'edit mode: pencil and bin:');
  eq(html.indexOf('type="checkbox"') < 0, true, 'and no tick boxes to confuse it:');

  c.setMode('send');
  html = c._els('page').innerHTML;
  eq(html.indexOf('type="checkbox"') >= 0, true, 'send mode: a tick box:');
  eq(html.indexOf('🗑️') < 0, true, 'and nothing that deletes:');
  eq(html.indexOf('toggleCart') >= 0, true, 'the whole row ticks:');
});

run('الوضعان: الوضع يُحفَظ فلا يُعاد اختياره', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  eq(c.mode(), 'send', 'sending is the daily job, so it is the default:');
  c.setMode('edit');
  eq(b._t.settings.mode, 'edit', 'the choice is persisted:');

  const c2 = load(b); c2.boot();
  eq(c2.mode(), 'edit', 'and comes back on the next launch:');
});

run('الوضعان: شريط السلة لا يظهر وأنت تُدخِل', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.setMode('edit'); c.goPage('labs');
  c._els('lf-name').value = 'CBC'; c.labSave('');
  c.setMode('send');
  c.toggleCart('labs', c.DB.labs[0].id);
  eq(c._els('page').innerHTML.indexOf('عرض وإرسال') >= 0, true, 'the send bar is there while sending:');
  c.setMode('edit');
  eq(c._els('page').innerHTML.indexOf('عرض وإرسال') < 0, true, 'and out of the way while editing:');
  eq(c.DB.cart.labs.length, 1, 'though the selection itself is kept:');
});

/* ── حفظٌ فاشل لا يتظاهر بالنجاح ───────────────────────────────────── */

run('الحفظ: فشل الكتابة يُقال ولا تطمسه رسالة نجاح', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.goPage('labs');
  c._els('lf-name').value = 'CBC'; c.labSave('');
  eq(b._t.labs.length, 1, 'the first save worked:');
  const id = c.DB.labs[0].id;

  // كما لو رفضت القاعدة الكتابة (عمود ناقص مثلًا)
  b.upsertItem = () => false;
  c.labForm(id);
  c._els('lf-name').value = 'صورة دم كاملة';
  c.labSave(id);

  eq(c._els('toast').textContent.indexOf('لم يُحفَظ') >= 0, true, 'the failure is what the user is told:');
  eq(c._els('toast').textContent.indexOf('تم الحفظ') < 0, true, 'and no success message on top of it:');
  eq(c._els('modal-bg').className.indexOf('on') >= 0, true, 'the form stays open so the typing is not lost:');
  eq(b._t.labs[0].name, 'CBC', 'and the database is unchanged, as reported:');
});

run('الحفظ: النجاح يبقى نجاحًا', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.goPage('labs');
  c._els('lf-name').value = 'CBC'; c.labSave('');
  eq(c._els('toast').textContent.indexOf('تم الحفظ') >= 0, true, 'a real save says so:');
  eq(c._els('modal-bg').className.indexOf('on') < 0, true, 'and closes the form:');
  eq(b._t.labs.length, 1, 'and reached the database:');
});

/* ── الاتجاه: كل سطر يتبع لغته، والرقم في طرفه الصحيح ────────────────── */

run('الاتجاه: اسم لاتيني يُرسَم ltr وعربي rtl', () => {
  const c = load(makeBridge()); c.boot();
  eq(c.dirOf('Urea'), 'ltr', 'latin → ltr:');
  eq(c.dirOf('ALT (SGPT)'), 'ltr', 'latin with punctuation → ltr:');
  eq(c.dirOf('صورة دم كاملة'), 'rtl', 'arabic → rtl:');
  eq(c.dirOf('1. Urea'), 'ltr', 'leading digits do not decide — the letters do:');
  eq(c.dirOf('٢٠٢٤ سكر الدم'), 'rtl', 'nor arabic-indic digits:');
  eq(c.dirOf('123'), 'rtl', 'digits alone fall back to the page direction:');
  eq(c.dirOf(''), 'rtl', 'and so does nothing at all:');
});

run('الاتجاه: الورقة تضع dir=auto على كل سطر والرقم عنصرًا مستقلًّا', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.goPage('labs');
  ['Urea', 'صورة دم كاملة'].forEach(n => { c._els('lf-name').value = n; c.labSave(''); });
  c.DB.labs.forEach(l => c.toggleCart('labs', l.id));

  const html = c.itemsHtml('labs', c.DB.cart.labs);
  eq(html.indexOf('class="rx-name" dir="auto"') >= 0, true, 'the name line decides its own direction:');
  eq(html.indexOf('<span class="rx-n">1.</span>') >= 0, true, 'the number is its own element:');
  eq(html.indexOf('<span class="rx-t">Urea</span>') >= 0, true, 'and the name is not glued to it:');
  eq(/1\. ?Urea/.test(html.replace(/<[^>]+>/g, '')), true, 'they still read as “1. Urea”:');
  eq(html.indexOf('<span class="rx-n">2.</span>') >= 0, true, 'and numbering carries on:');

  // تنسيق الطباعة يحجز للرقم عمودًا
  const css = c.printCss('.paper', 0);
  eq(css.indexOf('.rx-n{') >= 0, true, 'the number has a column of its own:');
  eq(css.indexOf('text-align:start') >= 0, true, 'aligned to the line start, whichever side that is:');
});

run('الاتجاه: النصّ المنسوخ يحمل علامة اتجاه قبل الرقم', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.goPage('labs');
  ['Urea', 'صورة دم كاملة'].forEach(n => { c._els('lf-name').value = n; c.labSave(''); });
  c.DB.labs.forEach(l => c.toggleCart('labs', l.id));

  const A = androidStub(); c.window.AndroidBridge = A;
  c.copyList('labs', c.DB.cart.labs, 'قائمة تحاليل', '');
  const lines = A._clip.split('\n');
  const latin = lines.find(l => l.indexOf('Urea') >= 0);
  const arabic = lines.find(l => l.indexOf('صورة دم') >= 0);
  eq(latin.charCodeAt(0), 0x200E, 'the latin line is marked left-to-right:');
  eq(arabic.charCodeAt(0), 0x200F, 'the arabic line right-to-left:');
  eq(latin.indexOf('1. Urea') >= 0, true, 'numbered as it reads:');
  eq(arabic.indexOf('2. صورة دم كاملة') >= 0, true, 'and so is the arabic one:');
});

/* ── ترتيبٌ واحد في كل مكان ────────────────────────────────────────── */

function seedCatLabs(c, b, pairs) {
  c.goPage('labs');
  return pairs.map(([cat, name]) => {
    c._els('lf-name').value = name;
    c._els('lf-catsel') && (c._els('lf-catsel').value = cat);
    const rec = { id: c.uid(), category: cat, name: name, code: '', extra: {} };
    c.DB.labs.push(rec); c.catEnsure('labs', cat); c.Store.upsert('labs', rec);
    return rec.id;
  });
}

run('الترتيب: السلة تتبع ترتيب العرض لا ترتيب النقر', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  const ids = seedCatLabs(c, b, [['كيمياء', 'FBS'], ['كيمياء', 'Urea'], ['دم', 'CBC'], ['دم', 'ESR']]);
  const shown = c.displayOrder('labs');
  eq(shown.length, 4, 'four on screen:');

  // أشِّر بالعكس تمامًا
  shown.slice().reverse().forEach(id => c.toggleCart('labs', id));
  eq(c.DB.cart.labs, shown, 'the cart holds them in display order, not tap order:');
  eq(b._t.cart.labs, shown, 'and that is what is persisted:');

  // والورقة تتبعها
  const rows = c.rowsFor('labs', c.DB.cart.labs).map(r => r.title);
  const names = shown.map(id => c.DB.labs.find(x => x.id === id).name);
  eq(rows, names, 'and the paper reads the same way:');

  // «تحديد الكل» على تصنيف لا يكسرها
  c.clearCart('labs'); c._els('cb-yes').onclick();
  c.toggleIds('labs', [ids[3], ids[2]]);
  eq(c.DB.cart.labs, [ids[2], ids[3]], 'select-all keeps display order too:');
});

run('الترتيب: ترتيب التصنيفات يقود ترتيب كل شيء', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  const ids = seedCatLabs(c, b, [['كيمياء', 'FBS'], ['دم', 'CBC']]);
  eq(c.displayOrder('labs'), ids, 'chemistry first, as created:');

  c.DB.labs.forEach(l => c.toggleCart('labs', l.id));
  eq(c.DB.cart.labs, ids, 'cart follows:');

  // ارفع «دم» فوق «كيمياء»
  const dam = c.DB.cats.find(x => x.kind === 'labs' && x.name === 'دم');
  const i = c.catsRaw('labs').findIndex(x => x.id === dam.id);
  for (let k = i; k > 0; k--) c.catMove('labs', dam.id, -1);

  eq(c.displayOrder('labs'), [ids[1], ids[0]], 'the section flipped:');
  c.boot();                       // إقلاعٌ جديد يُعيد ترتيب السلة المحفوظة
  eq(c.DB.cart.labs, [ids[1], ids[0]], 'and so did the stored cart:');
  const rows = c.rowsFor('labs', c.DB.cart.labs).map(r => r.title);
  eq(rows, ['CBC', 'FBS'], 'and the paper with it:');
});

run('الترتيب: الدفعة الجديدة تدخل المجموعة بترتيب العرض', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  const ids = seedCatLabs(c, b, [['كيمياء', 'FBS'], ['كيمياء', 'Urea'], ['دم', 'CBC']]);
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'شاملة'; c.groupCreate('labs');

  // أضِفها بترتيب معكوس
  c.GPICK = {}; ids.slice().reverse().forEach(i => c.groupPickToggle(i)); c.groupPickAdd();
  eq(b._t.groups[0].items, ids, 'they land in display order:');

  // وترتيب المجموعة الذي يضبطه المستخدم لا يُمَسّ بعدها
  c.groupItemMove(ids[2], -1);
  eq(b._t.groups[0].items, [ids[0], ids[2], ids[1]], 'his own arrangement stands:');
  const more = seedCatLabs(c, b, [['دم', 'ESR']]);
  c.GPICK = {}; c.groupPickToggle(more[0]); c.groupPickAdd();
  eq(b._t.groups[0].items, [ids[0], ids[2], ids[1], more[0]], 'and new ones only append:');
});

run('الوضعان: البحث بلا نتيجة يدلّ على وضع الإدخال بدل أن يُضيف', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.setMode('edit'); c.goPage('labs');
  c._els('lf-name').value = 'CBC'; c.labSave('');

  c.setMode('send');
  c._els('srch').value = 'فيتامين د'; c.renderLabs();
  const html = c._els('page').innerHTML;
  eq(html.indexOf('لا نتيجة') >= 0, true, 'it still says there is no hit:');
  eq(html.indexOf('أضِفه بهذا الاسم') < 0, true, 'but does not add from the sending mode:');
  eq(html.indexOf("setMode('edit')") >= 0, true, 'it points at the mode that does:');
  eq(b._t.labs.length, 1, 'and nothing was created behind the scenes:');
});

/* ── ترتيب العناصر: ظاهرٌ على البطاقة، ويُحفَظ، ويسري في كل مكان ───── */

run('الترتيب: أسهم العناصر ظاهرة فور فتح القائمة في كل قسم', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.setMode('edit');
  ['meds', 'labs', 'imaging', 'recipes'].forEach(k => {
    c.goPage(k);
    c.Store.upsert(k, { id: 'x1-' + k, name: 'أ', trade_name: 'أ', category: 'ت', extra: {} });
    c.coll(k).push({ id: 'x1-' + k, name: 'أ', trade_name: 'أ', category: 'ت', extra: {} });
    c.coll(k).push({ id: 'x2-' + k, name: 'ب', trade_name: 'ب', category: 'ت', extra: {} });
    c.render();
    const html = c._els('page').innerHTML;
    eq(html.indexOf("itemMove('" + k + "'") >= 0, true, k + ': the arrows are right on the card:');
    eq(html.indexOf('catMoveNamed(&#39;' + k) >= 0, true, k + ': and the category has its own, in its header:');
  });
});

run('الترتيب: تحريك عنصر يُحفَظ ويبقى بعد إعادة التشغيل', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.setMode('edit'); c.goPage('labs');
  ['FBS', 'Urea', 'CBC'].forEach(n => {
    const rec = { id: c.uid(), category: 'كيمياء', name: n, code: '', extra: {} };
    c.DB.labs.push(rec); c.catEnsure('labs', 'كيمياء'); c.Store.upsert('labs', rec);
  });
  const ids = c.DB.labs.map(x => x.id);

  c.itemMove('labs', ids[2], -1);
  eq(c.DB.labs.map(x => x.name), ['FBS', 'CBC', 'Urea'], 'moved up on screen:');
  eq(b._order.labs, [ids[0], ids[2], ids[1]], 'and the new order reached the database:');

  const c2 = load(b); c2.boot();
  eq(c2.DB.labs.map(x => x.name), ['FBS', 'CBC', 'Urea'], 'and it survives a restart:');

  // الحدّان
  c2.itemMove('labs', c2.DB.labs[0].id, -1);
  eq(c2.DB.labs.map(x => x.name), ['FBS', 'CBC', 'Urea'], 'the first cannot rise:');
  c2.itemMove('labs', c2.DB.labs[2].id, 1);
  eq(c2.DB.labs.map(x => x.name), ['FBS', 'CBC', 'Urea'], 'nor the last fall:');
});

run('الترتيب: العنصر يتحرّك بين جيرانه في تصنيفه لا عبر التصنيفات', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.setMode('edit');
  [['كيمياء', 'FBS'], ['دم', 'CBC'], ['دم', 'ESR']].forEach(x => {
    const rec = { id: c.uid(), category: x[0], name: x[1], code: '', extra: {} };
    c.DB.labs.push(rec); c.catEnsure('labs', x[0]); c.Store.upsert('labs', rec);
  });
  const ids = c.DB.labs.map(x => x.id);

  c.itemMove('labs', ids[1], -1);       // CBC أوّل «دم» — لا يقفز إلى «كيمياء»
  eq(c.DB.labs.map(x => x.name), ['FBS', 'CBC', 'ESR'], 'it stays within its category:');

  c.itemMove('labs', ids[2], -1);       // ESR يعلو فوق CBC
  eq(c.DB.labs.map(x => x.name), ['FBS', 'ESR', 'CBC'], 'but moves freely among its own:');
});

run('الترتيب: تحريك عنصر يسري على السلة والورقة فورًا', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.setMode('edit');
  ['FBS', 'Urea', 'CBC'].forEach(n => {
    const rec = { id: c.uid(), category: 'كيمياء', name: n, code: '', extra: {} };
    c.DB.labs.push(rec); c.catEnsure('labs', 'كيمياء'); c.Store.upsert('labs', rec);
  });
  c.setMode('send');
  c.DB.labs.forEach(l => c.toggleCart('labs', l.id));
  eq(c.rowsFor('labs', c.DB.cart.labs).map(r => r.title), ['FBS', 'Urea', 'CBC'], 'paper as created:');

  c.setMode('edit');
  c.itemMove('labs', c.DB.labs[2].id, -1);
  eq(c.DB.cart.labs, c.displayOrder('labs'), 'the cart followed at once:');
  eq(b._t.cart.labs, c.displayOrder('labs'), 'and so did the stored cart:');
  eq(c.rowsFor('labs', c.DB.cart.labs).map(r => r.title), ['FBS', 'CBC', 'Urea'], 'and the paper with it:');
});

run('الترتيب: تحريك التصنيف يبدّل مع الجار الظاهر لا الفارغ', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.setMode('edit');
  // تصنيفات مزروعة كثيرة، واثنان فقط فيهما عناصر
  [['كيمياء الدم', 'FBS'], ['أمراض الدم', 'CBC']].forEach(x => {
    const rec = { id: c.uid(), category: x[0], name: x[1], code: '', extra: {} };
    c.DB.labs.push(rec); c.catEnsure('labs', x[0]); c.Store.upsert('labs', rec);
  });
  eq(c.catsShown('labs'), ['كيمياء الدم', 'أمراض الدم'], 'only the two with items show:');
  eq(c.catsRaw('labs').length > 2, true, '(while many more are registered)');

  c.catMoveNamed('labs', 'أمراض الدم', -1);
  eq(c.catsShown('labs'), ['أمراض الدم', 'كيمياء الدم'], 'one tap actually swaps what is on screen:');
  eq(c.displayOrder('labs').map(id => c.DB.labs.find(x => x.id === id).name), ['CBC', 'FBS'],
     'and the list flipped with it:');

  const c2 = load(b); c2.boot();
  eq(c2.catsShown('labs'), ['أمراض الدم', 'كيمياء الدم'], 'and it survives a restart:');

  // الحدّان على ما هو ظاهر
  c2.catMoveNamed('labs', 'أمراض الدم', -1);
  eq(c2.catsShown('labs'), ['أمراض الدم', 'كيمياء الدم'], 'the top one cannot rise:');
});

run('الترتيب: تصنيفٌ مكتوبٌ في العناصر وحدها يُحرَّك أيضًا', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.setMode('edit');
  // اسمان بلا صفّ في cats إطلاقًا
  b._t.cats = []; c.DB.cats = []; c.DB.cats_seeded = 1;
  ['أ', 'ب'].forEach(n => {
    const rec = { id: c.uid(), category: n, name: 'عنصر ' + n, code: '', extra: {} };
    c.DB.labs.push(rec); c.Store.upsert('labs', rec);
  });
  eq(c.catsShown('labs'), ['أ', 'ب'], 'both show, though neither is registered:');

  c.catMoveNamed('labs', 'ب', -1);
  eq(c.catsShown('labs'), ['ب', 'أ'], 'and moving one registers it and works:');
  eq(b._t.cats.length, 2, 'both became real categories:');
});

/* ── الترتيب: زرٌّ صريح، وحفظٌ مُتحقَّق منه ────────────────────────── */

run('الترتيب: زرّ «↕️ ترتيب» ظاهر في كل قسم وفي الوضعين', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  ['meds', 'labs', 'imaging', 'recipes'].forEach(k => {
    ['أ', 'ب'].forEach(n => {
      const rec = { id: c.uid(), name: n, trade_name: n, category: 'ت', extra: {} };
      c.coll(k).push(rec); c.Store.upsert(k, rec);
    });
    ['send', 'edit'].forEach(m => {
      c.setMode(m); c.goPage(k);
      eq(c._els('page').innerHTML.indexOf("goPage('sort:" + k + "')") >= 0, true,
         k + ' / ' + m + ': the sort button is right there:');
    });
  });
});

run('الترتيب: صفحة الترتيب تحرّك وتحفظ وتتحقّق', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  ['FBS', 'Urea', 'CBC'].forEach(n => {
    const rec = { id: c.uid(), category: 'كيمياء', name: n, code: '', extra: {} };
    c.DB.labs.push(rec); c.catEnsure('labs', 'كيمياء'); c.Store.upsert('labs', rec);
  });
  const ids = c.DB.labs.map(x => x.id);

  c.goPage('sort:labs');
  const html = c._els('page').innerHTML;
  eq(html.indexOf('كل حركة تُحفَظ فورًا') >= 0, true, 'it promises to save as you go:');
  eq(html.indexOf("itemMove('labs'") >= 0, true, 'with arrows on every item:');
  eq(html.indexOf("catMoveNamed('labs'") >= 0, true, 'and on the category:');

  c.itemMove('labs', ids[2], -1);
  eq(b._t.labs.map(x => x.name), ['FBS', 'CBC', 'Urea'], 'the move reached the database:');
  eq(b._t.labs.map(x => x.sort_order), [1, 2, 3], 'with real sort_order values:');

  c.sortDone('labs');
  eq(c._els('toast').textContent, '✅ حُفظ الترتيب', 'and «done» confirms it:');

  const c2 = load(b); c2.boot();
  eq(c2.DB.labs.map(x => x.name), ['FBS', 'CBC', 'Urea'], 'and it survives a restart:');
});

run('الترتيب: فشل الكتابة يُقال ولا يُبتلع', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  ['FBS', 'Urea'].forEach(n => {
    const rec = { id: c.uid(), category: 'كيمياء', name: n, code: '', extra: {} };
    c.DB.labs.push(rec); c.catEnsure('labs', 'كيمياء'); c.Store.upsert('labs', rec);
  });
  b.setItemOrder = () => false;          // كما لو فشل التحقّق في القاعدة
  c.goPage('sort:labs');
  c.itemMove('labs', c.DB.labs[1].id, -1);
  eq(c._els('toast').textContent.indexOf('لم يُحفَظ الترتيب') >= 0, true, 'the failure is reported:');
  c.sortDone('labs');
  eq(c._els('toast').textContent.indexOf('لم يُحفَظ الترتيب') >= 0, true, 'and «done» refuses to claim success:');
});

run('الترتيب: «احفظ هذا الترتيب للقسم» من المعاينة', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  ['FBS', 'Urea', 'CBC'].forEach(n => {
    const rec = { id: c.uid(), category: 'كيمياء', name: n, code: '', extra: {} };
    c.DB.labs.push(rec); c.catEnsure('labs', 'كيمياء'); c.Store.upsert('labs', rec);
  });
  c.setMode('send');
  c.DB.labs.forEach(l => c.toggleCart('labs', l.id));
  c.previewCart('labs'); c.pvTab('list');
  eq(c._els('page').innerHTML.indexOf('احفظ هذا الترتيب للقسم') >= 0, true, 'the button is offered:');

  c.pvMove(0, 1);                        // FBS ينزل تحت Urea
  eq(c.rowsFor('labs', c.pvOn()).map(r => r.title), ['Urea', 'FBS', 'CBC'], 'the preview order changed:');
  eq(b._t.labs.map(x => x.name), ['FBS', 'Urea', 'CBC'], 'but the section is untouched so far:');

  c.pvKeepOrder();
  eq(b._t.labs.map(x => x.name), ['Urea', 'FBS', 'CBC'], 'now the section took it:');
  eq(c.DB.cart.labs, c.displayOrder('labs'), 'and the cart followed:');

  const c2 = load(b); c2.boot();
  eq(c2.DB.labs.map(x => x.name), ['Urea', 'FBS', 'CBC'], 'and it survives a restart:');
});

/* ── الحقول: مكانٌ واحد يحكم الترتيب والظهور ──────────────────────── */

run('الحقول: صفحةٌ واحدة تحكم ترتيب الحقل وظهوره في الإرسال', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.fldNew('labs'); c._els('ff-label').value = 'المختبر'; c.fldCreate('labs');
  c.fldNew('labs'); c._els('ff-label').value = 'السعر'; c.fldCreate('labs');
  const keys = c.fieldsOf('labs').map(f => f.key);

  c.goPage('fld:labs');
  let html = c._els('page').innerHTML;
  eq(html.indexOf('المختبر') >= 0 && html.indexOf('السعر') >= 0, true, 'the added fields are listed:');
  eq(html.indexOf('حقول ' + c.kindLbl('labs').title + ' الأصلية') >= 0, true,
     'and the built-in ones, in the same place:');
  eq(html.indexOf("fldEye('labs','x:" + keys[0] + "')") >= 0, true, 'each has a visibility button:');
  eq(html.indexOf("fldEye('labs','requirements')") >= 0, true, 'built-ins too:');

  // الحقل الجديد يظهر في الإرسال تلقائيًا، والزرّ يُخفيه
  eq(c.outHas('labs', 'x:' + keys[0]), true, 'a new field goes out by default:');
  c.fldEye('labs', 'x:' + keys[0]);
  eq(c.outHas('labs', 'x:' + keys[0]), false, 'and the eye hides it:');
  eq(c._els('toast').textContent.indexOf('أُخفي') >= 0, true, 'and says so:');

  // وأثره في المخرجات
  const rec = { id: 'L1', name: 'CBC', category: '', extra: {} };
  rec.extra[keys[0]] = 'مختبر الشفاء';
  rec.extra[keys[1]] = '٩٠ ريالًا';
  c.DB.labs.push(rec); c.Store.upsert('labs', rec);
  let out = c.outLines('labs', rec).map(x => x.l);
  eq(out.indexOf('المختبر') < 0, true, 'the hidden one is out of the paper:');
  eq(out.indexOf('السعر') >= 0, true, 'the shown one stays:');

  c.fldEye('labs', 'x:' + keys[0]);
  out = c.outLines('labs', rec).map(x => x.l);
  eq(out.indexOf('المختبر') >= 0, true, 'and showing it brings it back:');

  // الترتيب يُحفَظ ويحكم ترتيب الأسطر
  c.fldMove('labs', c.fieldsOf('labs')[1].id, -1);
  eq(c.fieldsOf('labs').map(f => f.label), ['السعر', 'المختبر'], 'reordered:');
  const c2 = load(b); c2.boot();
  eq(c2.fieldsOf('labs').map(f => f.label), ['السعر', 'المختبر'], 'and it survives a restart:');
  eq(c2.outLines('labs', rec).map(x => x.l).filter(l => l === 'السعر' || l === 'المختبر'),
     ['السعر', 'المختبر'], 'and the paper follows that order:');
});

run('الحقول: إخفاء حقلٍ أصلي يُخرجه من الورقة', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  const rec = { id: 'L1', name: 'CBC', requirements: 'صيام ٨ ساعات', category: '', extra: {} };
  c.DB.labs.push(rec); c.Store.upsert('labs', rec);
  eq(c.outLines('labs', rec).map(x => x.l).indexOf('متطلبات التحليل') >= 0, true, 'it is out by default:');

  c.fldEye('labs', 'requirements');
  eq(c.outLines('labs', rec).map(x => x.l).indexOf('متطلبات التحليل') < 0, true, 'and the eye removes it:');

  const c2 = load(b); c2.boot();
  eq(c2.outHas('labs', 'requirements'), false, 'and the choice is persisted:');
});

/* ── الحذف: تحذيرٌ يعدّ، وتأكيدٌ بقدر الخطر ───────────────────────── */

run('الحذف: صندوق التحذير يعدّ ما يُفقَد ويطمئن على ما يبقى', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.setMode('edit'); c.goPage('labs');
  c._els('lf-name').value = 'CBC'; c._els('lf-category').value = ''; c.labSave('');
  const id = c.DB.labs[0].id;
  c.toggleCart('labs', id);
  c.goPage('grp:labs'); c.groupNew('labs');
  c._els('gn').value = 'مج'; c.groupCreate('labs');
  c.GPICK = {}; c.groupPickToggle(id); c.groupPickAdd();

  c.labDel(id);
  const html = c._els('modal-body').innerHTML;
  eq(html.indexOf('سيُحذف نهائيًا') >= 0, true, 'it says what goes:');
  eq(html.indexOf('لا يمكن التراجع') >= 0, true, 'and that there is no undo:');
  eq(html.indexOf('قائمتك المحدَّدة') >= 0, true, 'it counts the selection:');
  eq(html.indexOf('مجموعة واحدة') >= 0, true, 'and the groups it sits in:');
  eq(html.indexOf('يبقى سالمًا') >= 0, true, 'and what survives:');
  eq(html.indexOf('🗑️ احذفه') >= 0, true, 'and the button names the act, not «تأكيد»:');

  c._els('cb-yes').onclick();
  eq(b._t.labs.length, 0, 'and it deletes when confirmed:');
});

run('الحذف: الأثقل يحتاج كتابة كلمة لا نقرة', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.DB.labs.push({ id: 'L1', name: 'CBC', category: '', extra: {} });
  const A = androidStub(); c.window.AndroidBridge = A;
  vm.runInContext('AB = window.AndroidBridge;', c);
  const name = c.autoBackup(true);

  c.backupRestore(name);
  eq(c._els('modal-body').innerHTML.indexOf('اكتب') >= 0, true, 'it asks for a typed word:');
  c._els('cb-yes').onclick();
  eq(c.DB.labs.length, 1, 'a bare tap changes nothing:');

  c._els('dz-in').value = 'خطأ'; c.dzCheck();
  c._els('cb-yes').onclick();
  eq(c.DB.labs.length, 1, 'nor does the wrong word:');

  c._els('dz-in').value = 'استبدال'; c.dzCheck();
  c._els('cb-yes').onclick();
  eq(c._els('toast').textContent.indexOf('تمت الاستعادة') >= 0, true, 'the right word goes through:');
});

run('الحذف: «مسح» التحديد صار يُؤكَّد بعد أن كان بلا سؤال', () => {
  const b = makeBridge(); const c = load(b); c.boot();
  c.setMode('edit'); c.goPage('labs');
  ['CBC', 'ESR'].forEach(n => { c._els('lf-name').value = n; c.labSave(''); });
  c.setMode('send');
  c.DB.labs.forEach(l => c.toggleCart('labs', l.id));
  eq(c.DB.cart.labs.length, 2, 'two selected:');

  c.clearCart('labs');
  eq(c.DB.cart.labs.length, 2, 'the tap alone does not wipe it:');
  eq(c._els('modal-body').innerHTML.indexOf('لا يُحذف منها شيء') >= 0, true,
     'and it reassures that no item is lost:');
  c._els('cb-yes').onclick();
  eq(c.DB.cart.labs.length, 0, 'confirmed, it clears:');
  eq(b._t.labs.length, 2, 'and not one item was deleted:');
});
