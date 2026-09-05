# قاعدة البيانات — دليل مفصّل

كل شيء محلي: ملف SQLite واحد داخل مساحة التطبيق الخاصة، لا يصل إليه أي
تطبيق آخر ولا يُرسَل لأي جهة. التطبيق لا يملك صلاحية إنترنت أصلًا
(`AndroidManifest.xml` بلا `INTERNET`).

```
/data/data/me.alaoufi.dalili/databases/dalili.db
```

- **الكود:** `app/src/main/java/me/alaoufi/dalili/DaliliDb.java`
- **المخطط الكامل كـSQL:** [`schema.sql`](schema.sql)
- **إصدار المخطط الحالي:** `8`

---

## ١. لماذا SQLite وليس localStorage؟

الإصدار الأول كان يحفظ كل شيء كنص JSON واحد في `localStorage`. المشاكل:

| المشكلة | الحل بقاعدة البيانات |
|---|---|
| مسح ذاكرة WebView يمحو كل البيانات | الملف خارج ذاكرة WebView تمامًا |
| الاستيراد الفاشل في منتصفه يترك بيانات مشوّهة | الاستيراد داخل معاملة واحدة — إمّا كلّه أو لا شيء |
| كل حفظ يعيد كتابة النص كاملًا | تحديث صف واحد فقط |
| لا فهارس ولا استعلامات | فهارس على الاسم والتصنيف والنوع |

الترحيل من الإصدار القديم تلقائي ومرّة واحدة — انظر §٧.

---

## ٢. الجداول

### الأقسام: `meds` / `labs` / `imaging` / `recipes`

تتشارك نفس البنية المفاهيمية:

```
id           TEXT PRIMARY KEY     معرّف نصّي يولّده JS
…حقول نصّية…                      تختلف بين الأقسام
<عمود علامة> INTEGER 0/1          ⭐ في الواجهة
sort_order   INTEGER              ترتيب الإدراج
```

| القسم | الحقول النصّية | عمود العلامة |
|---|---|---|
| `meds` | trade_name\*, scientific_name, category, concentration, dosage, duration, uses, cautions, notes, extra | `default_include` |
| `labs` | category, code, name\*, purpose, requirements, prohibitions, extra | `is_common` |
| `imaging` | category, name\*, region, purpose, requirements, prohibitions, extra | `is_common` |
| `recipes` | category, name\*, type, purpose, ingredients, preparation, usage, dose, duration, effects, precautions, extra | `is_favorite` |

\* الحقل المطلوب (`NOT NULL`) — والواجهة أيضًا تمنع الحفظ بدونه.

**لماذا `id` نصّي لا `AUTOINCREMENT`؟** حتى تبقى المعرّفات ثابتة عند تصدير
نسخة احتياطية واستيرادها على جهاز آخر، فلا تنكسر إشارات السلة والمجموعات.
يولّده `uid()` في `app.js`: طابع زمني بالأساس ٣٦ + جزء عشوائي.

### `cart` — سلة التحديد (مؤقتة)

```sql
kind TEXT, item_id TEXT, position INTEGER, PRIMARY KEY (kind, item_id)
```

جدول واحد لكل الأقسام، يميّزها عمود `kind`. `position` مهم لأنه ترتيب
الطباعة والصورة المُرسَلة.

### `groups` + `group_items` — المجموعات المسمّاة (دائمة)

```sql
groups(id, kind, name, sort_order)
group_items(group_id, item_id, position, PRIMARY KEY (group_id, item_id))
```

قائمة جاهزة داخل القسم — «فحوصات ما قبل الجراحة» مثلًا — تُطبع أو تُرسَل
باسمها. مستقلّة تمامًا عن السلة.

### `sections` + `fields` + `items` — الأقسام وحقولها

```sql
sections(id, title, icon, builtin, sort_order)
fields(id, kind, key, label, type, sort_order)
items(id, section, name, category, extra, flag, sort_order)
```

الأقسام الأربعة الأصلية مسجّلة في `sections` كغيرها (`builtin=1`)، فيقدر
المستخدم على تسميتها وتغيير أيقونتها وترتيبها؛ ولها جداولها الخاصة أعلاه
ولا تُحذف. الأقسام التي ينشئها لا جدول لكلٍّ منها — عناصرها كلها في
`items` يفرّقها عمود `section`.

**لماذا لا جدول لكل قسم جديد؟** لأن ذلك يعني تغيير المخطط وقت التشغيل،
ويُدخِل اسمًا من المستخدم في نصّ SQL كاسم جدول. باسم جدول ثابت ومرشّح
مربوط (`WHERE section = ?`) لا يوجد هذا الباب أصلًا.

**الحقول الإضافية** (`fields`) يعرّفها المستخدم داخل بيانات العنصر، وقيمتها
تُحفَظ في عمود `extra` (نص JSON) على صفّ العنصر نفسه — في الأقسام الأصلية
والجديدة سواء. فلا يتغيّر المخطط كلّما أُضيف حقل. و`key` يُولَّد مرّة ولا
يتغيّر بإعادة التسمية، فتبقى القيم المحفوظة سليمة.

في الواجهة يظهر الحقل الإضافي في نموذج العنصر، وفي «الحقول المرسلة»
بمفتاح مسبوق بـ`x:` يعرف منه `outLines` أن قيمته في `extra`.

### `cats` — التصنيفات (كيان مستقل)

```sql
cats(id, kind, name, sort_order)
```

«العيون» و«الأذن» في العلاجات، «كيمياء الدم» و«المناعة» في التحاليل. كانت
مجرّد نصّ داخل العنصر، فلم يكن ممكنًا إنشاء تصنيف قبل عناصره ولا إعادة
تسميته دفعةً واحدة ولا ترتيب المجموعات. الآن صفوف حقيقية، وعمود
`category` في جداول الأقسام يشير **لاسمها**.

**لماذا الاسم لا المعرّف؟** ليبقى العنصر مقروءًا بذاته في النسخة الاحتياطية
وفي أي تصدير، بلا حاجة لضمّ جدول التصنيفات. الثمن أن إعادة التسمية تلمس كل
العناصر — لكنها تحديث واحد:

```java
// DaliliDb.moveCatItems — يخدم إعادة التسمية (قديم ← جديد)
// والحذف (قديم ← '' أي «غير مصنّف»)
UPDATE <kind> SET category = ? WHERE category = ?
```

`sort_order` هو ترتيب المستخدم، وهو ترتيب ظهور المجموعات في القسم.
التصنيف الفارغ يعيش في `cats` ولا يظهر في القسم — مكانه صفحة إدارة
التصنيفات.

### `sent` — سجل الإرسالات

```sql
sent(id, kind, title, who, item_ids, ts)
```

آخر عشر قوائم أُرسِلت، لتُعاد بضغطة بلا إعادة تحديد. **لقطة تاريخية لا
علاقة حيّة:** العناصر تُحفَظ كقائمة معرّفات نصّية (JSON) لا كجدول ربط، فحذف
عنصر لاحقًا لا يغيّر ما جرى — يُستبعَد عند الاسترجاع فقط، مع إشعار.
`DaliliDb.addSent` يقصّ السجل على عشرة في نفس المعاملة.

### `settings` — مخزن مفتاح/قيمة

| المفتاح | القيمة |
|---|---|
| `pin_hash` | بصمة SHA-256 لرمز القفل — **لا الرمز نفسه** |
| `out_meds` | نص JSON: أسماء الحقول الظاهرة في طباعة العلاجات |
| `out_labs` | نفسه للتحاليل |
| `out_imaging` | نفسه للأشعة والفحوصات |
| `out_recipes` | نفسه للوصفات |
| `hdr_name` / `hdr_title` / `hdr_contact` | ترويسة الطباعة الاختيارية — فارغة افتراضيًا فلا تظهر |
| `backup_at` | وقت آخر نسخة احتياطية تلقائية |
| `cats_seeded` | `'1'` بعد زرع التصنيفات المبدئية مرّة واحدة — فحذف تصنيف مزروع لا يعيده الإقلاع التالي |
| `fields_out_done` | `'1'` بعد إدراج الحقول الإضافية المعرَّفة قبل التحديث في «الحقول المرسلة» |
| `dense` | `'1'` ورقة مضغوطة — خط أصغر وهوامش أضيق فتدخل قائمة أطول في الصفحة |
| `fmt` | الصيغة المفضّلة للإرسال (`pdf`/`img`/`print`/`copy`) — تتصدّر شريط المعاينة |

---

## ٣. لا مفاتيح أجنبية — وهذا مقصود

`cart` و`group_items` لا تحملان `FOREIGN KEY`. السبب: `PRAGMA foreign_keys`
مطفأ افتراضيًا في أندرويد القديم، والاعتماد عليه يجعل السلوك مختلفًا بين
الأجهزة. عوضًا عن ذلك **التنظيف صريح داخل معاملة**:

```java
public void delete(String kind, String id) {
    db.beginTransaction();
    try {
        db.delete(kind, "id=?", new String[]{id});
        db.delete("cart", "kind=? AND item_id=?", new String[]{kind, id});
        db.delete("group_items", "item_id=? AND group_id IN "
                + "(SELECT id FROM groups WHERE kind=?)", new String[]{id, kind});
        db.setTransactionSuccessful();
    } finally { db.endTransaction(); }
}
```

`delete()` تنظّف الآن **الثلاثة** في معاملة واحدة: الجدول المصدر، والسلة،
و`group_items` لكل مجموعة من نفس القسم — فلا تبقى إشارة يتيمة. استعلام كشف
اليتامى موجود في آخر `schema.sql` للتحقق.

---

## ٤. لماذا الجداول موحّدة المعالجة في الكود

بدل دالة قراءة/كتابة لكل قسم، هناك جدول أعمدة واحد يفرّق بينها:

```java
public static final String[] KINDS = { "meds", "labs", "imaging", "recipes" };

private static String[] textCols(String kind) { … }   // أي أعمدة نصّية
private static String flagCol(String kind)   { … }   // ما اسم عمود ⭐
```

وكل الدوال (`readItems`, `upsert`, `upsertMany`, `replaceAll`) تمرّ بهما.
إضافة قسم رابع = صفّان في هذين الجدولين + `CREATE TABLE` + إدخال في
`KINDS`.

**أمان:** اسم القسم يدخل في نص SQL كاسم جدول، فلا يمكن تمريره كمعامل مربوط.
لذلك `DbBridge.validKind()` يرفض أي قيمة خارج `KINDS` **قبل** الوصول إلى
قاعدة البيانات. لا تتجاوز هذا الفحص عند إضافة دالة جديدة للجسر.

---

## ٥. جسر JavaScript ↔ قاعدة البيانات

`DbBridge.java` مُسجَّل في WebView باسم `NativeDb`. كل الدوال متزامنة وتعمل
على خيط WebView الخلفي (لا توقف الواجهة)، وترجع `boolean` نجاح أو نصًّا.

| الدالة | المعاملات | ترجع |
|---|---|---|
| `loadAll()` | — | نص JSON بكل شيء (انظر §٦) |
| `upsertItem(kind, json)` | القسم + عنصر | نجاح |
| `upsertMany(kind, jsonArray)` | دفعة في معاملة واحدة | نجاح |
| `deleteItem(kind, id)` | | نجاح |
| `setCart(kind, jsonIds)` | يستبدل سلة القسم كاملة | نجاح |
| `saveGroup(json)` | `{id, kind, name, items[]}` | نجاح |
| `deleteGroup(id)` | | نجاح |
| `saveSection(json)` | `{id, title, icon, builtin}` | نجاح |
| `deleteSection(id)` | قسم المستخدم بكل ما يتبعه؛ الأصلية مرفوضة | نجاح |
| `setSectionOrder(jsonIds)` | ترتيب البطاقات في الرئيسية | نجاح |
| `saveField(json)` | `{id, kind, key, label, type}` | نجاح |
| `deleteField(id)` | | نجاح |
| `setFieldOrder(jsonIds)` | | نجاح |
| `addSent(json)` | `{id, kind, title, who, ids[], ts}` — يقصّ على عشرة | نجاح |
| `clearSent()` | إفراغ السجل؛ لا يمسّ عنصرًا | نجاح |
| `saveCat(json)` | `{id, kind, name}` — إنشاء أو إعادة تسمية | نجاح |
| `deleteCat(id)` | لا يمسّ العناصر | نجاح |
| `moveCatItems(kind, from, to)` | نقل عناصر تصنيف؛ `to` فارغًا = «غير مصنّف» | نجاح |
| `setCatOrder(jsonIds)` | ترتيب التصنيفات كما رتّبها المستخدم | نجاح |
| `setSetting(key, value)` | `value = null` يحذف الإعداد | نجاح |
| `replaceAll(json)` | استيراد نسخة احتياطية | نجاح |
| `isEmpty()` | للترحيل مرّة واحدة | منطقي |

في `app.js` كل هذا خلف كائن `Store` الذي يوفّر **بديلًا تلقائيًا** إلى
`localStorage` عند غياب الجسر (فتح الملفات في متصفح عادي للتطوير):

```js
upsert: function (kind, o) {
  if (!NDB) { blobSave(); return true; }          // متصفح
  try { return NDB.upsertItem(kind, JSON.stringify(o)) || dbFail(); }
  catch (e) { return dbFail(); }
}
```

---

## ٦. شكل `loadAll()`

```jsonc
{
  "meds":    [ { "id": "…", "trade_name": "…", …, "default_include": 0 } ],
  "labs":    [ { "id": "…", "code": "CBC", "name": "…", …, "is_common": 1 } ],
  "imaging": [ { "id": "…", "name": "رنين الدماغ", "region": "الدماغ", …, "is_common": 1 } ],
  "recipes": [ { "id": "…", "category": "…", "name": "…", "type": "وقائية", …, "is_favorite": 0 } ],
  "cart":    { "meds": ["id1"], "labs": ["id2","id3"], "imaging": [], "recipes": [] },
  "sections":[ { "id": "meds", "title": "العلاجات", "icon": "💊", "builtin": 1 },
               { "id": "sec_x", "title": "اللقاحات", "icon": "💉", "builtin": 0 } ],
  "fields":  [ { "id": "…", "kind": "meds", "key": "f1", "label": "الشركة المصنّعة", "type": "text" } ],
  "sec_x":   [ { "id": "…", "name": "لقاح الإنفلونزا", "category": "…", "extra": {…}, "flag": 0 } ],
  "cats":    [ { "id": "…", "kind": "labs", "name": "كيمياء الدم" } ],
  "sent":    [ { "id": "…", "kind": "labs", "title": "قائمة تحاليل", "who": "…",
                 "ids": ["id2","id3"], "ts": 1730000000000 } ],
  "groups":  [ { "id": "…", "kind": "labs", "name": "…", "items": ["id2","id3"] } ],
  "settings": { "pin_hash": "…", "out_labs": "[\"code\",\"requirements\"]" },
  "pin_hash": "…"
}
```

`pin_hash` مكرّر في الأعلى للتوافق مع الإصدارات الأولى؛ المصدر الحقيقي هو
`settings`. الحقول النصّية الفارغة ترجع `""` لا `null`.

**النسخة الاحتياطية** (تصدير/استيراد JSON) لها نفس الشكل تقريبًا، عدا أن
الحقول المرسلة تأتي في `out` كمصفوفات جاهزة بدل `settings` — الدالة
`applyData()` في `app.js` تقبل الشكلين.

---

## ٧. الترحيل من `localStorage`

عند أول إقلاع بعد التحديث:

```
هل في localStorage مفتاح clinic_tool_v1؟
  ├─ لا  → لا شيء
  └─ نعم → هل قاعدة البيانات فارغة (isEmpty)؟
             ├─ لا  → احذف المفتاح القديم فقط (لا تطمس شيئًا)
             └─ نعم → replaceAll(القديم) ثم احذف المفتاح
```

الشرط «القاعدة فارغة» أساسي: بدونه قد يمسح استيرادٌ متأخر بيانات أحدث.
مغطّى باختبارين في `tools/test_store.js`.

---

## ٨. فحص القاعدة على جهاز حقيقي

```bash
# سحب الملف (يعمل على نسخة debug فقط — release الموقّعة بمفتاح debug تعمل أيضًا)
adb shell "run-as me.alaoufi.dalili cat databases/dalili.db" > dalili.db
sqlite3 dalili.db ".schema"
sqlite3 dalili.db "SELECT COUNT(*) FROM labs;"

# أو مباشرة على الجهاز
adb shell run-as me.alaoufi.dalili sqlite3 databases/dalili.db ".tables"
```

للتحقق من نجاح ترقية: ثبّت الإصدار القديم، أدخل بيانات، ثبّت الجديد فوقه
(بلا إلغاء تثبيت)، ثم تأكد أن البيانات باقية وأن `.schema` يحوي الجداول
والأعمدة الجديدة.

---

## ٩. إضافة حقل جديد — قائمة تحقّق

مثال: إضافة «سعر التحليل» إلى `labs`.

1. `DaliliDb.java`
   - أضِف `"price"` إلى `LAB_TEXT_COLS`
   - أضِف `+ "price TEXT,"` في `CREATE TABLE labs` داخل `onCreate`
   - ارفع `DB_VERSION` إلى ٥
   - أضِف في `onUpgrade`: `if (oldVersion < 5) db.execSQL("ALTER TABLE labs ADD COLUMN price TEXT");`
2. `app.js`
   - أضِف الحقل إلى نموذج `labForm()` وقراءته في `labSave()`
   - أضِفه إلى `OUT_LABS` إن أردته ضمن الحقول المرسلة
3. `docs/schema.sql` و`docs/DATABASE.md` — حدّثهما
4. `tools/test_store.js` — أضِف تأكيدًا أن الحقل يُحفظ ويُسترجع
5. شغّل `node tools/test_store.js` ثم ابنِ

**لا تنسَ:** عمود يُضاف في `onCreate` فقط بلا `onUpgrade` يعمل على التثبيت
الجديد ويكسر التحديث فوق تثبيت قديم — وهو أكثر خطأ شائع هنا.


---

## ١٠. النسخ الاحتياطي التلقائي

ليس في قاعدة البيانات بل ملفات JSON بجانبها، باسم
`dalili-YYYY-MM-DD-HHmm.json`. الكود في `BackupStore.java`.

- يُكتب عند فتح التطبيق إن مرّ **يوم** على آخر نسخة وكانت هناك بيانات
- يُحتفظ بأحدث **خمس** ويُحذف ما زاد — والحذف يمسّ ملفات `dalili-*.json`
  وحدها، فلا يُلمس شيء آخر في مجلد المستخدم
- محتواه نفس شكل النسخة الاحتياطية اليدوية (`snapshot()`)

### موضعان للحفظ

| الموضع | المسار | يبقى بعد إلغاء التثبيت؟ | صلاحية |
|---|---|---|---|
| الافتراضي | `Android/data/me.alaoufi.dalili/files/backups/` | ✗ | لا شيء |
| يختاره المستخدم | أي مجلد عبر منتقي النظام | ✓ | لا شيء — الإذن للمجلد وحده |

الموضع المختار يُحفظ في `SharedPreferences` (`backup_dir`) كرابط شجرة، مع
`takePersistableUriPermission` فيبقى بعد إعادة التشغيل. وإن سُحب الإذن
(مسح بيانات، إزالة بطاقة) يرجع `BackupStore` للمجلد الافتراضي بهدوء بدل أن
يفشل — يفحص `getPersistedUriPermissions()` في كل مرة.

القراءة والكتابة في المجلد المختار تمرّ بـ`DocumentsContract` مباشرةً
(`createDocument` · `buildChildDocumentsUriUsingTree` · `deleteDocument`)
بلا تبعية `documentfile`.

### دوال الجسر

`writeBackup(json, stamp)` · `listBackups()` · `readBackup(name)` ·
`deleteBackup(name)` · `shareBackup(name)` · `backupDir()` ·
`backupDirIsCustom()` · `pickBackupDir()` · `resetBackupDir()`.

المنتقي غير متزامن، فبعد اختيار المجلد تنادي جافا
`window.onBackupDirPicked()` لتُحدِّث الواجهة.

`validName()` ترفض أي اسم لا يبدأ بـ`dalili-` أو لا ينتهي بـ`.json` أو فيه
`/` أو `..` — فلا يمكن لخلل في الواجهة أن يخرج من مجلد النسخ.
