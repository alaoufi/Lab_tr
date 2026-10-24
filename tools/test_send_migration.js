/* Native send metadata contract. Executes source-extracted SQL against real SQLite;
 * read/write routing is checked in source, not by executing Java/Android methods.
 * Run: node tools/test_send_migration.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const java = fs.readFileSync(path.join(__dirname, '../app/src/main/java/me/alaoufi/dalili/DaliliDb.java'), 'utf8');
const kinds = ['meds', 'labs', 'imaging', 'recipes'];
let passed = 0, failed = 0;
function run(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}
function body(name) {
  const match = java.match(new RegExp('(?:public|private|void|static)[^\\n]*\\b' + name + '\\([^\\n]*\\) [^{]*\\{([\\s\\S]*?)\\n    \\}'));
  assert.ok(match, 'native method exists: ' + name);
  return match[1];
}
function literals(text) {
  return Array.from(text.matchAll(/"((?:\\.|[^"\\])*)"/g), m => JSON.parse('"' + m[1] + '"'));
}
function textCols(kind) {
  const name = ({ meds: 'MED', labs: 'LAB', imaging: 'IMAGING', recipes: 'RECIPE' })[kind];
  return literals(java.match(new RegExp(name + '_TEXT_COLS = \\{([^}]+)\\}'))[1]);
}
function sql(expression, vars = {}) {
  const clean = expression.replace(/\/\/[^\n]*/g, '');
  return clean.split(/\s*\+\s*(?=(?:[^"\\]*(?:\\.[^"\\]*)*"[^"\\]*(?:\\.[^"\\]*)*")*[^"\\]*$)/).map(part => {
    part = part.trim();
    if (part.startsWith('"')) return JSON.parse(part);
    assert.ok(Object.hasOwn(vars, part), 'known SQL expression: ' + part);
    return vars[part];
  }).join('');
}
function execLiteralSql(db, source) {
  for (const m of source.matchAll(/db\.execSQL\(([\s\S]*?)\);/g)) db.exec(sql(m[1]));
}
function columns(db, table) { return db.prepare('PRAGMA table_info(' + table + ')').all(); }
function addColumns(db, table, cols, decl) {
  const helper = body('addCols');
  assert.match(helper, /if \(!hasColumn\(db, table, col\)\)/, 'repair checks before altering');
  const expression = helper.match(/db\.execSQL\(([\s\S]*?)\);/)[1];
  for (const col of cols) if (!columns(db, table).some(c => c.name === col)) db.exec(sql(expression, { table, col, decl }));
}
function applyAddCalls(db, source, kind) {
  for (const m of source.matchAll(/addCols\(db, (kind|"[^"]+"), (textCols\(kind\)|new String\[\]\{[^}]+\}), "([^"]+)"\)/g)) {
    const table = m[1] === 'kind' ? kind : JSON.parse(m[1]);
    const cols = m[2] === 'textCols(kind)' ? textCols(kind) : m[2].includes('flagCol(kind)')
      ? [kind === 'meds' ? 'default_include' : kind === 'recipes' ? 'is_favorite' : 'is_common'] : literals(m[2]);
    assert.ok(table, 'table variable is bound');
    addColumns(db, table, cols, m[3]);
  }
}
function upgrade(db, oldVersion) {
  assert.match(java, /DB_VERSION = 12;/, 'native schema is version 12');
  const source = body('onUpgrade');
  const step = source.match(/if \(oldVersion < 12\) \{([\s\S]*?)\n        \}/);
  assert.ok(step, 'schema 12 has an explicit upgrade step');
  assert.doesNotMatch(step[1], /db\.(?:delete|update|execSQL)\(|DROP|DELETE|REPLACE|CREATE TABLE/i, 'new migration only adds columns');
  for (const m of source.matchAll(/if \(oldVersion < (1[012])\) \{([\s\S]*?)\n        \}/g)) {
    if (oldVersion < Number(m[1])) applyAddCalls(db, m[2]);
  }
}
function repair(db) {
  const source = body('ensureSchema');
  for (const m of source.matchAll(/\b(create\w+)\(db\)/g)) execLiteralSql(db, body(m[1]));
  execLiteralSql(db, source);
  const loop = source.match(/for \(String kind : KINDS\) \{([\s\S]*?)\n            \}/);
  assert.ok(loop, 'all built-in text columns participate in repair');
  kinds.forEach(kind => applyAddCalls(db, loop[1], kind));
  applyAddCalls(db, source.replace(loop[0], ''));
}

// Fixed pre-change schema, deliberately not derived from the new CREATE statements.
function legacy(version = 11) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE meds(id TEXT PRIMARY KEY,trade_name TEXT NOT NULL,scientific_name TEXT,category TEXT,concentration TEXT,dosage TEXT,duration TEXT,uses TEXT,cautions TEXT,notes TEXT,default_include INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0,extra TEXT,img TEXT);
    CREATE TABLE labs(id TEXT PRIMARY KEY,category TEXT,code TEXT,name TEXT NOT NULL,purpose TEXT,requirements TEXT,prohibitions TEXT,is_common INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0,extra TEXT,img TEXT);
    CREATE TABLE imaging(id TEXT PRIMARY KEY,category TEXT,name TEXT NOT NULL,region TEXT,purpose TEXT,requirements TEXT,prohibitions TEXT,is_common INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0,extra TEXT,img TEXT);
    CREATE TABLE recipes(id TEXT PRIMARY KEY,category TEXT,name TEXT NOT NULL,type TEXT,purpose TEXT,ingredients TEXT,preparation TEXT,usage TEXT,dose TEXT,duration TEXT,effects TEXT,precautions TEXT,is_favorite INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0,extra TEXT,img TEXT);
    CREATE TABLE sent(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT,who TEXT,${version >= 11 ? 'notes TEXT,' : ''}item_ids TEXT NOT NULL,ts INTEGER NOT NULL);
    CREATE TABLE sections(id TEXT PRIMARY KEY,title TEXT NOT NULL,icon TEXT,builtin INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE fields(id TEXT PRIMARY KEY,kind TEXT NOT NULL,key TEXT NOT NULL,label TEXT NOT NULL,type TEXT NOT NULL,opts TEXT,sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE items(id TEXT PRIMARY KEY,section TEXT NOT NULL,name TEXT NOT NULL,category TEXT,extra TEXT,flag INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0,img TEXT);
    CREATE TABLE cats(id TEXT PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE groups(id TEXT PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE group_items(group_id TEXT NOT NULL,item_id TEXT NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(group_id,item_id));
    CREATE TABLE cart(kind TEXT NOT NULL,item_id TEXT NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(kind,item_id));
    CREATE TABLE images(id TEXT PRIMARY KEY,code TEXT NOT NULL,name TEXT,data TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);
  `);
  // Distinct IDs, ordering, Unicode, quotes, nulls and nested JSON catch value loss.
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()) {
    const cols = columns(db, name);
    const statement = db.prepare('INSERT INTO ' + name + ' VALUES(' + cols.map(() => '?').join(',') + ')');
    for (let row = 0; row < 2; row++) statement.run(...cols.map(c => {
      if (c.type === 'INTEGER') return c.name === 'sort_order' || c.name === 'position' ? 9 - row * 5 : row + 1;
      if (c.name === 'item_ids') return '["item-b","item-a"]';
      if (c.name === 'extra') return '{"custom":"قيمة محفوظة"}';
      if (c.name === 'notes') return row ? null : 'ملاحظات قديمة\nKeep < & "';
      if (c.name === 'kind') return 'meds';
      if (c.name === 'item_id') return 'meds:id:' + row + ':عربي';
      if (c.name === 'group_id') return 'groups:id:0:عربي';
      if (c.name === 'section') return 'sections:id:0:عربي';
      return name + ':' + c.name + ':' + row + ':عربي';
    }));
  }
  return db;
}
function snapshot(db, previous) {
  const result = {};
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()) {
    const names = previous ? previous[name].columns : columns(db, name).map(c => c.name);
    result[name] = { columns: names, rows: db.prepare('SELECT ' + names.join(',') + ' FROM ' + name + ' ORDER BY rowid').all() };
  }
  return result;
}
function assertNewColumns(db) {
  for (const [table, name] of [['meds', 'requirements'], ['sent', 'send_options']]) {
    const col = columns(db, table).find(c => c.name === name);
    assert.ok(col, table + '.' + name + ' exists');
    assert.equal(col.type, 'TEXT'); assert.equal(col.notnull, 0); assert.equal(col.dflt_value, null);
  }
}

run('fresh installs have nullable medicine requirements and JSON text send metadata', () => {
  const db = new DatabaseSync(':memory:');
  execLiteralSql(db, body('onCreate')); execLiteralSql(db, body('createSent'));
  assertNewColumns(db); db.close();
});
run('11 to 12 is additive and preserves every old value, ID, group, selection, order and setting', () => {
  const db = legacy(), before = snapshot(db);
  upgrade(db, 11); upgrade(db, 11); assertNewColumns(db);
  assert.deepEqual(snapshot(db, before), before);
  assert.ok(db.prepare('SELECT requirements FROM meds').all().every(r => r.requirements === null));
  assert.ok(db.prepare('SELECT send_options FROM sent').all().every(r => r.send_options === null));
  db.close();
});
run('10 to 12 also retains older history when both notes and send metadata are absent', () => {
  const db = legacy(10), before = snapshot(db);
  upgrade(db, 10); assertNewColumns(db); assert.deepEqual(snapshot(db, before), before);
  assert.ok(db.prepare('SELECT notes,send_options FROM sent').all().every(r => r.notes === null && r.send_options === null));
  db.close();
});
run('schema repair is idempotent for missing or partially restored send columns', () => {
  for (const partial of ['', 'meds', 'sent']) {
    const db = legacy(), before = snapshot(db);
    const column = partial === 'meds' ? 'requirements' : 'send_options';
    if (partial) {
      db.exec('ALTER TABLE ' + partial + ' ADD COLUMN ' + column + ' TEXT');
      db.prepare('UPDATE ' + partial + ' SET ' + column + '=?').run('Already saved: لا تتغير');
    }
    repair(db); repair(db); assertNewColumns(db); assert.deepEqual(snapshot(db, before), before);
    if (partial) assert.ok(db.prepare('SELECT ' + column + ' AS value FROM ' + partial).all().every(row => row.value === 'Already saved: لا تتغير'));
    for (const [table, name] of [['meds', 'requirements'], ['sent', 'send_options']]) {
      assert.equal(columns(db, table).filter(c => c.name === name).length, 1);
    }
    db.close();
  }
});
run('read/write and backup paths preserve medicine requirements and raw JSON metadata as text', () => {
  assert.ok(textCols('meds').includes('requirements'), 'medicine data contract contains requirements');
  assert.match(body('values'), /for \(String col : textCols\(kind\)\) v\.put\(col, o\.optString\(col, ""\)\)/);
  assert.match(body('readItems'), /for \(String col : textCols\(kind\)\) o\.put\(col, str\(c, col\)\)/);
  assert.match(body('readSent'), /o\.put\("send_options", str\(c, "send_options"\)\)/);
  assert.match(body('writeSent'), /v\.put\("send_options", o\.optString\("send_options", ""\)\)/);
  assert.match(body('loadAll'), /out\.put\(kind, readItems\(db, kind\)\)/);
  assert.match(body('loadAll'), /out\.put\("sent", readSent\(db\)\)/);
  assert.match(body('replaceAll'), /ContentValues v = values\(kind, o\)/);
  assert.match(body('replaceAll'), /writeSent\(db, o\)/);
  assert.match(body('str'), /if \(i < 0\) return "";/);
  assert.match(body('str'), /return v == null \? "" : v;/);
  const db = legacy(); upgrade(db, 11);
  const requirement = 'متطلب صريح\nKeep "quotes" <tag> & spaces  ';
  const options = JSON.stringify({ requirements: requirement, notesColor: '#123abc', notesBold: true });
  db.prepare('UPDATE meds SET requirements=?').run(requirement);
  db.prepare('UPDATE sent SET send_options=?').run(options);
  const exported = JSON.parse(JSON.stringify({
    meds: db.prepare('SELECT requirements FROM meds').all(), sent: db.prepare('SELECT send_options,notes FROM sent').all()
  }));
  const restored = legacy(); upgrade(restored, 11);
  restored.prepare('UPDATE meds SET requirements=?').run(exported.meds[0].requirements);
  for (const row of exported.sent) {
    restored.prepare('UPDATE sent SET send_options=? WHERE notes IS ?').run(row.send_options, row.notes);
  }
  assert.equal(restored.prepare('SELECT requirements FROM meds').get().requirements, requirement);
  assert.deepEqual(restored.prepare('SELECT send_options,notes FROM sent ORDER BY rowid').all(), db.prepare('SELECT send_options,notes FROM sent ORDER BY rowid').all());
  assert.equal(restored.prepare('SELECT typeof(send_options) AS type FROM sent').get().type, 'text');
  assert.deepEqual(JSON.parse(restored.prepare('SELECT send_options FROM sent').get().send_options), JSON.parse(options));
  db.close(); restored.close();
});
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
