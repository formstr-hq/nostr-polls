package com.formstr.pollerama;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

public class NotificationWorker extends Worker {

    private static final String CHANNEL_ID    = "pollerama_notifs";
    private static final String PREFS_CAP     = "CapacitorStorage";
    private static final String KEY_PUBKEY    = "worker_pubkey";
    private static final String KEY_RELAY     = "worker_relay";
    private static final String KEY_LAST      = "worker_last_check";
    private static final int    NOTIF_EVENTS  = 1001;
    private static final int    NOTIF_DMS     = 1002;
    private static final long   TIMEOUT_SEC   = 15;

    public NotificationWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        SharedPreferences prefs = getApplicationContext()
                .getSharedPreferences(PREFS_CAP, Context.MODE_PRIVATE);

        String pubkey = prefs.getString(KEY_PUBKEY, null);
        String relay  = prefs.getString(KEY_RELAY, null);
        if (pubkey == null || relay == null) return Result.success();

        long lastCheck = prefs.getLong(KEY_LAST, System.currentTimeMillis() / 1000 - 3600);
        long nowSec    = System.currentTimeMillis() / 1000;

        AtomicInteger dmCount    = new AtomicInteger(0);
        AtomicInteger eventCount = new AtomicInteger(0);
        CountDownLatch latch     = new CountDownLatch(1);

        OkHttpClient client = new OkHttpClient.Builder()
                .readTimeout(TIMEOUT_SEC + 2, TimeUnit.SECONDS)
                .build();

        // Build REQ message
        // Kinds: 1 (notes tagging me), 7 (reactions), 9735 (zaps), 1018 (poll responses), 1059 (DM gift wraps)
        String reqMsg;
        try {
            JSONArray filterArr = new JSONArray();
            JSONObject filter = new JSONObject();
            JSONArray kinds = new JSONArray();
            kinds.put(1); kinds.put(7); kinds.put(9735); kinds.put(1018); kinds.put(1059);
            filter.put("kinds", kinds);
            JSONArray pArr = new JSONArray();
            pArr.put(pubkey);
            filter.put("#p", pArr);
            filter.put("since", lastCheck);
            filterArr.put(filter);

            JSONArray req = new JSONArray();
            req.put("REQ");
            req.put("notif-check");
            req.put(filter);
            reqMsg = req.toString();
        } catch (Exception e) {
            return Result.failure();
        }

        final String finalReqMsg = reqMsg;

        Request wsRequest = new Request.Builder().url(relay).build();
        WebSocket ws = client.newWebSocket(wsRequest, new WebSocketListener() {
            @Override
            public void onOpen(@NonNull WebSocket webSocket, @NonNull Response response) {
                webSocket.send(finalReqMsg);
            }

            @Override
            public void onMessage(@NonNull WebSocket webSocket, @NonNull String text) {
                try {
                    JSONArray msg = new JSONArray(text);
                    String type = msg.getString(0);
                    if ("EVENT".equals(type) && msg.length() >= 3) {
                        JSONObject event = msg.getJSONObject(2);
                        int kind = event.getInt("kind");
                        if (kind == 1059) {
                            dmCount.incrementAndGet();
                        } else {
                            eventCount.incrementAndGet();
                        }
                    } else if ("EOSE".equals(type)) {
                        // Send CLOSE then release latch
                        JSONArray close = new JSONArray();
                        close.put("CLOSE");
                        close.put("notif-check");
                        webSocket.send(close.toString());
                        webSocket.close(1000, null);
                        latch.countDown();
                    }
                } catch (Exception ignored) {}
            }

            @Override
            public void onFailure(@NonNull WebSocket webSocket, @NonNull Throwable t, Response response) {
                latch.countDown();
            }

            @Override
            public void onClosed(@NonNull WebSocket webSocket, int code, @NonNull String reason) {
                latch.countDown();
            }
        });

        try {
            latch.await(TIMEOUT_SEC, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        ws.cancel();
        client.dispatcher().executorService().shutdown();

        // Save last check timestamp
        prefs.edit().putLong(KEY_LAST, nowSec).apply();

        // PendingIntent that launches MainActivity when notification is tapped
        Intent launchIntent = new Intent(getApplicationContext(), MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT |
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent launchPi = PendingIntent.getActivity(
                getApplicationContext(), 0, launchIntent, piFlags);

        // Post notifications
        NotificationManager nm = (NotificationManager)
                getApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE);

        if (nm != null) {
            int dms = dmCount.get();
            if (dms > 0) {
                String body = dms == 1 ? "You have a new message" : "You have " + dms + " new messages";
                nm.notify(NOTIF_DMS, new NotificationCompat.Builder(getApplicationContext(), CHANNEL_ID)
                        .setSmallIcon(R.drawable.ic_notification)
                        .setContentTitle("Pollerama")
                        .setContentText(body)
                        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                        .setContentIntent(launchPi)
                        .setAutoCancel(true)
                        .build());
            }

            int events = eventCount.get();
            if (events > 0) {
                String body = events == 1 ? "You have a new notification" : "You have " + events + " new notifications";
                nm.notify(NOTIF_EVENTS, new NotificationCompat.Builder(getApplicationContext(), CHANNEL_ID)
                        .setSmallIcon(R.drawable.ic_notification)
                        .setContentTitle("Pollerama")
                        .setContentText(body)
                        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                        .setContentIntent(launchPi)
                        .setAutoCancel(true)
                        .build());
            }
        }

        return Result.success();
    }
}
