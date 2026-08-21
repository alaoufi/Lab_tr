package android.print;

import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;

import java.io.File;

/**
 * توليد ملف PDF من {@link PrintDocumentAdapter} مباشرةً — بلا مربع الطباعة.
 *
 * <p><b>لماذا هذا الملف داخل حزمة {@code android.print}؟</b> لأن مُنشئَي
 * {@code LayoutResultCallback} و{@code WriteResultCallback} ليسا عامّين
 * (package-private)، فلا يمكن اشتقاقهما من حزمة التطبيق — يفشل التصريف
 * بـ«is not public in …; cannot be accessed from outside package». وضع
 * المساعد في نفس الحزمة هو الحل القياسي المعروف لهذه المسألة.
 *
 * <p>لا شيء هنا يمسّ الشبكة: نأخذ ما يرسمه محرّك الطباعة نفسه ونكتبه في ملف.
 */
public class PdfPrint {

    /** نتيجة التوليد — تصل على خيط الواجهة كما يستدعيها محرّك الطباعة. */
    public interface Result {
        void onDone(File file);
        void onFail(String error);
    }

    private final PrintAttributes attrs;

    public PdfPrint(PrintAttributes attrs) {
        this.attrs = attrs;
    }

    /**
     * يشغّل مرحلتَي المحرّك (onLayout ثم onWrite) ويكتب الناتج في {@code out}.
     * لا يعرض أي واجهة نظام — الملف جاهز للمشاركة عند {@code onDone}.
     */
    public void print(final PrintDocumentAdapter adapter, final File out, final Result cb) {
        adapter.onLayout(null, attrs, new CancellationSignal(),
                new PrintDocumentAdapter.LayoutResultCallback() {
                    @Override
                    public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                        ParcelFileDescriptor fd = null;
                        try {
                            fd = ParcelFileDescriptor.open(out,
                                    ParcelFileDescriptor.MODE_CREATE
                                            | ParcelFileDescriptor.MODE_TRUNCATE
                                            | ParcelFileDescriptor.MODE_READ_WRITE);
                        } catch (Exception e) {
                            cb.onFail("open: " + e.getMessage());
                            return;
                        }
                        final ParcelFileDescriptor pfd = fd;
                        adapter.onWrite(new PageRange[]{PageRange.ALL_PAGES}, pfd,
                                new CancellationSignal(),
                                new PrintDocumentAdapter.WriteResultCallback() {
                                    @Override
                                    public void onWriteFinished(PageRange[] pages) {
                                        close(pfd);
                                        if (pages != null && pages.length > 0 && out.length() > 0) {
                                            cb.onDone(out);
                                        } else {
                                            cb.onFail("لم تُكتب أي صفحة");
                                        }
                                    }

                                    @Override
                                    public void onWriteFailed(CharSequence error) {
                                        close(pfd);
                                        cb.onFail(String.valueOf(error));
                                    }
                                });
                    }

                    @Override
                    public void onLayoutFailed(CharSequence error) {
                        cb.onFail(String.valueOf(error));
                    }
                }, null);
    }

    private static void close(ParcelFileDescriptor fd) {
        try { if (fd != null) fd.close(); } catch (Exception ignored) { }
    }
}
