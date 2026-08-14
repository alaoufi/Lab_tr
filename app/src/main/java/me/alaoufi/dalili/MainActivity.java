package me.alaoufi.dalili;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/**
 * تطبيق «دليلي» — واجهة WebView تُحمِّل الملفات المدمجة داخل الحزمة نفسها
 * (assets/) حصرًا، بلا أي اتصال شبكي إطلاقًا. جسر AndroidBridge يوفّر
 * مشاركة الملفات (WebView لا يطبّق Web Share API أصلًا) واختيار ملف
 * الاستيراد عبر onShowFileChooser، وجسر NativeDb يوفّر قاعدة بيانات
 * SQLite محلية للتخزين الدائم.
 */
public class MainActivity extends ComponentActivity {

    private WebView webView;
    private DaliliDb db;
    /** يبقى مرجعًا حيًّا لعارض الطباعة حتى ينتهي النظام من توليد الـPDF. */
    private WebView printView;
    private ValueCallback<Uri[]> filePickerCallback;
    private ActivityResultLauncher<String> filePickerLauncher;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        filePickerLauncher = registerForActivityResult(
                new ActivityResultContracts.GetContent(),
                (Uri uri) -> {
                    if (filePickerCallback == null) return;
                    filePickerCallback.onReceiveValue(uri == null ? null : new Uri[]{uri});
                    filePickerCallback = null;
                });

        webView = findViewById(R.id.webview);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // مطلوب لعمل localStorage
        s.setAllowFileAccess(true);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        db = new DaliliDb(this);
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        webView.addJavascriptInterface(new DbBridge(db), "NativeDb");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                filePickerCallback = callback;
                try {
                    filePickerLauncher.launch("application/json");
                } catch (Exception e) {
                    filePickerCallback = null;
                    return false;
                }
                return true;
            }
        });

        webView.loadUrl("file:///android_asset/index.html");

        // زر الرجوع في الجهاز يُسلَّم أولًا للواجهة: تغلق المودال أو ترجع
        // صفحة، وإن لم يكن هناك ما يُرجَع إليه ("false") يخرج من التطبيق.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                final OnBackPressedCallback self = this;
                webView.evaluateJavascript(
                        "(function(){try{return !!(window.onAndroidBack&&window.onAndroidBack());}catch(e){return false;}})()",
                        (String handled) -> {
                            if (!"true".equals(handled)) {
                                self.setEnabled(false);
                                getOnBackPressedDispatcher().onBackPressed();
                            }
                        });
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (db != null) db.close();
        super.onDestroy();
    }

    /** جسر JS↔Android: مشاركة الصورة الناتجة، وطباعة القوائم عبر خدمة النظام. */
    public class AndroidBridge {

        /**
         * الطباعة داخل WebView: {@code window.open} لا يعمل هنا إطلاقًا (لا نوافذ
         * منبثقة)، فكان زر الطباعة صامتًا. الحل الصحيح تمرير صفحة HTML جاهزة إلى
         * PrintManager عبر عارض مؤقت — فيظهر مربع الطباعة القياسي بخيار
         * «حفظ كـPDF» بلا إنترنت ولا صلاحيات إضافية.
         */
        @JavascriptInterface
        public void printHtml(String html, String jobName) {
            final String job = (jobName == null || jobName.trim().isEmpty()) ? "دليلي" : jobName.trim();
            runOnUiThread(() -> {
                try {
                    WebView v = new WebView(MainActivity.this);
                    v.setWebViewClient(new WebViewClient() {
                        @Override
                        public void onPageFinished(WebView view, String url) {
                            PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                            if (pm == null) return;
                            PrintAttributes attrs = new PrintAttributes.Builder()
                                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                    .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                                    .build();
                            pm.print(job, view.createPrintDocumentAdapter(job), attrs);
                        }
                    });
                    printView = v;   // بلا هذا المرجع قد يُجمَع العارض قبل انتهاء الطباعة
                    v.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                } catch (Exception ignored) {
                    // فشل صامت — لا داعي لإيقاف التطبيق لأجل طباعة فاشلة
                }
            });
        }

        /** نسخ نص القائمة للحافظة — أخفّ من الصورة وقابل للصق والبحث. */
        @JavascriptInterface
        public void copyText(String text) {
            runOnUiThread(() -> {
                try {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("دليلي", text));
                } catch (Exception ignored) { }
            });
        }

        /* ── النسخ الاحتياطي التلقائي ──────────────────────────────────
           تُكتب الملفات في مجلد التطبيق الخاص على التخزين الخارجي:
           Android/data/me.alaoufi.dalili/files/backups
           لا يحتاج أي صلاحية على أي إصدار أندرويد. يحمي من تلف البيانات
           أو حذفها بالخطأ، لكنه يزول مع إلغاء التثبيت — لذلك يوجد زرّ
           مشاركة يُخرج الملف إلى درايف أو الحاسوب بضغطة. */

        private File backupDir() {
            File dir = new File(getExternalFilesDir(null), "backups");
            if (!dir.exists()) dir.mkdirs();
            return dir;
        }

        /** يكتب نسخة جديدة ويبقي أحدث خمس. يعيد اسم الملف أو نصًّا فارغًا. */
        @JavascriptInterface
        public String writeBackup(String json, String stamp) {
            try {
                File dir = backupDir();
                File f = new File(dir, "dalili-" + stamp + ".json");
                try (FileOutputStream out = new FileOutputStream(f)) {
                    out.write(json.getBytes(StandardCharsets.UTF_8));
                }
                File[] all = dir.listFiles((d, n) -> n.endsWith(".json"));
                if (all != null && all.length > 5) {
                    Arrays.sort(all, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
                    for (int i = 5; i < all.length; i++) all[i].delete();
                }
                return f.getName();
            } catch (Exception e) {
                Log.e("DaliliBackup", "writeBackup failed", e);
                return "";
            }
        }

        /** قائمة النسخ من الأحدث: [{name, size, time}]. */
        @JavascriptInterface
        public String listBackups() {
            try {
                File[] all = backupDir().listFiles((d, n) -> n.endsWith(".json"));
                if (all == null) return "[]";
                Arrays.sort(all, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
                JSONArray arr = new JSONArray();
                for (File f : all) {
                    JSONObject o = new JSONObject();
                    o.put("name", f.getName());
                    o.put("size", f.length());
                    o.put("time", f.lastModified());
                    arr.put(o);
                }
                return arr.toString();
            } catch (Exception e) {
                Log.e("DaliliBackup", "listBackups failed", e);
                return "[]";
            }
        }

        @JavascriptInterface
        public String readBackup(String name) {
            try {
                File f = safeBackup(name);
                if (f == null || !f.exists()) return "";
                try (FileInputStream in = new FileInputStream(f)) {
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
                    return new String(bos.toByteArray(), StandardCharsets.UTF_8);
                }
            } catch (Exception e) {
                Log.e("DaliliBackup", "readBackup failed", e);
                return "";
            }
        }

        @JavascriptInterface
        public boolean deleteBackup(String name) {
            File f = safeBackup(name);
            return f != null && f.delete();
        }

        /** يخرج الملف من الجهاز (درايف، واتساب، كابل) عبر مشاركة نظامية. */
        @JavascriptInterface
        public void shareBackup(String name) {
            runOnUiThread(() -> {
                try {
                    File f = safeBackup(name);
                    if (f == null || !f.exists()) return;
                    Uri uri = FileProvider.getUriForFile(
                            MainActivity.this, "me.alaoufi.dalili.fileprovider", f);
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("application/json");
                    send.putExtra(Intent.EXTRA_STREAM, uri);
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(send, "حفظ النسخة الاحتياطية"));
                } catch (Exception ignored) { }
            });
        }

        /** يمنع الخروج من مجلد النسخ عبر اسم فيه مسار (../). */
        private File safeBackup(String name) {
            if (name == null || name.contains("/") || name.contains("..")
                    || !name.endsWith(".json")) return null;
            return new File(backupDir(), name);
        }

        /** يستقبل صورة القائمة (Base64) ويطلق مشاركة نظامية حقيقية. */
        @JavascriptInterface
        public void shareImageBase64(String base64Png, String filename) {
            runOnUiThread(() -> {
                try {
                    File dir = new File(getCacheDir(), "shared");
                    if (!dir.exists()) dir.mkdirs();
                    File file = new File(dir, filename);
                    byte[] bytes = Base64.decode(base64Png, Base64.DEFAULT);
                    try (FileOutputStream out = new FileOutputStream(file)) {
                        out.write(bytes);
                    }
                    Uri uri = FileProvider.getUriForFile(
                            MainActivity.this, "me.alaoufi.dalili.fileprovider", file);
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("image/png");
                    send.putExtra(Intent.EXTRA_STREAM, uri);
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(send, "مشاركة"));
                } catch (Exception ignored) {
                    // فشل صامت — لا داعي لإيقاف التطبيق لأجل مشاركة فاشلة
                }
            });
        }
    }
}
