# pollerama-web

A small gateway in front of the Pollerama SPA. It serves the existing build and
adds per-route link previews — no framework, no database, no external services.

- Serves the CRA build (`../build`) and its static assets.
- For share routes, resolves the event directly from relays and injects
  Open Graph / Twitter tags into the SPA shell.
- Humans get the same SPA; the app is unchanged.

```
reverse proxy → pollerama-web :8080
                  ├─ build/ (SPA + assets)
                  ├─ /note/:id, /feeds/articles/:id, /result/:id, /respond/:id
                  │    └─ resolve from relays → inject og:* → index.html
                  └─ /og-default.png (bundled 1200×630 card)
```

## Routes

| Route | Behaviour |
|---|---|
| `/note/:nevent` / `/note/:note` | kind 1 (post/reply) or 1068 (poll) preview |
| `/feeds/articles/:naddr` | kind 30023 preview |
| `/result/:id`, `/respond/:id` | poll preview |
| `/p/:id` | `noindex,nofollow`, no preview |
| `/og-default.png` | bundled fallback card |
| `/healthz` | `{"ok":true}` |
| everything else | the SPA shell / static assets |

## Env

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | listen port |
| `STATIC_DIR` | `../build` | SPA output |
| `SITE_URL` | `http://localhost:8080` | canonical origin used for `og:url` |
| `NOSTR_RELAYS` | `wss://relay.formstr.app,wss://relay.damus.io,wss://relay.primal.net,wss://nos.lol,wss://relay.nostr.wirednet.jp,wss://nostr-01.yakihonne.com,wss://nostr21.com` | fallback relays; reference relay hints win |
| `RELAY_TIMEOUT_MS` | `10000` | per-lookup relay timeout |
| `PREVIEW_CACHE_MS` | `86400000` | in-memory preview TTL |
| `PREVIEW_CACHE_MAX` | `5000` | max cached previews |
| `DEFAULT_OG_IMAGE` | `${SITE_URL}/og-default.png` | override the fallback card |
| `SITE_NAME` | `Pollerama` | `og:site_name` |
| `APP_TITLE` | `Pollerama` | generic title |
| `DEFAULT_DESCRIPTION` | `Polls On Nostr!` | generic description |

## Local

```bash
npm run build
(cd server && npm ci)
SITE_URL=http://localhost:8080 node server/index.mjs

curl -s http://localhost:8080/note/<identifier> | grep -oE 'property="og:[^"]*" content="[^"]*"'
curl -sI http://localhost:8080/og-default.png
curl -s http://localhost:8080/healthz
```

## Deploy

```bash
docker compose up -d --build
```

Set `SITE_URL` to the public origin. The service binds to `127.0.0.1:8080`, so
put any reverse proxy in front of it. No hostnames, certificates or upstream
configuration are committed here.

## Behaviour

- resolved preview: `x-preview: hit`, `Cache-Control: public, s-maxage=300, stale-while-revalidate=86400`
- miss/timeout: generic branded head, `Cache-Control: no-store` (so it is retried)
- injected values are HTML-escaped; images must be `http(s)`
- private `/p/...` is `noindex,nofollow`
- previews are cached in memory for `PREVIEW_CACHE_MS`

## Limits

- No sitemap/enumeration; previews resolve by identifier only.
- Some relays do not serve older events by id; those fall back to the generic card.
- The fallback card is `server/assets/og-default.png` (1200×630).
