/* ============================================================
   تشغيل الواجهة في متصفح حقيقي والتقاط لقطات — يكشف ما لا تكشفه
   اختبارات الوحدة (أخطاء DOM، تخطيط، أخطاء كونسول).

   التشغيل:  npm i -g playwright && node tools/ui_smoke.js
   اللقطات تُكتب في مجلد التشغيل الحالي.
   ============================================================ */
const { chromium } = require('playwright');
const path = require('path');
const APP = 'file://' + path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'index.html');
(async () => {
  const b = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 412, height: 950 }, deviceScaleFactor: 2 });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await p.goto(APP);
  await p.waitForTimeout(400);
  await p.screenshot({ path: 'n1-home.png' });

  // إضافة وصفة من صفحة الوصفات
  await p.click('text=الوصفات العلاجية');
  await p.waitForTimeout(250);
  await p.click('text=+ إضافة');
  await p.waitForTimeout(250);
  await p.fill('#rf-name', 'شراب الزنجبيل والعسل');
  await p.click('.seg:has-text("وقائية")');
  await p.fill('#rf-purpose', 'تهدئة الحلق والسعال الجاف');
  await p.fill('#rf-ingredients', 'زنجبيل طازج ٢ ملعقة، عسل ٣ ملاعق، ليمون نصف حبة');
  await p.fill('#rf-preparation', 'يُغلى الزنجبيل في كوب ماء ١٠ دقائق، يُصفّى ثم يُضاف العسل والليمون بعد أن يفتر');
  await p.fill('#rf-usage', 'يُشرب دافئًا بعد الأكل');
  await p.fill('#rf-dose', 'كوب واحد');
  await p.fill('#rf-duration', 'حتى تتحسن الأعراض');
  await p.fill('#rf-effects', 'تحسّن تدريجي خلال يومين');
  await p.fill('#rf-precautions', 'يُتجنّب العسل لمن هم دون سنة');
  await p.screenshot({ path: 'n2-recipe-form.png', fullPage: true });
  await p.click('.mft .btn.primary');
  await p.waitForTimeout(350);
  await p.screenshot({ path: 'n3-recipes.png' });

  // حدّد الوصفة ثم عاينها بتبويبيها قبل الرجوع
  await p.check('.card input[type=checkbox]');
  await p.waitForTimeout(250);
  await p.click('text=عرض وإرسال');
  await p.waitForTimeout(400);
  await p.screenshot({ path: 'n3b-preview-paper.png', fullPage: true });
  await p.click('.pvt:has-text("الصورة")');
  await p.waitForTimeout(600);
  await p.screenshot({ path: 'n3c-preview-image.png', fullPage: true });
  await p.click('#hdr-back');
  await p.waitForTimeout(300);

  await p.click('#hdr-back');
  await p.waitForTimeout(300);
  await p.screenshot({ path: 'n4-home-cart.png' });

  await p.click('#hdr-set');
  await p.waitForTimeout(300);
  await p.screenshot({ path: 'n5-settings.png', fullPage: true });

  // التصنيفات: صفحة الإدارة ثم الشرائح داخل نموذج العنصر
  await p.evaluate(() => goPage('cat:labs'));
  await p.waitForTimeout(300);
  await p.screenshot({ path: 'n6-categories.png', fullPage: true });
  await p.evaluate(() => { goPage('labs'); labForm(); });
  await p.waitForTimeout(300);
  await p.screenshot({ path: 'n7-category-picker.png', fullPage: true });
  await p.evaluate(() => closeModal());
  await p.waitForTimeout(200);

  console.log(errs.length ? errs.join('\n') : 'لا أخطاء في الكونسول ✅');
  await b.close();
})();
