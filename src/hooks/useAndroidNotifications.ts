import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Preferences } from '@capacitor/preferences';
import { useNavigate } from 'react-router-dom';
import { Event, nip19 } from 'nostr-tools';
import { useNostrNotifications } from '../contexts/nostr-notification-context';
import { parseNotification } from '../components/Header/notification-utils';
import { Conversation } from '../contexts/dm-context';
import { useDMContext } from './useDMContext';
import { useUserContext } from './useUserContext';
import { useAppContext } from './useAppContext';
import { useRelays } from './useRelays';
import { initLocalNotifications, fireNotification, NotifExtra } from '../services/localNotificationService';
import { dataLayer } from '@formstr/local-relay';
import { getCachedProfiles } from '../utils/localStorage';

const NOTIF_ID_DMS = 1002;
// Cap how many relays the background worker polls — it opens one socket per relay.
const MAX_WORKER_RELAYS = 6;
// Cap how many profile names we bridge to the worker so the SharedPreferences
// blob stays small. The cache is dominated by follows / web-of-trust — exactly
// the people most likely to show up in notifications.
const MAX_WORKER_PROFILES = 1000;
const PENDING_IDS_KEY = 'notif_pending_ids';
const EVENT_KEY_PREFIX = 'notif_event_';
// Cap NIP-65 read relays per account, matching the old OutboxService budget.
const MAX_NIP65_RELAYS = 5;

/** Fetch a pubkey's NIP-65 (kind:10002) read/inbox relays via the dataLayer.
 *  Replaces the deleted OutboxService.getNip65InboxRelays — the local relay
 *  worker now owns the fetch + caching, so we just parse the "r" tags here. */
async function getNip65InboxRelays(pubkey: string): Promise<string[]> {
  const event = await dataLayer.fetchReplaceable(10002, pubkey);
  if (!event) return [];
  const read: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== 'r' || !tag[1]) continue;
    const marker = tag[2]; // "read", "write", or undefined (= both)
    if (!marker || marker === 'read') read.push(tag[1]);
  }
  return read.slice(0, MAX_NIP65_RELAYS);
}

/** Derive a stable integer notification ID from an event ID (hex string). */
function eventIdToNotifId(eventId: string): number {
  return (parseInt(eventId.slice(0, 8), 16) & 0x7fffffff) || 1;
}

/** Read events the WorkManager Worker persisted to SharedPreferences,
 *  parse them into Event[], and clear the pending index. */
async function drainPendingPayloads(): Promise<Event[]> {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const { value } = await Preferences.get({ key: PENDING_IDS_KEY });
    if (!value) return [];
    let ids: string[];
    try { ids = JSON.parse(value) as string[]; } catch { return []; }
    if (!Array.isArray(ids) || ids.length === 0) return [];

    const events: Event[] = [];
    for (const id of ids) {
      const key = `${EVENT_KEY_PREFIX}${id}`;
      const { value: json } = await Preferences.get({ key });
      if (json) {
        try { events.push(JSON.parse(json) as Event); } catch { /* skip */ }
      }
      await Preferences.remove({ key });
    }
    await Preferences.remove({ key: PENDING_IDS_KEY });
    return events;
  } catch (e) {
    console.warn('[useAndroidNotifications] drainPendingPayloads error:', e);
    return [];
  }
}

/** True if the event addresses `pubkey` via a "p" tag. The background worker
 *  collects events for every account; the in-app list only shows the active
 *  profile's, so we filter drained payloads through this before seeding. */
function eventTargetsPubkey(ev: Event, pubkey: string | undefined): boolean {
  if (!pubkey) return false;
  return ev.tags.some((t) => t[0] === 'p' && t[1] === pubkey);
}

function buildEventNotification(
  ev: Event,
  nameOf: (pubkey: string) => string
): { title: string; body: string; extra: NotifExtra } {
  if (ev.kind === 1) {
    const nevent = (() => { try { return nip19.neventEncode({ id: ev.id }); } catch { return undefined; } })();
    return {
      title: `${nameOf(ev.pubkey)} mentioned you`,
      body: ev.content ? `"${ev.content.slice(0, 80)}"` : '',
      extra: nevent ? { target: 'note', nevent } : { target: 'notifications' },
    };
  }

  if (ev.kind === 7) {
    const postId = ev.tags.find((t) => t[0] === 'e')?.[1];
    const nevent = postId ? (() => { try { return nip19.neventEncode({ id: postId }); } catch { return undefined; } })() : undefined;
    const reaction = ev.content && ev.content !== '+' ? ` ${ev.content}` : '';
    return {
      title: `${nameOf(ev.pubkey)} reacted${reaction}`.trim(),
      body: '',
      extra: nevent ? { target: 'note', nevent } : { target: 'notifications' },
    };
  }

  if (ev.kind === 9735) {
    const parsed = parseNotification(ev);
    const nevent = parsed.postId
      ? (() => { try { return nip19.neventEncode({ id: parsed.postId! }); } catch { return undefined; } })()
      : undefined;
    // Zaps are wrapped: the real sender is the zap-request author (parsed.fromPubkey),
    // not the 9735 receipt author (the zapper's wallet/LNURL service).
    const sender = parsed.fromPubkey || ev.pubkey;
    return {
      title: `${nameOf(sender)} zapped you ⚡`,
      body: parsed.sats ? `${parsed.sats} sats` : '',
      extra: nevent ? { target: 'note', nevent } : { target: 'notifications' },
    };
  }

  return {
    title: 'New notification',
    body: '',
    extra: { target: 'notifications' },
  };
}

function buildDMBody(conversations: Map<string, Conversation>, userPubkey: string | undefined): string {
  const unreadConvs = Array.from(conversations.values()).filter(c => c.unreadCount > 0);
  if (unreadConvs.length === 0) return 'New message';

  const total = unreadConvs.reduce((s, c) => s + c.unreadCount, 0);

  if (unreadConvs.length === 1) {
    const conv = unreadConvs[0];
    const otherPubkey = conv.participants.find(p => p !== userPubkey) ?? '';
    const shortKey = otherPubkey ? `${otherPubkey.slice(0, 8)}…` : 'someone';
    return `${total} new message${total > 1 ? 's' : ''} from ${shortKey}`;
  }

  return `${total} new messages from ${unreadConvs.length} people`;
}

/** Resolve the npub of the other participant if there's exactly one unread DM conversation */
function getSingleDMNpub(conversations: Map<string, Conversation>, userPubkey: string | undefined): string | undefined {
  const unreadConvs = Array.from(conversations.values()).filter(c => c.unreadCount > 0);
  if (unreadConvs.length !== 1) return undefined;
  const otherPubkey = unreadConvs[0].participants.find(p => p !== userPubkey);
  if (!otherPubkey) return undefined;
  try { return nip19.npubEncode(otherPubkey); } catch { return undefined; }
}

function encodeHexToNevent(hex: string): string | undefined {
  try { return nip19.neventEncode({ id: hex }); } catch { return undefined; }
}

/** Pull a human-readable name out of a kind:0 content blob. */
function profileName(content: string): string | undefined {
  try {
    const meta = JSON.parse(content) as { display_name?: string; name?: string };
    const name = (meta.display_name || meta.name || '').trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}

/** Pull the `acct` (hex pubkey) query param a notification deep link may carry. */
function extractAcct(url: string): string | undefined {
  const q = url.indexOf('?');
  if (q === -1) return undefined;
  const acct = new URLSearchParams(url.slice(q + 1)).get('acct');
  return acct || undefined;
}

/** Strip the query string so the existing path matching below stays simple. */
function stripQuery(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

async function handleDeepLink(
  rawUrl: string,
  navigate: ReturnType<typeof useNavigate>,
  switchToAccount?: (pubkey: string) => Promise<void>
) {
  const acct = extractAcct(rawUrl);
  if (acct && switchToAccount) {
    await switchToAccount(acct).catch((e) =>
      console.warn('[useAndroidNotifications] switchAccount on deep link failed:', e)
    );
  }
  const url = stripQuery(rawUrl);
  if (url.includes('/messages/')) {
    const npub = url.split('/messages/')[1];
    navigate(`/messages/${npub}`);
  } else if (url.includes('/messages')) {
    navigate('/messages');
  } else if (url.includes('/respond-hex/')) {
    const hex = url.split('/respond-hex/')[1];
    const nevent = encodeHexToNevent(hex);
    navigate(nevent ? `/respond/${nevent}` : '/notifications');
  } else if (url.includes('/respond/')) {
    const nevent = url.split('/respond/')[1];
    navigate(`/respond/${nevent}`);
  } else if (url.includes('/note-hex/')) {
    const hex = url.split('/note-hex/')[1];
    const nevent = encodeHexToNevent(hex);
    navigate(nevent ? `/note/${nevent}` : '/notifications');
  } else if (url.includes('/note/')) {
    const nevent = url.split('/note/')[1];
    navigate(`/note/${nevent}`);
  } else if (url.includes('/notifications')) {
    navigate('/notifications');
  }
}

export function useAndroidNotifications() {
  const navigate = useNavigate();
  const { unreadCount, notifications, lastSeen, pollMap, seedFromCache } = useNostrNotifications();
  const { unreadTotal: dmUnread, conversations } = useDMContext();
  const { user, accounts, switchAccount } = useUserContext();
  const { getProfile } = useAppContext();
  const { relays } = useRelays();
  const permitted = useRef(false);
  const prevDMs    = useRef(0);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  // Stable ref to switchAccount so the worker deep-link handler (registered once)
  // can switch to the account a tapped background notification belongs to.
  const switchAccountRef = useRef(switchAccount);
  switchAccountRef.current = switchAccount;
  // Active pubkey ref so the once-registered drain can filter worker payloads to
  // the active profile (the in-app list is active-profile only).
  const userPubkeyRef = useRef(user?.pubkey);
  userPubkeyRef.current = user?.pubkey;
  // Stable ref to seedFromCache so the mount effect can call it without re-running.
  const seedFromCacheRef = useRef(seedFromCache);
  seedFromCacheRef.current = seedFromCache;
  // Track which event IDs we've already fired a notification for (per session).
  // Pre-populating with payloads hydrated from the WorkManager Worker prevents
  // us from re-firing OS notifications for events the user already saw.
  const firedEventIds = useRef(new Set<string>());
  // Per-session running tallies used to keep a single grouped OS notification
  // per target rather than one per fan-out event.
  const pollResponseCounts = useRef(new Map<string, number>());
  const reactionCounts = useRef(new Map<string, number>());

  // Resolve a display name from the live kind:0 profile cache, falling back to a
  // short pubkey. Kept in a ref so the notification effect can use the latest
  // resolver without listing it as a dependency.
  const nameOf = (pubkey: string): string => {
    const p = getProfile(pubkey);
    const n = ((p?.display_name as string) || (p?.name as string) || '').trim();
    if (n) return n;
    return pubkey ? `${pubkey.slice(0, 8)}…` : 'Someone';
  };
  const nameOfRef = useRef(nameOf);
  nameOfRef.current = nameOf;

  // Request permission + register listeners once
  useEffect(() => {
    initLocalNotifications().then(ok => {
      permitted.current = ok;
    });

    // Handle taps on JS-side local notifications (app alive/backgrounded). These
    // are only ever scheduled for the active profile, so no account switch here.
    const tapSub = LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      const extra = action.notification.extra as NotifExtra | undefined;
      if (!extra) return;
      if (extra.target === 'messages') {
        navigateRef.current('npub' in extra && extra.npub ? `/messages/${extra.npub}` : '/messages');
      } else if (extra.target === 'notifications') {
        navigateRef.current('/notifications');
      } else if (extra.target === 'respond') {
        navigateRef.current(`/respond/${extra.nevent}`);
      } else if (extra.target === 'note') {
        navigateRef.current(`/note/${extra.nevent}`);
      }
    });

    // Hydrate the notification context from any payloads the WorkManager Worker
    // wrote to SharedPreferences while the app was closed. We seed *before*
    // dispatching the launch URL so the destination screen has its data ready.
    const drainAndDeepLink = async () => {
      const events = await drainPendingPayloads();
      if (events.length) {
        // Suppress duplicate JS-side OS notifications for events already shown
        // by the Worker — for every account, not just the active one.
        for (const ev of events) firedEventIds.current.add(ev.id);
        // Only seed the active profile's events into the in-app list.
        const mine = events.filter((ev) => eventTargetsPubkey(ev, userPubkeyRef.current));
        if (mine.length) seedFromCacheRef.current(mine);
      }
      const launch = await App.getLaunchUrl();
      if (launch?.url) handleDeepLink(launch.url, navigateRef.current, switchAccountRef.current);
    };
    drainAndDeepLink();

    const urlSub = App.addListener('appUrlOpen', async ({ url }) => {
      // Re-drain in case new events landed after launch (e.g. cold-start race
      // where the user tapped a second notification).
      const events = await drainPendingPayloads();
      if (events.length) {
        for (const ev of events) firedEventIds.current.add(ev.id);
        const mine = events.filter((ev) => eventTargetsPubkey(ev, userPubkeyRef.current));
        if (mine.length) seedFromCacheRef.current(mine);
      }
      handleDeepLink(url, navigateRef.current, switchAccountRef.current);
    });

    return () => {
      tapSub.then(h => h.remove());
      urlSub.then(h => h.remove());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Bridge: save all logged-in pubkeys for the WorkManager Worker so background
  // push notifications cover every account, not just the active one. We also
  // keep `worker_pubkey` (active account) for backward compatibility.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const pubkeys = accounts.map((a) => a.pubkey);
    if (pubkeys.length === 0) return;
    Preferences.set({ key: 'worker_pubkeys', value: JSON.stringify(pubkeys) });
    if (user?.pubkey) Preferences.set({ key: 'worker_pubkey', value: user.pubkey });
  }, [accounts, user?.pubkey]);

  // Bridge: save a pubkey -> display-name map from the cached kind:0 profiles so
  // the background worker can show "Alice zapped you" instead of a raw pubkey.
  // Re-runs whenever the notification set changes, which is when the cache is most
  // likely to have been freshly warmed with the relevant authors' profiles.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const cached = getCachedProfiles();
    if (cached.length === 0) return;

    // Newest profiles first, then cap, so we keep the freshest names within budget.
    const sorted = [...cached].sort((a, b) => b.created_at - a.created_at);
    const nameMap: Record<string, string> = {};
    for (const ev of sorted) {
      if (Object.keys(nameMap).length >= MAX_WORKER_PROFILES) break;
      const name = profileName(ev.content);
      if (name) nameMap[ev.pubkey] = name;
    }
    Preferences.set({ key: 'worker_profiles', value: JSON.stringify(nameMap) });
  }, [notifications]);

  // Bridge: save the relays the WorkManager Worker should poll. We use the
  // union of every logged-in account's NIP-65 read (inbox) relays — that's where
  // notifications tagging them are expected to land (outbox model). Falls back to
  // the active read-relay set when no NIP-65 list is cached/discoverable.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const pubkeys = accounts.map((a) => a.pubkey);
    if (pubkeys.length === 0) return;

    let cancelled = false;
    (async () => {
      const union = new Set<string>();
      await Promise.all(
        pubkeys.map(async (pk) => {
          try {
            // The local relay worker caches the kind:10002 it fetches.
            const inbox = await getNip65InboxRelays(pk);
            inbox.forEach((r) => union.add(r));
          } catch (e) {
            console.warn('[useAndroidNotifications] inbox relays fetch failed:', pk, e);
          }
        })
      );
      // Fall back to the active read-relay set if nobody published a NIP-65 list.
      if (union.size === 0) relays.forEach((r) => union.add(r));
      if (cancelled || union.size === 0) return;

      // Cap to keep the background job light — it opens one socket per relay.
      const list = Array.from(union).slice(0, MAX_WORKER_RELAYS);
      Preferences.set({ key: 'worker_relays', value: JSON.stringify(list) });
      // Keep the single-relay key for backward compatibility with older worker builds.
      Preferences.set({ key: 'worker_relay', value: list[0] });
    })();

    return () => {
      cancelled = true;
    };
  }, [accounts, relays]);

  // Fire one notification per new unread event while the app is backgrounded
  useEffect(() => {
    if (!permitted.current) return;

    const unread = Array.from(notifications.values())
      .filter(ev => lastSeen === null || ev.created_at > lastSeen)
      .filter(ev => !firedEventIds.current.has(ev.id));

    for (const ev of unread) {
      // Always mark as seen so we never re-fire even if foregrounded
      firedEventIds.current.add(ev.id);

      // Only push the OS notification when the app is in the background
      if (!document.hidden) continue;

      // Fan-out kinds (poll responses, reactions): collapse into one notification
      // per target, re-firing the same notification ID with an incrementing count.
      if (ev.kind === 1018) {
        const pollId = ev.tags.find((t) => t[0] === 'e')?.[1];
        if (!pollId) continue;
        const next = (pollResponseCounts.current.get(pollId) ?? 0) + 1;
        pollResponseCounts.current.set(pollId, next);
        const pollContent = pollMap.get(pollId)?.content;
        const title = next === 1 ? 'New poll response' : `${next} new poll responses`;
        const body = pollContent ? `"${pollContent.slice(0, 80)}"` : '';
        const nevent = encodeHexToNevent(pollId);
        fireNotification(
          eventIdToNotifId(pollId),
          title,
          body,
          nevent ? { target: 'respond', nevent } : { target: 'notifications' }
        );
        continue;
      }
      if (ev.kind === 7) {
        const postId = ev.tags.find((t) => t[0] === 'e')?.[1];
        if (!postId) continue;
        const next = (reactionCounts.current.get(postId) ?? 0) + 1;
        reactionCounts.current.set(postId, next);
        const title = next === 1
          ? `${nameOfRef.current(ev.pubkey)} reacted to your post`
          : `${next} new reactions`;
        const nevent = encodeHexToNevent(postId);
        fireNotification(
          eventIdToNotifId(postId),
          title,
          '',
          nevent ? { target: 'note', nevent } : { target: 'notifications' }
        );
        continue;
      }

      const notifId = eventIdToNotifId(ev.id);
      const { title, body, extra } = buildEventNotification(ev, nameOfRef.current);
      fireNotification(notifId, title, body, extra);
    }
  }, [unreadCount, notifications, lastSeen, pollMap]);

  // Fire when new DMs arrive while backgrounded
  useEffect(() => {
    if (!permitted.current) { prevDMs.current = dmUnread; return; }
    if (dmUnread > prevDMs.current && document.hidden) {
      const npub = getSingleDMNpub(conversations, user?.pubkey);
      const extra: NotifExtra = npub ? { target: 'messages', npub } : { target: 'messages' };
      fireNotification(NOTIF_ID_DMS, 'Pollerama', buildDMBody(conversations, user?.pubkey), extra);
    }
    prevDMs.current = dmUnread;
  }, [dmUnread, conversations, user?.pubkey]);
}
