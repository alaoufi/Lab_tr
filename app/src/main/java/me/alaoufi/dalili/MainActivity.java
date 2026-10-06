package me.alaoufi.dalili;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Bundle;
import android.print.PdfPrint;
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

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * تطبيق «دليلي» — واجهة WebView تُحمِّل الملفات المدمجة داخل الحزمة نفسها
 * (assets/) حصرًا، بلا أي اتصال شبكي إطلاقًا. جسر AndroidBridge يوفّر
 * مشاركة الملفات (WebView لا يطبّق Web Share API أصلًا) واختيار ملف
 * الاستيراد عبر onShowFileChooser، وجسر NativeDb يوفّر قاعدة بيانات
 * SQLite محلية للتخزين الدائم.
 */
public class MainActivity extends ComponentActivity {

    /**
     * العنوان الوحيد الذي يتصل به هذا التطبيق، مكتوبًا هنا لا يأتي من
     * الواجهة. ملفٌّ صغير فيه رقم آخر إصدار منشور ولا شيء غيره.
     */
    private static final String UPDATE_URL =
            "https://raw.githubusercontent.com/alaoufi/Lab_tr/HEAD/dist/version.json";
    /** المضيفات المقبولة بعد أي تحويل — ما عداها يُرفَض ولا يُقرأ. */
    private static final String[] UPDATE_HOSTS = {
            "raw.githubusercontent.com", "objects.githubusercontent.com", "github.com"
    };
    private static boolean allowedHost(String host) {
        if (host == null) return false;
        String h = host.toLowerCase(java.util.Locale.US);
        for (String a : UPDATE_HOSTS) if (a.equals(h)) return true;
        return false;
    }

    private WebView webView;
    private DaliliDb db;
    /** يبقى مرجعًا حيًّا لعارض الطباعة حتى ينتهي النظام من توليد الـPDF. */
    private WebView printView;
    private BackupStore backups;
    private ValueCallback<Uri[]> filePickerCallback;
    private ActivityResultLauncher<String> filePickerLauncher;
    private ActivityResultLauncher<Uri> dirPickerLauncher;

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

        backups = new BackupStore(this);
        // منتقي مجلد النسخ الاحتياطي: نثبّت الإذن ليبقى بعد إعادة التشغيل
        dirPickerLauncher = registerForActivityResult(
                new ActivityResultContracts.OpenDocumentTree(),
                (Uri uri) -> {
                    if (uri == null) return;
                    try {
                        getContentResolver().takePersistableUriPermission(uri,
                                Intent.FLAG_GRANT_READ_URI_PERMISSION
                                        | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                        backups.setDir(uri);
                    } catch (Exception e) {
                        Log.e("DaliliBackup", "takePersistableUriPermission failed", e);
                    }
                    notifyDirChanged();
                });

        db = new DaliliDb(this);
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        webView.addJavascriptInterface(new DbBridge(db), "NativeDb");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                filePickerCallback = callback;
                try {
                    // النوع يأتي من سمة accept في الحقل نفسه: نسخة احتياطية
                    // (JSON) أو صورة للمكتبة — فمنتقٍ واحد يخدم الاثنين.
                    String[] accept = params == null ? null : params.getAcceptTypes();
                    String mime = "application/json";
                    if (accept != null) {
                        for (String a : accept) {
                            if (a != null && a.startsWith("image/")) { mime = "image/*"; break; }
                        }
                    }
                    filePickerLauncher.launch(mime);
                } catch (Exception e) {
                    filePickerCallback = null;
                    return false;
                }
                return true;
            }
        });

        /*
         * الواجهة محبوسة في assets. صار للتطبيق صلاحية إنترنت (لفحص
         * التحديث وحده)، فلم يعد كافيًا أن نقول «لا يوجد في الصفحة رابط
         * خارجي»: نمنع الوصول منعًا. أي تنقّل أو موردٍ ليس `file://`
         * يُرفَض هنا — فلا صفحةٌ تُحمَّل من الشبكة ولا خطٌّ يُجلَب من CDN
         * ولو أُقحم في الأصول يومًا. والروابط الخارجية طريقها
         * `openExternal` وحدها: تطبيقٌ آخر يفتحها بصلاحياته لا بصلاحياتنا.
         */
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest req) {
                Uri u = req == null ? null : req.getUrl();
                return u == null || !"file".equalsIgnoreCase(String.valueOf(u.getScheme()));
            }

            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(
                    WebView view, android.webkit.WebResourceRequest req) {
                Uri u = req == null ? null : req.getUrl();
                if (u != null && "file".equalsIgnoreCase(String.valueOf(u.getScheme()))) return null;
                Log.w("DaliliApp", "blocked non-file request: " + u);
                return new android.webkit.WebResourceResponse(
                        "text/plain", "UTF-8", new java.io.ByteArrayInputStream(new byte[0]));
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

    /** رقم إصدار الحزمة المثبَّتة — مصدره `versionCode` في build.gradle. */
    private long versionCode() throws Exception {
        PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
        return android.os.Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
    }

    /** يُعلم الواجهة أن موضع النسخ تغيّر لتُحدِّث صفحة الإعدادات. */
    private void notifyDirChanged() {
        runOnUiThread(() -> {
            try {
                webView.evaluateJavascript(
                        "window.onBackupDirPicked && window.onBackupDirPicked()", null);
            } catch (Exception ignored) { }
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
         * رقم الإصدار كما هو في الحزمة المثبَّتة فعلًا.
         *
         * <p>يُقرأ من {@code PackageManager} لا من ثابت مكتوب في الواجهة: مصدره
         * الوحيد هو {@code versionName/versionCode} في {@code app/build.gradle}،
         * فيتحدّث وحده مع كل بناء ولا يمكن أن يتقادم أو يخالف ما ثبّته المستخدم.
         */
        @JavascriptInterface
        public String appVersion() {
            try {
                PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                return pi.versionName + " (" + versionCode() + ")";
            } catch (Exception e) {
                Log.e("DaliliApp", "appVersion failed", e);
                return "";
            }
        }

        /** رقم الإصدار وحده — الواجهة تقارنه برقم آخر إصدار منشور. */
        @JavascriptInterface
        public long appVersionCode() {
            try { return versionCode(); }
            catch (Exception e) { return 0L; }
        }

        /**
         * فحص وجود إصدار أحدث — الاستعمال <b>الوحيد</b> لصلاحية الإنترنت
         * في هذا التطبيق.
         *
         * <p>ما يخرج من الجهاز: طلب {@code GET} واحد لا يحمل شيئًا — لا
         * معرّف جهاز، ولا إحصاءات، ولا حرفًا من قاعدة البيانات. والعنوان
         * ثابتٌ في {@link MainActivity#UPDATE_URL} ولا يأتي من الواجهة،
         * فلا يستطيع شيء في JS أن يوجّه الاتصال إلى غيره.
         *
         * <p>وبعد أي تحويل يُتحقَّق من المضيف ثانيةً: تحويلٌ إلى خارج
         * قائمة {@link MainActivity#UPDATE_HOSTS} يُرفَض ولا يُقرأ.
         *
         * <p>كل فشلٍ صامت: الفحص خدمةٌ إضافية، فتعذّره لا يعني شيئًا
         * للمستخدم إلا أن يبقى على نسخته.
         */
        @JavascriptInterface
        public void checkUpdate() {
            new Thread(() -> {
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(UPDATE_URL).openConnection();
                    c.setRequestMethod("GET");
                    c.setConnectTimeout(8000);
                    c.setReadTimeout(8000);
                    c.setUseCaches(false);
                    c.setInstanceFollowRedirects(true);
                    c.setRequestProperty("Accept", "application/json");
                    // لا نرسل شيئًا يُعرَف به الجهاز أو المستخدم
                    c.setRequestProperty("User-Agent", "dalili");
                    int code = c.getResponseCode();
                    String host = c.getURL() == null ? "" : String.valueOf(c.getURL().getHost());
                    if (code != 200 || !allowedHost(host)) { updateResult(null); return; }

                    StringBuilder sb = new StringBuilder();
                    try (InputStream in = c.getInputStream()) {
                        byte[] buf = new byte[2048];
                        int n, total = 0;
                        while ((n = in.read(buf)) > 0 && total < 8192) {
                            sb.append(new String(buf, 0, n, "UTF-8"));
                            total += n;
                        }
                    }
                    // نقرأه هنا لا في الواجهة: ما يصل JS أرقامٌ تحقّقنا منها
                    JSONObject o = new JSONObject(sb.toString());
                    JSONObject out = new JSONObject();
                    out.put("ok", true);
                    out.put("code", o.optLong("versionCode", 0));
                    out.put("name", o.optString("versionName", ""));
                    out.put("notes", o.optString("notes", ""));
                    updateResult(out.toString());
                } catch (Exception e) {
                    Log.e("DaliliApp", "checkUpdate failed", e);
                    updateResult(null);
                } finally {
                    if (c != null) try { c.disconnect(); } catch (Exception ignored) { }
                }
            }).start();
        }

        private void updateResult(String json) {
            final String payload = json == null ? "{\"ok\":false}" : json;
            runOnUiThread(() -> {
                try {
                    webView.evaluateJavascript(
                            "window.onUpdateInfo && window.onUpdateInfo("
                                    + org.json.JSONObject.quote(payload) + ")", null);
                } catch (Exception ignored) { }
            });
        }

        /**
         * فتح رابط خارج التطبيق — موقعٍ على الخرائط، أو صفحة تنزيل التحديث.
         *
         * <p>هذا <b>لا</b> يفتح اتصالًا من التطبيق ولا يحتاج صلاحية إنترنت:
         * نسلّم العنوان لنظام أندرويد عبر {@code ACTION_VIEW} فيختار له
         * التطبيق المناسب (الخرائط أو المتصفّح)، والاتصال — إن وقع — يقع
         * هناك بصلاحيات ذلك التطبيق لا بصلاحياتنا.
         *
         * <p>المخططات مقصورة على ثلاثة: {@code http}/{@code https}/{@code geo}.
         * العنوان يأتي ممّا كتبه المستخدم في حقل الموقع، و{@code intent:} أو
         * {@code file:} في يد نيّةٍ صريحة بابٌ لا داعي لفتحه.
         */
        @JavascriptInterface
        public void openExternal(String url) {
            final String u = url == null ? "" : url.trim();
            final String low = u.toLowerCase(java.util.Locale.US);
            if (!low.startsWith("http://") && !low.startsWith("https://") && !low.startsWith("geo:")) {
                toastJs("رابط غير مدعوم");
                return;
            }
            runOnUiThread(() -> {
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(u));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception e) {
                    Log.e("DaliliApp", "openExternal failed", e);
                    toastJs("لا يوجد تطبيق يفتح هذا الرابط");
                }
            });
        }

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

        /**
         * تصدير القائمة ملفَّ PDF ومشاركته مباشرةً — بلا مربع الطباعة.
         *
         * <p>نفس محرّك الطباعة (PrintDocumentAdapter من WebView) لكن بدل
         * تسليمه لـPrintManager نستدعي onLayout ثم onWrite بأنفسنا ونكتب
         * الناتج في ملف، فيخرج PDF جاهزًا للإرسال في واتساب أو غيره.
         */
        @JavascriptInterface
        public void sharePdf(String html, String jobName) {
            final String job = (jobName == null || jobName.trim().isEmpty()) ? "دليلي" : jobName.trim();
            runOnUiThread(() -> {
                try {
                    WebView v = new WebView(MainActivity.this);
                    v.setWebViewClient(new WebViewClient() {
                        @Override
                        public void onPageFinished(WebView view, String url) {
                            writePdf(view, job);
                        }
                    });
                    printView = v;   // يبقى حيًّا حتى ينتهي التوليد
                    v.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                } catch (Exception e) {
                    Log.e("DaliliPdf", "sharePdf failed", e);
                }
            });
        }

        private void writePdf(WebView view, String job) {
            try {
                File dir = new File(getCacheDir(), "shared");
                if (!dir.exists()) dir.mkdirs();
                final File out = new File(dir, safeFileName(job) + ".pdf");

                PrintAttributes attrs = new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                        .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 600, 600))
                        .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                        .build();

                new PdfPrint(attrs).print(view.createPrintDocumentAdapter(job), out,
                        new PdfPrint.Result() {
                            @Override
                            public void onDone(File file) { sendPdf(file); }

                            @Override
                            public void onFail(String error) {
                                Log.e("DaliliPdf", "pdf failed: " + error);
                                toastJs("تعذّر تجهيز ملف PDF");
                            }
                        });
            } catch (Exception e) {
                Log.e("DaliliPdf", "writePdf failed", e);
            }
        }

        /** يعرض رسالة في الواجهة (توست الويب) من جهة جافا. */
        private void toastJs(String msg) {
            runOnUiThread(() -> {
                try {
                    webView.evaluateJavascript(
                            "window.toast && window.toast(" + org.json.JSONObject.quote(msg) + ",'er')", null);
                } catch (Exception ignored) { }
            });
        }

        private void sendPdf(File file) {
            try {
                Uri uri = FileProvider.getUriForFile(
                        MainActivity.this, "me.alaoufi.dalili.fileprovider", file);
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("application/pdf");
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(send, "إرسال PDF"));
            } catch (Exception e) {
                Log.e("DaliliPdf", "sendPdf failed", e);
            }
        }

        /** اسم ملف آمن: بلا فواصل مسار ولا محارف تكسر أنظمة الملفات. */
        private String safeFileName(String s) {
            String out = s.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_").trim();
            if (out.length() > 60) out = out.substring(0, 60);
            return out.isEmpty() ? "دليلي" : out;
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

        /* ── النسخ الاحتياطي ────────────────────────────────────────
           الموضع الافتراضي مجلد التطبيق الخاص (بلا صلاحية، لكنه يزول مع
           إلغاء التثبيت). ويستطيع المستخدم اختيار مجلد دائم عبر منتقي
           النظام فيبقى بعد إلغاء التثبيت ويظهر في مدير الملفات. التفاصيل
           في BackupStore. */

        @JavascriptInterface
        public String writeBackup(String json, String stamp) {
            return backups.write(json, stamp);
        }

        @JavascriptInterface
        public String listBackups() { return backups.listJson(); }

        @JavascriptInterface
        public String readBackup(String name) { return backups.read(name); }

        @JavascriptInterface
        public boolean deleteBackup(String name) { return backups.delete(name); }

        /** وصف الموضع الحالي كما يُعرَض في الإعدادات. */
        @JavascriptInterface
        public String backupDir() { return backups.label(); }

        @JavascriptInterface
        public boolean backupDirIsCustom() { return backups.isCustom(); }

        /** يفتح منتقي المجلدات؛ النتيجة تصل للواجهة عبر onBackupDirPicked. */
        @JavascriptInterface
        public void pickBackupDir() {
            runOnUiThread(() -> {
                try { dirPickerLauncher.launch(null); }
                catch (Exception e) { Log.e("DaliliBackup", "picker failed", e); }
            });
        }

        @JavascriptInterface
        public void resetBackupDir() {
            backups.clearDir();
            notifyDirChanged();
        }

        /** يخرج الملف من الجهاز (درايف، واتساب، كابل) عبر مشاركة نظامية. */
        @JavascriptInterface
        public void shareBackup(String name) {
            runOnUiThread(() -> {
                try {
                    Uri uri = backups.shareUri(name);
                    if (uri == null) return;
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("application/json");
                    send.putExtra(Intent.EXTRA_STREAM, uri);
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(send, "حفظ النسخة الاحتياطية"));
                } catch (Exception ignored) { }
            });
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
