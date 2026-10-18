package store.rosefly.circle;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;

/**
 * Receives the site's notifications from Chrome (Trusted Web Activity notification delegation) and
 * shows them as Circle notifications on a high-importance "Messages" channel, so new messages pop
 * up at the top of the screen with sound and vibration — even when the app and Chrome are closed.
 */
public class DelegationService extends com.google.androidbrowserhelper.trusted.DelegationService {
    static final String CHANNEL_ID = "messages";

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

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel(this);
    }

    @Override
    public boolean onNotifyNotificationWithChannel(
            String platformTag, int platformId, Notification notification, String channelName) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return super.onNotifyNotificationWithChannel(platformTag, platformId, notification, channelName);
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || !manager.areNotificationsEnabled()) return false;
        ensureChannel(this);
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL_ID);
        if (channel == null || channel.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        Notification shown = Notification.Builder.recoverBuilder(this, notification)
                .setChannelId(CHANNEL_ID)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .build();
        manager.notify(platformTag, platformId, shown);
        return true;
    }
}
