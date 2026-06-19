/**
 * Test helpers for the local relay. Not a test suite itself — kept outside any
 * __tests__ folder and without a `.test` suffix so the Jest runner ignores it.
 */
import type { Event } from "nostr-tools";

let counter = 0;

/** Build a structurally-valid event (no real signature — the store never checks). */
export function makeEvent(overrides: Partial<Event> = {}): Event {
  counter += 1;
  const id =
    overrides.id ?? counter.toString(16).padStart(64, "0").slice(0, 64);
  return {
    id,
    pubkey: overrides.pubkey ?? "a".repeat(64),
    created_at: overrides.created_at ?? 1000,
    kind: overrides.kind ?? 1,
    tags: overrides.tags ?? [],
    content: overrides.content ?? "",
    sig: overrides.sig ?? "0".repeat(128),
  };
}

/** Reset the id counter between tests if deterministic ids are needed. */
export function resetIds(): void {
  counter = 0;
}

import type { Socket, SocketFactory } from "./sync/Socket";

/** A controllable Socket for pool/connection tests. */
export class FakeSocket implements Socket {
  readyState = 0; // CONNECTING
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  /** Everything the code under test sent, as parsed JSON arrays. */
  sent: any[] = [];

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }

  // --- test controls ---
  open(): void {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }
  /** Push a relay→client message in (array or pre-stringified). */
  emit(msg: unknown): void {
    this.onmessage?.(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  fail(): void {
    this.onerror?.();
    this.close();
  }
}

/** Factory that records every FakeSocket it creates, keyed by url. */
export function fakeSocketFactory() {
  const byUrl = new Map<string, FakeSocket[]>();
  const factory: SocketFactory = (url: string) => {
    const s = new FakeSocket();
    const list = byUrl.get(url) ?? [];
    list.push(s);
    byUrl.set(url, list);
    return s;
  };
  return {
    factory,
    /** Most recent socket created for a url (the live connection). */
    last: (url: string): FakeSocket => {
      const list = byUrl.get(url);
      if (!list?.length) throw new Error(`no socket for ${url}`);
      return list[list.length - 1];
    },
    count: (url: string): number => byUrl.get(url)?.length ?? 0,
  };
}
