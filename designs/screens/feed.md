# Screen — Feed (Home / Polls / Notes / Topics / Bookmarks / Articles)

Layout: top bar → sub-feed pills (sticky) → virtualized list (`react-virtuoso`) → bottom nav + FAB.
- Pull-to-refresh at top of list; top-bar shows a 2dp indeterminate progress line while refreshing/updating cached data.
- "N new" pill floats centered under the pills when new items arrived while scrolled; tap scrolls to top.
- Items per `05-components.md` (Post item / Poll item), 1px dividers, no card chrome.
- Home mixes kinds: each item type renders its own variant but shares `FeedItemShell` header/footer.
- Topics: pills = Interests / My topics / Discover; Discover shows `HashtagCard` as horizontal chip-rows with follow toggle; tag detail (`TopicExplorer`) keeps its nested route.
- Articles: item = 16:9 cover (radius sm), title (`title`), 2-line summary, author · read time. Detail: 680 max column, `body` 17/28, sticky slim progress bar.
- Packs: item = overlapping avatars (`OverlappingAvatars`), title, count, Follow-all pill.
- Empty: logo mark + "Nothing here yet" + context action (e.g. "Follow people" for Following).
