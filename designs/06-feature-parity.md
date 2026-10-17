# 06 — Feature parity checklist

Every item must exist and work after each migration step. Tick in the PR description.

## Navigation / shell
- [ ] 10 feeds reachable: Home, Polls, Topics, Notes, Articles, Music, Movies, Packs, Bookmarks, Games
- [ ] All sub-modes: Home(Following/Network); Polls(Global/Following/Web of Trust); Notes(Network/Following/Reacted/Zapped); Topics(Interests/My topics/Discover); Articles/Bookmarks(Global/Following/Bookmarked); Packs(Global/Following); Music(Discover/Following/Local)
- [ ] Sub-mode persistence across launches (`FEED_STORAGE_KEYS`) and `pollerama:lastFeed`
- [ ] Search modal incl. Ctrl/⌘+K
- [ ] Notification bell + page; DM badge; messages list/new/chat
- [ ] Multi-account switch / add account / log out; Profile, Contacts, Settings, Drafts entries
- [ ] Create FAB with all creation types; Create route `/create`
- [ ] Pull-to-refresh, cached first paint, virtualized lists, scroll restoration (`FeedScrollContext`)
- [ ] Update banner; Android safe areas/edge-to-edge; back-button closes overlays (`useBackClose`)
- [ ] Sidebar collapse (desktop)

## Content
- [ ] Polls: create, vote, results, response tracking, all poll types
- [ ] Notes: create, thread/depth, quote, repost, like/react (emoji), zap, bookmark, share, translate, report, mute, broadcast, relay sources, JSON view
- [ ] Articles list + detail (markdown)
- [ ] Follow packs list + detail
- [ ] Topics explorer + hashtag cards
- [ ] Movies list/detail + metadata modal + ratings
- [ ] Music: discover, playlists (own/shared/following/local), mini-player, downloads, add-to-playlist
- [ ] Games: 2048, Tetris, Racer, leaderboards, share score
- [ ] Profile page tabs, edit profile, followers, who-to-follow, NIP-05 badge
- [ ] Private notes, drafts + autosave
- [ ] Floating video player (draggable)

## Settings / theming
- [ ] 8 color presets + custom primary/secondary
- [ ] 5 font options incl. System; runtime switching
- [ ] Light / dark / system (`pollerama-color-scheme`); OLED black dark
- [ ] Relay list editor, relay health, Blossom, AI, Moderation, Notifications, General, feedback menu
- [ ] Local relay / NIP-46 / NIP-55 login flows

## Feel (reject the PR if any fail)
- [ ] Buttons are pills
- [ ] Brand font + preset colors visible on nav, FAB, tabs, links
- [ ] Feed is un-boxed
- [ ] Warm light bg / pure-black dark bg
