package com.formstr.pollerama;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

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
    private static final String KEY_PENDING   = "notif_pending_ids";
    private static final String EVENT_KEY_PREFIX = "notif_event_";
    private static final int    NOTIF_DMS     = 1002;
    private static final long   TIMEOUT_SEC   = 15;
    private static final int    MAX_PER_RUN   = 20;

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

        final List<JSONObject> events = new ArrayList<>();
        final List<JSONObject> dms    = new ArrayList<>();
        CountDownLatch latch          = new CountDownLatch(1);

        OkHttpClient client = new OkHttpClient.Builder()
                .readTimeout(TIMEOUT_SEC + 2, TimeUnit.SECONDS)
                .build();

        // Kinds: 1 (notes tagging me), 7 (reactions), 9735 (zaps), 1018 (poll responses), 1059 (DM gift wraps)
        String reqMsg;
        try {
            JSONObject filter = new JSONObject();
            JSONArray kinds = new JSONArray();
            kinds.put(1); kinds.put(7); kinds.put(9735); kinds.put(1018); kinds.put(1059);
            filter.put("kinds", kinds);
            JSONArray pArr = new JSONArray();
            pArr.put(pubkey);
            filter.put("#p", pArr);
            filter.put("since", lastCheck);

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
                        // Skip events authored by the user (won't notify yourself)
                        if (pubkey.equals(event.optString("pubkey"))) return;
                        if (kind == 1059) {
                            dms.add(event);
                        } else {
                            events.add(event);
                        }
                    } else if ("EOSE".equals(type)) {
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
        SharedPreferences.Editor editor = prefs.edit();
        editor.putLong(KEY_LAST, nowSec);

        NotificationManager nm = (NotificationManager)
                getApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE);

        // Merge with any still-pending IDs (in case the user hasn't opened the app yet)
        JSONArray pending = parseJsonArray(prefs.getString(KEY_PENDING, "[]"));
        Set<String> pendingSet = new HashSet<>();
        for (int i = 0; i < pending.length(); i++) {
            String id = pending.optString(i, null);
            if (id != null) pendingSet.add(id);
        }

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT |
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);

        // Group high-volume kinds so one popular target = one notification.
        Map<String, Integer> pollResponseCounts = new HashMap<>();
        Map<String, Integer> reactionCounts = new HashMap<>();

        int posted = 0;
        for (JSONObject ev : events) {
            String eventId = ev.optString("id", null);
            if (eventId == null || eventId.isEmpty()) continue;

            // Always persist — the in-app /notifications list shows every event
            // even when we collapse OS notifications.
            editor.putString(EVENT_KEY_PREFIX + eventId, ev.toString());
            pendingSet.add(eventId);

            int kind = ev.optInt("kind", 0);

            // Poll responses + reactions: tally now, post one grouped notification per target later.
            if (kind == 1018) {
                String pollId = findFirstTagValue(ev, "e");
                if (pollId != null) {
                    Integer prev = pollResponseCounts.get(pollId);
                    pollResponseCounts.put(pollId, prev == null ? 1 : prev + 1);
                }
                continue;
            }
            if (kind == 7) {
                String postId = findFirstTagValue(ev, "e");
                if (postId != null) {
                    Integer prev = reactionCounts.get(postId);
                    reactionCounts.put(postId, prev == null ? 1 : prev + 1);
                }
                continue;
            }

            if (nm == null || posted >= MAX_PER_RUN) continue;

            String pub = ev.optString("pubkey", "");
            String content = ev.optString("content", "");
            String shortAuthor = pub.length() >= 8 ? pub.substring(0, 8) + "…" : "Someone";

            String title;
            String body = "";
            String deepLink = "nostr-polls://app/notifications";

            if (kind == 1) {
                title = shortAuthor + " mentioned you";
                body = truncate(content, 80);
                deepLink = "nostr-polls://app/note-hex/" + eventId;
            } else if (kind == 9735) {
                title = shortAuthor + " zapped you ⚡";
            } else if (kind == 6 || kind == 16) {
                title = shortAuthor + " reposted you";
                String postId = findFirstTagValue(ev, "e");
                if (postId != null) deepLink = "nostr-polls://app/note-hex/" + postId;
            } else {
                title = "New notification";
            }

            int notifId = eventIdToNotifId(eventId);
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(deepLink));
            intent.setClass(getApplicationContext(), MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            PendingIntent pi = PendingIntent.getActivity(
                    getApplicationContext(), notifId, intent, piFlags);

            NotificationCompat.Builder builder = new NotificationCompat.Builder(
                    getApplicationContext(), CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setContentTitle(title)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .setContentIntent(pi)
                    .setAutoCancel(true);
            if (!body.isEmpty()) {
                builder.setContentText(body)
                       .setStyle(new NotificationCompat.BigTextStyle().bigText(body));
            }
            nm.notify(notifId, builder.build());
            posted++;
        }

        // One notification per poll / reacted-to post, regardless of count.
        // Re-using the target-derived notif ID means subsequent runs replace the
        // previous summary instead of stacking.
        if (nm != null) {
            for (Map.Entry<String, Integer> entry : pollResponseCounts.entrySet()) {
                postGroupedNotification(
                        entry.getKey(),
                        entry.getValue(),
                        " new poll response",
                        " new poll responses",
                        "respond-hex",
                        piFlags,
                        nm);
            }
            for (Map.Entry<String, Integer> entry : reactionCounts.entrySet()) {
                postGroupedNotification(
                        entry.getKey(),
                        entry.getValue(),
                        " new reaction to your post",
                        " new reactions to your post",
                        "note-hex",
                        piFlags,
                        nm);
            }
        }

        // DM gift wraps stay as a summary — we can't decrypt them in the worker.
        if (!dms.isEmpty() && nm != null) {
            int count = dms.size();
            Intent dmIntent = new Intent(Intent.ACTION_VIEW,
                    Uri.parse("nostr-polls://app/messages"));
            dmIntent.setClass(getApplicationContext(), MainActivity.class);
            dmIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            PendingIntent dmPi = PendingIntent.getActivity(
                    getApplicationContext(), 1, dmIntent, piFlags);
            String body = count == 1 ? "You have a new message" : "You have " + count + " new messages";
            nm.notify(NOTIF_DMS, new NotificationCompat.Builder(getApplicationContext(), CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setContentTitle("Pollerama")
                    .setContentText(body)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .setContentIntent(dmPi)
                    .setAutoCancel(true)
                    .build());
        }

        // Persist the pending-ID index so the JS layer knows which keys to read.
        JSONArray pendingOut = new JSONArray();
        for (String id : pendingSet) pendingOut.put(id);
        editor.putString(KEY_PENDING, pendingOut.toString());
        editor.apply();

        return Result.success();
    }

    private void postGroupedNotification(String targetHex, int count,
                                         String singularSuffix, String pluralSuffix,
                                         String deepLinkType, int piFlags,
                                         NotificationManager nm) {
        String title = count == 1
                ? "1" + singularSuffix
                : count + pluralSuffix;
        String deepLink = "nostr-polls://app/" + deepLinkType + "/" + targetHex;
        int notifId = eventIdToNotifId(targetHex);

        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(deepLink));
        intent.setClass(getApplicationContext(), MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        PendingIntent pi = PendingIntent.getActivity(
                getApplicationContext(), notifId, intent, piFlags);

        nm.notify(notifId, new NotificationCompat.Builder(getApplicationContext(), CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build());
    }

    /** Derive a stable positive int notification ID from a hex event ID. */
    private static int eventIdToNotifId(String eventId) {
        try {
            int v = (int) (Long.parseLong(eventId.substring(0, 8), 16) & 0x7fffffffL);
            return v == 0 ? 1 : v;
        } catch (Exception e) {
            return Math.abs(eventId.hashCode()) | 1;
        }
    }

    private static String findFirstTagValue(JSONObject event, String tagName) {
        try {
            JSONArray tags = event.optJSONArray("tags");
            if (tags == null) return null;
            for (int i = 0; i < tags.length(); i++) {
                JSONArray tag = tags.optJSONArray(i);
                if (tag != null && tag.length() >= 2 && tagName.equals(tag.optString(0))) {
                    String val = tag.optString(1, null);
                    if (val != null && !val.isEmpty()) return val;
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private static String truncate(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max) + "…";
    }

    private static JSONArray parseJsonArray(String s) {
        try { return new JSONArray(s); } catch (Exception e) { return new JSONArray(); }
    }
}
