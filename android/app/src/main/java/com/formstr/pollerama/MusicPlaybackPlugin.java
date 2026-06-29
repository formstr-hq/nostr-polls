package com.formstr.pollerama;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.OptIn;
import androidx.core.content.ContextCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.util.UnstableApi;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

// The web layer's PlaybackContext talks to this on native; it owns no audio
// itself, just relays commands to PlaybackService (the ExoPlayer host) and
// forwards player state back to JS as "sync" / "position" events.
@OptIn(markerClass = UnstableApi.class)
@CapacitorPlugin(
        name = "MusicPlayback",
        permissions = {
                @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
        }
)
public class MusicPlaybackPlugin extends Plugin {

    private static MusicPlaybackPlugin instance;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    // A queue staged by setQueue() before the service had finished starting;
    // PlaybackService.onCreate() drains it via flushPending().
    private static List<MediaItem> pendingItems;
    private static List<String[]> pendingSources;
    private static int pendingStart;
    private static boolean hasPending;

    @Override
    public void load() {
        instance = this;
    }

    // Media3's MediaSessionService posts the playback notification (and promotes
    // the service to foreground) only if POST_NOTIFICATIONS is granted. On
    // Android 13+ that's a runtime grant; without it there's no media control and
    // the foreground-service start obligation is never met → the OS kills us.
    @PluginMethod
    public void ensureNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("notifications", call, "notifPermCallback");
    }

    @PermissionCallback
    private void notifPermCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(ret);
    }

    @PluginMethod
    public void setQueue(PluginCall call) {
        JSArray tracks = call.getArray("tracks");
        int startIndex = call.getInt("startIndex", 0);
        if (tracks == null) {
            call.reject("MISSING_TRACKS");
            return;
        }

        List<MediaItem> items = new ArrayList<>();
        List<String[]> sources = new ArrayList<>();
        try {
            for (int i = 0; i < tracks.length(); i++) {
                JSONObject t = tracks.getJSONObject(i);
                JSONArray srcArr = t.getJSONArray("sources");
                if (srcArr.length() == 0) continue;
                String[] s = new String[srcArr.length()];
                for (int j = 0; j < srcArr.length(); j++) s[j] = srcArr.getString(j);

                String title = t.optString("title", "");
                String artist = t.optString("artist", "");
                String image = t.optString("image", "");

                MediaMetadata.Builder meta = new MediaMetadata.Builder().setTitle(title);
                if (!artist.isEmpty()) meta.setArtist(artist);
                if (!image.isEmpty()) meta.setArtworkUri(Uri.parse(image));

                MediaItem item = new MediaItem.Builder()
                        .setMediaId(t.optString("id", title))
                        .setUri(Uri.parse(s[0]))
                        .setMediaMetadata(meta.build())
                        .build();
                items.add(item);
                sources.add(s);
            }
        } catch (Exception e) {
            call.reject("BAD_QUEUE", e);
            return;
        }

        if (items.isEmpty()) {
            call.reject("EMPTY_QUEUE");
            return;
        }

        PlaybackService svc = PlaybackService.getInstance();
        if (svc != null) {
            final List<MediaItem> fi = items;
            final List<String[]> fs = sources;
            final int start = startIndex;
            MAIN.post(() -> svc.applyQueue(fi, fs, start));
        } else {
            // Stash and boot the service; it flushes the pending queue on create.
            pendingItems = items;
            pendingSources = sources;
            pendingStart = startIndex;
            hasPending = true;
            Intent intent = new Intent(getContext(), PlaybackService.class);
            ContextCompat.startForegroundService(getContext(), intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void play(PluginCall call) {
        withService(PlaybackService::play);
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        withService(PlaybackService::pause);
        call.resolve();
    }

    @PluginMethod
    public void skipNext(PluginCall call) {
        withService(PlaybackService::skipNext);
        call.resolve();
    }

    @PluginMethod
    public void skipPrev(PluginCall call) {
        withService(PlaybackService::skipPrev);
        call.resolve();
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        double position = call.getDouble("position", 0.0);
        final long ms = (long) (position * 1000);
        withService(svc -> svc.seekTo(ms));
        call.resolve();
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        double volume = call.getDouble("volume", 1.0);
        final float v = (float) volume;
        withService(svc -> svc.setVolume(v));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        withService(PlaybackService::stopPlayback);
        call.resolve();
    }

    // ── Service ↔ plugin glue ──────────────────────────────────────────────────

    private interface ServiceAction {
        void run(PlaybackService svc);
    }

    private void withService(ServiceAction action) {
        PlaybackService svc = PlaybackService.getInstance();
        if (svc != null) MAIN.post(() -> action.run(svc));
    }

    // Called by PlaybackService.onCreate() once the player is ready.
    static void flushPending() {
        PlaybackService svc = PlaybackService.getInstance();
        if (svc == null || !hasPending) return;
        hasPending = false;
        final List<MediaItem> items = pendingItems;
        final List<String[]> sources = pendingSources;
        final int start = pendingStart;
        pendingItems = null;
        pendingSources = null;
        MAIN.post(() -> svc.applyQueue(items, sources, start));
    }

    static void emitSync(boolean playing, int index, boolean hasNext, boolean hasPrev, double duration) {
        if (instance == null) return;
        JSObject o = new JSObject();
        o.put("playing", playing);
        o.put("index", index);
        o.put("hasNext", hasNext);
        o.put("hasPrev", hasPrev);
        o.put("duration", duration);
        instance.notifyListeners("sync", o);
    }

    static void emitPosition(double position, double duration) {
        if (instance == null) return;
        JSObject o = new JSObject();
        o.put("position", position);
        o.put("duration", duration);
        instance.notifyListeners("position", o);
    }
}
