# دليل المطوّر — دليلي

كل ما تحتاجه لبناء التطبيق وتعديله وتوسيعه. اقرأ [`DATABASE.md`](DATABASE.md)
معه لتفاصيل التخزين.

---

## ١. الفكرة المعمارية في سطرين

التطبيق **غلاف أندرويد رقيق حول واجهة ويب مدمجة**. كل المنطق والواجهة في
`assets/` (HTML + JS خالص، بلا أُطر ولا حزم)، وجافا تقدّم ثلاثة أشياء لا
يقدر عليها WebView وحده: **قاعدة بيانات SQLite**، **مشاركة ملف حقيقي**،
و**الطباعة**.

```
┌──────────────── APK ────────────────┐
│  MainActivity (WebView)             │
│    ├─ NativeDb      ──→ DaliliDb ──→ dalili.db (SQLite)
│    └─ AndroidBridge ──→ PrintManager / ACTION_SEND
│                                     │
│  assets/index.html  ← الواجهة والأنماط
│  assets/app.js      ← كل المنطق
│  assets/library.js  ← المكتبة الجاهزة (بيانات ثابتة)
└─────────────────────────────────────┘
```

**بلا إنترنت إطلاقًا:** لا صلاحية `INTERNET` في `AndroidManifest.xml`، ولا
ملف خارجي واحد. هذا قيد تصميمي مقصود — لا تُدخل CDN ولا خطًّا خارجيًا.

---

## ٢. خريطة الملفات

```
DaliliApp/
├── app/
│   ├── build.gradle                     إعدادات البناء ورقم الإصدار
│   └── src/main/
│       ├── AndroidManifest.xml          بلا صلاحيات — FileProvider للمشاركة
│       ├── assets/
│       │   ├── index.html      (195 س)  الهيكل + كل الـCSS
│       │   ├── app.js          (1253 س) كل المنطق — انظر §٤
│       │   └── library.js               ٢٣٢ تحليلًا + ٧٢ فحصًا + ٢٧٠ علاجًا
│       ├── java/android/print/PdfPrint.java   توليد PDF بلا مربع طباعة
│       ├── java/me/alaoufi/dalili/
│       │   ├── MainActivity.java (166 س) WebView + الجسور + زر الرجوع
│       │   ├── DaliliDb.java             SQLite: مخطط + ترقيات + CRUD
│       │   ├── DbBridge.java              واجهة NativeDb المعروضة لـJS
│       │   └── BackupStore.java           النسخ الاحتياطي ومكان حفظه
│       └── res/                          الأيقونات والألوان والتخطيط
├── docs/
│   ├── DEVELOPER.md                     هذا الملف
│   ├── DATABASE.md                      تفصيل قاعدة البيانات
│   └── schema.sql                       المخطط الكامل كـSQL
├── tools/
│   ├── test_store.js                    ٤٨ اختبارًا — node tools/test_store.js
│   └── ui_smoke.js                      تشغيل الواجهة في Chromium + لقطات
├── dist/                                ملف APK الجاهز
└── gradlew / gradlew.bat                لا تحتاج Gradle مثبّتًا
```

---

## ٣. البناء

### أ) Android Studio (الأسهل)

1. **File ← Open** ← اختر مجلد المشروع
2. انتظر Gradle Sync
3. **Build ← Build App Bundle(s) / APK(s) ← Build APK(s)**
4. الناتج: `app/build/outputs/apk/debug/app-debug.apk`

### ب) سطر الأوامر

يحتاج JDK 17+ وAndroid SDK (platform 34، build-tools 34).

```bash
echo "sdk.dir=/path/to/Android/sdk" > local.properties
chmod +x gradlew
./gradlew assembleRelease          # أو assembleDebug
# الناتج: app/build/outputs/apk/release/app-release.apk
```

تثبيت مباشر على جهاز موصول:

```bash
./gradlew installRelease
# أو
adb install -r app/build/outputs/apk/release/app-release.apk
```

### ج) التوقيع

`buildTypes.release` يستخدم `signingConfigs.debug` عمدًا حتى يُثبَّت الملف
مباشرةً بلا إعداد. **للنشر الرسمي** أنشئ مفتاحك:

```gradle
signingConfigs {
    create("release") {
        storeFile file("my-key.jks")
        storePassword System.getenv("KS_PASS")
        keyAlias "dalili"
        keyPassword System.getenv("KEY_PASS")
    }
}
buildTypes { release { signingConfig signingConfigs.release } }
```

ولا تُدخل ملف المفتاح ولا كلمات السر في المستودع.

### د) رقم الإصدار

في `app/build.gradle`. ارفع **الاثنين** مع كل إصدار توزّعه:

```gradle
versionCode 10       // رقم صحيح يزيد دائمًا — أندرويد يمنع التحديث بدونه
versionName "1.9"    // ما يراه المستخدم
```

---

## ٤. بنية `app.js`

ملف واحد بترتيب مقصود، كل قسم معلّم بفاصل. الأقسام بالترتيب:

| السطر ≈ | القسم | المحتوى |
|---|---|---|
| 1–95 | الحالة والثوابت | `DB`، `KINDS`، `OUT_*`، `KIND_LBL` |
| 98–150 | `Store` | طبقة التخزين (SQLite أو localStorage) |
| 152–165 | الترحيل | من `localStorage` القديم |
| 178–270 | التنقّل | `NAV`، `goPage`، `goBack`، `onAndroidBack` |
| 272–325 | الإعدادات | صفحة الإعدادات كاملة |
| 326–505 | المكتبة الجاهزة | التصفح والبحث والإضافة |
| 506–570 | المودال + الرئيسية | |
| … | 💊 العلاجات | قائمة + نموذج + حفظ + حذف |
| … | 🧪 التحاليل | نفس النمط |
| … | 📷 الأشعة والفحوصات | نفس النمط |
| … | 🌿 الوصفات | نفس النمط |
| 895–1067 | 📁 المجموعات | القائمة + المحرّر + المنتقي |
| 1069–نهاية | الطباعة والمشاركة | `printDoc`، `buildCanvas`، الجسور |

### قواعد الأسلوب

- **ES5 صرف** (`var`, `function`) — WebView على أندرويد ٧ لا يضمن ما بعده.
  الاستثناءان: `async/await` في دوال الـPIN، وهما مدعومان منذ أندرويد ٨؛
  إن أردت دعم ٧ فعلًا استبدلهما بـPromises.
- **بلا حزم ولا أدوات بناء للواجهة.** لا npm، لا حزم، لا transpile.
- كل ما تناديه سمة `onclick` في HTML يجب أن يكون على `window` صراحةً:
  `window.medSave = function (id) { … }`
- **كل نص من المستخدم يمرّ بـ`esc()`** قبل وضعه في HTML. لا استثناء.
- الرسم عبر `h(id, html)` الذي يكتب `innerHTML` — أي إعادة رسم تُفقد حالة
  الحقول، لذا البحث والفتح/الطي يُدار بعناية (انظر §٩).

### الحالة العامة

```js
DB = {
  meds: [], labs: [], imaging: [], recipes: [],   // العناصر
  cart:   { meds: [], labs: [], imaging: [], recipes: [] },
  groups: [],                                     // {id, kind, name, items[]}
  out:    { … },                                  // الحقول المرسلة لكل قسم
  header: { name: '', title: '', contact: '' },   // ترويسة الطباعة (اختيارية)
  backup_at: 0,                                   // آخر نسخة احتياطية
  pin_hash: null
}
```

`DB` هي نسخة الذاكرة من قاعدة البيانات. كل تعديل يكتب في **الاثنين**:
`DB` أولًا ثم `Store.*` — والواجهة تُرسم من `DB`.

---

## ٥. التنقّل

مكدّس بسيط:

```js
NAV = ['home']            // آخر عنصر هو الصفحة الحالية
goPage('labs')            // يدفع
goBack()                  // يسحب (مع حارس التعديلات غير المحفوظة)
goHome()                  // يعيد التهيئة
```

أسماء الصفحات: `home`, `meds`, `labs`, `imaging`, `recipes`, `settings`,
`lib:<kind>`, `grp:<kind>`, `grp:<kind>:<groupId>`.

`render()` هو الموزّع الوحيد: يضبط الترويسة (عنوان + سهم رجوع + ترس) ثم
ينادي دالة رسم الصفحة.

**زر الرجوع في الجهاز** يُسلَّم للواجهة أولًا:

```java
webView.evaluateJavascript("… window.onAndroidBack() …", handled -> {
    if (!"true".equals(handled)) { /* اخرج من التطبيق */ }
});
```

و`onAndroidBack()` في JS: يغلق المودال → يرجع صفحة → يعيد `false` فيخرج.

---

## ٦. الطباعة والمشاركة

> **`window.open` لا يعمل داخل WebView إطلاقًا.** هذا كان سبب رسالة «اسمح
> بالنوافذ المنبثقة» وصمت زر الطباعة في الإصدارات الأولى. لا تعتمد عليها.

### الطباعة

```
printDoc(title, itemsHtml(kind, ids))          ← صفحة HTML واحدة يتشاركها الاثنان
   ├─ printList → AndroidBridge.printHtml      ← مربع الطباعة (PrintManager)
   └─ pdfList   → AndroidBridge.sharePdf       ← ملف PDF ثم قائمة الإرسال
```

**إرسال PDF مباشرةً** (`sharePdf`) يستخدم نفس محرّك الطباعة لكن بدل تسليمه
لـ`PrintManager` يستدعي `onLayout` ثم `onWrite` بنفسه ويكتب الناتج ملفًّا،
فيخرج PDF جاهزًا للإرسال بلا أي واجهة نظام وسيطة.

`AndroidBridge.printHtml` ينشئ WebView مؤقتًا، ينتظر `onPageFinished`، ثم
يمرّر `createPrintDocumentAdapter` إلى `PrintManager`. **يجب** الاحتفاظ
بمرجع للعارض (`printView`) وإلا جُمِع قبل انتهاء توليد الـPDF.

ورقة الطباعة في `printDoc()`: مقاسات بالنقاط، `@page { size: A4 }`، وأسطر
متقاربة، و`page-break-inside: avoid` لكل عنصر.

### المشاركة كصورة

`buildCanvas(kind, ids, title)` يرسم القائمة على `<canvas>`:

1. يقيس النص أولًا (`wrapText`) لحساب الارتفاع المطلوب
2. يضبط أبعاد اللوحة ثم يرسم (تغيير الأبعاد يصفّر سياق الرسم — أعِد ضبط
   الخطوط بعده)
3. `toDataURL` → `AndroidBridge.shareImageBase64` → `FileProvider` →
   `ACTION_SEND`

**لماذا صورة لا PDF؟** رسم النص العربي في المتصفح يضبط الاتجاه والتشكيل
تلقائيًا وبدقة، بخلاف توليد PDF يدويًا الذي يحتاج تضمين خطوط وقد يُخرج
حروفًا مفكّكة.

### النسخ كنص

`copyList(kind, ids, title)` يبني نصًّا عاديًا (ترويسة اختيارية + عنوان
وتاريخ + عناصر بنقاط) ويمرّره إلى `AndroidBridge.copyText` الذي يضعه في
حافظة النظام. في المتصفح يستخدم `navigator.clipboard`.

### حقول النص الطويل

`taField(id, label, value, placeholder)` تبني الحقل كاملًا: تسمية + شريط
إدراج (نقطة / ترقيم / سطر جديد) + `<textarea>` يتمدّد مع المحتوى عبر
`grow()`. و`taKey()` تجعل Enter يُكمل القائمة تلقائيًا، وعلى علامة فارغة
يُنهيها. `growAll()` تُستدعى بعد `openModal` ليظهر النص المحفوظ كاملًا.

الأسطر الجديدة تصل إلى المخرجات الثلاثة: `white-space: pre-wrap` في ورقة
الطباعة وبطاقات القوائم، و`wrapBlock()` في الصورة، وإزاحة أسطر التكملة في
النص المنسوخ.

### ترويسة الطباعة

`DB.header` = `{name, title, contact}` — كلها **اختيارية وفارغة افتراضيًا**.
`headerHtml()` يعيد نصًّا فارغًا ما لم يُملأ سطر منها، فلا تظهر كتلة الترويسة
في الورقة إطلاقًا. تُحفظ في `settings` بالمفاتيح `hdr_*`.

### النسخ الاحتياطي التلقائي

`autoBackup(force)` تُستدعى عند كل إقلاع: تكتب نسخة إن مرّ يوم على آخر واحدة
وكانت هناك بيانات. `BackupStore.java` يتولّى الموضع: مجلد التطبيق الخاص
افتراضيًا، أو مجلدًا يختاره المستخدم عبر `ACTION_OPEN_DOCUMENT_TREE` مع
`takePersistableUriPermission` فيبقى بعد إعادة التشغيل. التفاصيل في
[`DATABASE.md §١٠`](DATABASE.md).

### الحقول المرسلة

`DB.out[kind]` مصفوفة أسماء حقول. `outLines()` تمرّ على **تعريف** الحقول
(`OUT_MEDS` / `OUT_LABS` / `OUT_RECIPES`) وتصفّي بالمختار — فيبقى الترتيب
ثابتًا لا يتبع ترتيب نقر المستخدم. الاسم يظهر دائمًا، ورمز التحليل والاسم
العلمي يُدمجان في سطر الاسم إن اختيرا.

---

## ٧. المجموعات المسمّاة

المحرّر يعمل على **نسخة مؤقتة** في `GRP`:

```js
GRP = { id, kind, name, items: [...], dirty: false }
```

- التعديل يمسّ `GRP` فقط ويرفع `dirty`
- `groupSave()` ينسخ إلى `DB.groups` ويكتب في القاعدة
- `goBack()` مع `dirty` يسأل، ثم يهمل `GRP` — فتعود المجموعة كما كانت
- `groupEditPrint/Share` يعملان على `GRP.items` فتُرسل النسخة المعدَّلة بلا حفظ

هذا هو المطلوب: «تعدّل، ترسل، وتخرج بلا أن تمسّ الأصل».

---

## ٨. المكتبة الجاهزة

`library.js` يعرّف `window.LIBRARY = { labs: [...], meds: [...] }` — بيانات
ثابتة مدمجة. الإضافة تنسخ العنصر وتعطيه `id` جديدًا فيصير ملك المستخدم
يعدّله كما يشاء.

- منع التكرار بمفتاح: `code|name` للتحاليل، `trade_name|scientific_name`
  للعلاجات (`libKey()`)
- الإضافة دفعة واحدة عبر `upsertMany` (معاملة واحدة)
- **حقل `dosage` فارغ عمدًا في كل علاجات المكتبة** — الجرعة تختلف بالحالة
  والعمر والوزن ووظائف الكلى والكبد. لا تملأه ببيانات عامة.

لإضافة عناصر: عدّل `library.js` مباشرةً بنفس شكل الكائنات. الاختبار
`كل عناصر المكتبة تحمل الحقول المطلوبة` سيرفض أي عنصر ناقص أو مكرّر أو
يحمل جرعة.

---

## ٩. تطوير الواجهة بسرعة (بلا بناء APK)

افتح `app/src/main/assets/index.html` في متصفح مباشرةً. بلا جسر `NativeDb`
يعمل `Store` على `localStorage` تلقائيًا، فكل الواجهة والمنطق قابلان
للاختبار في ثوانٍ بدل دقائق بناء.

```bash
xdg-open app/src/main/assets/index.html      # أو افتحه يدويًا
```

الفروق الوحيدة عن التطبيق: التخزين، والطباعة (نافذة بدل مربع النظام)،
والمشاركة (تنزيل الصورة بدل قائمة النظام).

### لقطات آلية

```bash
node tools/ui_smoke.js      # يحتاج playwright
```

يمرّ على تدفّق كامل ويلتقط لقطات ويطبع أخطاء الكونسول. هذا ما كشف ثلاثة
أخطاء حقيقية لم تلتقطها اختبارات الوحدة (انظر §١١).

---

## ١٠. الاختبارات

```bash
node tools/test_store.js
```

٤٨ اختبارًا، بلا أي حزم خارجية. الفكرة: تشغيل `app.js` **الحقيقي** داخل
`vm` مع DOM وهمي مبسّط وجسر `NativeDb` وهمي يحاكي دلالات `DaliliDb`
(جداول منفصلة، سلة مرتّبة، مجموعات).

يغطّي: CRUD للأقسام الثلاثة، البقاء بعد إعادة التشغيل، الترحيل من
`localStorage` (ولا يتكرر ولا يطمس)، رمز القفل، النسخ الاحتياطي، الحقول
المرسلة ومخرجات الطباعة، المكتبة وبحثها وسلامة بياناتها، التنقّل وزر
الرجوع، والمجموعات (تعديل/حفظ/رجوع بلا حفظ).

**ما لا يغطّيه:** كود جافا. لا `DaliliDb` ولا `PrintManager` ولا
`evaluateJavascript` يُختبر آليًا هنا — يُبنى ويُترجم فقط. أي تعديل في جافا
يحتاج تجربة على جهاز.

أضِف اختبارًا مع كل ميزة. النمط:

```js
run('وصف بالعربية', () => {
  const b = makeBridge(); const c = load(b); c.Store.load(); c.showApp();
  …
  eq(actual, expected, 'وصف قصير:');
});
```

---

## ١١. مزالق واجهناها فعلًا

| المزلق | الأثر | الحل |
|---|---|---|
| `window.open` في WebView | زر الطباعة صامت، رسالة «اسمح بالنوافذ المنبثقة» | `PrintManager` عبر الجسر (§٦) |
| `applyData(null)` كانت تخرج مبكرًا | `DB.out` يبقى `null` فتنهار الإعدادات والطباعة على أول تشغيل | `data = data \|\| {}` ثم أكمل بالافتراضيات |
| تعارض `kotlin-stdlib` | البناء يفشل بأصناف مكرّرة | `resolutionStrategy.force` على 1.8.22 في `app/build.gradle` |
| طيّ كل التصنيفات | قائمة قصيرة لا يظهر فيها اسم عنصر واحد | `openByDefault()`: تُفتح ما لم تتجاوز ٤٠ عنصرًا |
| البحث على الاسم فقط | البحث عن «صيام» لا يجد شيئًا | `libHay()` يشمل كل نص العنصر |
| إعادة رسم القائمة عند كل حرف بحث | فقدان تركيز الحقل | في المكتبة: تحديث `#lib-list` فقط لا الشريط |
| عمود في `onCreate` بلا `onUpgrade` | يعمل على تثبيت جديد ويكسر التحديث | راجع قائمة §٩ في `DATABASE.md` |
| فرع `if (kind === 'meds') … else …` بقي من زمن القسمين | عناصر مكتبة الأشعة ذهبت إلى قائمة التحاليل | استخدم `coll(kind)` / `setColl(kind, …)` دائمًا — لا تفرّع على القسم يدويًا |
| اشتقاق `PrintDocumentAdapter.LayoutResultCallback` من حزمة التطبيق | التصريف يفشل: «is not public … outside package» | المساعد `PdfPrint` موضوع في حزمة `android.print` — لا تنقله |
| `<textarea>` بارتفاع ثابت | لا يظهر إلا سطران مهما طال النص، وسحب الحجم لا يعمل باللمس | `taField()` + `grow()` — يتمدّد مع المحتوى |
| `esc()` وحدها لا تحفظ الأسطر الجديدة في HTML | نص متعدد الأسطر يُطبع كتلة واحدة | `white-space: pre-wrap` في الطباعة والبطاقات، و`wrapBlock()` في الصورة |

---

## ١٢. إضافة قسم رابع — خطوة بخطوة

> طُبّقت هذه الخطوات فعلًا عند إضافة قسم **الأشعة والفحوصات** (`imaging`) —
> راجع الالتزام المقابل في تاريخ المستودع كمثال كامل.

مثال: «اللقاحات».

**قاعدة البيانات** (`DaliliDb.java`)
1. `KINDS` ← أضِف `"vaccines"`
2. عرّف `VACCINE_TEXT_COLS`
3. `textCols()` و`flagCol()` ← أضِف الفرع
4. `createVaccines(db)` ونادِها من `onCreate`
5. ارفع `DB_VERSION` وأضِف `if (oldVersion < N) createVaccines(db);`

**الواجهة** (`app.js`)
6. `KINDS` ← أضِف `'vaccines'`
7. `KIND_LBL` ← التسميات والأيقونة وصيغ العدد
8. `coll()` و`setColl()` ← أضِف الفرع
9. `OUT_VACCINES` + `OUT_DEF.vaccines` + `outDefs()`
10. `PAGES` ← عنوان الصفحة، و`render()` ← فرع الرسم
11. اكتب `vaccineRow` / `renderVaccines` / `vaccineForm` / `vaccineSave` /
    `vaccineDel` على نمط الوصفات
12. `outTitle()` ← فرع العنوان، و`cartTitle()` ← اسم القائمة
13. الإعدادات ← `outBlock('vaccines', …)` وزر الإضافة السريعة

**التوثيق والاختبار**
14. `docs/schema.sql` + `docs/DATABASE.md`
15. اختبارات في `tools/test_store.js` (والجسر الوهمي فيه يحتاج الجدول الجديد)
16. `node tools/test_store.js` ثم `./gradlew assembleRelease`

السلة والمجموعات والطباعة والمشاركة والنسخ الاحتياطي **تعمل تلقائيًا** —
كلها معمّمة على `KINDS`.

---

## ١٣. قائمة تحقّق قبل كل إصدار

- [ ] `node tools/test_store.js` — كلها خضراء
- [ ] `node tools/ui_smoke.js` — بلا أخطاء كونسول
- [ ] رفع `versionCode` و`versionName`
- [ ] `./gradlew assembleRelease` ينجح
- [ ] تثبيت **فوق** الإصدار السابق (لا إلغاء تثبيت) والتأكد أن البيانات باقية
- [ ] تجربة الطباعة والمشاركة على جهاز حقيقي — لا يمكن اختبارهما آليًا
- [ ] تحديث `README.md` واسم ملف APK في `dist/`
