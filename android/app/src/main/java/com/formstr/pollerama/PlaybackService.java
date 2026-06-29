package com.formstr.pollerama;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

import java.util.ArrayList;
import java.util.List;

// Hosts the actual audio engine. As a MediaSessionService it keeps ExoPlayer
// playing while the app is backgrounded or swiped from recents, and Media3 posts
// the media notification (with lock-screen + headset controls) for free. The
// MusicPlayback Capacitor plugin drives it; this service forwards player state
// back to the web layer through that plugin.
@OptIn(markerClass = UnstableApi.class)
public class PlaybackService extends MediaSessionService {

    private static PlaybackService instance;

    private MediaSession mediaSession;
    private ExoPlayer player;

    // The full source list (primary + fallback mirrors) for each queue item, and
    // the index of the source currently in use — ExoPlayer won't try alternate
    // URLs for a failed item on its own, so we do it manually on error.
    private final List<String[]> sourcesPerItem = new ArrayList<>();
    private final List<Integer> srcIndex = new ArrayList<>();

    private final Handler ticker = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            emitPosition();
            ticker.postDelayed(this, 1000);
        }
    };

    public static PlaybackService getInstance() {
        return instance;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;

        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build();

        player = new ExoPlayer.Builder(this)
                // Pause (don't duck-and-resume forever) on transient focus loss,
                // and stop when headphones are unplugged.
                .setAudioAttributes(audioAttributes, true)
                .setHandleAudioBecomingNoisy(true)
                .build();

        player.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                emitSync();
                if (isPlaying) startTicker();
                else stopTicker();
            }

            @Override
            public void onMediaItemTransition(@Nullable MediaItem mediaItem, int reason) {
                emitSync();
                emitPosition();
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                emitSync();
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                advanceToNextSource();
            }
        });

        PendingIntent sessionActivity = PendingIntent.getActivity(
                this,
                0,
                new Intent(this, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        mediaSession = new MediaSession.Builder(this, player)
                .setSessionActivity(sessionActivity)
                .build();

        // Register the session with the service ourselves. Media3 only attaches its
        // notification/foreground manager to a session when onGetSession fires, and
        // that only happens when a MediaController BINDS — which never occurs here,
        // since we drive the player directly via the static instance. Without this,
        // Media3 never posts the media notification nor calls startForeground(), so
        // the startForegroundService() launch misses its 5s obligation and the OS
        // kills us (ForegroundServiceDidNotStartInTimeException). The controller
        // connect path checks containment, so this is safe if one ever does bind.
        addSession(mediaSession);

        // Apply any queue the plugin staged before the service finished starting.
        MusicPlaybackPlugin.flushPending();
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }

    // Swiping the app away: keep going if music is actually playing, otherwise
    // tear the service (and its notification) down.
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (player == null || !player.getPlayWhenReady() || player.getMediaItemCount() == 0) {
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        stopTicker();
        if (mediaSession != null) {
            mediaSession.getPlayer().release();
            mediaSession.release();
            mediaSession = null;
        }
        player = null;
        instance = null;
        super.onDestroy();
    }

    // ── Commands from the plugin (all invoked on the main thread) ─────────────

    public void applyQueue(List<MediaItem> items, List<String[]> sources, int startIndex) {
        if (player == null) return;
        sourcesPerItem.clear();
        srcIndex.clear();
        for (String[] s : sources) {
            sourcesPerItem.add(s);
            srcIndex.add(0);
        }
        int start = Math.max(0, Math.min(startIndex, items.size() - 1));
        player.setMediaItems(items, start, 0L);
        player.prepare();
        player.play();
    }

    public void play() {
        if (player != null) player.play();
    }

    public void pause() {
        if (player != null) player.pause();
    }

    public void skipNext() {
        if (player != null && player.hasNextMediaItem()) player.seekToNextMediaItem();
    }

    public void skipPrev() {
        if (player != null && player.hasPreviousMediaItem()) player.seekToPreviousMediaItem();
    }

    public void seekTo(long positionMs) {
        if (player != null) player.seekTo(positionMs);
    }

    public void setVolume(float volume) {
        if (player != null) player.setVolume(Math.max(0f, Math.min(1f, volume)));
    }

    public void stopPlayback() {
        if (player != null) {
            player.stop();
            player.clearMediaItems();
        }
        sourcesPerItem.clear();
        srcIndex.clear();
        stopSelf();
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    // The current item's source failed to load — swap in its next mirror and
    // resume from the start of the track; give up only when all mirrors are spent.
    private void advanceToNextSource() {
        if (player == null) return;
        int idx = player.getCurrentMediaItemIndex();
        if (idx < 0 || idx >= sourcesPerItem.size()) {
            emitSync();
            return;
        }
        String[] sources = sourcesPerItem.get(idx);
        int next = srcIndex.get(idx) + 1;
        if (next >= sources.length) {
            emitSync();
            return;
        }
        srcIndex.set(idx, next);
        MediaItem replacement = player.getMediaItemAt(idx)
                .buildUpon()
                .setUri(Uri.parse(sources[next]))
                .build();
        player.replaceMediaItem(idx, replacement);
        player.prepare();
        player.play();
    }

    private void startTicker() {
        ticker.removeCallbacks(tick);
        ticker.post(tick);
    }

    private void stopTicker() {
        ticker.removeCallbacks(tick);
    }

    private double durationSeconds() {
        if (player == null) return 0;
        long d = player.getDuration();
        return d == C.TIME_UNSET || d < 0 ? 0 : d / 1000.0;
    }

    private double positionSeconds() {
        if (player == null) return 0;
        long p = player.getCurrentPosition();
        return p < 0 ? 0 : p / 1000.0;
    }

    private void emitSync() {
        if (player == null) return;
        MusicPlaybackPlugin.emitSync(
                player.isPlaying(),
                player.getCurrentMediaItemIndex(),
                player.hasNextMediaItem(),
                player.hasPreviousMediaItem(),
                durationSeconds());
    }

    private void emitPosition() {
        MusicPlaybackPlugin.emitPosition(positionSeconds(), durationSeconds());
    }
}
