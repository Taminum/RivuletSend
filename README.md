# RivuletSend

Send files directly between two browsers over an encrypted WebRTC data channel.
Files never touch a server in direct P2P mode — the signaling server only helps
the two peers find each other, then gets out of the way.

Two ways to send:

- **One-time code** — no account needed. Share an 8-character code (or a QR) and
  the transfer runs browser-to-browser.
- **To a contact** — sign in, add contacts, and send with no code at all. Contact
  rows show live per-contact online status, and you can select several contacts
  and send the same files to all of them.

Folders transfer as a whole tree, incoming files raise a notification you can
preview in place, and there's an Electron desktop shell for native folder saves.

## How it works

```
Browser A  ──create room──▶  Signaling server  ◀──join code──  Browser B
   │                         (SDP/ICE relay only)                   │
   └───────────── encrypted RTCDataChannel (files) ────────────────┘
```

1. One peer **creates a room** and gets a short code (8 chars, unambiguous
   alphabet — no `0/O/1/l`). A QR code encodes a join URL for phone-to-laptop.
2. The other peer **joins with the code** (or scans the QR).
3. The signaling server introduces them (exchanges WebRTC SDP offers/answers and
   ICE candidates) and then relays nothing else — it never sees file data or
   filenames.
4. Files stream peer-to-peer in 64KB chunks over a DTLS-encrypted data channel,
   with backpressure handling so large (multi-GB) transfers don't blow up memory.

## Repo layout (pnpm workspace)

```
packages/
  shared      protocol types, room-code + chunk constants — pure TS, no DOM/Node
  signaling   Node + ws server: room codes, SDP/ICE relay, contact presence
  api         Fastify + Prisma + Postgres: accounts, contacts, transfer history
  web         React + Vite app
  desktop     Electron shell around the web app (native folder saves)
```

## Local development

```bash
pnpm install

# Terminal 1 — signaling server on ws://localhost:8080
pnpm dev:signaling

# Terminal 2 — web app on http://localhost:5173
pnpm dev:web
```

Open the app in two tabs (or two devices on the same network): create a room in
one, join with the code in the other, then drag a file onto the drop zone.

## Run the whole stack in Docker

Brings up Postgres, the API, the signaling server, and the web app together:

```bash
docker compose up --build          # add -d to run in the background
```

Then open **http://localhost:5173**. Ports: web `5173`, api `8081`,
signaling `8080`, postgres `5432`.

Notes:
- The web image inlines `VITE_API_URL` / `VITE_SIGNALING_URL` at build time, so
  they point at the host ports (`localhost:8081` / `ws://localhost:8080`). If you
  serve from another host, change the `web` build args in `docker-compose.yml`
  and rebuild.
- The API applies migrations on start (`prisma migrate deploy`).
- To test a **contact-to-contact** transfer you need two separate browsers (or a
  normal + incognito window) — the session cookie is per-browser. Anonymous
  code-based transfer works fine across two tabs.
- Telegram login is hidden unless you set `TELEGRAM_BOT_TOKEN` (api service) and
  the `VITE_TELEGRAM_BOT_USERNAME` build arg (web service) — both are commented
  placeholders in `docker-compose.yml`.
- `docker compose down` stops it; add `-v` to also wipe the database volume.

## Sending folders

Drop a folder (or use "send a folder") and the whole tree transfers as one unit,
with a manifest so the receiver shows "N of M files" progress. How it lands on
the receiving side depends on the environment:

- **Desktop app (Electron):** writes the real folder tree to a directory you pick
  — no browser limits.
- **Chromium browsers:** "Save to folder" uses the File System Access API to
  write the real tree; or download a `.zip`.
- **Firefox / Safari:** downloads a single `.zip` (they can't write folders from
  a web page). Empty subfolders are skipped.

## Desktop app (Electron)

`packages/desktop` is a thin Electron shell — the entire web app runs inside it
unmodified, plus native folder handling.

```bash
# with the web app running (dev on :5173 or Docker), from the repo root:
pnpm --filter @p2p/desktop start          # loads http://localhost:5173
# point at another instance:
RIVULET_URL=https://your-host pnpm --filter @p2p/desktop start
```

The renderer detects the shell via `window.rivulet` and unlocks native folder
save (`fs`-backed) on receive. Packaging a Windows installer:
`pnpm --filter @p2p/desktop dist` (electron-builder → NSIS). Unsigned installers
trigger a SmartScreen warning — code signing is a later step.

## Production build

```bash
pnpm build           # builds every package
# or individually:
pnpm --filter @p2p/web build         # static site → packages/web/dist
pnpm --filter @p2p/signaling build   # bundled server → packages/signaling/dist/server.js
```

## Configuration (web)

Copy `packages/web/.env.example` to `packages/web/.env` and set:

| Variable                | Purpose                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `VITE_SIGNALING_URL`    | WebSocket URL of the signaling server (`wss://` in production) |
| `VITE_STUN_URL`         | STUN server (defaults to Google public STUN)                   |
| `VITE_TURN_URL`         | TURN relay URL(s), comma-separated — **needed behind symmetric NATs** |
| `VITE_TURN_USERNAME`    | TURN username                                                  |
| `VITE_TURN_CREDENTIAL`  | TURN credential                                                |

The signaling server reads `PORT` (default `8080`).

## Deploy

- **web** — static build (`packages/web/dist`) → Cloudflare Pages / Vercel /
  Netlify. Set the `VITE_*` env vars at build time.
- **signaling** — a long-lived process holding WebSocket connections, so **not**
  a serverless function. Use Fly.io / Render / a small VPS. A Dockerfile is
  provided:

  ```bash
  # build context is the repo root
  docker build -f packages/signaling/Dockerfile -t p2p-signaling .
  docker run -p 8080:8080 p2p-signaling
  ```

- **TURN** (for the fraction of users behind symmetric NATs where direct P2P
  can't be established) — stand up [coturn](https://github.com/coturn/coturn) on
  a VPS with UDP ports open, or use a hosted TURN provider, then set the
  `VITE_TURN_*` vars. This is the single most common reason a WebRTC transfer
  silently fails for some users, so don't skip it for a real deployment.

## Privacy model

- **Direct P2P (default):** files flow browser-to-browser over an encrypted data
  channel. The signaling server sees only connection-setup metadata.
- **TURN relay (when direct fails):** media is relayed through the TURN server,
  but it stays DTLS-encrypted end-to-end — the relay forwards ciphertext, it does
  not decrypt files.
