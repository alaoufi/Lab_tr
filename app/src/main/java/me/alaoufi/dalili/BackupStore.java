package me.alaoufi.dalili;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Log;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * تخزين النسخ الاحتياطية في موضعين ممكنين:
 *
 * <ol>
 *   <li><b>مجلد التطبيق الخاص</b> (الافتراضي): بلا أي صلاحية، لكنه يزول مع
 *       إلغاء التثبيت وقد لا يظهر لمدير الملفات على أندرويد ١١+.</li>
 *   <li><b>مجلد يختاره المستخدم</b> عبر منتقي النظام (Storage Access
 *       Framework): يبقى بعد إلغاء التثبيت ويظهر في مدير الملفات ودرايف،
 *       وبلا صلاحية تخزين أيضًا — الإذن يُمنَح للمجلد المختار وحده ويُثبَّت
 *       عبر takePersistableUriPermission فيبقى بعد إعادة التشغيل.</li>
 * </ol>
 *
 * كل الدوال تعمل على الموضع النشِط، فالواجهة لا تفرّق بينهما.
 * الملفات التي نتعامل معها هي {@code dalili-*.json} فقط — لا نلمس غيرها في
 * مجلد المستخدم.
 */
public class BackupStore {

    private static final String TAG = "DaliliBackup";
    private static final String PREFS = "dalili";
    private static final String KEY_DIR = "backup_dir";
    private static final String PREFIX = "dalili-";
    private static final String SUFFIX = ".json";
    private static final int KEEP = 5;

    private final Context ctx;

    public BackupStore(Context ctx) {
        this.ctx = ctx;
    }

    private SharedPreferences prefs() {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /* ─────────────── الموضع النشِط ─────────────── */

    /** شجرة المستخدم المختارة، أو null إن كان الموضع هو مجلد التطبيق. */
    private Uri treeUri() {
        String s = prefs().getString(KEY_DIR, null);
        if (s == null) return null;
        Uri uri = Uri.parse(s);
        // إن سُحب الإذن (مسح بيانات، إزالة بطاقة) نرجع للمجلد الافتراضي بهدوء
        for (android.content.UriPermission p : ctx.getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(uri) && p.isWritePermission()) return uri;
        }
        return null;
    }

    public void setDir(Uri uri) {
        prefs().edit().putString(KEY_DIR, uri.toString()).apply();
    }

    public void clearDir() {
        prefs().edit().remove(KEY_DIR).apply();
    }

    public boolean isCustom() {
        return treeUri() != null;
    }

    /** وصف مقروء للموضع الحالي يُعرَض في الإعدادات. */
    public String label() {
        Uri tree = treeUri();
        if (tree == null) return "مجلد التطبيق الخاص (يزول مع إلغاء التثبيت)";
        String id = DocumentsContract.getTreeDocumentId(tree);
        if (id == null) return tree.getLastPathSegment();
        int colon = id.indexOf(':');
        String path = colon >= 0 ? id.substring(colon + 1) : id;
        return path.isEmpty() ? "الجذر" : path;
    }

    private File internalDir() {
        File dir = new File(ctx.getExternalFilesDir(null), "backups");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    /* ─────────────── كتابة ─────────────── */

    /** يكتب نسخة ويحذف ما زاد عن الأحدث خمس. يعيد اسم الملف أو نصًّا فارغًا. */
    public String write(String json, String stamp) {
        String name = PREFIX + stamp + SUFFIX;
        try {
            Uri tree = treeUri();
            if (tree == null) {
                File f = new File(internalDir(), name);
                try (FileOutputStream out = new FileOutputStream(f)) {
                    out.write(json.getBytes(StandardCharsets.UTF_8));
                }
            } else {
                Uri existing = findChild(tree, name);
                Uri target = existing != null ? existing : DocumentsContract.createDocument(
                        ctx.getContentResolver(), parentDoc(tree), "application/json", name);
                if (target == null) return "";
                try (OutputStream out = ctx.getContentResolver().openOutputStream(target, "wt")) {
                    if (out == null) return "";
                    out.write(json.getBytes(StandardCharsets.UTF_8));
                }
            }
            prune();
            return name;
        } catch (Exception e) {
            Log.e(TAG, "write failed", e);
            return "";
        }
    }

    private void prune() {
        try {
            List<Entry> all = entries();
            for (int i = KEEP; i < all.size(); i++) delete(all.get(i).name);
        } catch (Exception e) {
            Log.e(TAG, "prune failed", e);
        }
    }

    /* ─────────────── قراءة وحذف ─────────────── */

    /** [{name, size, time}] من الأحدث للأقدم. */
    public String listJson() {
        JSONArray arr = new JSONArray();
        try {
            for (Entry e : entries()) {
                JSONObject o = new JSONObject();
                o.put("name", e.name);
                o.put("size", e.size);
                o.put("time", e.time);
                arr.put(o);
            }
        } catch (Exception e) {
            Log.e(TAG, "listJson failed", e);
        }
        return arr.toString();
    }

    public String read(String name) {
        if (!validName(name)) return "";
        try {
            Uri tree = treeUri();
            if (tree == null) {
                File f = new File(internalDir(), name);
                if (!f.exists()) return "";
                try (FileInputStream in = new FileInputStream(f)) { return slurp(in); }
            }
            Uri child = findChild(tree, name);
            if (child == null) return "";
            try (InputStream in = ctx.getContentResolver().openInputStream(child)) {
                return in == null ? "" : slurp(in);
            }
        } catch (Exception e) {
            Log.e(TAG, "read failed", e);
            return "";
        }
    }

    public boolean delete(String name) {
        if (!validName(name)) return false;
        try {
            Uri tree = treeUri();
            if (tree == null) return new File(internalDir(), name).delete();
            Uri child = findChild(tree, name);
            return child != null && DocumentsContract.deleteDocument(ctx.getContentResolver(), child);
        } catch (Exception e) {
            Log.e(TAG, "delete failed", e);
            return false;
        }
    }

    /** رابط قابل للمشاركة عبر ACTION_SEND. */
    public Uri shareUri(String name) {
        if (!validName(name)) return null;
        try {
            Uri tree = treeUri();
            if (tree == null) {
                File f = new File(internalDir(), name);
                if (!f.exists()) return null;
                return FileProvider.getUriForFile(ctx, "me.alaoufi.dalili.fileprovider", f);
            }
            return findChild(tree, name);
        } catch (Exception e) {
            Log.e(TAG, "shareUri failed", e);
            return null;
        }
    }

    /* ─────────────── أدوات ─────────────── */

    private static class Entry {
        String name;
        long size, time;
        Entry(String n, long s, long t) { name = n; size = s; time = t; }
    }

    /** كل نسخنا في الموضع النشِط، مرتّبة من الأحدث. */
    private List<Entry> entries() {
        List<Entry> out = new ArrayList<>();
        Uri tree = treeUri();
        if (tree == null) {
            File[] all = internalDir().listFiles((d, n) -> isOurs(n));
            if (all != null) {
                Arrays.sort(all, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
                for (File f : all) out.add(new Entry(f.getName(), f.length(), f.lastModified()));
            }
            return out;
        }
        Cursor c = null;
        try {
            c = ctx.getContentResolver().query(childrenUri(tree), new String[]{
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED}, null, null, null);
            while (c != null && c.moveToNext()) {
                String n = c.getString(0);
                if (!isOurs(n)) continue;
                out.add(new Entry(n, c.getLong(1), c.getLong(2)));
            }
        } catch (Exception e) {
            Log.e(TAG, "entries failed", e);
        } finally {
            if (c != null) c.close();
        }
        Collections.sort(out, (a, b) -> Long.compare(b.time, a.time));
        return out;
    }

    private Uri parentDoc(Uri tree) {
        return DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
    }

    private Uri childrenUri(Uri tree) {
        return DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
    }

    /** يبحث عن ملف بالاسم داخل الشجرة ويعيد رابط مستنده. */
    private Uri findChild(Uri tree, String name) {
        Cursor c = null;
        try {
            c = ctx.getContentResolver().query(childrenUri(tree), new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null);
            while (c != null && c.moveToNext()) {
                if (name.equals(c.getString(1))) {
                    return DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0));
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "findChild failed", e);
        } finally {
            if (c != null) c.close();
        }
        return null;
    }

    private static boolean isOurs(String n) {
        return n != null && n.startsWith(PREFIX) && n.endsWith(SUFFIX);
    }

    /** يمنع أي اسم فيه مسار أو لا يتبع نمط ملفاتنا. */
    private static boolean validName(String n) {
        return isOurs(n) && !n.contains("/") && !n.contains("..");
    }

    private static String slurp(InputStream in) throws Exception {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        return new String(bos.toByteArray(), StandardCharsets.UTF_8);
    }
}
