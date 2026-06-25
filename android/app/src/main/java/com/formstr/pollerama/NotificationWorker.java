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
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

public class NotificationWorker extends Worker {

    private static final String CHANNEL_ID    = "pollerama_notifs";
    private static final String PREFS_CAP     = "CapacitorStorage";
    private static final String KEY_PUBKEY    = "worker_pubkey";
    private static final String KEY_PUBKEYS   = "worker_pubkeys";
    private static final String KEY_RELAY     = "worker_relay";
    private static final String KEY_RELAYS    = "worker_relays";
    private static final String KEY_PROFILES  = "worker_profiles";
    private static final String KEY_LAST      = "worker_last_check";
    private static final String KEY_PENDING   = "notif_pending_ids";
    private static final String KEY_SEEN_DMS  = "worker_seen_dm_ids";
    private static final String EVENT_KEY_PREFIX = "notif_event_";
    private static final int    NOTIF_DMS     = 1002;
    private static final long   TIMEOUT_SEC   = 15;
    private static final int    MAX_PER_RUN   = 20;
    private static final int    MAX_RELAYS    = 6;
    // NIP-59 randomizes a gift wrap's created_at up to two days into the past, so
    // a freshly received DM can carry an old timestamp. Widen the 1059 `since`
    // window by this grace so backdated wraps aren't dropped by the relay filter.
    private static final long   GIFTWRAP_BACKDATE_GRACE_SEC = 2L * 24 * 60 * 60;
    // Cap on the persisted set of already-notified gift-wrap ids (cross-run DM dedup).
    private static final int    MAX_SEEN_DMS  = 300;

    public NotificationWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        SharedPreferences prefs = getApplicationContext()
                .getSharedPreferences(PREFS_CAP, Context.MODE_PRIVATE);

        // All logged-in account pubkeys. Prefer the multi-account list; fall back
        // to the single active pubkey for older installs that haven't written it.
        final Set<String> myPubkeys = new HashSet<>();
        JSONArray pubkeysArr = parseJsonArray(prefs.getString(KEY_PUBKEYS, "[]"));
        for (int i = 0; i < pubkeysArr.length(); i++) {
            String pk = pubkeysArr.optString(i, null);
            if (pk != null && !pk.isEmpty()) myPubkeys.add(pk);
        }
        if (myPubkeys.isEmpty()) {
            String single = prefs.getString(KEY_PUBKEY, null);
            if (single != null && !single.isEmpty()) myPubkeys.add(single);
        }

        // Relays to poll: the union of every account's NIP-65 read (inbox) relays,
        // written by the JS bridge. Fall back to the single active relay for older
        // installs that haven't written the list yet.
        final List<String> relayUrls = new ArrayList<>();
        JSONArray relaysArr = parseJsonArray(prefs.getString(KEY_RELAYS, "[]"));
        for (int i = 0; i < relaysArr.length() && relayUrls.size() < MAX_RELAYS; i++) {
            String url = relaysArr.optString(i, null);
            if (url != null && !url.isEmpty() && !relayUrls.contains(url)) relayUrls.add(url);
        }
        if (relayUrls.isEmpty()) {
            String single = prefs.getString(KEY_RELAY, null);
            if (single != null && !single.isEmpty()) relayUrls.add(single);
        }

        if (myPubkeys.isEmpty() || relayUrls.isEmpty()) return Result.success();

        // pubkey -> display name, bridged from the JS kind:0 profile cache. Lets us
        // show "Alice zapped you" instead of a truncated pubkey. Best-effort: any
        // author missing here falls back to a shortened pubkey.
        final Map<String, String> profileNames = new HashMap<>();
        JSONObject profilesObj = parseJsonObject(prefs.getString(KEY_PROFILES, "{}"));
        for (java.util.Iterator<String> it = profilesObj.keys(); it.hasNext(); ) {
            String pk = it.next();
            String name = profilesObj.optString(pk, null);
            if (name != null && !name.isEmpty()) profileNames.put(pk, name);
        }

        long lastCheck = prefs.getLong(KEY_LAST, System.currentTimeMillis() / 1000 - 3600);
        long nowSec    = System.currentTimeMillis() / 1000;

        // Shared across all relay sockets. Lists are synchronized for concurrent
        // appends; seenIds dedupes events that arrive from more than one relay.
        final List<JSONObject> events = Collections.synchronizedList(new ArrayList<>());
        final List<JSONObject> dms    = Collections.synchronizedList(new ArrayList<>());
        final Set<String> seenIds     = Collections.synchronizedSet(new HashSet<>());
        // One countdown per relay; await proceeds once every relay finished (or timed out).
        final CountDownLatch latch    = new CountDownLatch(relayUrls.size());

        OkHttpClient client = new OkHttpClient.Builder()
                .readTimeout(TIMEOUT_SEC + 2, TimeUnit.SECONDS)
                .build();

        // Two filters in one REQ (relays OR them):
        //  - notifications: kinds 1 (mentions), 7 (reactions), 9735 (zaps),
        //    1018 (poll responses) — a normal `since: lastCheck`.
        //  - DM gift wraps: kind 1059 — `since` widened by the NIP-59 backdating
        //    grace so backdated wraps aren't dropped. Cross-run dedup via the
        //    persisted seen-id set keeps the wider window from re-notifying.
        String reqMsg;
        try {
            JSONArray pArr = new JSONArray();
            for (String pk : myPubkeys) pArr.put(pk);

            JSONObject notifFilter = new JSONObject();
            JSONArray notifKinds = new JSONArray();
            notifKinds.put(1); notifKinds.put(7); notifKinds.put(9735); notifKinds.put(1018);
            notifFilter.put("kinds", notifKinds);
            notifFilter.put("#p", pArr);
            notifFilter.put("since", lastCheck);

            JSONObject dmFilter = new JSONObject();
            JSONArray dmKinds = new JSONArray();
            dmKinds.put(1059);
            dmFilter.put("kinds", dmKinds);
            dmFilter.put("#p", pArr);
            dmFilter.put("since", Math.max(0, lastCheck - GIFTWRAP_BACKDATE_GRACE_SEC));

            JSONArray req = new JSONArray();
            req.put("REQ");
            req.put("notif-check");
            req.put(notifFilter);
            req.put(dmFilter);
            reqMsg = req.toString();
        } catch (Exception e) {
            return Result.failure();
        }

        final String finalReqMsg = reqMsg;

        // Fan out: open one socket per relay. Each counts the latch down exactly
        // once (on EOSE, failure, or close), guarded by its own `done` flag.
        final List<WebSocket> sockets = new ArrayList<>();
        for (String url : relayUrls) {
            final AtomicBoolean done = new AtomicBoolean(false);
            Request wsRequest;
            try {
                wsRequest = new Request.Builder().url(url).build();
            } catch (Exception e) {
                latch.countDown(); // malformed URL — don't wait on it
                continue;
            }
            WebSocket ws = client.newWebSocket(wsRequest, new WebSocketListener() {
                private void finish(WebSocket webSocket) {
                    if (done.compareAndSet(false, true)) {
                        webSocket.cancel();
                        latch.countDown();
                    }
                }

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
                            String id = event.optString("id", null);
                            // Dedupe across relays.
                            if (id == null || id.isEmpty() || !seenIds.add(id)) return;
                            int kind = event.getInt("kind");
                            // Skip events authored by any of my accounts (won't notify yourself)
                            if (myPubkeys.contains(event.optString("pubkey"))) return;
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
                            finish(webSocket);
                        }
                    } catch (Exception ignored) {}
                }

                @Override
                public void onFailure(@NonNull WebSocket webSocket, @NonNull Throwable t, Response response) {
                    finish(webSocket);
                }

                @Override
                public void onClosed(@NonNull WebSocket webSocket, int code, @NonNull String reason) {
                    finish(webSocket);
                }
            });
            sockets.add(ws);
        }

        try {
            latch.await(TIMEOUT_SEC, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        for (WebSocket ws : sockets) ws.cancel();
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
        // Reactor pubkey per post, used to name the notification when a post has
        // exactly one reaction ("Alice reacted to your post").
        Map<String, String> reactionAuthor = new HashMap<>();
        // Target account (one of my pubkeys) per grouped target, so the grouped
        // notification's deep link can switch to the right account on tap.
        Map<String, String> targetAcct = new HashMap<>();

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
                    if (!targetAcct.containsKey(pollId)) {
                        targetAcct.put(pollId, findMyPubkey(ev, myPubkeys));
                    }
                }
                continue;
            }
            if (kind == 7) {
                String postId = findFirstTagValue(ev, "e");
                if (postId != null) {
                    Integer prev = reactionCounts.get(postId);
                    reactionCounts.put(postId, prev == null ? 1 : prev + 1);
                    reactionAuthor.put(postId, ev.optString("pubkey"));
                    if (!targetAcct.containsKey(postId)) {
                        targetAcct.put(postId, findMyPubkey(ev, myPubkeys));
                    }
                }
                continue;
            }

            if (nm == null || posted >= MAX_PER_RUN) continue;

            String pub = ev.optString("pubkey", "");
            String content = ev.optString("content", "");
            String shortAuthor = displayName(pub, profileNames);

            String title;
            String body = "";
            String deepLink = "nostr-polls://app/notifications";

            if (kind == 1) {
                title = shortAuthor + " mentioned you";
                body = truncate(content, 80);
                deepLink = "nostr-polls://app/note-hex/" + eventId;
            } else if (kind == 9735) {
                title = shortAuthor + " zapped you ⚡";
                String postId = findFirstTagValue(ev, "e");
                if (postId != null) deepLink = "nostr-polls://app/note-hex/" + postId;
            } else if (kind == 6 || kind == 16) {
                title = shortAuthor + " reposted you";
                String postId = findFirstTagValue(ev, "e");
                if (postId != null) deepLink = "nostr-polls://app/note-hex/" + postId;
            } else {
                title = "New notification";
            }

            // Tag the deep link with the account this notification is for so a tap
            // switches to it before navigating.
            deepLink = appendAcct(deepLink, findMyPubkey(ev, myPubkeys));

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
                        targetAcct.get(entry.getKey()),
                        piFlags,
                        nm,
                        null);
            }
            for (Map.Entry<String, Integer> entry : reactionCounts.entrySet()) {
                String postId = entry.getKey();
                int count = entry.getValue();
                // With a single reactor, name them; otherwise summarize the count.
                String singleName = count == 1
                        ? displayName(reactionAuthor.get(postId), profileNames) + " reacted to your post"
                        : null;
                postGroupedNotification(
                        postId,
                        count,
                        " reacted to your post", // unused when singleName is provided
                        " new reactions",
                        "note-hex",
                        targetAcct.get(postId),
                        piFlags,
                        nm,
                        singleName);
            }
        }

        // DM gift wraps stay as a summary — we can't decrypt them in the worker.
        // Because the 1059 `since` window is widened for backdating, the same wrap
        // can reappear across runs; dedup against the persisted seen-id set so we
        // only notify (and only count) genuinely new DMs. Insertion order is kept
        // so the set can be trimmed to its most-recent entries.
        LinkedHashSet<String> seenDmIds = new LinkedHashSet<>();
        JSONArray seenDmArr = parseJsonArray(prefs.getString(KEY_SEEN_DMS, "[]"));
        for (int i = 0; i < seenDmArr.length(); i++) {
            String id = seenDmArr.optString(i, null);
            if (id != null && !id.isEmpty()) seenDmIds.add(id);
        }

        int newDmCount = 0;
        for (JSONObject dm : dms) {
            String id = dm.optString("id", null);
            if (id == null || id.isEmpty()) continue;
            if (seenDmIds.add(id)) newDmCount++; // add() returns true only if newly seen
        }

        if (newDmCount > 0 && nm != null) {
            Intent dmIntent = new Intent(Intent.ACTION_VIEW,
                    Uri.parse("nostr-polls://app/messages"));
            dmIntent.setClass(getApplicationContext(), MainActivity.class);
            dmIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            PendingIntent dmPi = PendingIntent.getActivity(
                    getApplicationContext(), 1, dmIntent, piFlags);
            String body = newDmCount == 1 ? "You have a new message" : "You have " + newDmCount + " new messages";
            nm.notify(NOTIF_DMS, new NotificationCompat.Builder(getApplicationContext(), CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setContentTitle("Pollerama")
                    .setContentText(body)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .setContentIntent(dmPi)
                    .setAutoCancel(true)
                    .build());
        }

        // Persist the seen-DM ids, trimmed to the most recent MAX_SEEN_DMS.
        JSONArray seenOut = new JSONArray();
        int skip = Math.max(0, seenDmIds.size() - MAX_SEEN_DMS);
        int seenIdx = 0;
        for (String id : seenDmIds) {
            if (seenIdx++ < skip) continue;
            seenOut.put(id);
        }
        editor.putString(KEY_SEEN_DMS, seenOut.toString());

        // Persist the pending-ID index so the JS layer knows which keys to read.
        JSONArray pendingOut = new JSONArray();
        for (String id : pendingSet) pendingOut.put(id);
        editor.putString(KEY_PENDING, pendingOut.toString());
        editor.apply();

        return Result.success();
    }

    private void postGroupedNotification(String targetHex, int count,
                                         String singularSuffix, String pluralSuffix,
                                         String deepLinkType, String acct, int piFlags,
                                         NotificationManager nm, String singleTitle) {
        String title;
        if (count == 1) {
            // singleTitle, when supplied, is a fully-formed title (e.g. naming the
            // single actor). Otherwise fall back to the "1" + suffix form.
            title = singleTitle != null ? singleTitle : "1" + singularSuffix;
        } else {
            title = count + pluralSuffix;
        }
        String deepLink = appendAcct(
                "nostr-polls://app/" + deepLinkType + "/" + targetHex, acct);
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

    /** Return the first "p" tag value that is one of my logged-in pubkeys, else null. */
    private static String findMyPubkey(JSONObject event, Set<String> myPubkeys) {
        try {
            JSONArray tags = event.optJSONArray("tags");
            if (tags == null) return null;
            for (int i = 0; i < tags.length(); i++) {
                JSONArray tag = tags.optJSONArray(i);
                if (tag != null && tag.length() >= 2 && "p".equals(tag.optString(0))) {
                    String val = tag.optString(1, null);
                    if (val != null && myPubkeys.contains(val)) return val;
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    /** Append the target account as an `acct` query param so taps switch accounts. */
    private static String appendAcct(String deepLink, String acct) {
        if (acct == null || acct.isEmpty()) return deepLink;
        return deepLink + (deepLink.contains("?") ? "&" : "?") + "acct=" + acct;
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

    private static JSONObject parseJsonObject(String s) {
        try { return new JSONObject(s); } catch (Exception e) { return new JSONObject(); }
    }

    /** Resolve a human-readable name for an author, falling back to a short pubkey. */
    private static String displayName(String pubkey, Map<String, String> profileNames) {
        String name = profileNames.get(pubkey);
        if (name != null && !name.isEmpty()) return name;
        return pubkey != null && pubkey.length() >= 8 ? pubkey.substring(0, 8) + "…" : "Someone";
    }
}
