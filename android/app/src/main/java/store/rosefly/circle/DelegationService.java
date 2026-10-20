package store.rosefly.circle;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentResolver;
import android.content.Context;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

/**
 * Receives the site's notifications from Chrome (Trusted Web Activity notification delegation) and
 * shows them as Circle notifications. Messages use a high-importance "Messages" channel so they pop
 * up with sound and vibration. Incoming calls use a "Calls" channel that plays Circle's ringtone
 * and keeps ringing like a phone call until the call is answered, declined or missed — even while
 * the app is in the background or closed.
 */
public class DelegationService extends com.google.androidbrowserhelper.trusted.DelegationService {
    static final String CHANNEL_ID = "messages";
    /** Channel sounds are fixed once created: a new ringtone needs a new id. */
    static final String CALL_CHANNEL_ID = "calls_ringtone_v1";
    /** The server stops a call ringing after 60 seconds. */
    static final long CALL_TIMEOUT_MS = 60_000;

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel =
                new NotificationChannel(CHANNEL_ID, "Messages", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("New direct messages");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] {0, 80, 60, 80});
        channel.setShowBadge(true);
        manager.createNotificationChannel(channel);
    }

    static void ensureCallChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CALL_CHANNEL_ID) != null) return;
        NotificationChannel channel =
                new NotificationChannel(CALL_CHANNEL_ID, "Calls", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Incoming voice and video calls");
        channel.setSound(ringtone(context), new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] {0, 800, 600, 800, 600, 800});
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    static Uri ringtone(Context context) {
        return new Uri.Builder()
                .scheme(ContentResolver.SCHEME_ANDROID_RESOURCE)
                .authority(context.getPackageName())
                .appendPath(String.valueOf(R.raw.ring))
                .build();
    }

    /**
     * The service worker tags call notifications "call-<id>" and says "Incoming audio/video call";
     * Chrome passes the tag inside the platform tag.
     */
    static boolean isCall(String platformTag, Notification notification) {
        if (platformTag != null && platformTag.contains("call-")) return true;
        CharSequence text = notification.extras == null ? null : notification.extras.getCharSequence(Notification.EXTRA_TEXT);
        return text != null && text.toString().matches("Incoming (audio|video) call");
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel(this);
        ensureCallChannel(this);
    }

    @Override
    public boolean onNotifyNotificationWithChannel(
            String platformTag, int platformId, Notification notification, String channelName) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return super.onNotifyNotificationWithChannel(platformTag, platformId, notification, channelName);
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || !manager.areNotificationsEnabled()) return false;
        boolean call = isCall(platformTag, notification);
        String channelId = call ? CALL_CHANNEL_ID : CHANNEL_ID;
        if (call) ensureCallChannel(this); else ensureChannel(this);
        NotificationChannel channel = manager.getNotificationChannel(channelId);
        if (channel == null || channel.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        Notification.Builder builder = Notification.Builder.recoverBuilder(this, notification)
                .setChannelId(channelId)
                .setCategory(call ? Notification.CATEGORY_CALL : Notification.CATEGORY_MESSAGE);
        if (call) {
            builder.setTimeoutAfter(CALL_TIMEOUT_MS).setOngoing(true).setAutoCancel(true);
            // Over the lock screen, like a phone call, where Android allows it for this app.
            boolean fullScreen = Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent();
            if (fullScreen && notification.contentIntent != null) builder.setFullScreenIntent(notification.contentIntent, true);
        }
        Notification shown = builder.build();
        // Keep ringing until the notification is opened or cancelled (the site cancels it when the
        // call is answered elsewhere, declined or missed; the timeout ends it otherwise).
        if (call) shown.flags |= Notification.FLAG_INSISTENT;
        manager.notify(platformTag, platformId, shown);
        return true;
    }
}
