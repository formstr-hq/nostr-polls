// Web Worker: aggregates the user's follows' kind-3 contact lists into the
// web-of-trust "union" set (every reachable pubkey) and the inverted "network
// index" (target pubkey -> the subset of the user's own follows who follow
// them, powering the "followed by … you follow" row on profiles).
//
// This used to run on the UI thread in lists-context's `subscribeToContacts`,
// where looping every `p` tag of up to 500 contact lists (each with hundreds–
// thousands of tags) into a growing Set/Map — plus serializing the result —
// janked the app. It now lives here; the main thread only forwards raw events
// and writes the finished strings to localStorage.

/* eslint-disable no-restricted-globals */

// Compact, index-referenced form of the network index — small enough for
// localStorage even on large follow graphs. MUST stay in sync with
// `deserializeNetworkIndex` in lists-context.tsx.
type SerializedNetworkIndex = {
  follows: string[];
  edges: Record<string, number[]>;
};

const ctx: Worker = self as any;

// A follow recommendation: a 2nd-degree pubkey (someone the user doesn't follow
// yet) plus how many of the user's own follows follow them — the trust score.
type Recommendation = { pubkey: string; score: number };

// Recommendation tuning. Score 1 (followed by a single contact) is a weak,
// noisy signal, so candidates need at least this many endorsements; we keep the
// strongest REC_LIMIT to bound the payload + localStorage footprint.
const REC_MIN_SCORE = 2;
const REC_LIMIT = 200;

let union = new Set<string>();
let index = new Map<string, Set<string>>();
let follows = new Set<string>(); // the user's own follows — excluded from recs
let ownPubkey = ""; // the user's own pubkey — excluded from recs
let lastProgress = 0;

function serializeNetworkIndex(idx: Map<string, Set<string>>): string {
  const follows: string[] = [];
  const followIdx = new Map<string, number>();
  const edges: Record<string, number[]> = {};
  idx.forEach((sources, target) => {
    const arr: number[] = [];
    sources.forEach((src) => {
      let i = followIdx.get(src);
      if (i === undefined) {
        i = follows.length;
        follows.push(src);
        followIdx.set(src, i);
      }
      arr.push(i);
    });
    edges[target] = arr;
  });
  return JSON.stringify({ follows, edges } as SerializedNetworkIndex);
}

ctx.addEventListener("message", (e: MessageEvent) => {
  const msg = e.data;
  switch (msg.type) {
    case "init": {
      // Seed the union with whatever we already have (cache / current state) so
      // a sparse fetch can only ever add to the web of trust, never shrink it.
      union = new Set<string>(msg.seedUnion ?? []);
      index = new Map<string, Set<string>>();
      follows = new Set<string>(msg.follows ?? []);
      ownPubkey = msg.self ?? "";
      lastProgress = 0;
      break;
    }
    case "event": {
      const source: string = msg.pubkey; // one of the user's follows
      const tags: string[][] = msg.tags;
      for (const tag of tags) {
        if (tag[0] === "p" && tag[1]) {
          const target = tag[1];
          union.add(target);
          let sources = index.get(target);
          if (!sources) {
            sources = new Set();
            index.set(target, sources);
          }
          sources.add(source);
        }
      }
      // Throttle progress so the main thread isn't flooded with postMessages.
      const now = Date.now();
      if (now - lastProgress > 200) {
        lastProgress = now;
        ctx.postMessage({ type: "progress", size: union.size });
      }
      break;
    }
    case "commit": {
      // Build the follow-recommendation list: every 2nd-degree pubkey the user
      // doesn't already follow, scored by how many of their follows follow them.
      // This full-index scan + sort is exactly the work we keep off the UI thread.
      const recommendations: Recommendation[] = [];
      index.forEach((sources, target) => {
        if (target === ownPubkey || follows.has(target)) return;
        const score = sources.size;
        if (score >= REC_MIN_SCORE) recommendations.push({ pubkey: target, score });
      });
      recommendations.sort((a, b) => b.score - a.score);
      if (recommendations.length > REC_LIMIT) recommendations.length = REC_LIMIT;

      ctx.postMessage({
        type: "result",
        union: Array.from(union),
        serializedIndex: serializeNetworkIndex(index),
        recommendations,
        size: union.size,
      });
      break;
    }
    default:
      break;
  }
});

export default ctx;
