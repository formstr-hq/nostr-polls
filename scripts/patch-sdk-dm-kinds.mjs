// Patches @formstr/local-relay 0.6.x to include NIP-59 kind 21059 (ephemeral
// gift wrap) in its internal DM_KINDS set. Without this the SDK routes 21059
// reads away from the NIP-17 DM inbox relays and never applies
// dmPublishTargets to 21059 publishes (chunk: `kinds.every((k) =>
// DM_KINDS.has(k))` / `DM_KINDS.has(event.kind)`). Upstream change pending in
// formstr-hq/local-relay — drop this script once the SDK ships 21059 support.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const base = "./node_modules/@formstr/local-relay/dist";
const OLD = "new Set([1059])";
const NEW = "new Set([1059, 21059])";
let relevant = 0, patched = 0;

try {
  for (const f of readdirSync(base)) {
    if (!f.endsWith(".js") && !f.endsWith(".cjs")) continue;
    const p = join(base, f);
    let s;
    try { s = readFileSync(p, "utf8"); } catch { continue; }
    if (!s.includes("DM_KINDS")) continue;
    relevant++;
    if (s.includes(NEW)) { patched++; continue; }
    if (s.includes(OLD)) {
      writeFileSync(p, s.replace(OLD, NEW));
      console.log("[patch-sdk-dm-kinds] patched", p);
      patched++;
    }
  }
} catch (e) {
  console.error("[patch-sdk-dm-kinds] dist not found — skipping");
  process.exit(0);
}
if (relevant > 0 && patched === 0) {
  console.error(
    "[patch-sdk-dm-kinds] WARNING: @formstr/local-relay layout changed and the" +
    " DM_KINDS anchor is gone. If ping wraps (kind 21059) stop routing to DM" +
    " inbox relays, check whether the SDK now ships native 21059 support."
  );
}
process.exit(0);
