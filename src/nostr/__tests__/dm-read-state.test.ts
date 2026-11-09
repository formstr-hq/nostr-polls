import { Event } from "nostr-tools";
import { dataLayer } from "@formstr/local-relay";
import { collectOnce } from "../../dataLayer/collect";
import { signerManager } from "../../singletons/Signer/SignerManager";
import {
  __resetForTests,
  DM_READ_STATE_D_TAG,
  DM_READ_STATE_KIND,
  getLastSeen,
  loadReadState,
  setLastSeen,
  setMarkAllTs,
} from "../dm-read-state";

jest.mock("@formstr/local-relay", () => ({
  dataLayer: { publishEvent: jest.fn(), fetchReplaceable: jest.fn() },
}));
jest.mock("../../dataLayer/collect", () => ({ collectOnce: jest.fn() }));
jest.mock("../../singletons/Signer/SignerManager", () => ({
  signerManager: { getSigner: jest.fn() },
}));

const ME = "a".repeat(64);
const BOB = "b".repeat(64);
const CAROL = "c".repeat(64);
const CONV_BOB = [ME, BOB].sort().join("+");
const CONV_CAROL = [ME, CAROL].sort().join("+");

const mockCollect = collectOnce as jest.Mock;
const mockPublish = dataLayer.publishEvent as jest.Mock;
const mockFetchReplaceable = dataLayer.fetchReplaceable as jest.Mock;
const mockGetSigner = signerManager.getSigner as jest.Mock;

// Fake "encryption": prefix the JSON so decrypt can recognise our own payloads
// and reject anything else (like a real NIP-44 decrypt would).
const signer = {
  nip44Encrypt: jest.fn(),
  nip44Decrypt: jest.fn(),
  signEvent: jest.fn(),
};

function installSigner() {
  signer.nip44Encrypt.mockImplementation(
    async (_pk: string, plain: string) => "enc:" + plain
  );
  signer.nip44Decrypt.mockImplementation(async (_pk: string, cipher: string) => {
    if (!cipher.startsWith("enc:")) throw new Error("bad mac");
    return cipher.slice(4);
  });
  signer.signEvent.mockImplementation(async (t: any) => ({
    ...t,
    id: "id" + Math.random(),
    pubkey: ME,
    sig: "s",
  }));
}

let remote: Event[] = [];

function readStateEvent(
  state: object,
  created_at: number,
  d = DM_READ_STATE_D_TAG
): Event {
  return {
    id: `${d}-${created_at}`,
    kind: DM_READ_STATE_KIND,
    pubkey: ME,
    created_at,
    tags: [["d", d]],
    content: "enc:" + JSON.stringify(state),
    sig: "s",
  } as Event;
}

function lastPublishedState(): any {
  const ev = mockPublish.mock.calls[mockPublish.mock.calls.length - 1][0];
  return JSON.parse(ev.content.slice(4));
}

async function tick(ms = 0) {
  jest.advanceTimersByTime(ms);
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers("modern");
  __resetForTests();
  localStorage.clear();
  remote = [];
  jest.clearAllMocks();
  installSigner();
  mockGetSigner.mockResolvedValue(signer);
  mockPublish.mockImplementation(async (ev: Event) => {
    remote.push(ev);
    return { ok: true, accepted: 1, total: 1, relayResults: [] };
  });
  // Honour the d-tag filter like a relay would — but also return a foreign
  // 30078 sometimes to check the defensive re-filter.
  mockCollect.mockImplementation(async (filters: any[]) => {
    const d = filters[0]["#d"]?.[0];
    return remote.filter(
      (e) => !d || e.tags.some((t) => t[0] === "d" && t[1] === d)
    );
  });
});

afterEach(() => {
  jest.useRealTimers();
});

test("ignores another app's newer kind-30078 event and loads ours", async () => {
  remote = [
    readStateEvent({ lastSeen: { [CONV_BOB]: 1000 } }, 100),
    // Another NIP-78 app: different d tag, not decryptable by us, newer.
    { ...readStateEvent({}, 999, "other-app"), content: "garbage" } as Event,
  ];
  const { status } = await loadReadState(ME);
  expect(status).toBe("found");
  expect(getLastSeen(ME, CONV_BOB)).toBe(1000);
  expect(mockFetchReplaceable).not.toHaveBeenCalled();
});

test("defensively drops events whose d tag doesn't match even if returned", async () => {
  mockCollect.mockImplementation(async () => [
    readStateEvent({ lastSeen: { [CONV_BOB]: 1000 } }, 100),
    { ...readStateEvent({}, 999, "other-app"), content: "garbage" } as Event,
  ]);
  const { status } = await loadReadState(ME);
  expect(status).toBe("found");
  expect(getLastSeen(ME, CONV_BOB)).toBe(1000);
});

test("decrypt failure: no publish over the remote event", async () => {
  remote = [readStateEvent({ lastSeen: { [CONV_BOB]: 1000 } }, 100)];
  signer.nip44Decrypt.mockRejectedValueOnce(new Error("signer locked"));
  const { status } = await loadReadState(ME);
  expect(status).toBe("failed");

  setLastSeen(ME, CONV_CAROL, 2000);
  await tick(60000);
  expect(mockPublish).not.toHaveBeenCalled();
  // Still read in this session.
  expect(getLastSeen(ME, CONV_CAROL)).toBe(2000);
});

test("mutations before load are held, then published merged with remote", async () => {
  remote = [readStateEvent({ lastSeen: { [CONV_BOB]: 1000 } }, 100)];
  setLastSeen(ME, CONV_CAROL, 2000);
  await tick(1000);
  expect(mockPublish).not.toHaveBeenCalled();

  await loadReadState(ME);
  await tick(300);
  expect(mockPublish).toHaveBeenCalledTimes(1);
  expect(lastPublishedState().lastSeen).toEqual({
    [CONV_BOB]: 1000,
    [CONV_CAROL]: 2000,
  });
});

test("merge-before-publish never lowers a watermark set by another device", async () => {
  remote = [readStateEvent({ lastSeen: { [CONV_BOB]: 1000 } }, 100)];
  await loadReadState(ME);

  // Another device advances Bob and marks all, after our load.
  remote.push(
    readStateEvent({ lastSeen: { [CONV_BOB]: 5000 }, markAllTs: 4000 }, 200)
  );

  setLastSeen(ME, CONV_CAROL, 3000);
  await tick(300);
  const published = lastPublishedState();
  expect(published.lastSeen[CONV_BOB]).toBe(5000);
  expect(published.lastSeen[CONV_CAROL]).toBe(3000);
  expect(published.markAllTs).toBe(4000);
});

test("legacy keys are kept until a publish carrying them succeeds", async () => {
  localStorage.setItem("dm_lastseen_" + CONV_BOB, "1500");
  localStorage.setItem("dm_markall_" + ME, "1200");
  mockPublish.mockResolvedValueOnce({ ok: false, accepted: 0, total: 1, relayResults: [] });

  await loadReadState(ME);
  expect(getLastSeen(ME, CONV_BOB)).toBe(1500);
  await tick(300);
  expect(mockPublish).toHaveBeenCalledTimes(1);
  // First publish failed — keys must survive.
  expect(localStorage.getItem("dm_lastseen_" + CONV_BOB)).toBe("1500");
  expect(localStorage.getItem("dm_markall_" + ME)).toBe("1200");

  await tick(2000); // first retry
  expect(mockPublish).toHaveBeenCalledTimes(2);
  expect(lastPublishedState()).toEqual({
    lastSeen: { [CONV_BOB]: 1500 },
    markAllTs: 1200,
  });
  expect(localStorage.getItem("dm_lastseen_" + CONV_BOB)).toBeNull();
  expect(localStorage.getItem("dm_markall_" + ME)).toBeNull();
});

test("legacy keys already covered remotely are dropped without publishing", async () => {
  remote = [readStateEvent({ lastSeen: { [CONV_BOB]: 2000 } }, 100)];
  localStorage.setItem("dm_lastseen_" + CONV_BOB, "1500");
  await loadReadState(ME);
  await tick(300);
  expect(mockPublish).not.toHaveBeenCalled();
  expect(localStorage.getItem("dm_lastseen_" + CONV_BOB)).toBeNull();
});

test("publish failure is retried with backoff, then gives up", async () => {
  await loadReadState(ME);
  mockPublish.mockRejectedValue(new Error("worker down"));
  setLastSeen(ME, CONV_BOB, 1000);
  await tick(300);
  expect(mockPublish).toHaveBeenCalledTimes(1);
  await tick(2000);
  expect(mockPublish).toHaveBeenCalledTimes(2);
  await tick(8000);
  expect(mockPublish).toHaveBeenCalledTimes(3);
  await tick(30000);
  expect(mockPublish).toHaveBeenCalledTimes(4);
  await tick(120000);
  expect(mockPublish).toHaveBeenCalledTimes(4);

  // A new user action restarts the cycle and carries the old change too.
  mockPublish.mockImplementation(async (ev: Event) => {
    remote.push(ev);
    return { ok: true, accepted: 1, total: 1, relayResults: [] };
  });
  setLastSeen(ME, CONV_CAROL, 2000);
  await tick(300);
  expect(lastPublishedState().lastSeen).toEqual({
    [CONV_BOB]: 1000,
    [CONV_CAROL]: 2000,
  });
});

test("getLastSeen honours markAllTs", async () => {
  await loadReadState(ME);
  setLastSeen(ME, CONV_BOB, 1000);
  setMarkAllTs(ME, 3000);
  expect(getLastSeen(ME, CONV_BOB)).toBe(3000);
  expect(getLastSeen(ME, CONV_CAROL)).toBe(3000);
});

test("not-found remote is authoritative empty and allows publishing", async () => {
  const { status } = await loadReadState(ME);
  expect(status).toBe("not-found");
  setLastSeen(ME, CONV_BOB, 1000);
  await tick(300);
  expect(mockPublish).toHaveBeenCalledTimes(1);
  const ev = mockPublish.mock.calls[0][0];
  expect(ev.tags).toEqual([["d", DM_READ_STATE_D_TAG]]);
});
