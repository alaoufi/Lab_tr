/* ============================================================
   هيكل تشغيل «دليلي» خارج أندرويد: جسر NativeDb وهمي يحاكي دلالات
   DaliliDb، ولوحةُ DOM مصغّرة، ثم تشغيل app.js الحقيقي داخل vm.

   يستعمله `test_store.js` (الاختبارات) و`check_backup.js` (فحص نسخة
   احتياطية حقيقية) — مصدرٌ واحد فلا يتباعد المحاكيان عن بعضهما.
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


const base = require('path').join(__dirname, '..', 'app', 'src', 'main', 'assets') + require('path').sep;
const src = fs.readFileSync(base + 'app.js', 'utf8');
const libSrc = fs.readFileSync(base + 'library.js', 'utf8');
const load = (bridge, legacy) => {
  const c = makeCtx(bridge, legacy);
  vm.runInContext(libSrc, c);
  vm.runInContext(src, c);
  return c;
};


module.exports = { makeBridge, brokenBridge, makeCtx, load, vm, fs, src, libSrc };
