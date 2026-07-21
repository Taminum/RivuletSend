// ICE server configuration, assembled from env so TURN credentials can be
// added at deploy time without touching code.
//
// Public STUN is enough for most peers behind cone NATs, but fails behind
// symmetric NATs (common on mobile carriers and some corporate wifi) — those
// need a TURN relay. Set the VITE_TURN_* vars (see .env.example) to point at a
// coturn instance or hosted TURN provider and it gets appended automatically.

const STUN_URL = import.meta.env.VITE_STUN_URL ?? "stun:stun.l.google.com:19302";

export function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: STUN_URL }];

  const turnUrl = import.meta.env.VITE_TURN_URL;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL;

  if (turnUrl && turnUsername && turnCredential) {
    // Support a comma-separated list of TURN URLs (e.g. udp + tcp + tls).
    const urls = turnUrl.split(",").map((u) => u.trim()).filter(Boolean);
    servers.push({ urls, username: turnUsername, credential: turnCredential });
  }

  return servers;
}
