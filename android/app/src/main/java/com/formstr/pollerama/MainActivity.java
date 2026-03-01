package com.formstr.pollerama;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Bundle;
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
        super.onCreate(savedInstanceState);
        createNotificationChannel();
        scheduleNotificationWorker();
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
