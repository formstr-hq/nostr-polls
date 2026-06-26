# 1.10.0

- New Music feed: discover tracks from across Nostr and from people you follow, with a built-in player. A mini player docks at the bottom and keeps playing as you move between feeds.
- Background playback on Android: music keeps playing when you leave the app or lock the screen, with play/pause/skip controls on the lock screen and notification, plus headphone-button support.
- Volume control: set the playback volume right from the mini player, and it's remembered for next time.
- Play your own music: browse and play the audio already on your device (Android), or add local files in the browser.
- Search now finds more: full-text search across the network returns notes, profiles, and polls.

# 1.9.5

- Direct messages now arrive on time on Android: gift-wrapped DMs (which carry a randomized, sometimes back-dated timestamp) were being skipped by the background notifier, so messages could show up days late or not at all — they're now caught and notified as they land.
- DMs deliver and sync more reliably: your message inbox relays are now used specifically for messages, separate from your feed relays, so conversations stay in real time without dragging your whole feed onto a small inbox relay.
- Messages and posts that can't reach a relay are no longer lost — they're queued and re-sent automatically when the connection comes back. Network settings now show pending/failed deliveries (with a Retry button) and an online indicator.
- Tap a reaction again to remove it: react with an emoji and tapping it once more takes it back (the picker also highlights the reactions you've already added so you can clear them).
- Poll response notifications now tell you what the person chose, not just that they responded.
- Fixed not being able to tap anything above the floating create button.
- Fixed the Interests / topic feeds freezing the app while they loaded.

# 1.9.4

- Trust scores: profiles now show a "Trust score" — how many of the people you follow also follow them — surfaced as a network chip, so you can gauge a stranger at a glance.
- New "People you may know" rail: follow suggestions drawn from your web of trust (people followed by those you follow), ranked by how many of your follows follow them.
- Network settings now show your web-of-trust size and last computed time, with a button to recompute it on demand.
- Trust scores and recommendations are computed in the background by the web-of-trust worker, so they don't block the app.

# 1.9.3

- Fixed a crash on launch.
- Fixed the Home feed sometimes failing to load.

# 1.9.2

- Fixed the Home and Notes feeds (and any "Following"/"Network" view) sometimes showing nothing on launch or resume — your follow list is now cached and available instantly, independent of the sync engine.
- Notes shared inside DMs now load reliably, fetching the referenced note from relay hints even when you don't follow the author.
- New Network settings: see your relay connections, cache size, and sync state at a glance, with controls to reconnect or clear the local cache.

# 1.9.0

- New on-device relay engine: a built-in local relay now stores everything you've seen and answers the app from local cache first, so feeds, profiles, and threads load instantly — even offline — and stay in sync with the network in the background.
- All relay traffic (reads and writes) now flows through this engine off the main thread, so the app stays smooth and responsive even while it's busy syncing.
- Faster repeat visits: notes, profiles, reactions, and zaps you've already loaded come straight from local storage instead of re-fetching from relays each time.
- Fixed a Zap notification issue on Android.

# 1.8.21

- Zap notifications: you now get a push when someone zaps you, with the sats amount, on Android.
- Hold-to-zap: press and hold the zap icon to ramp the amount up — release to open the zap dialog preloaded with that amount (a quick tap still opens it at the default).
- Notifications now use people's names instead of raw keys — "Alice mentioned you", "Alice zapped you ⚡", "Alice reacted to your post" — falling back to a short key only when the profile isn't cached yet.
- Grouped reactions read more naturally: a single reactor is named ("Alice reacted to your post"), while several collapse into one "5 new reactions".

# 1.8.20

- New unified Home feed — notes, polls, and articles in a single stream — is now the default landing screen. Scope it to people you Follow or your wider Network (web of trust); replies are filtered out so it stays a feed of top-level posts.
- Movies feed now waits for relays to finish responding (EOSE) instead of cutting the batch off after a few seconds, so busy relay pools return the full set of titles.
- Topic feed tabs renamed for clarity: "Interests feed", "my topics", and "discover topics".
- Mobile sub-navigation now includes the Home feed (Following / Network), and the Notes "Discover" tab is labeled "Network".
- Theme updates: themes now carry a secondary accent color that flows through the app.

# 1.8.18

- Profiles now show your web of trust: an "In your wider network" badge and a "Followed by … you follow" row showing which people you follow also follow them.
- New notes are surfaced in the speed dial with a notification dot, and no longer pop into the feed on their own — they're buffered and dropped into their natural spot only when you tap "+N", so the feed never jumps under you.
- Global search now also finds people from your contacts and lists them first.
- Long-lived tabs that quietly lost their relay connections now reconnect automatically; the speed-dial refresh reconnects too.
- Web of trust now computes in the background with a progress indicator instead of freezing the app, and the result is cached.
- Reposting a poll now shows up in more clients, and poll reposts match the cleaner notes repost style.
- The Pollerama logo follows your theme — the wordmark uses your selected font and its colors track light/dark and the accent color.
- The selected accent color is now clearly marked in Appearance settings.
- Fixed the notes feeds not loading (and the refresh button doing nothing) when the web of trust was empty or stale.

# 1.8.15

- Movable action buttons can now snap to the vertical middle of the left/right edge, not just the corners.
- Tap the reaction emojis next to a post to open the full reactions breakdown.
- Four new color themes: Midnight, Crimson Noir, Steel Noir, and Amber Noir.
- Smarter image previews in notes — portrait images get a taller box (no more thin cropped slices), and lightbox tap-to-close behaves correctly.
- Following / Reacted / Zapped feeds keep listening after a timeout, so notes from slow or flaky relays still stream in instead of getting stuck on an empty/Retry screen.
- Emoji picker opens instantly and works offline — it now uses your device's native emojis instead of fetching them each time.

# 1.8.14

- Chat UI: emoji picker, movable action buttons, and assorted chat view fixes.
- Easier topic discovery in feeds.
- Optional "Pollerama" client tag on published events (Settings → General). Off by default.

# 1.8.13

- Fix NIP-55 (Amber) sign-in not dismissing the login modal.
- Fix login modal popping up automatically while already signed in.
- Stop external signer (Amber / NIP-46 bunker) approval prompts on cold start — signed-in users now resume silently from cached session state. Ncryptsec users still get the passphrase prompt by design.

# 1.8.11

- Replace SignerManager with @formstr/signer
- Encrypt all raw nsecs with passphrase encrypted nip-49. App doesn't store any nsec in raw form anymore.
- Fix Remote Signer flows.
- Add QR Code logins for signer.
- Prompt to sign in for logged out users when required.

# 1.8.7

- Fix stuck feeds

# 1.8.5

- Add zapped by following feed.
- Fix Account Switch issues.
- Fix notification renderer issues
- Load User Feeds from users outbox relays.

# 1.8.3

- Add Edits interoperable with Amethsyt
- Add Articles Feed
- Add articles on user profiles
- Fix profile navigation issues on follow packs feeds.

# 1.8.2

So many fixes.

- Fix Account switch behavior
- Fix zaps confirmation
- Move to more secure storage for Raw nsecs and DMs cache.
- Fix Profile click through on all pages
- Fix Rating comments and better UX.
- Fix Visibility issues in Profile and Movie Pages.

# 1.8.1

- Fix User profiles in header menu
- Add npub to profile switcher

# 1.8.0

- Add multi account support!

# 1.7.8

- Different colors for community rating vs users own rating.
- Fixed follow-pack bookmark bug.
- Fixed note referencing bugs.
- Ratings gesture now waits to hold before being activated, preventing accidental ratings while scrolling.
- Visibility uplift for some buttons.

# 1.7.7

- Add a notification customizer while replying to threads.
- Fix missing notifications and refresh notifications when visiting notif screen.

# 1.7.6

- Rating UI Uplifted
- Fix App Search
- Fix Initial Feed loading in topics, Following and Reacted Feeds.
- Move Settings to a new screen

# 1.7.5

- Add Movie Search
- Fix publish on Ratings on DMs
- Fix Stale relay connections

# 1.7.4

- Add System wide PIP.

# 1.7.3

- Fix movie feed
- Add wikidata as fallback for movie metadata.

# 1.7.2

- Notifications Cleanup: Filter user include, reposts , comments (1111)
- Fixed Zaps
- Added Unfollow
- random UI colors for new users

# 1.7.0

- Chose your own Fonts and Colors!
- Fixes slowness in loading poll results

# 1.6.1

- Websocket cleanup for mobile devices
- Better performance on lower powered device.
- Relay analyis i now more meaningful on mobile

# 1.6.0

- Add Follow Packs!
- You can now filter poll results with follow pack!
- Added Relay analysis in settings
- See which relays a post was found on!
- See details of relays published on and errors while posting notes/polls/DMs

# 1.5.2

- Make pollerama gossip compliant
- Accessibility for copy-paste is increased
- Performance Issues fixed
- Image accessibility increased

# 1.5.1

- Complete UI Overhaul
- Add NIP05 badges
- Reconnect to relays on app suspends.

# 1.4.5

- Add Reporting
- Fix Ollama issues

# 1.4.4

- Revert AI setting to ollama directly
- Fix blank page isue when person goes back from profile page

# 1.4.3

- Fix feed issues
- Fix unncessary reloads
- added relay indicator
- Added pull to refresh on all feeds

# 1.4.0

- Add PIP video player for uninterrupted 24/7 video streaming.
- Fix feed issues
- Add method to upload files

# 1.3.0

- Add Search
- Add notifications

# 1.2.15

- Bug fix: fixed an issue where the feed load interrupts reading experience.

# 1.2.11

- DM UI gets an uplift, added swipe to reply, hold to react gestures
- better UI for visibility
- Relay accept/reject feedback on new messages.
- Optimized Share with Modal
- Better Poll UI

# 1.2.0

- Added DMs
- Added share post to DMs button
- Feedback Menu UI uplift
- Various UI fixes

## 1.1.2

- Added User Profiles
- Smoothened relay interactions
- Bettered Zap Modal
- Fix Contacts

**For Users:**\
Join a community-driven platform where your voice matters—no censorship, no ads, just pure peer-to-peer interaction.

**Get Started:**

- **Web:** [pollerama.fun](pollerama.fun)
- **Android:** Available on Google Play
- **GitHub:** [](https://github.com/abh3po/nostr-polls)<https://github.com/abh3po/nostr-polls>
