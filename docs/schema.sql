-- ============================================================================
--  دليلي — مخطط قاعدة البيانات المحلية (SQLite)
--  ملف: /data/data/me.alaoufi.dalili/databases/dalili.db
--  إصدار المخطط: 4   (DaliliDb.DB_VERSION)
--
--  هذا الملف مرجع توثيقي مطابق حرفيًا لما تنشئه DaliliDb.onCreate().
--  التطبيق ينشئ الجداول من كود جافا لا من هذا الملف — إن عدّلت أحدهما
--  فعدّل الآخر معه.
--
--  لفتح قاعدة بيانات جهاز حقيقي ومطابقتها بهذا الملف:
--      adb shell "run-as me.alaoufi.dalili cat databases/dalili.db" > dalili.db
--      sqlite3 dalili.db ".schema"
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────────────────────
--  ١) العلاجات
--  المفتاح id نصّي يولّده JS (uid = طابع زمني + عشوائي) لا AUTOINCREMENT،
--  حتى تبقى المعرّفات ثابتة عبر التصدير والاستيراد بين الأجهزة.
--  sort_order يحفظ ترتيب الإدراج فتبقى القائمة كما بناها المستخدم.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE meds (
    id               TEXT PRIMARY KEY,
    trade_name       TEXT    NOT NULL,          -- الاسم التجاري (مطلوب)
    scientific_name  TEXT,                      -- الاسم العلمي
    category         TEXT,                      -- التصنيف (مضادات حيوية، …)
    concentration    TEXT,                      -- التركيز
    dosage           TEXT,                      -- الجرعات
    duration         TEXT,                      -- مدة الاستخدام
    uses             TEXT,                      -- الاستخدامات
    cautions         TEXT,                      -- المحاذير
    notes            TEXT,                      -- ملاحظات
    default_include  INTEGER NOT NULL DEFAULT 0, -- ⭐ محدَّد افتراضيًا (0/1)
    sort_order       INTEGER NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────────────────────────────────────
--  ٢) التحاليل
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE labs (
    id            TEXT PRIMARY KEY,
    category      TEXT,                          -- التصنيف (التخصص)
    code          TEXT,                          -- رمز التحليل / المصطلح (CBC)
    name          TEXT    NOT NULL,              -- اسم التحليل (مطلوب)
    purpose       TEXT,                          -- الهدف من التحليل
    requirements  TEXT,                          -- متطلباته (صيام، نوع العيّنة)
    prohibitions  TEXT,                          -- ممنوعاته
    is_common     INTEGER NOT NULL DEFAULT 0,    -- ⭐ تحليل شائع (0/1)
    sort_order    INTEGER NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────────────────────────────────────
--  ٣) الوصفات العلاجية
--  ملاحظة: usage ليست كلمة محجوزة في SQLite فلا تحتاج اقتباسًا، لكن بعض
--  أدوات العرض الخارجية قد تفضّل "usage" — انتبه إن نقلت المخطط لمحرّك آخر.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE recipes (
    id           TEXT PRIMARY KEY,
    name         TEXT    NOT NULL,               -- اسم الوصفة (مطلوب)
    type         TEXT,                           -- علاجية / وقائية / غذائية
    purpose      TEXT,                           -- الهدف
    ingredients  TEXT,                           -- المواد المستخدمة
    preparation  TEXT,                           -- طريقة الإعداد
    usage        TEXT,                           -- الاستخدام
    dose         TEXT,                           -- الجرعة
    duration     TEXT,                           -- مدة الاستخدام
    effects      TEXT,                           -- الأعراض المتوقعة
    precautions  TEXT,                           -- الاحتياطات
    is_favorite  INTEGER NOT NULL DEFAULT 0,     -- ⭐ مفضّلة (0/1)
    sort_order   INTEGER NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────────────────────────────────────
--  ٤) سلة التحديد — مؤقتة، مشتركة بين الأقسام الثلاثة
--  kind ∈ ('meds','labs','recipes') ويطابق اسم الجدول المصدر.
--  position يحفظ ترتيب الطباعة/الصورة المُرسَلة.
--  لا مفتاح أجنبي: الحذف من الجدول المصدر يمرّ عبر DaliliDb.delete() التي
--  تحذف من السلة في نفس المعاملة.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE cart (
    kind      TEXT    NOT NULL,
    item_id   TEXT    NOT NULL,
    position  INTEGER NOT NULL,
    PRIMARY KEY (kind, item_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
--  ٥) المجموعات المسمّاة — قوائم دائمة («فحوصات ما قبل الجراحة»)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE groups (
    id          TEXT PRIMARY KEY,
    kind        TEXT    NOT NULL,                -- القسم الذي تنتمي إليه
    name        TEXT    NOT NULL,                -- اسم المجموعة
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE group_items (
    group_id  TEXT    NOT NULL,
    item_id   TEXT    NOT NULL,
    position  INTEGER NOT NULL,
    PRIMARY KEY (group_id, item_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
--  ٦) الإعدادات — مخزن مفتاح/قيمة
--  المفاتيح المستخدمة حاليًا:
--    pin_hash      بصمة SHA-256 لرمز القفل (لا الرمز نفسه)
--    out_meds      JSON: أسماء حقول العلاجات الظاهرة في الطباعة/الصورة
--    out_labs      JSON: نفسه للتحاليل
--    out_recipes   JSON: نفسه للوصفات
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT
);

-- ─────────────────────────────────────────────────────────────────────────────
--  الفهارس
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX idx_meds_name     ON meds(trade_name);
CREATE INDEX idx_meds_category ON meds(category);
CREATE INDEX idx_labs_category ON labs(category);
CREATE INDEX idx_recipes_type  ON recipes(type);
CREATE INDEX idx_groups_kind   ON groups(kind);


-- ============================================================================
--  تاريخ الترقيات — DaliliDb.onUpgrade()
--  تراكمية وبلا حذف بيانات: كل خطوة تبني على ما قبلها.
-- ============================================================================
--
--  الإصدار ١ → ٢
--      ALTER TABLE meds ADD COLUMN category     TEXT;
--      ALTER TABLE labs ADD COLUMN purpose      TEXT;
--      ALTER TABLE labs ADD COLUMN requirements TEXT;
--      ALTER TABLE labs ADD COLUMN prohibitions TEXT;
--      CREATE INDEX IF NOT EXISTS idx_meds_category ON meds(category);
--
--  الإصدار ٢ → ٣
--      CREATE TABLE IF NOT EXISTS recipes (…);          -- قسم الوصفات
--      CREATE INDEX IF NOT EXISTS idx_recipes_type ON recipes(type);
--
--  الإصدار ٣ → ٤
--      CREATE TABLE IF NOT EXISTS groups (…);           -- المجموعات المسمّاة
--      CREATE TABLE IF NOT EXISTS group_items (…);
--      CREATE INDEX IF NOT EXISTS idx_groups_kind ON groups(kind);
--
--  عند إضافة ترقية جديدة:
--    ١) ارفع DB_VERSION
--    ٢) أضِف كتلة  if (oldVersion < N) { … }  في onUpgrade
--    ٣) أضِف الأعمدة/الجداول نفسها في onCreate ليتطابق التثبيت الجديد
--    ٤) حدّث هذا الملف و docs/DATABASE.md
--  لا تستخدم DROP ولا تُعِد إنشاء جدول فيه بيانات مستخدم.


-- ============================================================================
--  استعلامات مفيدة للتشخيص
-- ============================================================================

-- ما في السلة الآن بالترتيب (تحاليل):
--   SELECT l.code, l.name FROM cart c
--   JOIN labs l ON l.id = c.item_id
--   WHERE c.kind = 'labs' ORDER BY c.position;

-- محتوى مجموعة باسمها:
--   SELECT gi.position, l.code, l.name
--   FROM groups g
--   JOIN group_items gi ON gi.group_id = g.id
--   JOIN labs l         ON l.id = gi.item_id
--   WHERE g.name = 'فحوصات ما قبل الجراحة'
--   ORDER BY gi.position;

-- عناصر يتيمة في السلة (لا يقابلها عنصر — لا يفترض أن توجد):
--   SELECT * FROM cart WHERE kind='labs'
--   AND item_id NOT IN (SELECT id FROM labs);

-- توزيع التحاليل على التخصصات:
--   SELECT IFNULL(NULLIF(TRIM(category),''),'غير مصنّف') AS cat, COUNT(*) n
--   FROM labs GROUP BY cat ORDER BY n DESC;
