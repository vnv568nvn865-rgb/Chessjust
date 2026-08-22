# Chessjust Native

هذا هو مسار إعادة بناء Chessjust كتطبيق Android Native حقيقي.

## المبدأ
- Kotlin + Jetpack Compose هو الأساس الجديد.
- لا يتم استخدام WebView كواجهة للتطبيق النهائي.
- يتم نقل الوظائف من `www/` تدريجيًا إلى طبقات Kotlin أصلية.
- Stockfish، PGN، Chess.com، التدريب، التكتيكات، الألغاز، الافتتاحيات والمدرب سيتم نقلها واختبارها مرحلةً بعد مرحلة.

## المرحلة الحالية
- Native Android project فعال.
- Compose Material 3.
- Navigation سفلية أصلية.
- Home / Analyze / Training / Profile.
- لوحة شطرنج Native أولية قابلة للتفاعل.
- تم تغيير GitHub Actions ليبني مجلد `native/` بدل Capacitor.

## قاعدة الترحيل
لا نعتبر المشروع مكتملًا طالما بقيت HTML/CSS/JavaScript هي الأساس التشغيلي لأي ميزة رئيسية. يتم حذف الأجزاء القديمة بعد نقل وظائفها والتحقق منها.
