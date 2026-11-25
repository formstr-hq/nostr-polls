# Android App Links

Pollerama uses **Android App Links** so a click on `https://pollerama.fun/...`
opens the installed app instead of the browser. There is no custom prompt or
`intent://` URL involved: Android verifies the site against the signing
certificate and hands the https URL to the app.

## How it fits together

| Piece | Where |
| --- | --- |
| `https://` intent filter + `android:autoVerify` | `android/app/src/main/AndroidManifest.xml` |
| Certificate proof for Android | `public/.well-known/assetlinks.json` (served at `https://pollerama.fun/.well-known/assetlinks.json`) |
| URL → in-app route mapping | `src/utils/appLinks.ts` (`resolveAppLink`) |
| OS listener (`appUrlOpen` / `getLaunchUrl`) | `src/hooks/useAndroidNotifications.ts` |
| Certificate generator / release gate | `scripts/assetlinks.mjs` |

When Android opens the app it loads the local bundle at `https://localhost/`
and Capacitor delivers the original URL to the JS layer. `resolveAppLink` turns
that URL into a normal React Router path, so any web route works in the app:

- `/note/<nevent>`
- `/respond/<nevent>`, `/result/<id>`
- `/profile/<npub>`
- `/feeds/articles/<naddr>`
- `/feeds/music/...`, `/feeds/movies/...`, `/feeds/topics/<tag>`,
  `/feeds/follow-packs/<naddr>`, `/feeds/games/...`
- `/messages/<npub>`, `/notifications`, `/settings`

The `?acct=<hex>` parameter used by background notifications switches profiles
before routing and is removed from the route.

`www.pollerama.fun` is declared as a second host. It currently serves the same
app, so the same asset links file is available there.

## The signing certificate must match

`public/.well-known/assetlinks.json` contains the SHA-256 fingerprint of the
release certificate. The committed value is:

```
A1:8C:93:B8:E6:06:42:85:7B:A9:1C:C5:F9:A2:E2:5C:1D:1F:52:FB:D9:12:92:58:AD:A6:D2:CD:84:DB:DE:4B
```

The helper reads the certificate from a signed APK (preferred), a keystore, or a
fingerprint you pass in:

```bash
# Verify the committed file against a signed release APK
yarn applinks:verify --apk android/app/build/outputs/apk/release/app-release.apk

# Regenerate after building a release APK
yarn applinks:generate --apk android/app/build/outputs/apk/release/app-release.apk

# Or straight from the keystore (passwords via env, never argv history)
ANDROID_KEYSTORE_PASSWORD=… ANDROID_KEY_ALIAS=… \
  yarn applinks:generate --keystore /path/to/release-key.jks

# Extra certificates (for example Play App Signing) can be added explicitly
yarn applinks:generate --apk <apk> --fingerprint AA:BB:…
```

The script reads the package name from `capacitor.config.ts`. Never commit a
keystore, password, or `.env` file.

## Release pipeline

Releases are cut with the shared `formstr-infra` build runner. After signing,
that runner executes the project's verification for any checked-in
`assetlinks.json`:

```bash
node scripts/assetlinks.mjs verify --apk <signed-release.apk> \
  --file <repo>/public/.well-known/assetlinks.json
```

If the APK is signed with a certificate that is not listed, the release fails
**before** it is published. This keeps the web file and the installable artifact
in sync, including when the signing key or Play App Signing certificate changes.

## Deploying

`public/.well-known/assetlinks.json` is copied into `build/` by the web build,
and `server/index.mjs` serves it explicitly with `application/json` and a short
cache lifetime. After changing it:

```bash
docker compose up -d --build
```

Do not put a redirect in front of `/.well-known/assetlinks.json`; Android fetches
the file from the exact host it is verifying. Cloudflare passes the path
through to the origin without special configuration. If a proxy cached the old
404, purge that URL after deploying.

## Testing on a device

```bash
# Force (re)verification after deploying the file or updating the app
adb shell pm verify-app-links --re-verify com.formstr.pollerama

# Should say "verified"
adb shell pm get-app-links com.formstr.pollerama

# Open a link exactly as another app would
adb shell am start -a android.intent.action.VIEW \
  -d "https://pollerama.fun/note/<nevent>"
```

Android verifies links at install time. If the app was installed before the
asset links file existed, install the next build or run the re-verify command
above. A device that has already chosen "open in browser" for this app may keep
that preference; reset it in Settings → Apps → Pollerama → Open by default →
Reset defaults.

Debug builds are signed with a different certificate, so they do not verify
against the production file. For a local end-to-end test, either install a
release-signed APK or temporarily generate the file from the debug APK with
`yarn applinks:generate --apk android/app/build/outputs/apk/debug/app-debug.apk`
and redeploy the web build — do not commit that version.

## iOS

There is no iOS project in this repository yet. If one is added, the equivalent
is a Universal Link: add the `applinks:pollerama.fun` associated-domains
entitlement and serve `https://pollerama.fun/.well-known/apple-app-site-association`
with the app's team ID and bundle ID. The URL-to-route resolver in
`src/utils/appLinks.ts` is shared by both platforms.
