package me.alaoufi.dalili;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * قاعدة البيانات المحلية (SQLite) — تعيش داخل مساحة التطبيق الخاصة على الجهاز
 * (/data/data/me.alaoufi.dalili/databases/dalili.db) ولا تُرسَل لأي جهة إطلاقًا.
 *
 * تحلّ محل التخزين السابق في localStorage: جداول حقيقية بمفاتيح وفهارس بدل
 * نص JSON واحد، فلا تُفقد البيانات عند مسح ذاكرة WebView، ويبقى الحفظ ذرّيًا
 * (transaction) عند الاستيراد.
 *
 * الأقسام الثلاثة (meds / labs / recipes) تتشارك نفس منطق القراءة والكتابة،
 * ويفرّق بينها جدولُ الأعمدة أدناه فقط — إضافة قسم رابع لاحقًا تعني سطرين هنا.
 */
public class DaliliDb extends SQLiteOpenHelper {

    public static final String DB_NAME = "dalili.db";
    private static final int DB_VERSION = 7;

    /**
     * الأقسام الأصلية الأربعة — وهي أيضًا أسماء جداولها.
     *
     * <p>الأقسام التي ينشئها المستخدم لا جدول لكلٍّ منها (لا نغيّر المخطط
     * وقت التشغيل)؛ عناصرها كلها في جدول {@code items} يفرّقها عمود
     * {@code section}. لذلك اسم الجدول هنا ثابت دائمًا ولا يأتي من
     * المستخدم إطلاقًا — لا مجال لحقن SQL عبر اسم قسم.
     */
    public static final String[] KINDS = { "meds", "labs", "imaging", "recipes" };

    private static final String[] MED_TEXT_COLS = {
            "trade_name", "scientific_name", "category", "concentration",
            "dosage", "duration", "uses", "cautions", "notes"
    };
    private static final String[] LAB_TEXT_COLS = {
            "category", "code", "name", "purpose", "requirements", "prohibitions"
    };
    /** الأشعة والفحوصات: تصوير ومناظير وتخطيط — نفس بنية التحاليل مع «المنطقة». */
    private static final String[] IMAGING_TEXT_COLS = {
            "category", "name", "region", "purpose", "requirements", "prohibitions"
    };
    /** الوصفات: اسمها ونوعها (علاجية/وقائية/غذائية) وتفاصيل تحضيرها واستخدامها. */
    private static final String[] RECIPE_TEXT_COLS = {
            "category", "name", "type", "purpose", "ingredients", "preparation",
            "usage", "dose", "duration", "effects", "precautions"
    };

    public DaliliDb(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    public static boolean isKind(String kind) {
        for (String k : KINDS) if (k.equals(kind)) return true;
        return false;
    }

    /** قسم من إنشاء المستخدم: معرّف غير فارغ ليس من الأربعة الأصلية. */
    public static boolean isCustomKind(String kind) {
        return kind != null && !kind.isEmpty() && !isKind(kind);
    }

    private static String[] textCols(String kind) {
        if ("meds".equals(kind)) return MED_TEXT_COLS;
        if ("labs".equals(kind)) return LAB_TEXT_COLS;
        if ("imaging".equals(kind)) return IMAGING_TEXT_COLS;
        return RECIPE_TEXT_COLS;
    }

    /** عمود العلامة (⭐) يختلف اسمه بين الأقسام لأسباب تاريخية في الواجهة. */
    private static String flagCol(String kind) {
        if ("meds".equals(kind)) return "default_include";
        if ("labs".equals(kind) || "imaging".equals(kind)) return "is_common";
        return "is_favorite";
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE meds ("
                + "id TEXT PRIMARY KEY,"
                + "trade_name TEXT NOT NULL,"
                + "scientific_name TEXT,"
                + "category TEXT,"
                + "concentration TEXT,"
                + "dosage TEXT,"
                + "duration TEXT,"
                + "uses TEXT,"
                + "cautions TEXT,"
                + "notes TEXT,"
                + "default_include INTEGER NOT NULL DEFAULT 0,"
                + "sort_order INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE TABLE labs ("
                + "id TEXT PRIMARY KEY,"
                + "category TEXT,"
                + "code TEXT,"
                + "name TEXT NOT NULL,"
                + "purpose TEXT,"
                + "requirements TEXT,"
                + "prohibitions TEXT,"
                + "is_common INTEGER NOT NULL DEFAULT 0,"
                + "sort_order INTEGER NOT NULL DEFAULT 0)");
        createImaging(db);
        createRecipes(db);
        createGroups(db);
        createCats(db);
        createSections(db);
        createFields(db);
        createItems(db);
        // سلة التحديد: الترتيب مهم لأنه ترتيب الطباعة/الصورة المُرسَلة
        db.execSQL("CREATE TABLE cart ("
                + "kind TEXT NOT NULL,"
                + "item_id TEXT NOT NULL,"
                + "position INTEGER NOT NULL,"
                + "PRIMARY KEY (kind, item_id))");
        db.execSQL("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)");
        db.execSQL("CREATE INDEX idx_meds_name ON meds(trade_name)");
        db.execSQL("CREATE INDEX idx_meds_category ON meds(category)");
        db.execSQL("CREATE INDEX idx_labs_category ON labs(category)");
    }

    private void createImaging(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS imaging ("
                + "id TEXT PRIMARY KEY,"
                + "category TEXT,"          // نوع الفحص: أشعة سينية، رنين، منظار…
                + "name TEXT NOT NULL,"
                + "region TEXT,"            // المنطقة أو العضو
                + "purpose TEXT,"
                + "requirements TEXT,"      // التحضير المطلوب
                + "prohibitions TEXT,"      // موانع الإجراء
                + "is_common INTEGER NOT NULL DEFAULT 0,"
                + "sort_order INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_imaging_category ON imaging(category)");
    }

    private void createRecipes(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS recipes ("
                + "id TEXT PRIMARY KEY,"
                + "category TEXT,"          // تصنيف يختاره المستخدم بنفسه
                + "name TEXT NOT NULL,"
                + "type TEXT,"
                + "purpose TEXT,"
                + "ingredients TEXT,"
                + "preparation TEXT,"
                + "usage TEXT,"
                + "dose TEXT,"
                + "duration TEXT,"
                + "effects TEXT,"
                + "precautions TEXT,"
                + "is_favorite INTEGER NOT NULL DEFAULT 0,"
                + "sort_order INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_recipes_type ON recipes(type)");
    }

    /**
     * التصنيفات: كيان مستقل لكل قسم («العيون» و«الأذن» في العلاجات، «كيمياء
     * الدم» و«المناعة» في التحاليل…). كانت مجرّد نصّ داخل العنصر، فلم يكن
     * ممكنًا إنشاء تصنيف قبل عناصره ولا إعادة تسميته دفعةً واحدة. الآن هي
     * صفوف حقيقية، وعمود {@code category} في جداول الأقسام يشير لاسمها.
     *
     * <p>الربط بالاسم لا بالمعرّف عمدًا: يبقى العنصر مقروءًا في النسخة
     * الاحتياطية وفي التصدير بلا الحاجة لجدول التصنيفات، وإعادة التسمية
     * تُنفَّذ بتحديث واحد عبر {@link #moveCatItems}.
     */
    private void createCats(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS cats ("
                + "id TEXT PRIMARY KEY,"
                + "kind TEXT NOT NULL,"
                + "name TEXT NOT NULL,"
                + "sort_order INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_cats_kind ON cats(kind)");
    }

    /** أول ترقية: تُبنى التصنيفات ممّا هو مكتوب فعلًا في العناصر فلا يضيع شيء. */
    private void seedCatsFromItems(SQLiteDatabase db) {
        int order = 1;
        for (String kind : KINDS) {
            Cursor c = db.rawQuery("SELECT DISTINCT category FROM " + kind
                    + " WHERE category IS NOT NULL AND category<>'' ORDER BY category", null);
            try {
                while (c.moveToNext()) {
                    ContentValues v = new ContentValues();
                    v.put("id", "cat_" + kind + "_" + order);
                    v.put("kind", kind);
                    v.put("name", c.getString(0));
                    v.put("sort_order", order++);
                    db.insertWithOnConflict("cats", null, v, SQLiteDatabase.CONFLICT_IGNORE);
                }
            } finally { c.close(); }
        }
    }

    /**
     * الأقسام: الأربعة الأصلية مسجّلة هنا أيضًا ليتمكّن المستخدم من تغيير
     * اسمها وأيقونتها وترتيبها، ومعها ما ينشئه من أقسام جديدة.
     * {@code builtin=1} يعني أن لها جدولها الخاص ولا تُحذف.
     */
    private void createSections(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS sections ("
                + "id TEXT PRIMARY KEY,"
                + "title TEXT NOT NULL,"
                + "icon TEXT,"
                + "builtin INTEGER NOT NULL DEFAULT 0,"
                + "sort_order INTEGER NOT NULL DEFAULT 0)");
    }

    /**
     * الحقول الإضافية التي يعرّفها المستخدم داخل بيانات العنصر. القيمة
     * نفسها تُحفَظ في عمود {@code extra} (JSON) على صفّ العنصر، فلا يتغيّر
     * المخطط كلّما أضاف المستخدم حقلًا.
     */
    private void createFields(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS fields ("
                + "id TEXT PRIMARY KEY,"
                + "kind TEXT NOT NULL,"      // القسم الذي ينتمي له الحقل
                + "key TEXT NOT NULL,"       // المفتاح داخل extra
                + "label TEXT NOT NULL,"     // ما يراه المستخدم
                + "type TEXT NOT NULL,"      // text | area
                + "sort_order INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_fields_kind ON fields(kind)");
    }

    /** عناصر الأقسام التي ينشئها المستخدم — جدول واحد يفرّقه عمود section. */
    private void createItems(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS items ("
                + "id TEXT PRIMARY KEY,"
                + "section TEXT NOT NULL,"
                + "name TEXT NOT NULL,"
                + "category TEXT,"
                + "extra TEXT,"              // JSON: قيم الحقول التي عرّفها المستخدم
                + "flag INTEGER NOT NULL DEFAULT 0,"
                + "sort_order INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_items_section ON items(section)");
    }

    /** عمود extra على الأقسام الأصلية — يحمل قيم حقول المستخدم. */
    private void addExtraColumns(SQLiteDatabase db) {
        for (String kind : KINDS) {
            if (!hasColumn(db, kind, "extra")) {
                db.execSQL("ALTER TABLE " + kind + " ADD COLUMN extra TEXT");
            }
        }
    }

    private static boolean hasColumn(SQLiteDatabase db, String table, String col) {
        Cursor c = db.rawQuery("PRAGMA table_info(" + table + ")", null);
        try {
            while (c.moveToNext()) if (col.equals(c.getString(1))) return true;
        } finally { c.close(); }
        return false;
    }

    /**
     * المجموعات المسمّاة: قوائم جاهزة داخل القسم («فحوصات ما قبل الجراحة»
     * مثلًا) تُحمَّل للطباعة أو الإرسال بضغطة، وتُعدَّل وتُحفظ باستقلال عن
     * سلة التحديد المؤقتة.
     */
    private void createGroups(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS groups ("
                + "id TEXT PRIMARY KEY,"
                + "kind TEXT NOT NULL,"
                + "name TEXT NOT NULL,"
                + "sort_order INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE TABLE IF NOT EXISTS group_items ("
                + "group_id TEXT NOT NULL,"
                + "item_id TEXT NOT NULL,"
                + "position INTEGER NOT NULL,"
                + "PRIMARY KEY (group_id, item_id))");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_groups_kind ON groups(kind)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // الترقيات تراكمية وبلا حذف بيانات: كل خطوة تبني على ما قبلها.
        if (oldVersion < 2) {
            // تصنيف للعلاجات (لتجميعها كالتحاليل) + حقول التحليل الجديدة:
            // الهدف منه، متطلبات التحليل (صيام/نوع العيّنة)، وممنوعاته
            db.execSQL("ALTER TABLE meds ADD COLUMN category TEXT");
            db.execSQL("ALTER TABLE labs ADD COLUMN purpose TEXT");
            db.execSQL("ALTER TABLE labs ADD COLUMN requirements TEXT");
            db.execSQL("ALTER TABLE labs ADD COLUMN prohibitions TEXT");
            db.execSQL("CREATE INDEX IF NOT EXISTS idx_meds_category ON meds(category)");
        }
        if (oldVersion < 3) {
            createRecipes(db);   // القسم الثالث: الوصفات العلاجية
        }
        if (oldVersion < 4) {
            createGroups(db);    // المجموعات المسمّاة
        }
        if (oldVersion < 5) {
            createImaging(db);   // القسم الرابع: الأشعة والفحوصات
        }
        if (oldVersion < 6) {
            // التصنيفات كيانًا مستقلًّا + تصنيف للوصفات.
            // الفحص قبل ALTER لأن createRecipes صار يُنشئ العمود، فقاعدة
            // مرقّاة من ٢ تملكه أصلًا بينما القادمة من ٣–٥ لا تملكه.
            if (!hasColumn(db, "recipes", "category")) {
                db.execSQL("ALTER TABLE recipes ADD COLUMN category TEXT");
            }
            createCats(db);
            seedCatsFromItems(db);
        }
        if (oldVersion < 7) {
            // أقسام يملكها المستخدم (تسمية وأيقونة وترتيب وإضافة قسم جديد)
            // + حقول إضافية داخل بيانات العنصر.
            createSections(db);
            createFields(db);
            createItems(db);
            addExtraColumns(db);
        }
    }

    /* ─────────────── قراءة كل شيء دفعة واحدة (عند الإقلاع) ─────────────── */

    public JSONObject loadAll() throws Exception {
        SQLiteDatabase db = getReadableDatabase();
        JSONObject out = new JSONObject();
        JSONObject cart = new JSONObject();
        for (String kind : KINDS) {
            out.put(kind, readItems(db, kind));
            cart.put(kind, readCart(db, kind));
        }
        JSONArray sections = readSections(db);
        out.put("sections", sections);
        out.put("fields", readFields(db));
        // أقسام المستخدم: عناصرها في items، وتصل للواجهة بنفس شكل الأصلية
        for (int i = 0; i < sections.length(); i++) {
            JSONObject sec = sections.optJSONObject(i);
            String id = sec == null ? "" : sec.optString("id");
            if (isCustomKind(id)) {
                out.put(id, readCustomItems(db, id));
                cart.put(id, readCart(db, id));
            }
        }
        out.put("cart", cart);
        out.put("cats", readCats(db));
        out.put("groups", readGroups(db));
        out.put("settings", readSettings(db));
        out.put("pin_hash", getSetting(db, "pin_hash"));
        return out;
    }

    private JSONArray readItems(SQLiteDatabase db, String kind) throws Exception {
        JSONArray arr = new JSONArray();
        Cursor c = db.query(kind, null, null, null, null, null, "sort_order ASC");
        try {
            while (c.moveToNext()) {
                JSONObject o = new JSONObject();
                o.put("id", c.getString(c.getColumnIndexOrThrow("id")));
                for (String col : textCols(kind)) o.put(col, str(c, col));
                String flag = flagCol(kind);
                o.put(flag, c.getInt(c.getColumnIndexOrThrow(flag)));
                o.put("extra", parseExtra(str(c, "extra")));
                arr.put(o);
            }
        } finally { c.close(); }
        return arr;
    }

    private JSONArray readCart(SQLiteDatabase db, String kind) {
        JSONArray arr = new JSONArray();
        Cursor c = db.query("cart", new String[]{"item_id"}, "kind=?",
                new String[]{kind}, null, null, "position ASC");
        try {
            while (c.moveToNext()) arr.put(c.getString(0));
        } finally { c.close(); }
        return arr;
    }

    private JSONArray readSections(SQLiteDatabase db) throws Exception {
        JSONArray arr = new JSONArray();
        Cursor c = db.query("sections", null, null, null, null, null, "sort_order ASC");
        try {
            while (c.moveToNext()) {
                JSONObject o = new JSONObject();
                o.put("id", str(c, "id"));
                o.put("title", str(c, "title"));
                o.put("icon", str(c, "icon"));
                o.put("builtin", c.getInt(c.getColumnIndexOrThrow("builtin")));
                arr.put(o);
            }
        } finally { c.close(); }
        return arr;
    }

    private JSONArray readFields(SQLiteDatabase db) throws Exception {
        JSONArray arr = new JSONArray();
        Cursor c = db.query("fields", null, null, null, null, null, "sort_order ASC");
        try {
            while (c.moveToNext()) {
                JSONObject o = new JSONObject();
                o.put("id", str(c, "id"));
                o.put("kind", str(c, "kind"));
                o.put("key", str(c, "key"));
                o.put("label", str(c, "label"));
                o.put("type", str(c, "type"));
                arr.put(o);
            }
        } finally { c.close(); }
        return arr;
    }

    /** عناصر قسمٍ أنشأه المستخدم — من جدول items بمرشّح مربوط لا باسم جدول. */
    private JSONArray readCustomItems(SQLiteDatabase db, String section) throws Exception {
        JSONArray arr = new JSONArray();
        Cursor c = db.query("items", null, "section=?", new String[]{section},
                null, null, "sort_order ASC");
        try {
            while (c.moveToNext()) {
                JSONObject o = new JSONObject();
                o.put("id", str(c, "id"));
                o.put("name", str(c, "name"));
                o.put("category", str(c, "category"));
                o.put("flag", c.getInt(c.getColumnIndexOrThrow("flag")));
                o.put("extra", parseExtra(str(c, "extra")));
                arr.put(o);
            }
        } finally { c.close(); }
        return arr;
    }

    /** {@code extra} يصل الواجهة كائنًا لا نصًّا، وأي نص تالف يعود كائنًا فارغًا. */
    private static JSONObject parseExtra(String raw) {
        if (raw == null || raw.isEmpty()) return new JSONObject();
        try { return new JSONObject(raw); } catch (Exception e) { return new JSONObject(); }
    }

    public void saveSection(JSONObject o) {
        writeSection(getWritableDatabase(), o, -1);
    }

    private void writeSection(SQLiteDatabase db, JSONObject o, int order) {
        String id = o.optString("id");
        if (id.isEmpty()) return;
        ContentValues v = new ContentValues();
        v.put("title", o.optString("title", ""));
        v.put("icon", o.optString("icon", ""));
        v.put("builtin", o.optInt("builtin", 0));
        if (order >= 0) v.put("sort_order", order);
        if (db.update("sections", v, "id=?", new String[]{id}) == 0) {
            v.put("id", id);
            if (order < 0) v.put("sort_order", nextSortOrder(db, "sections"));
            db.insert("sections", null, v);
        }
    }

    /** حذف قسم أنشأه المستخدم: عناصره وسلّته وتصنيفاته وحقوله ومجموعاته. */
    public void deleteSection(String id) {
        if (!isCustomKind(id)) return;      // الأصلية لا تُحذف
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("items", "section=?", new String[]{id});
            db.delete("sections", "id=?", new String[]{id});
            db.delete("fields", "kind=?", new String[]{id});
            db.delete("cats", "kind=?", new String[]{id});
            db.delete("cart", "kind=?", new String[]{id});
            db.delete("group_items", "group_id IN (SELECT id FROM groups WHERE kind=?)",
                    new String[]{id});
            db.delete("groups", "kind=?", new String[]{id});
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }

    public void setSectionOrder(JSONArray ids) {
        reorder(getWritableDatabase(), "sections", ids);
    }

    public void saveField(JSONObject o) {
        writeField(getWritableDatabase(), o, -1);
    }

    private void writeField(SQLiteDatabase db, JSONObject o, int order) {
        String id = o.optString("id");
        if (id.isEmpty()) return;
        ContentValues v = new ContentValues();
        v.put("kind", o.optString("kind", ""));
        v.put("key", o.optString("key", ""));
        v.put("label", o.optString("label", ""));
        v.put("type", o.optString("type", "text"));
        if (order >= 0) v.put("sort_order", order);
        if (db.update("fields", v, "id=?", new String[]{id}) == 0) {
            v.put("id", id);
            if (order < 0) v.put("sort_order", nextSortOrder(db, "fields"));
            db.insert("fields", null, v);
        }
    }

    public void deleteField(String id) {
        getWritableDatabase().delete("fields", "id=?", new String[]{id});
    }

    public void setFieldOrder(JSONArray ids) {
        reorder(getWritableDatabase(), "fields", ids);
    }

    /** ترتيب صفوف جدول بحسب قائمة معرّفات — اسم الجدول من الكود لا من المستخدم. */
    private void reorder(SQLiteDatabase db, String table, JSONArray ids) {
        db.beginTransaction();
        try {
            for (int i = 0; i < ids.length(); i++) {
                ContentValues v = new ContentValues();
                v.put("sort_order", i + 1);
                db.update(table, v, "id=?", new String[]{ids.optString(i)});
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }

    private JSONArray readCats(SQLiteDatabase db) throws Exception {
        JSONArray arr = new JSONArray();
        Cursor c = db.query("cats", null, null, null, null, null, "sort_order ASC");
        try {
            while (c.moveToNext()) {
                JSONObject o = new JSONObject();
                o.put("id", str(c, "id"));
                o.put("kind", str(c, "kind"));
                o.put("name", str(c, "name"));
                arr.put(o);
            }
        } finally { c.close(); }
        return arr;
    }

    /** إضافة تصنيف أو إعادة تسميته. {@code order} سالبًا يعني «أبقِ ترتيبه». */
    public void saveCat(JSONObject o) {
        writeCat(getWritableDatabase(), o, -1);
    }

    private void writeCat(SQLiteDatabase db, JSONObject o, int order) {
        String id = o.optString("id");
        if (id.isEmpty()) return;
        ContentValues v = new ContentValues();
        v.put("kind", o.optString("kind", "labs"));
        v.put("name", o.optString("name", ""));
        if (order >= 0) v.put("sort_order", order);
        if (db.update("cats", v, "id=?", new String[]{id}) == 0) {
            v.put("id", id);
            if (order < 0) v.put("sort_order", nextSortOrder(db, "cats"));
            db.insert("cats", null, v);
        }
    }

    public void deleteCat(String id) {
        getWritableDatabase().delete("cats", "id=?", new String[]{id});
    }

    /**
     * نقل كل عناصر تصنيف إلى تصنيف آخر — تحديث واحد يخدم إعادة التسمية
     * (القديم ← الجديد) والحذف (القديم ← فارغ = «غير مصنّف»).
     */
    public void moveCatItems(String kind, String from, String to) {
        ContentValues v = new ContentValues();
        v.put("category", to == null ? "" : to);
        if (isCustomKind(kind)) {
            getWritableDatabase().update("items", v, "section=? AND category=?",
                    new String[]{kind, from});
        } else if (isKind(kind)) {
            getWritableDatabase().update(kind, v, "category=?", new String[]{from});
        }
    }

    /** ترتيب التصنيفات كما رتّبها المستخدم — قائمة معرّفات بالترتيب. */
    public void setCatOrder(JSONArray ids) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            for (int i = 0; i < ids.length(); i++) {
                ContentValues v = new ContentValues();
                v.put("sort_order", i + 1);
                db.update("cats", v, "id=?", new String[]{ids.optString(i)});
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }

    private JSONArray readGroups(SQLiteDatabase db) throws Exception {
        JSONArray arr = new JSONArray();
        Cursor c = db.query("groups", null, null, null, null, null, "sort_order ASC");
        try {
            while (c.moveToNext()) {
                JSONObject g = new JSONObject();
                String id = c.getString(c.getColumnIndexOrThrow("id"));
                g.put("id", id);
                g.put("kind", str(c, "kind"));
                g.put("name", str(c, "name"));
                g.put("items", readGroupItems(db, id));
                arr.put(g);
            }
        } finally { c.close(); }
        return arr;
    }

    private JSONArray readGroupItems(SQLiteDatabase db, String groupId) {
        JSONArray arr = new JSONArray();
        Cursor c = db.query("group_items", new String[]{"item_id"}, "group_id=?",
                new String[]{groupId}, null, null, "position ASC");
        try {
            while (c.moveToNext()) arr.put(c.getString(0));
        } finally { c.close(); }
        return arr;
    }

    /** حفظ مجموعة كاملة (اسمها ومحتواها) في معاملة واحدة. */
    public void saveGroup(JSONObject g) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            writeGroup(db, g, -1);
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }

    private void writeGroup(SQLiteDatabase db, JSONObject g, int order) {
        String id = g.optString("id");
        if (id.isEmpty()) return;
        ContentValues v = new ContentValues();
        v.put("kind", g.optString("kind", "labs"));
        v.put("name", g.optString("name", ""));
        if (db.update("groups", v, "id=?", new String[]{id}) == 0) {
            v.put("id", id);
            v.put("sort_order", order >= 0 ? order : nextSortOrder(db, "groups"));
            db.insert("groups", null, v);
        }
        db.delete("group_items", "group_id=?", new String[]{id});
        JSONArray items = g.optJSONArray("items");
        for (int i = 0; items != null && i < items.length(); i++) {
            String item = items.optString(i);
            if (item.isEmpty()) continue;
            ContentValues iv = new ContentValues();
            iv.put("group_id", id);
            iv.put("item_id", item);
            iv.put("position", i);
            db.insertWithOnConflict("group_items", null, iv, SQLiteDatabase.CONFLICT_REPLACE);
        }
    }

    public void deleteGroup(String id) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("groups", "id=?", new String[]{id});
            db.delete("group_items", "group_id=?", new String[]{id});
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }

    private static String str(Cursor c, String col) {
        String v = c.getString(c.getColumnIndexOrThrow(col));
        return v == null ? "" : v;
    }

    /* ─────────────── كتابة ─────────────── */

    private static ContentValues values(String kind, JSONObject o) {
        ContentValues v = new ContentValues();
        for (String col : textCols(kind)) v.put(col, o.optString(col, ""));
        v.put(flagCol(kind), o.optInt(flagCol(kind), 0));
        v.put("extra", extraStr(o));
        return v;
    }

    /** قيم الحقول التي عرّفها المستخدم — نصّ JSON في عمود واحد. */
    private static String extraStr(JSONObject o) {
        JSONObject x = o.optJSONObject("extra");
        return x == null ? "" : x.toString();
    }

    /** صفّ عنصر في قسمٍ أنشأه المستخدم. */
    private static ContentValues customValues(String section, JSONObject o) {
        ContentValues v = new ContentValues();
        v.put("section", section);
        v.put("name", o.optString("name", ""));
        v.put("category", o.optString("category", ""));
        v.put("flag", o.optInt("flag", 0));
        v.put("extra", extraStr(o));
        return v;
    }

    /** إضافة أو تعديل عنصر. يُحافظ على ترتيب الإدراج للعناصر الجديدة. */
    public void upsert(String kind, JSONObject o) {
        SQLiteDatabase db = getWritableDatabase();
        if (isCustomKind(kind)) {
            upsertRow(db, "items", o.optString("id"), customValues(kind, o));
        } else {
            upsertRow(db, kind, o.optString("id"), values(kind, o));
        }
    }

    /**
     * إضافة دفعة كاملة داخل معاملة واحدة — تُستخدم عند استيراد عناصر من
     * المكتبة الجاهزة، فإضافة ٥٠ عنصرًا واحدًا واحدًا بطيئة وغير ذرّية.
     */
    public void upsertMany(String kind, JSONArray items) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            boolean custom = isCustomKind(kind);
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.optJSONObject(i);
                if (o == null || o.optString("id").isEmpty()) continue;
                if (custom) upsertRow(db, "items", o.optString("id"), customValues(kind, o));
                else upsertRow(db, kind, o.optString("id"), values(kind, o));
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }

    private void upsertRow(SQLiteDatabase db, String table, String id, ContentValues v) {
        int updated = db.update(table, v, "id=?", new String[]{id});
        if (updated == 0) {
            v.put("id", id);
            v.put("sort_order", nextSortOrder(db, table));
            db.insert(table, null, v);
        }
    }

    private int nextSortOrder(SQLiteDatabase db, String table) {
        Cursor c = db.rawQuery("SELECT IFNULL(MAX(sort_order),0)+1 FROM " + table, null);
        try { return c.moveToFirst() ? c.getInt(0) : 1; } finally { c.close(); }
    }

    /** حذف عنصر مع إزالته من السلة في نفس المعاملة. */
    public void delete(String kind, String id) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            if (isCustomKind(kind)) db.delete("items", "id=? AND section=?", new String[]{id, kind});
            else db.delete(kind, "id=?", new String[]{id});
            db.delete("cart", "kind=? AND item_id=?", new String[]{kind, id});
            // وإلا بقيت إشارة يتيمة في كل مجموعة تضمّ العنصر
            db.delete("group_items", "item_id=? AND group_id IN "
                    + "(SELECT id FROM groups WHERE kind=?)", new String[]{id, kind});
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }

    /** استبدال محتوى السلة بالكامل (يحفظ الترتيب كما هو في الواجهة). */
    public void setCart(String kind, JSONArray ids) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("cart", "kind=?", new String[]{kind});
            insertCartRows(db, kind, ids);
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }

    public void setSetting(String key, String value) {
        SQLiteDatabase db = getWritableDatabase();
        if (value == null) {
            db.delete("settings", "key=?", new String[]{key});
            return;
        }
        ContentValues v = new ContentValues();
        v.put("key", key);
        v.put("value", value);
        db.insertWithOnConflict("settings", null, v, SQLiteDatabase.CONFLICT_REPLACE);
    }

    /** كل الإعدادات دفعة واحدة (رمز القفل، الحقول المرسلة، …). */
    private JSONObject readSettings(SQLiteDatabase db) throws Exception {
        JSONObject o = new JSONObject();
        Cursor c = db.query("settings", new String[]{"key", "value"},
                null, null, null, null, null);
        try {
            while (c.moveToNext()) o.put(c.getString(0), c.getString(1));
        } finally { c.close(); }
        return o;
    }

    private String getSetting(SQLiteDatabase db, String key) {
        Cursor c = db.query("settings", new String[]{"value"}, "key=?",
                new String[]{key}, null, null, null);
        try { return c.moveToFirst() ? c.getString(0) : null; } finally { c.close(); }
    }

    /**
     * استيراد نسخة احتياطية: يمسح الجداول ويكتب المحتوى الجديد داخل معاملة
     * واحدة — إمّا ينجح كلّه أو تبقى البيانات القديمة كما هي.
     */
    public void replaceAll(JSONObject data) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            for (String kind : KINDS) db.delete(kind, null, null);
            db.delete("items", null, null);
            db.delete("cart", null, null);
            db.delete("cats", null, null);
            db.delete("sections", null, null);
            db.delete("fields", null, null);
            db.delete("groups", null, null);
            db.delete("group_items", null, null);

            for (String kind : KINDS) {
                JSONArray items = data.optJSONArray(kind);
                for (int i = 0; items != null && i < items.length(); i++) {
                    JSONObject o = items.optJSONObject(i);
                    if (o == null || o.optString("id").isEmpty()) continue;
                    ContentValues v = values(kind, o);
                    v.put("id", o.optString("id"));
                    v.put("sort_order", i + 1);
                    db.insertWithOnConflict(kind, null, v, SQLiteDatabase.CONFLICT_REPLACE);
                }
            }

            // الأقسام أولًا: منها نعرف أي أقسام أنشأها المستخدم فنستعيد عناصرها
            JSONArray sections = data.optJSONArray("sections");
            for (int i = 0; sections != null && i < sections.length(); i++) {
                JSONObject o = sections.optJSONObject(i);
                if (o != null) writeSection(db, o, i + 1);
            }
            JSONArray fields = data.optJSONArray("fields");
            for (int i = 0; fields != null && i < fields.length(); i++) {
                JSONObject o = fields.optJSONObject(i);
                if (o != null) writeField(db, o, i + 1);
            }

            JSONObject cart = data.optJSONObject("cart");
            for (String kind : KINDS) {
                if (cart != null) insertCartRows(db, kind, cart.optJSONArray(kind));
            }
            for (int i = 0; sections != null && i < sections.length(); i++) {
                JSONObject sec = sections.optJSONObject(i);
                String id = sec == null ? "" : sec.optString("id");
                if (!isCustomKind(id)) continue;
                JSONArray items = data.optJSONArray(id);
                for (int j = 0; items != null && j < items.length(); j++) {
                    JSONObject o = items.optJSONObject(j);
                    if (o == null || o.optString("id").isEmpty()) continue;
                    ContentValues v = customValues(id, o);
                    v.put("id", o.optString("id"));
                    v.put("sort_order", j + 1);
                    db.insertWithOnConflict("items", null, v, SQLiteDatabase.CONFLICT_REPLACE);
                }
                if (cart != null) insertCartRows(db, id, cart.optJSONArray(id));
            }

            JSONArray cats = data.optJSONArray("cats");
            for (int i = 0; cats != null && i < cats.length(); i++) {
                JSONObject o = cats.optJSONObject(i);
                if (o != null) writeCat(db, o, i + 1);
            }

            JSONArray groups = data.optJSONArray("groups");
            for (int i = 0; groups != null && i < groups.length(); i++) {
                JSONObject g = groups.optJSONObject(i);
                if (g != null) writeGroup(db, g, i + 1);
            }

            String pin = data.isNull("pin_hash") ? null : data.optString("pin_hash", null);
            if (pin != null && !pin.isEmpty()) {
                ContentValues v = new ContentValues();
                v.put("key", "pin_hash");
                v.put("value", pin);
                db.insertWithOnConflict("settings", null, v, SQLiteDatabase.CONFLICT_REPLACE);
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }

    private void insertCartRows(SQLiteDatabase db, String kind, JSONArray ids) {
        for (int i = 0; ids != null && i < ids.length(); i++) {
            String id = ids.optString(i);
            if (id.isEmpty()) continue;
            ContentValues v = new ContentValues();
            v.put("kind", kind);
            v.put("item_id", id);
            v.put("position", i);
            db.insertWithOnConflict("cart", null, v, SQLiteDatabase.CONFLICT_REPLACE);
        }
    }

    /** هل القاعدة فارغة تمامًا؟ (تُستخدم لترحيل بيانات localStorage القديمة مرّة واحدة) */
    public boolean isEmpty() {
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.rawQuery("SELECT (SELECT COUNT(*) FROM meds)+(SELECT COUNT(*) FROM labs)"
                + "+(SELECT COUNT(*) FROM imaging)+(SELECT COUNT(*) FROM recipes)", null);
        try { return !c.moveToFirst() || c.getInt(0) == 0; } finally { c.close(); }
    }
}
