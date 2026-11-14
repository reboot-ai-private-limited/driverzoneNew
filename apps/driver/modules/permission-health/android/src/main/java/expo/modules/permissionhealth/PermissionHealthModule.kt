package expo.modules.permissionhealth

import android.app.NotificationManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The two grants that ring-reliability depends on and that NO JS library can read:
 *
 *   - `canUseFullScreenIntent` — from Android 14 the OS revokes USE_FULL_SCREEN_INTENT for every
 *     app that is not a dialer or alarm clock. Without it the offer posts as a plain heads-up and
 *     never wakes the screen. `checkSelfPermission` keeps answering GRANTED, so only
 *     `NotificationManager.canUseFullScreenIntent()` tells the truth.
 *   - `isDndAccessGranted` — the offer channel sets `bypassDnd`, which Android silently ignores
 *     unless the user has granted "Do Not Disturb access" in system settings.
 *
 * Both are read-only and cheap, so they are synchronous functions.
 */
class PermissionHealthModule : Module() {
  private val notificationManager: NotificationManager?
    get() = appContext.reactContext
      ?.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager

  override fun definition() = ModuleDefinition {
    Name("PermissionHealth")

    Function("canUseFullScreenIntent") {
      // Granted automatically at install below Android 14.
      if (Build.VERSION.SDK_INT < 34) return@Function true
      notificationManager?.canUseFullScreenIntent() ?: true
    }

    Function("isDndAccessGranted") {
      notificationManager?.isNotificationPolicyAccessGranted ?: false
    }
  }
}
