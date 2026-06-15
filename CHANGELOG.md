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
