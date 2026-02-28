import { useState, useEffect } from "react";
import { nip19, nip05, Event } from "nostr-tools";
import { nostrRuntime } from "../../singletons";
import { searchRelays, profileSearchRelays } from "../../nostr";

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

  // NIP-50 free-text search (debounced 400ms)
  // Runs two parallel queries so profiles and notes each get their own result quota
  useEffect(() => {
    if (inputType !== "text") return;
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    let cancelled = false;

    const timeout = <T>(ms: number): Promise<T> =>
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), ms)
      );

    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      // Show all unique relays used across both queries
      const allRelays = Array.from(
        new Set([...profileSearchRelays, ...searchRelays])
      );
      setSearchedRelays(allRelays);

      try {
        const [profileEvents, contentEvents] = await Promise.all([
          // Profiles on broader relay set (Primal has massive profile coverage)
          Promise.race([
            nostrRuntime.querySync(profileSearchRelays, {
              search: trimmed,
              kinds: [0],
              limit: 20,
            }),
            timeout<Event[]>(6000),
          ]).catch(() => [] as Event[]),

          // Notes + polls on NIP-50 search relays
          Promise.race([
            nostrRuntime.querySync(searchRelays, {
              search: trimmed,
              kinds: [1, 1068],
              limit: 20,
            }),
            timeout<Event[]>(6000),
          ]).catch(() => [] as Event[]),
        ]);

        if (!cancelled) {
          setResults({
            profiles: profileEvents,
            notes: contentEvents.filter((e) => e.kind === 1),
            polls: contentEvents.filter((e) => e.kind === 1068),
          });
        }
      } catch (err: any) {
        if (!cancelled) {
          setError("Search failed. Try again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, inputType]);

  return {
    query,
    setQuery,
    inputType,
    nip19Result,
    nip05Pubkey,
    nip05Loading,
    results,
    loading,
    error,
    searchedRelays,
  };
}
