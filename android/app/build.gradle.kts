plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val ownerWebAppUrl = providers.gradleProperty("satoriWebAppUrl")
    .orElse("https://script.google.com/macros/s/AKfycbwJjiajW-gbCwCISrGjvLy5L5ETdmfAGV1zHpUWoeszRUXNgQ6vGHOs3DVABSAcEtV1/exec?authuser=0&pli=1")
    .get()
val ownerUri = java.net.URI(ownerWebAppUrl)
require(
    ownerUri.scheme == "https" &&
    ownerUri.host == "script.google.com" &&
    ownerUri.port == -1 && ownerUri.userInfo == null &&
    ownerUri.path.matches(Regex("^/macros/s/[A-Za-z0-9_-]+/exec$")) &&
    ownerUri.fragment == null &&
    (ownerUri.rawQuery == null || ownerUri.rawQuery == "authuser=0&pli=1")
) {
    "satoriWebAppUrl must be a valid owner-only Apps Script /exec URL with optional authuser=0&pli=1"
}

android {
    namespace = "vn.minhsatori.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "vn.minhsatori.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "0.1.1-test"
        buildConfigField("String", "SATORI_WEB_APP_URL", "\"$ownerWebAppUrl\"")
    }

    buildFeatures { buildConfig = true }

    buildTypes {
        getByName("debug") {
            isMinifyEnabled = false
        }
        getByName("release") {
            isMinifyEnabled = false
            // Release signing must be configured with a private, persistent keystore.
            // The CI publishes DEBUG builds for testing only.
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.core:core-ktx:1.15.0")
    testImplementation("junit:junit:4.13.2")
}
