package vn.minhsatori.app

import android.app.Application
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions

/**
 * No google-services.json or private credentials are shipped in source.
 * Public Firebase identifiers are CI-injected only for an explicitly enabled build.
 */
class OwnerPushApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (!OwnerPushConfig.configured) return
        if (FirebaseApp.getApps(this).isNotEmpty()) return
        FirebaseApp.initializeApp(this, FirebaseOptions.Builder()
            .setApplicationId(BuildConfig.SATORI_FCM_APP_ID)
            .setApiKey(BuildConfig.SATORI_FCM_API_KEY)
            .setProjectId(BuildConfig.SATORI_FCM_PROJECT_ID)
            .setGcmSenderId(BuildConfig.SATORI_FCM_SENDER_ID)
            .build())
    }
}

object OwnerPushConfig {
    val configured: Boolean get() =
        BuildConfig.SATORI_FCM_APP_ID.matches(Regex("^1:[0-9]+:android:[A-Za-z0-9]+$")) &&
        BuildConfig.SATORI_FCM_SENDER_ID.matches(Regex("^[0-9]{5,20}$")) &&
        BuildConfig.SATORI_FCM_PROJECT_ID.matches(Regex("^[a-z][a-z0-9-]{3,63}$")) &&
        BuildConfig.SATORI_FCM_API_KEY.startsWith("AIza")
}
