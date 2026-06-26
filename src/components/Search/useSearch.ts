import { useState, useEffect, useMemo } from "react";
import { nip19, nip05, Event } from "nostr-tools";
import { dataLayer } from "@formstr/local-relay";
import { searchRelays } from "../../nostr";
import { useUserContext } from "../../hooks/useUserContext";
import { useAppContext } from "../../hooks/useAppContext";

export type InputType = "idle" | "nip19" | "nip05" | "hashtag" | "text";

export interface Nip19Result {
  type: string;
  data: any;
  original: string; // stripped of nostr: prefix
}

export interface SearchResults {
  profiles: Event[];
  notes: Event[];
  polls: Event[];
}

export interface UseSearchReturn {
  query: string;
  setQuery: (q: string) => void;
  inputType: InputType;
  nip19Result: Nip19Result | null;
  nip05Pubkey: string | null;
  nip05Loading: boolean;
  results: SearchResults;
  loading: boolean;
  error: string | null;
  searchedRelays: string[];
}

const NIP05_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NIP19_PREFIXES = ["npub1", "note1", "nevent1", "nprofile1", "naddr1"];

function stripNostrPrefix(input: string): string {
  return input.startsWith("nostr:") ? input.slice(6) : input;
}

function tryDecodeNip19(raw: string): Nip19Result | null {
  const stripped = stripNostrPrefix(raw.trim());
  if (!NIP19_PREFIXES.some((p) => stripped.toLowerCase().startsWith(p))) {
    return null;
  }
  try {
    const decoded = nip19.decode(stripped);
    return { type: decoded.type, data: decoded.data, original: stripped };
  } catch {
    return null;
  }
}

export function detectInputType(raw: string): InputType {
  const trimmed = raw.trim();
  if (!trimmed) return "idle";

  const stripped = stripNostrPrefix(trimmed);
  if (NIP19_PREFIXES.some((p) => stripped.toLowerCase().startsWith(p))) {
    return "nip19";
  }
  if (trimmed.startsWith("#") && trimmed.length > 1) return "hashtag";
  if (NIP05_REGEX.test(trimmed)) return "nip05";
  return "text";
}

const EMPTY_RESULTS: SearchResults = { profiles: [], notes: [], polls: [] };

export function useSearch(): UseSearchReturn {
  const [query, setQuery] = useState("");
  const [inputType, setInputType] = useState<InputType>("idle");
  const [nip19Result, setNip19Result] = useState<Nip19Result | null>(null);
  const [nip05Pubkey, setNip05Pubkey] = useState<string | null>(null);
  const [nip05Loading, setNip05Loading] = useState(false);
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedRelays, setSearchedRelays] = useState<string[]>([]);
  const { user } = useUserContext();
  const { profiles } = useAppContext();

  // Detect type and reset on every query change
  useEffect(() => {
    const type = detectInputType(query);
    setInputType(type);
    setNip19Result(null);
    setNip05Pubkey(null);
    setResults(EMPTY_RESULTS);
    setError(null);
    setSearchedRelays([]);

    if (type === "nip19") {
      setNip19Result(tryDecodeNip19(query));
    }
  }, [query]);

  // NIP-05 resolution
  useEffect(() => {
    if (inputType !== "nip05") return;
    let cancelled = false;

    setNip05Loading(true);
    setNip05Pubkey(null);

    nip05
      .queryProfile(query.trim())
      .then((profile) => {
        if (!cancelled) {
          if (profile) setNip05Pubkey(profile.pubkey);
          else setError("Could not resolve NIP-05 identifier");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not resolve NIP-05 identifier");
      })
      .finally(() => {
        if (!cancelled) setNip05Loading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query, inputType]);

  // NIP-50 free-text search (debounced 400ms).
  //
  // We STREAM rather than batch: the worker replays its local store first (so
  // already-cached notes matching the query paint immediately), then the live
  // tail brings in results from the dedicated search relays as they arrive.
  // Relay selection — routing the `search` filter to search-capable relays — is
  // the worker's job; the app just declares the interest. `matchFilter` gates on
  // the `search` field, so neither the cache replay nor a relay that ignores
  // `search` can leak unrelated events into the results.
  useEffect(() => {
    if (inputType !== "text") return;
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    let cancelled = false;
    let handle: { unobserve: () => void } | null = null;
    let stopLoading: ReturnType<typeof setTimeout> | null = null;

    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      setSearchedRelays(searchRelays);

      const byId = new Map<string, Event>();
      const commit = () => {
        if (cancelled) return;
        const events = Array.from(byId.values());
        const byNewest = (a: Event, b: Event) => b.created_at - a.created_at;
        setResults({
          profiles: events.filter((e) => e.kind === 0),
          notes: events.filter((e) => e.kind === 1).sort(byNewest),
          polls: events.filter((e) => e.kind === 1068).sort(byNewest),
        });
      };

      handle = dataLayer.observe([{ search: trimmed, kinds: [0, 1, 1068], limit: 30 }], {
        onEvent: (e: Event) => {
          if (cancelled) return;
          byId.set(e.id, e);
          // First match (typically a local cache hit) clears the spinner so
          // results show before the search relays have answered.
          setLoading(false);
          commit();
        },
      });

      // Hard cap: stop the spinner even if nothing ever arrives (e.g. a query
      // with no local matches and a slow/empty relay response).
      stopLoading = setTimeout(() => {
        if (!cancelled) setLoading(false);
      }, 6000);
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (stopLoading) clearTimeout(stopLoading);
      handle?.unobserve();
    };
  }, [query, inputType]);

  // Match the user's own contacts (people they follow) against the free-text
  // query locally — no network. These are surfaced before the relay results so
  // people you actually know rank first.
  const contactMatches = useMemo<Event[]>(() => {
    if (inputType !== "text") return [];
    const q = query.trim().toLowerCase();
    if (q.length < 2 || !user?.follows?.length) return [];

    const matched: Event[] = [];
    for (const pubkey of user.follows) {
      const profile = profiles.get(pubkey);
      if (!profile?.event) continue;
      const hit = [
        profile.name,
        profile.display_name,
        profile.username,
        profile.nip05,
      ].some((v) => typeof v === "string" && v.toLowerCase().includes(q));
      if (hit) matched.push(profile.event);
    }
    return matched;
  }, [inputType, query, user?.follows, profiles]);

  // Contacts first, then relay results with any duplicates removed.
  const mergedResults = useMemo<SearchResults>(() => {
    if (contactMatches.length === 0) return results;
    const contactPubkeys = new Set(contactMatches.map((e) => e.pubkey));
    return {
      ...results,
      profiles: [
        ...contactMatches,
        ...results.profiles.filter((e) => !contactPubkeys.has(e.pubkey)),
      ],
    };
  }, [results, contactMatches]);

  return {
    query,
    setQuery,
    inputType,
    nip19Result,
    nip05Pubkey,
    nip05Loading,
    results: mergedResults,
    loading,
    error,
    searchedRelays,
  };
}
