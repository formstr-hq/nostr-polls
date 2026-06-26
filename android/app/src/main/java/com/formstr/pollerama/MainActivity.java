package com.formstr.pollerama;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PictureInPictureParams;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
import androidx.work.Constraints;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import com.getcapacitor.BridgeActivity;
import java.util.concurrent.TimeUnit;

public class MainActivity extends BridgeActivity {

    private static final String CHANNEL_ID   = "pollerama_notifs";
    private static final String CHANNEL_NAME = "Pollerama Notifications";
    private static final String WORK_TAG     = "pollerama_notif_worker";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Must register before super.onCreate() so the Capacitor bridge
        // includes the plugin when it initialises.
        registerPlugin(PipPlugin.class);
        registerPlugin(SecureKeyStoragePlugin.class);
        registerPlugin(MusicLibraryPlugin.class);
        registerPlugin(MusicPlaybackPlugin.class);
        super.onCreate(savedInstanceState);
        createNotificationChannel();
        scheduleNotificationWorker();
    }

    // Android 8–11: fires when the user intentionally leaves (home button or
    // recents → switches away). Android 12+ is handled by setAutoEnterEnabled.
    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (PipPlugin.videoActive && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            PictureInPictureParams params = new PictureInPictureParams.Builder()
                    .setAspectRatio(new Rational(16, 9))
                    .build();
            enterPictureInPictureMode(params);
        }
    }

    // Tell the web layer when system PiP starts/ends so it can switch the
    // floating player to/from full-screen layout.
    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode,
                                               Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        if (PipPlugin.instance != null) {
            PipPlugin.instance.notifyPipChanged(isInPictureInPictureMode);
        }
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Background notification checks for Pollerama");
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(channel);
    }

    private void scheduleNotificationWorker() {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

        // TODO: change to 60, TimeUnit.MINUTES for production (min 15 min enforced by Android)
        PeriodicWorkRequest workRequest = new PeriodicWorkRequest.Builder(
                NotificationWorker.class,
                15, TimeUnit.MINUTES
        )
                .setConstraints(constraints)
                .addTag(WORK_TAG)
                .build();

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
                WORK_TAG,
                androidx.work.ExistingPeriodicWorkPolicy.KEEP,
                workRequest
        );
    }
}
