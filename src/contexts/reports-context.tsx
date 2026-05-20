import {
  createContext,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { EventTemplate } from "nostr-tools";
import { nostrRuntime, pool } from "../singletons";
import { signEvent } from "../nostr";
import { useUserContext } from "../hooks/useUserContext";
import { useRelays } from "../hooks/useRelays";

export type ReportReason =
  | "nudity"
  | "malware"
  | "profanity"
  | "illegal"
  | "spam"
  | "impersonation"
  | "other";

const WOT_THRESHOLD_KEY = "pollerama:wotReportThreshold";
const DEFAULT_WOT_THRESHOLD = 3;

interface ReportsContextInterface {
  isReportedByMe: (id: string) => boolean;
  getWoTReporters: (id: string) => Set<string>;
  reportEvent: (
    eventId: string,
    eventPubkey: string,
    reason: ReportReason,
    content?: string
  ) => Promise<void>;
  reportUser: (
    pubkey: string,
    reason: ReportReason,
    content?: string
  ) => Promise<void>;
  /** Check WoT reports by event id (#e tag) */
  requestReportCheck: (eventIds: string[]) => void;
  /** Check WoT reports by author pubkey (#p tag) */
  requestUserReportCheck: (pubkeys: string[]) => void;
  wotReportThreshold: number;
  setWotReportThreshold: (n: number) => void;
}

export const ReportsContext = createContext<ReportsContextInterface | null>(
  null
);

export function ReportsProvider({ children }: { children: ReactNode }) {
  const { user } = useUserContext();
  const { relays, writeRelays } = useRelays();

  // IDs (event ids or pubkeys) the current user has reported
  const [myReportedIds, setMyReportedIds] = useState<Set<string>>(new Set());

  // Map from id -> Set of pubkeys who reported it (from WoT)
  const [wotReports, setWotReports] = useState<Map<string, Set<string>>>(
    new Map()
  );

  const [wotReportThreshold, setWotReportThresholdState] = useState<number>(
    () =>
      Number(
        localStorage.getItem(WOT_THRESHOLD_KEY) ?? DEFAULT_WOT_THRESHOLD
      )
  );

  // Batching: event ids waiting for WoT #e report check
  const pendingCheckRef = useRef<Set<string>>(new Set());
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkedIdsRef = useRef<Set<string>>(new Set());

  // Batching: author pubkeys waiting for WoT #p report check
  const pendingUserCheckRef = useRef<Set<string>>(new Set());
  const userCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkedUserIdsRef = useRef<Set<string>>(new Set());

  const setWotReportThreshold = useCallback((n: number) => {
    localStorage.setItem(WOT_THRESHOLD_KEY, String(n));
    setWotReportThresholdState(n);
  }, []);

  // On login: fetch current user's own kind 1984 reports (so we know what
  // they've already reported without them having to report again).
  useEffect(() => {
    if (!user) {
      setMyReportedIds(new Set());
      return;
    }
    nostrRuntime
      .querySync(relays, {
        kinds: [1984],
        authors: [user.pubkey],
        limit: 500,
      })
      .then((events) => {
        const ids = new Set<string>();
        for (const event of events) {
          for (const tag of event.tags) {
            if (tag[0] === "e" || tag[0] === "p") ids.add(tag[1]);
          }
        }
        setMyReportedIds(ids);
      });
  }, [user?.pubkey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush: fetch kind 1984 events from WoT contacts for the pending batch of ids
  const flushPendingCheck = useCallback(async () => {
    const idsToCheck = Array.from(pendingCheckRef.current);
    pendingCheckRef.current = new Set();
    checkTimerRef.current = null;

    if (idsToCheck.length === 0 || !user) return;

    // Build WoT author set: follows + WoT + self
    const wotAuthors = new Set<string>();
    user.follows?.forEach((f) => wotAuthors.add(f));
    user.webOfTrust?.forEach((f) => wotAuthors.add(f));
    if (user.pubkey) wotAuthors.add(user.pubkey);

    if (wotAuthors.size === 0) return;

    const events = await nostrRuntime.querySync(relays, {
      kinds: [1984],
      authors: Array.from(wotAuthors),
      "#e": idsToCheck,
      limit: 500,
    });

    if (events.length === 0) return;

    setWotReports((prev) => {
      const next = new Map(prev);
      for (const event of events) {
        for (const tag of event.tags) {
          if (tag[0] === "e" && idsToCheck.includes(tag[1])) {
            if (!next.has(tag[1])) next.set(tag[1], new Set());
            next.get(tag[1])!.add(event.pubkey);
          }
        }
      }
      return next;
    });
  }, [user, relays]); // eslint-disable-line react-hooks/exhaustive-deps

  // Called by feed components with the IDs currently visible/loaded.
  // Batches and deduplicates requests so we never fetch the same id twice.
  const requestReportCheck = useCallback(
    (ids: string[]) => {
      if (!user) return;
      const newIds = ids.filter((id) => !checkedIdsRef.current.has(id));
      if (newIds.length === 0) return;
      newIds.forEach((id) => {
        checkedIdsRef.current.add(id);
        pendingCheckRef.current.add(id);
      });
      if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
      checkTimerRef.current = setTimeout(flushPendingCheck, 800);
    },
    [user, flushPendingCheck]
  );

  // Flush: fetch kind 1984 from WoT that tag author pubkeys (#p)
  const flushPendingUserCheck = useCallback(async () => {
    const pubkeysToCheck = Array.from(pendingUserCheckRef.current);
    pendingUserCheckRef.current = new Set();
    userCheckTimerRef.current = null;

    if (pubkeysToCheck.length === 0 || !user) return;

    const wotAuthors = new Set<string>();
    user.follows?.forEach((f) => wotAuthors.add(f));
    user.webOfTrust?.forEach((f) => wotAuthors.add(f));
    if (user.pubkey) wotAuthors.add(user.pubkey);

    if (wotAuthors.size === 0) return;

    const events = await nostrRuntime.querySync(relays, {
      kinds: [1984],
      authors: Array.from(wotAuthors),
      "#p": pubkeysToCheck,
      limit: 500,
    });

    if (events.length === 0) return;

    setWotReports((prev) => {
      const next = new Map(prev);
      for (const event of events) {
        for (const tag of event.tags) {
          if (tag[0] === "p" && pubkeysToCheck.includes(tag[1])) {
            if (!next.has(tag[1])) next.set(tag[1], new Set());
            next.get(tag[1])!.add(event.pubkey);
          }
        }
      }
      return next;
    });
  }, [user, relays]); // eslint-disable-line react-hooks/exhaustive-deps

  const requestUserReportCheck = useCallback(
    (pubkeys: string[]) => {
      if (!user) return;
      const newPubkeys = pubkeys.filter(
        (p) => !checkedUserIdsRef.current.has(p)
      );
      if (newPubkeys.length === 0) return;
      newPubkeys.forEach((p) => {
        checkedUserIdsRef.current.add(p);
        pendingUserCheckRef.current.add(p);
      });
      if (userCheckTimerRef.current) clearTimeout(userCheckTimerRef.current);
      userCheckTimerRef.current = setTimeout(flushPendingUserCheck, 800);
    },
    [user, flushPendingUserCheck]
  );

  const isReportedByMe = useCallback(
    (id: string) => myReportedIds.has(id),
    [myReportedIds]
  );

  const getWoTReporters = useCallback(
    (id: string) => wotReports.get(id) ?? new Set<string>(),
    [wotReports]
  );

  const reportEvent = useCallback(
    async (
      eventId: string,
      eventPubkey: string,
      reason: ReportReason,
      content = ""
    ) => {
      const eventTemplate: EventTemplate = {
        kind: 1984,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["e", eventId, reason],
          ["p", eventPubkey, reason],
        ],
        content,
      };
      const signed = await signEvent(eventTemplate);
      pool.publish(writeRelays, signed);
      // Optimistic: mark as reported immediately
      setMyReportedIds((prev) => new Set(Array.from(prev).concat([eventId, eventPubkey])));
    },
    [writeRelays]
  );

  const reportUser = useCallback(
    async (pubkey: string, reason: ReportReason, content = "") => {
      const eventTemplate: EventTemplate = {
        kind: 1984,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", pubkey, reason]],
        content,
      };
      const signed = await signEvent(eventTemplate);
      pool.publish(writeRelays, signed);
      setMyReportedIds((prev) => new Set(Array.from(prev).concat([pubkey])));
    },
    [writeRelays]
  );

  return (
    <ReportsContext.Provider
      value={{
        isReportedByMe,
        getWoTReporters,
        reportEvent,
        reportUser,
        requestReportCheck,
        requestUserReportCheck,
        wotReportThreshold,
        setWotReportThreshold,
      }}
    >
      {children}
    </ReportsContext.Provider>
  );
}
