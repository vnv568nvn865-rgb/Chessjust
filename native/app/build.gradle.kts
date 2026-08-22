plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android { namespace = "com.chessjust.app"; compileSdk = 35
    defaultConfig { applicationId = "com.chessjust.app"; minSdk = 26; targetSdk = 35; versionCode = 21; versionName = "0.21.0" }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.02.00"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.navigation:navigation-compose:2.8.7")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
