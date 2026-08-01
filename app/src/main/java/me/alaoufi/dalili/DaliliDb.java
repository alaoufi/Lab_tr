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
 */
public class DaliliDb extends SQLiteOpenHelper {

    public static final String DB_NAME = "dalili.db";
    private static final int DB_VERSION = 1;

    /** حقول العلاج النصية — نفس أسماء الحقول في الواجهة تمامًا. */
    private static final String[] MED_TEXT_COLS = {
            "trade_name", "scientific_name", "concentration",
            "dosage", "duration", "uses", "cautions", "notes"
    };
    private static final String[] LAB_TEXT_COLS = { "category", "code", "name" };

    public DaliliDb(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE meds ("
                + "id TEXT PRIMARY KEY,"
                + "trade_name TEXT NOT NULL,"
                + "scientific_name TEXT,"
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
                + "is_common INTEGER NOT NULL DEFAULT 0,"
                + "sort_order INTEGER NOT NULL DEFAULT 0)");
        // سلة التحديد: الترتيب مهم لأنه ترتيب الطباعة/الصورة المُرسَلة
        db.execSQL("CREATE TABLE cart ("
                + "kind TEXT NOT NULL,"
                + "item_id TEXT NOT NULL,"
                + "position INTEGER NOT NULL,"
                + "PRIMARY KEY (kind, item_id))");
        db.execSQL("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)");
        db.execSQL("CREATE INDEX idx_meds_name ON meds(trade_name)");
        db.execSQL("CREATE INDEX idx_labs_category ON labs(category)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // لا ترقيات بعد — الإصدار ١ هو الأول. تُضاف هنا لاحقًا بلا حذف بيانات.
    }

    /* ─────────────── قراءة كل شيء دفعة واحدة (عند الإقلاع) ─────────────── */

    public JSONObject loadAll() throws Exception {
        SQLiteDatabase db = getReadableDatabase();
        JSONObject out = new JSONObject();
        out.put("meds", readMeds(db));
        out.put("labs", readLabs(db));
        JSONObject cart = new JSONObject();
        cart.put("meds", readCart(db, "meds"));
        cart.put("labs", readCart(db, "labs"));
        out.put("cart", cart);
        out.put("pin_hash", getSetting(db, "pin_hash"));
        return out;
    }

    private JSONArray readMeds(SQLiteDatabase db) throws Exception {
        JSONArray arr = new JSONArray();
        Cursor c = db.query("meds", null, null, null, null, null, "sort_order ASC");
        try {
            while (c.moveToNext()) {
                JSONObject o = new JSONObject();
                o.put("id", c.getString(c.getColumnIndexOrThrow("id")));
                for (String col : MED_TEXT_COLS) o.put(col, str(c, col));
                o.put("default_include", c.getInt(c.getColumnIndexOrThrow("default_include")));
                arr.put(o);
            }
        } finally { c.close(); }
        return arr;
    }

    private JSONArray readLabs(SQLiteDatabase db) throws Exception {
        JSONArray arr = new JSONArray();
        Cursor c = db.query("labs", null, null, null, null, null, "sort_order ASC");
        try {
            while (c.moveToNext()) {
                JSONObject o = new JSONObject();
                o.put("id", c.getString(c.getColumnIndexOrThrow("id")));
                for (String col : LAB_TEXT_COLS) o.put(col, str(c, col));
                o.put("is_common", c.getInt(c.getColumnIndexOrThrow("is_common")));
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

    /** إضافة أو تعديل علاج. يُحافظ على ترتيب الإدراج للعناصر الجديدة. */
    public void upsertMed(JSONObject m) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues v = new ContentValues();
        for (String col : MED_TEXT_COLS) v.put(col, m.optString(col, ""));
        v.put("default_include", m.optInt("default_include", 0));
        upsertRow(db, "meds", m.optString("id"), v);
    }

    /** إضافة أو تعديل تحليل. */
    public void upsertLab(JSONObject t) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues v = new ContentValues();
        for (String col : LAB_TEXT_COLS) v.put(col, t.optString(col, ""));
        v.put("is_common", t.optInt("is_common", 0));
        upsertRow(db, "labs", t.optString("id"), v);
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
            for (int i = 0; i < ids.length(); i++) {
                ContentValues v = new ContentValues();
                v.put("kind", kind);
                v.put("item_id", ids.optString(i));
                v.put("position", i);
                db.insert("cart", null, v);
            }
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
            db.delete("meds", null, null);
            db.delete("labs", null, null);
            db.delete("cart", null, null);

            JSONArray meds = data.optJSONArray("meds");
            for (int i = 0; meds != null && i < meds.length(); i++) {
                JSONObject m = meds.optJSONObject(i);
                if (m == null || m.optString("id").isEmpty()) continue;
                ContentValues v = new ContentValues();
                v.put("id", m.optString("id"));
                for (String col : MED_TEXT_COLS) v.put(col, m.optString(col, ""));
                v.put("default_include", m.optInt("default_include", 0));
                v.put("sort_order", i + 1);
                db.insertWithOnConflict("meds", null, v, SQLiteDatabase.CONFLICT_REPLACE);
            }

            JSONArray labs = data.optJSONArray("labs");
            for (int i = 0; labs != null && i < labs.length(); i++) {
                JSONObject t = labs.optJSONObject(i);
                if (t == null || t.optString("id").isEmpty()) continue;
                ContentValues v = new ContentValues();
                v.put("id", t.optString("id"));
                for (String col : LAB_TEXT_COLS) v.put(col, t.optString(col, ""));
                v.put("is_common", t.optInt("is_common", 0));
                v.put("sort_order", i + 1);
                db.insertWithOnConflict("labs", null, v, SQLiteDatabase.CONFLICT_REPLACE);
            }

            JSONObject cart = data.optJSONObject("cart");
            if (cart != null) {
                insertCartRows(db, "meds", cart.optJSONArray("meds"));
                insertCartRows(db, "labs", cart.optJSONArray("labs"));
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
        Cursor c = db.rawQuery(
                "SELECT (SELECT COUNT(*) FROM meds)+(SELECT COUNT(*) FROM labs)", null);
        try { return !c.moveToFirst() || c.getInt(0) == 0; } finally { c.close(); }
    }
}
