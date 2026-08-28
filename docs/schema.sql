-- ============================================================================
--  دليلي — مخطط قاعدة البيانات المحلية (SQLite)
--  ملف: /data/data/me.alaoufi.dalili/databases/dalili.db
--  إصدار المخطط: 7   (DaliliDb.DB_VERSION)
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
    extra            TEXT,                      -- JSON: قيم الحقول التي عرّفها المستخدم
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
    extra         TEXT,                          -- JSON: حقول المستخدم
    is_common     INTEGER NOT NULL DEFAULT 0,    -- ⭐ تحليل شائع (0/1)
    sort_order    INTEGER NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────────────────────────────────────
--  ٣) الأشعة والفحوصات — تصوير ومناظير وتخطيط
--  بنيتها كالتحاليل مع «المنطقة أو العضو» بدل رمز التحليل.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE imaging (
    id            TEXT PRIMARY KEY,
    category      TEXT,                          -- نوع الفحص (رنين، منظار…)
    name          TEXT    NOT NULL,              -- اسم الفحص (مطلوب)
    region        TEXT,                          -- المنطقة أو العضو
    purpose       TEXT,                          -- الهدف من الفحص
    requirements  TEXT,                          -- التحضير المطلوب
    prohibitions  TEXT,                          -- موانع الإجراء
    extra         TEXT,                          -- JSON: حقول المستخدم
    is_common     INTEGER NOT NULL DEFAULT 0,
    sort_order    INTEGER NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────────────────────────────────────
--  ٤) الوصفات العلاجية
--  ملاحظة: usage ليست كلمة محجوزة في SQLite فلا تحتاج اقتباسًا، لكن بعض
--  أدوات العرض الخارجية قد تفضّل "usage" — انتبه إن نقلت المخطط لمحرّك آخر.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE recipes (
    id           TEXT PRIMARY KEY,
    category     TEXT,                           -- التصنيف (يختاره المستخدم)
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
    extra        TEXT,                           -- JSON: حقول المستخدم
    is_favorite  INTEGER NOT NULL DEFAULT 0,     -- ⭐ مفضّلة (0/1)
    sort_order   INTEGER NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────────────────────────────────────
--  ٥) سلة التحديد — مؤقتة، مشتركة بين الأقسام
--  kind ∈ ('meds','labs','imaging','recipes') ويطابق اسم الجدول المصدر.
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
--  ٦) المجموعات المسمّاة — قوائم دائمة («فحوصات ما قبل الجراحة»)
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
--  ٧) التصنيفات — كيان مستقل لكل قسم
--  «العيون» و«الأذن» في العلاجات، «كيمياء الدم» و«المناعة» في التحاليل…
--  كانت مجرّد نصّ داخل العنصر، فلم يكن ممكنًا إنشاء تصنيف قبل عناصره ولا
--  إعادة تسميته دفعةً واحدة. الآن صفوف حقيقية، وعمود category في جداول
--  الأقسام يشير لاسمها.
--
--  لماذا الربط بالاسم لا بالمعرّف؟ ليبقى العنصر مقروءًا بذاته في النسخة
--  الاحتياطية بلا الحاجة لجدول التصنيفات. إعادة التسمية تُنفَّذ بتحديث واحد
--  (DaliliDb.moveCatItems) على كل عناصر القسم، والحذف يفرّغ العمود فتعود
--  العناصر «غير مصنّفة» ولا يُحذف منها شيء.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE cats (
    id          TEXT PRIMARY KEY,
    kind        TEXT    NOT NULL,                -- القسم: meds/labs/imaging/recipes
    name        TEXT    NOT NULL,                -- اسم التصنيف كما يظهر
    sort_order  INTEGER NOT NULL DEFAULT 0       -- ترتيب المستخدم للمجموعات
);

-- ─────────────────────────────────────────────────────────────────────────────
--  ٨) الأقسام — الأربعة الأصلية وما ينشئه المستخدم
--  الأصلية مسجّلة هنا أيضًا ليقدر المستخدم على تسميتها وتغيير أيقونتها
--  وترتيبها. builtin=1 يعني أن لها جدولها الخاص أعلاه ولا تُحذف.
--  الأقسام الجديدة لا جدول لكلٍّ منها — عناصرها في items أدناه.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE sections (
    id          TEXT PRIMARY KEY,               -- 'meds' … أو 'sec_<uid>'
    title       TEXT    NOT NULL,               -- الاسم كما يظهر
    icon        TEXT,                           -- رمز تعبيري واحد
    builtin     INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0      -- ترتيب البطاقات في الرئيسية
);

-- ─────────────────────────────────────────────────────────────────────────────
--  ٩) الحقول الإضافية — حقول يعرّفها المستخدم داخل بيانات العنصر
--  القيمة نفسها في عمود extra (JSON) على صفّ العنصر، فلا يتغيّر المخطط
--  كلّما أضاف المستخدم حقلًا. key ثابت لا يتغيّر بإعادة التسمية فلا تضيع
--  القيم المحفوظة.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE fields (
    id          TEXT PRIMARY KEY,
    kind        TEXT    NOT NULL,               -- القسم (sections.id)
    key         TEXT    NOT NULL,               -- المفتاح داخل extra
    label       TEXT    NOT NULL,               -- ما يراه المستخدم
    type        TEXT    NOT NULL,               -- 'text' | 'area'
    sort_order  INTEGER NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────────────────────────────────────
--  ١٠) عناصر الأقسام التي ينشئها المستخدم
--  جدول واحد يفرّق بينها عمود section، فلا يتغيّر المخطط وقت التشغيل ولا
--  يدخل اسمٌ من المستخدم في نصّ SQL كاسم جدول.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE items (
    id          TEXT PRIMARY KEY,
    section     TEXT    NOT NULL,               -- sections.id
    name        TEXT    NOT NULL,
    category    TEXT,                           -- cats.name
    extra       TEXT,                           -- JSON: قيم حقول القسم
    flag        INTEGER NOT NULL DEFAULT 0,     -- ⭐ مفضّل
    sort_order  INTEGER NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────────────────────────────────────
--  ١١) الإعدادات — مخزن مفتاح/قيمة
--  المفاتيح المستخدمة حاليًا:
--    pin_hash      بصمة SHA-256 لرمز القفل (لا الرمز نفسه)
--    out_meds      JSON: أسماء حقول العلاجات الظاهرة في الطباعة/الصورة
--    out_labs      JSON: نفسه للتحاليل
--    out_imaging   JSON: نفسه للأشعة والفحوصات
--    out_recipes   JSON: نفسه للوصفات
--    hdr_name      ترويسة الطباعة: الاسم        (اختيارية — فارغة افتراضيًا)
--    hdr_title     ترويسة الطباعة: الصفة        (اختيارية)
--    hdr_contact   ترويسة الطباعة: التواصل      (اختيارية)
--    backup_at     وقت آخر نسخة احتياطية تلقائية (ميلي ثانية)
--    cats_seeded   '1' بعد زرع التصنيفات المبدئية مرّة واحدة
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
CREATE INDEX idx_imaging_category ON imaging(category);
CREATE INDEX idx_recipes_type  ON recipes(type);
CREATE INDEX idx_groups_kind   ON groups(kind);
CREATE INDEX idx_cats_kind     ON cats(kind);
CREATE INDEX idx_fields_kind   ON fields(kind);
CREATE INDEX idx_items_section ON items(section);


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
--  الإصدار ٤ → ٥
--      CREATE TABLE IF NOT EXISTS imaging (…);          -- الأشعة والفحوصات
--      CREATE INDEX IF NOT EXISTS idx_imaging_category ON imaging(category);
--
--  الإصدار ٥ → ٦
--      -- التصنيفات كيانًا مستقلًّا + تصنيف للوصفات
--      ALTER TABLE recipes ADD COLUMN category TEXT;   -- إن لم يكن موجودًا
--      CREATE TABLE IF NOT EXISTS cats (…);
--      CREATE INDEX IF NOT EXISTS idx_cats_kind ON cats(kind);
--      -- ثم تُبنى التصنيفات ممّا هو مكتوب فعلًا في العناصر فلا يضيع شيء:
--      INSERT INTO cats SELECT … FROM (SELECT DISTINCT category FROM <kind>
--          WHERE category IS NOT NULL AND category<>'');
--      -- ملاحظة: ALTER مشروط بفحص PRAGMA table_info لأن createRecipes صار
--      -- يُنشئ العمود، فقاعدة مرقّاة من ٢ تملكه بينما القادمة من ٣–٥ لا.
--
--  الإصدار ٦ → ٧
--      -- أقسام يملكها المستخدم + حقول إضافية داخل بيانات العنصر
--      CREATE TABLE IF NOT EXISTS sections (…);
--      CREATE TABLE IF NOT EXISTS fields (…);
--      CREATE TABLE IF NOT EXISTS items (…);
--      ALTER TABLE <kind> ADD COLUMN extra TEXT;   -- للأربعة، إن لم يكن موجودًا
--      -- الأقسام الأصلية تُسجَّل من الواجهة عند أول إقلاع (ensureSections)
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
