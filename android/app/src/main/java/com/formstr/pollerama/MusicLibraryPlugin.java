package com.formstr.pollerama;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

// Exposes the device's music library (MediaStore) to the web layer so the Local
// tab can auto-browse and play on-device tracks. The alias lists BOTH permissions
// so requesting it works across versions: Android 13+ grants READ_MEDIA_AUDIO and
// ignores the legacy one; Android 12- grants READ_EXTERNAL_STORAGE and ignores
// READ_MEDIA_AUDIO (which doesn't exist there).
@CapacitorPlugin(
    name = "MusicLibrary",
    permissions = {
        @Permission(
            alias = "audio",
            strings = {
                Manifest.permission.READ_MEDIA_AUDIO,
                Manifest.permission.READ_EXTERNAL_STORAGE
            }
        )
    }
)
public class MusicLibraryPlugin extends Plugin {

    // The permission that actually governs audio reads on this OS version.
    private String requiredPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? Manifest.permission.READ_MEDIA_AUDIO
                : Manifest.permission.READ_EXTERNAL_STORAGE;
    }

    private boolean hasAudioPermission() {
        return getContext().checkSelfPermission(requiredPermission())
                == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasAudioPermission());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (hasAudioPermission()) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("audio", call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasAudioPermission());
        call.resolve(ret);
    }

    @PluginMethod
    public void getTracks(PluginCall call) {
        if (!hasAudioPermission()) {
            call.reject("PERMISSION_DENIED");
            return;
        }

        JSArray tracks = new JSArray();
        ContentResolver resolver = getContext().getContentResolver();
        Uri collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
        String[] projection = {
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.ALBUM_ID,
            MediaStore.Audio.Media.DURATION,
        };
        String selection = MediaStore.Audio.Media.IS_MUSIC + " != 0";
        String sortOrder = MediaStore.Audio.Media.TITLE + " ASC";

        try (Cursor cursor = resolver.query(collection, projection, selection, null, sortOrder)) {
            if (cursor != null) {
                int idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
                int titleCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
                int artistCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
                int albumCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM);
                int albumIdCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID);
                int durCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);

                // The albumart provider exposes embedded cover art as a content://
                // URI keyed by album id; not every album has one, so the web layer
                // falls back to a placeholder when it fails to load.
                Uri albumArtBase = Uri.parse("content://media/external/audio/albumart");

                while (cursor.moveToNext()) {
                    long id = cursor.getLong(idCol);
                    long albumId = cursor.getLong(albumIdCol);
                    Uri contentUri = ContentUris.withAppendedId(collection, id);
                    JSObject t = new JSObject();
                    t.put("id", String.valueOf(id));
                    t.put("title", cursor.getString(titleCol));
                    t.put("artist", cursor.getString(artistCol));
                    t.put("album", cursor.getString(albumCol));
                    t.put("durationMs", cursor.getLong(durCol));
                    t.put("uri", contentUri.toString());
                    if (albumId > 0) {
                        t.put("artworkUri", ContentUris.withAppendedId(albumArtBase, albumId).toString());
                    }
                    tracks.put(t);
                }
            }
        } catch (Exception e) {
            call.reject("QUERY_FAILED", e);
            return;
        }

        JSObject ret = new JSObject();
        ret.put("tracks", tracks);
        call.resolve(ret);
    }
}
