// ICE server configuration.
//
// Public STUN is enough for most peers behind cone NATs, but fails behind
// symmetric NATs (common on mobile carriers and some corporate wifi) — those
// need a TURN relay.
//
// The relay config is fetched from the API at runtime rather than inlined at
// build time, because it carries a credential: anything compiled into the
// bundle is public, and a permanent TURN password in public JavaScript is an
// open relay. The API mints short-lived credentials instead (see
// packages/api/src/routes/turn.ts).
//
// Build-time VITE_TURN_* still wins when set, so an existing deployment
// pointed at a hosted TURN provider keeps working untouched.

import { API_URL } from "./api";

// `||`, not `??`: a build arg that is declared but left empty inlines an empty
// string, which would produce a useless { urls: "" } ICE server.
const STUN_URL = import.meta.env.VITE_STUN_URL || "stun:stun.l.google.com:19302";

const STATIC_TURN_URL = import.meta.env.VITE_TURN_URL;
const STATIC_TURN_USERNAME = import.meta.env.VITE_TURN_USERNAME;
const STATIC_TURN_CREDENTIAL = import.meta.env.VITE_TURN_CREDENTIAL;
const hasStaticTurn = Boolean(STATIC_TURN_URL && STATIC_TURN_USERNAME && STATIC_TURN_CREDENTIAL);

function staticServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: STUN_URL }];
  // Checked field by field rather than via hasStaticTurn: the boolean carries
  // no type information, so TypeScript can't narrow the values through it.
  if (STATIC_TURN_URL && STATIC_TURN_USERNAME && STATIC_TURN_CREDENTIAL) {
    // Support a comma-separated list of TURN URLs (e.g. udp + tcp + tls).
    const urls = STATIC_TURN_URL.split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    servers.push({ urls, username: STATIC_TURN_USERNAME, credential: STATIC_TURN_CREDENTIAL });
  }
  return servers;
}

let cached: RTCIceServer[] | null = null;
let cachedUntil = 0;
let inflight: Promise<void> | null = null;

// Fetches (or refreshes) the ICE configuration. Called well before a peer
// connection is built so that getIceServers() can stay synchronous — making
// RTCPeerConnection creation async would mean racing the signals that arrive
// immediately after 'ready'.
export function primeIceServers(): Promise<void> {
  if (hasStaticTurn) return Promise.resolve();
  if (cached && Date.now() < cachedUntil) return Promise.resolve();
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const response = await fetch(`${API_URL}/turn-credentials`, { credentials: "omit" });
      if (!response.ok) return;
      const body = (await response.json()) as { iceServers?: RTCIceServer[]; ttl?: number };
      if (!Array.isArray(body.iceServers) || body.iceServers.length === 0) return;
      cached = body.iceServers;
      // Refresh a minute before the credential actually expires, so a transfer
      // starting right at the boundary doesn't get a dead relay.
      const ttl = typeof body.ttl === "number" && body.ttl > 0 ? body.ttl : 3600;
      cachedUntil = Date.now() + Math.max(60, ttl - 60) * 1000;
    } catch {
      // Offline API or a deployment without TURN: fall through to STUN only,
      // which is what this app did before the relay existed.
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function getIceServers(): RTCIceServer[] {
  if (hasStaticTurn) return staticServers();
  // Stale beats empty: an expired credential is still worth offering, since
  // the alternative is no relay at all.
  if (cached) return cached;
  return [{ urls: STUN_URL }];
}
