import {
  ReactNode,
  createContext,
  useCallback,
  useEffect,
  useState,
  useRef,
  useContext,
} from "react";
import { Event, Filter } from "nostr-tools";
import { dataLayer, type ObserveHandle } from "@formstr/local-relay";
import { collectOnce } from "../dataLayer/collect";
import { useRelays } from "../hooks/useRelays";
import { useUserContext } from "../hooks/useUserContext";

const NOTIF_STORAGE_KEY_PREFIX = `pollerama:notifications:lastSeen`;
const DEFAULT_LOOKBACK_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

interface NotificationsContextInterface {
  notifications: Map<string, Event>;
  unreadCount: number;
  isLoading: boolean;

  markAllAsRead: () => void;
  markAsRead: (id: string) => void;
  refresh: () => void;
  seedFromCache: (events: Event[]) => void;

  lastSeen: number | null;
  pollMap: Map<string, Event>;
}

export const NostrNotificationsContext =
  createContext<NotificationsContextInterface | null>(null);

export function NostrNotificationsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = useUserContext();
  const { relays } = useRelays();

  const hasStarted = useRef(false);
  const subHandleRef = useRef<ObserveHandle | null>(null);
  const [notifications, setNotifications] = useState<Map<string, Event>>(
    new Map()
  );
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastSeen, setLastSeen] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref so pushNotification always reads the current value without stale closure issues
  const lastSeenRef = useRef<number | null>(null);
  // Track the highest created_at we've seen so refresh knows where to start from
  const latestNotifTsRef = useRef<number>(0);

  // Reset notification state only when the active user changes (not on relay changes).
  // The subscription cleanup must NOT clear notifications — relay updates trigger cleanup
  // and re-subscription, and clearing there causes the visible flash/blank screen.
  const prevNotifPubkeyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevNotifPubkeyRef.current;
    const next = user?.pubkey;
    if (prev !== undefined && prev !== next) {
      setNotifications(new Map());
      setUnreadCount(0);
      setIsLoading(true);
      pollMap.current.clear();
      latestNotifTsRef.current = 0;
      lastSeenRef.current = null;
    }
    prevNotifPubkeyRef.current = next;
  }, [user?.pubkey]); // eslint-disable-line react-hooks/exhaustive-deps

  const pollMap = useRef<Map<string, Event>>(new Map());

  //
  // ────────────────────────────────────────────────────────────
  // load/save lastSeen
  // ────────────────────────────────────────────────────────────
  //
  const loadLastSeen = (pubkey: string) => {
    const stored = localStorage.getItem(
      `${NOTIF_STORAGE_KEY_PREFIX}:${pubkey}`
    );
    if (stored) {
      const n = Number(stored);
      return isNaN(n) ? null : n;
    }
    return null;
  };

  const saveLastSeen = (pubkey: string, ts: number) => {
    localStorage.setItem(
      `${NOTIF_STORAGE_KEY_PREFIX}:${pubkey}`,
      ts.toString()
    );
  };

  //
  // ────────────────────────────────────────────────────────────
  // Add notification
  // ────────────────────────────────────────────────────────────
  //
  // Bulk-seed from Android Worker payloads so the UI renders before relays return.
  const seedFromCache = useCallback((events: Event[]) => {
    if (!events.length) return;
    setNotifications((prev) => {
      const next = new Map(prev);
      let bumpedUnread = 0;
      for (const ev of events) {
        if (ev.pubkey === user?.pubkey) continue;
        if (next.has(ev.id)) continue;
        next.set(ev.id, ev);
        if (ev.created_at > latestNotifTsRef.current) {
          latestNotifTsRef.current = ev.created_at;
        }
        if (!lastSeenRef.current || ev.created_at > lastSeenRef.current) {
          bumpedUnread++;
        }
      }
      if (bumpedUnread > 0) setUnreadCount((c) => c + bumpedUnread);
      return next;
    });
    // Seeded data means the user has something to look at — drop the spinner.
    setIsLoading(false);
  }, [user?.pubkey]);

  const pushNotification = useCallback((event: Event) => {
    // Don't notify about your own activity
    if (event.pubkey === user?.pubkey) return;

    if (event.created_at > latestNotifTsRef.current) {
      latestNotifTsRef.current = event.created_at;
    }

    setNotifications((prev) => {
      if (prev.has(event.id)) return prev;
      const next = new Map(prev);
      next.set(event.id, event);
      return next;
    });

    // Read from ref so this callback never goes stale regardless of when it was created
    if (!lastSeenRef.current || event.created_at > lastSeenRef.current) {
      setUnreadCount((c) => c + 1);
    }
  }, [user?.pubkey]); // eslint-disable-line react-hooks/exhaustive-deps

  //
  // ────────────────────────────────────────────────────────────
  // Fetch my polls once on mount
  // ────────────────────────────────────────────────────────────
  //
  const fetchPollIds = useCallback(async (pubkey: string): Promise<void> => {
    // collectOnce keeps the interest open across the worker's upstream fetch
    // (the local EOSE fires first and would resolve this empty).
    const events = await collectOnce([
      { kinds: [1068], authors: [pubkey], limit: 1000 },
    ]);
    for (const event of events) pollMap.current.set(event.id, event);
  }, []);

  //
  // ────────────────────────────────────────────────────────────
  // Build filters AFTER pollIds are known
  // ────────────────────────────────────────────────────────────
  //
  const buildFilters = (pubkey: string, since: number): Filter[] => {
    const pollIdArray = Array.from(pollMap.current.keys());
    const filters: Filter[] = [
      // known notification kinds that tag the user:
      // 1=note/reply, 6=repost, 7=reaction, 16=generic-repost,
      // 1018=poll-vote (#p path for new votes), 1068=poll,
      // 1111=NIP-22 comment, 9735=zap, 9802=highlight, 30023=article
      {
        kinds: [1, 6, 7, 16, 1018, 1068, 1111, 9735, 9802, 30023],
        since,
        "#p": [pubkey],
      },
    ];
    // poll responses via #e (catches old votes that predate the #p tag)
    if (pollIdArray.length > 0) {
      filters.push({
        kinds: [1018],
        since,
        "#e": pollIdArray,
      });
    }
    return filters;
  };

  //
  // ────────────────────────────────────────────────────────────
  // Main subscription
  // ────────────────────────────────────────────────────────────
  //
  useEffect(() => {
    if (!user?.pubkey) return;
    if (!relays || relays.length === 0) return;
    if (hasStarted.current) return;

    hasStarted.current = true;
    let isCancelled = false;

    (async () => {
      // 1. load last seen — update ref first so pushNotification sees it immediately
      const stored = loadLastSeen(user.pubkey);
      // Always look back the full window so users can revisit old notifications.
      // lastSeen only controls the unread badge, not what's fetched.
      const since = Math.floor((Date.now() - DEFAULT_LOOKBACK_MS) / 1000);

      lastSeenRef.current = stored;
      setLastSeen(stored);

      // 2. fetch pollIds
      await fetchPollIds(user.pubkey);

      // 3. subscribe only after pollIds exist
      const filters = buildFilters(user.pubkey, since);

      if (isCancelled) return;
      subHandleRef.current = dataLayer.observe(filters, {
        onEvent: (event: Event) => {
          pushNotification(event);
        },
        onEose: () => {
          setIsLoading(false);
          if (loadingTimerRef.current) {
            clearTimeout(loadingTimerRef.current);
            loadingTimerRef.current = null;
          }
        },
      });

      // Safety: relays that never send EOSE shouldn't leave the page in a
      // forever-loading state.
      loadingTimerRef.current = setTimeout(() => setIsLoading(false), 6000);
    })();

    return () => {
      isCancelled = true;
      subHandleRef.current?.unobserve();
      subHandleRef.current = null;
      hasStarted.current = false;
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
      // State (notifications, counts, pollMap) is intentionally NOT cleared here.
      // Relay changes trigger this cleanup and re-subscribe — clearing here causes
      // the visible flash. The user-change effect above handles clearing on logout/switch.
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, relays, fetchPollIds]); // pushNotification intentionally omitted — stable useCallback with no deps

  //
  // ────────────────────────────────────────────────────────────
  // Foreground recovery on visibility change (handles mobile WS drops)
  //
  // The worker owns the connections; the app can only *tell* it the tab
  // became visible again (it can't observe page visibility itself).
  // ────────────────────────────────────────────────────────────
  //
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        dataLayer.resume();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  //
  // ────────────────────────────────────────────────────────────
  // Refresh — one-shot catch-up fetch since the last event we saw
  // ────────────────────────────────────────────────────────────
  //
  const refresh = useCallback(() => {
    if (!user?.pubkey || !relays.length) return;
    const since = latestNotifTsRef.current > 0
      ? latestNotifTsRef.current
      : Math.floor((Date.now() - DEFAULT_LOOKBACK_MS) / 1000);
    const filters = buildFilters(user.pubkey, since);
    // Keep the interest open so the worker's upstream catch-up streams in via
    // onEvent (local EOSE precedes it); close after the window below.
    const handle = dataLayer.observe(filters, {
      onEvent: pushNotification,
    });
    setTimeout(() => handle.unobserve(), 10_000);
  }, [user?.pubkey, relays, pushNotification]); // eslint-disable-line react-hooks/exhaustive-deps

  //
  // ────────────────────────────────────────────────────────────
  // Mark read logic
  // ────────────────────────────────────────────────────────────
  //
  const markAllAsRead = () => {
    if (!user) return;
    const ts = Math.floor(Date.now() / 1000);
    lastSeenRef.current = ts;
    setLastSeen(ts);
    saveLastSeen(user.pubkey, ts);
    setUnreadCount(0);
  };

  const markAsRead = (id: string) => {
    if (!user) return;

    const event = notifications.get(id);
    if (!event) return;

    if (lastSeen && event.created_at <= lastSeen) return;

    const nextLastSeen = event.created_at;
    lastSeenRef.current = nextLastSeen;
    setLastSeen(nextLastSeen);
    saveLastSeen(user.pubkey, nextLastSeen);

    const unread = Array.from(notifications.values()).filter(
      (ev) => ev.created_at > nextLastSeen
    ).length;

    setUnreadCount(unread);
  };

  return (
    <NostrNotificationsContext.Provider
      value={{
        notifications,
        unreadCount,
        isLoading,
        markAllAsRead,
        markAsRead,
        refresh,
        seedFromCache,
        lastSeen,
        pollMap: pollMap.current,
      }}
    >
      {children}
    </NostrNotificationsContext.Provider>
  );
}

export const useNostrNotifications = () =>
  useContext(NostrNotificationsContext)!;
