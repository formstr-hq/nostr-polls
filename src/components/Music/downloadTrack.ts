import { Filesystem, Directory } from "@capacitor/filesystem";
import { isAndroidNative } from "../../utils/platform";

// Audio extensions we recognise in a source URL's path, so the saved file keeps a
// sensible suffix. Blossom-hosted tracks are often `…/<sha256>` with no extension,
// in which case we default to .mp3.
const AUDIO_EXT = /\.(mp3|m4a|flac|wav|ogg|oga|aac|opus)(?:\?|#|$)/i;

const sanitize = (s: string): string =>
  s.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim() || "track";

// "Artist - Title.mp3" from the metadata, with the extension taken from the source
// URL when present (else .mp3).
const buildFilename = (url: string, title: string, artist?: string): string => {
  let ext = "mp3";
  try {
    const m = new URL(url, window.location.href).pathname.match(AUDIO_EXT);
    if (m) ext = m[1].toLowerCase();
  } catch {
    /* leave default */
  }
  const base = artist ? `${sanitize(artist)} - ${sanitize(title)}` : sanitize(title);
  return `${base}.${ext}`;
};

// Base64 (no data: prefix) of a blob — the form Capacitor Filesystem.writeFile wants.
const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // strip the "data:<mime>;base64," prefix
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

// Outcome of a download, so the caller can show the right feedback.
//   • saved  — written to disk (web: browser download; native: `location` folder)
//   • opened — handed off to the browser (CORS-blocked fetch or last-resort)
export type DownloadResult =
  | { status: "saved"; location?: string }
  | { status: "opened" };

// Save a track's audio file to the device.
//   • Native (Android): fetch the bytes and write them into the Documents folder via
//     the Capacitor Filesystem plugin.
//   • Web: fetch and trigger a real download with a proper filename.
// In both cases, if the fetch fails (e.g. CORS blocks it) we fall back to opening
// the URL so the browser can stream/save it itself.
export async function downloadTrack(
  url: string,
  title: string,
  artist?: string
): Promise<DownloadResult> {
  const filename = buildFilename(url, title, artist);

  if (isAndroidNative()) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const base64 = await blobToBase64(await res.blob());
      await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Documents,
        recursive: true,
      });
      return { status: "saved", location: "Documents" };
    } catch {
      window.open(url, "_blank");
      return { status: "opened" };
    }
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const objectUrl = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return { status: "saved" };
  } catch {
    // CORS or network failure — let the browser handle the raw URL.
    window.open(url, "_blank");
    return { status: "opened" };
  }
}
