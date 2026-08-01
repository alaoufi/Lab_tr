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
    private static final int DB_VERSION = 3;

    /** الأقسام الثلاثة — وهي أيضًا أسماء الجداول وقيم عمود cart.kind. */
    public static final String[] KINDS = { "meds", "labs", "recipes" };

    private static final String[] MED_TEXT_COLS = {
            "trade_name", "scientific_name", "category", "concentration",
            "dosage", "duration", "uses", "cautions", "notes"
    };
    private static final String[] LAB_TEXT_COLS = {
            "category", "code", "name", "purpose", "requirements", "prohibitions"
    };
    /** الوصفات: اسمها ونوعها (علاجية/وقائية/غذائية) وتفاصيل تحضيرها واستخدامها. */
    private static final String[] RECIPE_TEXT_COLS = {
            "name", "type", "purpose", "ingredients", "preparation",
            "usage", "dose", "duration", "effects", "precautions"
    };

    public DaliliDb(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    public static boolean isKind(String kind) {
        for (String k : KINDS) if (k.equals(kind)) return true;
        return false;
    }

    private static String[] textCols(String kind) {
        if ("meds".equals(kind)) return MED_TEXT_COLS;
        if ("labs".equals(kind)) return LAB_TEXT_COLS;
        return RECIPE_TEXT_COLS;
    }

    /** عمود العلامة (⭐) يختلف اسمه بين الأقسام لأسباب تاريخية في الواجهة. */
    private static String flagCol(String kind) {
        if ("meds".equals(kind)) return "default_include";
        if ("labs".equals(kind)) return "is_common";
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
        createRecipes(db);
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

    private void createRecipes(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS recipes ("
                + "id TEXT PRIMARY KEY,"
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
        out.put("cart", cart);
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

    private static String str(Cursor c, String col) {
        String v = c.getString(c.getColumnIndexOrThrow(col));
        return v == null ? "" : v;
    }

    /* ─────────────── كتابة ─────────────── */

    private static ContentValues values(String kind, JSONObject o) {
        ContentValues v = new ContentValues();
        for (String col : textCols(kind)) v.put(col, o.optString(col, ""));
        v.put(flagCol(kind), o.optInt(flagCol(kind), 0));
        return v;
    }

    /** إضافة أو تعديل عنصر. يُحافظ على ترتيب الإدراج للعناصر الجديدة. */
    public void upsert(String kind, JSONObject o) {
        upsertRow(getWritableDatabase(), kind, o.optString("id"), values(kind, o));
    }

    /**
     * إضافة دفعة كاملة داخل معاملة واحدة — تُستخدم عند استيراد عناصر من
     * المكتبة الجاهزة، فإضافة ٥٠ عنصرًا واحدًا واحدًا بطيئة وغير ذرّية.
     */
    public void upsertMany(String kind, JSONArray items) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.optJSONObject(i);
                if (o == null || o.optString("id").isEmpty()) continue;
                upsertRow(db, kind, o.optString("id"), values(kind, o));
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
            db.delete(kind, "id=?", new String[]{id});
            db.delete("cart", "kind=? AND item_id=?", new String[]{kind, id});
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
            db.delete("cart", null, null);

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

            JSONObject cart = data.optJSONObject("cart");
            if (cart != null) {
                for (String kind : KINDS) insertCartRows(db, kind, cart.optJSONArray(kind));
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
        Cursor c = db.rawQuery("SELECT (SELECT COUNT(*) FROM meds)"
                + "+(SELECT COUNT(*) FROM labs)+(SELECT COUNT(*) FROM recipes)", null);
        try { return !c.moveToFirst() || c.getInt(0) == 0; } finally { c.close(); }
    }
}
