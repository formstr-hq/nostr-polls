# FIPS + Browser FIPS Nodes — Notes for a Nostr "Spaces" Feature

## TL;DR
A **browser tab can be a real, interoperable FIPS node today** (`satsandsports/fips-in-the-browser` —
the full FIPS protocol compiled to WASM, not a lookalike). That makes a serverless, NAT-free,
end-to-end-encrypted Twitter-Spaces-style audio feature plausible inside a Nostr app, using the
user's Nostr key as the network identity. The main open risk is **real-time audio latency** over the
demo's WebSocket-to-gateway uplink.

---

## What FIPS is
**FIPS — Free Internetworking Peering System** ([fips.network](https://fips.network/),
[github.com/jmcorgan/fips](https://github.com/jmcorgan/fips)) is a self-organizing encrypted mesh
network built on **Nostr identities**.

- **Nostr keypairs (secp256k1/schnorr) are the node identity** — your npub *is* your address.
- **No coordinator** — the mesh elects its own root, merges with neighbors on contact, reroutes
  around damage on its own.
- **Routing:** spanning tree for coordinate-based routing + bloom filters for reachability; nodes
  forward using only local knowledge.
- **Transport-agnostic:** UDP, Ethernet, Bluetooth, LoRa, or any datagram medium; can run as an
  internet overlay.
- **Two crypto layers:** Noise **IK** hop-by-hop, Noise **XK** end-to-end (intermediate routers
  can't read traffic).
- Written in Rust; ships `fipsctl` / `fipstop` tooling. Notable app on top: **Nostr VPN**
  (Tailscale-style mesh VPN, FIPS data plane).

### Why it matters for "Spaces"
A Twitter-Spaces-style app normally needs a **TURN server** to relay audio through NAT. If peers are
on FIPS, **NAT is already solved at the network layer** and traffic is already encrypted — so you can
get much closer to "just talk," peer-to-peer, no central media relay.

---

## Browser FIPS node — `fips-in-the-browser`
Live demo: <https://satsandsports.github.io/fips-in-the-browser/>
Repo: <https://github.com/satsandsports/fips-in-the-browser>

**It is the real protocol in WASM, wire-compatible with native nodes** — confirmed from source:

- Crate `fips-wasm`, described as *"FIPS protocol implementation for WebAssembly (browser FIPS
  node)."* Exports a single `class FipsNode`.
- Full protocol present in `browser/src/`: `noise.rs`, `noise_xk.rs`, `tree.rs` (spanning tree),
  `bloom.rs` (reachability), `session.rs`, `wire.rs`, `replay.rs`, `cipher.rs`, `identity.rs`,
  `ipv6.rs`, `dns.rs`.
- Crypto crates pinned with comments **"same crates as native fips"** (`chacha20poly1305`, `k256`
  schnorr/ecdh, `hkdf`, `sha2`) → interoperable, not a reimplementation.
- So a browser tab gets a routable, npub-derived **FIPS IPv6 address** and does real Noise-XK
  end-to-end to any node in the mesh.

### How it connects (important nuance)
- **No WebRTC, no STUN/TURN.** The browser node is a **leaf** with a **single WebSocket uplink to a
  Gateway node** (UI fields: "WebSocket URL", "Gateway npub"). FIPS overlay routing then carries it
  to the whole mesh — the "one link into the mesh" pattern.
- The demo also boots a tiny Linux VM in-tab (`v86`/`libv86.js`) and bridges its IPv6 packets into
  FIPS — a flashy demo, **not needed** for app integration (you'd call `FipsNode` directly).

---

## Implications for a Nostr-app Spaces feature

**What's already solved for you**
- A real, interoperable, **encrypted FIPS endpoint in a browser tab** (open source).
- **Identity** = the Nostr key the app already manages.
- **Signaling/discovery** = plain Nostr events: a "Space" is an addressable event; participants'
  npubs are their FIPS addresses. No new infra.

**What you still build**
- An **Opus media layer** over FIPS sessions (encode/decode via WebCodecs or WASM Opus + jitter
  buffer).
- **Listener fan-out topology** — a flat mesh doesn't scale to a big room; Spaces is one-to-many, so
  you need an SFU-like forwarding tree among peers (FIPS gives reachability, not fan-out).

**Risks / open questions**
1. **TCP head-of-line blocking on the WS uplink.** WebSocket is reliable/ordered TCP; one lost
   packet stalls audio → jitter. Tolerable for an MVP with a fat jitter buffer; for quality you'd
   want a **datagram uplink (WebRTC DataChannel or WebTransport)** that this demo did *not* build.
2. **Gateway dependency.** "No TURN" is traded for a public-WebSocket **gateway node**. Any FIPS node
   can be one (repo ships `examples/sidecar-nostr-relay` + a k8s sidecar), and it's lighter than TURN
   (routing, not media relay) — but it's still a semi-central piece, not pure P2P.
3. **Latency through multiple hops** can exceed the ~150 ms target for live audio; measure early.

**Platform split (for a Capacitor/React app)**
- **Browser / Android webview:** import the WASM `FipsNode`; tab is a FIPS leaf over a WS uplink.
- **Native (Capacitor plugin):** could run the native FIPS node over UDP for a true peer with no
  gateway/HoL issues (same pattern as an existing native signer plugin).

**Net:** browser-tab-as-FIPS-node is real and shipped, so Spaces becomes *"wire Opus through an
existing `FipsNode`,"* not *"port a protocol."* The make-or-break unknown is whether the WS uplink's
latency/HoL behavior is good enough for live audio, or whether a datagram transport must be added.

---

## Links
- FIPS site — <https://fips.network/>
- FIPS source — <https://github.com/jmcorgan/fips>
- Browser FIPS demo — <https://satsandsports.github.io/fips-in-the-browser/>
- Browser FIPS source — <https://github.com/satsandsports/fips-in-the-browser>
- Nostr VPN (FIPS data plane) — <https://github.com/mmalmi/nostr-vpn>
- WebRTC-over-Nostr building blocks — <https://codeberg.org/cipres/nostr_webrtc> ·
  <https://crates.io/crates/matchbox_socket_nostr> · <https://webconnect.js.org/>
- FIPS networking-protocol intro (Grin forum) —
  <https://forum.grin.mw/t/fips-new-networking-protocol-on-nostr/12483>
