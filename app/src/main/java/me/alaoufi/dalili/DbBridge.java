package me.alaoufi.dalili;

import android.util.Log;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * جسر JS ↔ SQLite: الواجهة (assets/app.js) تنادي هذه الدوال مباشرةً باسم
 * <code>NativeDb</code>. كل الدوال متزامنة وتُنفَّذ على خيط WebView الخلفي،
 * لذا لا تُوقِف الواجهة.
 *
 * <p>لا شيء هنا يفتح اتصالًا خارجيًا — القراءة والكتابة على ملف قاعدة البيانات
 * المحلي فقط.
 */
public class DbBridge {

    private static final String TAG = "DaliliDb";
    private final DaliliDb db;

    public DbBridge(DaliliDb db) {
        this.db = db;
    }

    /**
     * قسم مقبول: أحد الأربعة الأصلية (اسم جدول ثابت في الكود) أو قسمٌ
     * أنشأه المستخدم (يذهب لجدول items بمرشّح مربوط). في الحالتين لا يصل
     * نصّ من المستخدم إلى اسم جدول داخل SQL.
     */
    private static boolean validKind(String kind) {
        return DaliliDb.isKind(kind) || DaliliDb.isCustomKind(kind);
    }

    /** كل البيانات دفعة واحدة عند الإقلاع: {pin_hash, meds, labs, cart}. */
    @JavascriptInterface
    public String loadAll() {
        try {
            return db.loadAll().toString();
        } catch (Exception e) {
            Log.e(TAG, "loadAll failed", e);
            return "";
        }
    }

    /** إضافة أو تعديل عنصر في أي قسم (meds / labs / recipes). */
    @JavascriptInterface
    public boolean upsertItem(String kind, String json) {
        if (!validKind(kind)) return false;
        try {
            db.upsert(kind, new JSONObject(json));
            return true;
        } catch (Exception e) {
            Log.e(TAG, "upsertItem failed", e);
            return false;
        }
    }

    /** إضافة دفعة عناصر (استيراد من المكتبة الجاهزة) في معاملة واحدة. */
    @JavascriptInterface
    public boolean upsertMany(String kind, String jsonArray) {
        if (!validKind(kind)) return false;
        try {
            db.upsertMany(kind, new JSONArray(jsonArray));
            return true;
        } catch (Exception e) {
            Log.e(TAG, "upsertMany failed", e);
            return false;
        }
    }

    /** حفظ قسم (اسمه وأيقونته) — {id, title, icon, builtin}. */
    @JavascriptInterface
    public boolean saveSection(String json) {
        try {
            db.saveSection(new JSONObject(json));
            return true;
        } catch (Exception e) {
            Log.e(TAG, "saveSection failed", e);
            return false;
        }
    }

    /** حذف قسم أنشأه المستخدم بكل ما يتبعه. الأقسام الأصلية لا تُحذف. */
    @JavascriptInterface
    public boolean deleteSection(String id) {
        try {
            db.deleteSection(id);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "deleteSection failed", e);
            return false;
        }
    }

    @JavascriptInterface
    public boolean setSectionOrder(String jsonIds) {
        try {
            db.setSectionOrder(new JSONArray(jsonIds));
            return true;
        } catch (Exception e) {
            Log.e(TAG, "setSectionOrder failed", e);
            return false;
        }
    }

    /** حفظ حقل إضافي داخل بيانات العنصر — {id, kind, key, label, type}. */
    @JavascriptInterface
    public boolean saveField(String json) {
        try {
            db.saveField(new JSONObject(json));
            return true;
        } catch (Exception e) {
            Log.e(TAG, "saveField failed", e);
            return false;
        }
    }

    @JavascriptInterface
    public boolean deleteField(String id) {
        try {
            db.deleteField(id);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "deleteField failed", e);
            return false;
        }
    }

    @JavascriptInterface
    public boolean setFieldOrder(String jsonIds) {
        try {
            db.setFieldOrder(new JSONArray(jsonIds));
            return true;
        } catch (Exception e) {
            Log.e(TAG, "setFieldOrder failed", e);
            return false;
        }
    }

    /** تسجيل إرسال — {id, kind, title, who, ids[], ts}. يُقصّ على آخر عشرة. */
    @JavascriptInterface
    public boolean addSent(String json) {
        try {
            db.addSent(new JSONObject(json));
            return true;
        } catch (Exception e) {
            Log.e(TAG, "addSent failed", e);
            return false;
        }
    }

    @JavascriptInterface
    public boolean clearSent() {
        try {
            db.clearSent();
            return true;
        } catch (Exception e) {
            Log.e(TAG, "clearSent failed", e);
            return false;
        }
    }

    /** حفظ تصنيف (إنشاء أو إعادة تسمية) — {id, kind, name}. */
    @JavascriptInterface
    public boolean saveCat(String json) {
        try {
            db.saveCat(new JSONObject(json));
            return true;
        } catch (Exception e) {
            Log.e(TAG, "saveCat failed", e);
            return false;
        }
    }

    @JavascriptInterface
    public boolean deleteCat(String id) {
        try {
            db.deleteCat(id);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "deleteCat failed", e);
            return false;
        }
    }

    /** نقل عناصر تصنيف إلى آخر: إعادة تسمية، أو إفراغ عند الحذف. */
    @JavascriptInterface
    public boolean moveCatItems(String kind, String from, String to) {
        if (!validKind(kind)) return false;
        try {
            db.moveCatItems(kind, from, to);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "moveCatItems failed", e);
            return false;
        }
    }

    /** ترتيب التصنيفات كما رتّبها المستخدم — مصفوفة معرّفات. */
    @JavascriptInterface
    public boolean setCatOrder(String jsonIds) {
        try {
            db.setCatOrder(new JSONArray(jsonIds));
            return true;
        } catch (Exception e) {
            Log.e(TAG, "setCatOrder failed", e);
            return false;
        }
    }

    /** حفظ مجموعة مسمّاة (اسمها ومحتواها) — {id, kind, name, items[]}. */
    @JavascriptInterface
    public boolean saveGroup(String json) {
        try {
            db.saveGroup(new JSONObject(json));
            return true;
        } catch (Exception e) {
            Log.e(TAG, "saveGroup failed", e);
            return false;
        }
    }

    @JavascriptInterface
    public boolean deleteGroup(String id) {
        try {
            db.deleteGroup(id);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "deleteGroup failed", e);
            return false;
        }
    }

    @JavascriptInterface
    public boolean deleteItem(String kind, String id) {
        if (!validKind(kind)) return false;
        try {
            db.delete(kind, id);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "deleteItem failed", e);
            return false;
        }
    }

    @JavascriptInterface
    public boolean setCart(String kind, String jsonIds) {
        if (!validKind(kind)) return false;
        try {
            db.setCart(kind, new JSONArray(jsonIds));
            return true;
        } catch (Exception e) {
            Log.e(TAG, "setCart failed", e);
            return false;
        }
    }

    /** تمرير <code>null</code> كقيمة يحذف الإعداد (إزالة رمز القفل مثلًا). */
    @JavascriptInterface
    public boolean setSetting(String key, String value) {
        try {
            db.setSetting(key, value);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "setSetting failed", e);
            return false;
        }
    }

    /** استيراد نسخة احتياطية — استبدال كامل داخل معاملة واحدة. */
    @JavascriptInterface
    public boolean replaceAll(String json) {
        try {
            db.replaceAll(new JSONObject(json));
            return true;
        } catch (Exception e) {
            Log.e(TAG, "replaceAll failed", e);
            return false;
        }
    }

    /** تُستخدم مرّة واحدة لترحيل بيانات localStorage من الإصدارات السابقة. */
    @JavascriptInterface
    public boolean isEmpty() {
        try {
            return db.isEmpty();
        } catch (Exception e) {
            Log.e(TAG, "isEmpty failed", e);
            return false;
        }
    }
}
