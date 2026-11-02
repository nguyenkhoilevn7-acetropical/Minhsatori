plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "vn.minhsatori.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "vn.minhsatori.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 68
        versionName = "0.4.51"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures { buildConfig = true }

    // Public project settings only. A missing Firebase project disables FCM.
    defaultConfig {
        fun fcmValue(name: String): String =
            System.getenv(name).orEmpty().takeIf {
                it.matches(Regex("[A-Za-z0-9_:.-]{0,220}"))
            } ?: ""
        fun quotedFcmValue(name: String): String =
            listOf('"', fcmValue(name), '"').joinToString("")
        buildConfigField("String", "SATORI_FCM_APP_ID", quotedFcmValue("SATORI_FCM_APP_ID"))
        buildConfigField("String", "SATORI_FCM_API_KEY", quotedFcmValue("SATORI_FCM_API_KEY"))
        buildConfigField("String", "SATORI_FCM_PROJECT_ID", quotedFcmValue("SATORI_FCM_PROJECT_ID"))
    }

    signingConfigs {
        create("satoriRelease") {
            // A stable keystore must be supplied by protected CI secrets or a secure
            // local environment; never place private keys in source control.
            val filePath = System.getenv("SATORI_ANDROID_KEYSTORE_FILE")
            if (!filePath.isNullOrBlank()) {
                storeFile = file(filePath)
                storePassword = System.getenv("SATORI_ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("SATORI_ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("SATORI_ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        getByName("debug") {
            isMinifyEnabled = false
        }
        getByName("release") {
            isMinifyEnabled = false
            // If signing secrets are absent, do not automatically sign using debug.
            // The release workflow refuses to build without the private keystore.
            if (!System.getenv("SATORI_ANDROID_KEYSTORE_FILE").isNullOrBlank()) {
                signingConfig = signingConfigs.getByName("satoriRelease")
            }
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
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("com.google.android.gms:play-services-auth:22.0.0")
    implementation("com.google.firebase:firebase-messaging:24.1.2")
    implementation("androidx.credentials:credentials:1.6.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.6.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
