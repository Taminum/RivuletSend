// Typed client for the accounts API. All requests send the session cookie
// (credentials: "include"); the API allows this origin with CORS credentials.

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8081";

export interface ApiUser {
  id: string;
  displayName: string;
  email: string | null;
  telegramId: string | null;
  accentPreference: string | null;
  createdAt: string;
}

// Shape the Telegram Login Widget passes to its data-onauth callback.
export interface TelegramAuthData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export type ContactStatus = "accepted" | "outgoing" | "incoming";
export interface ContactEntry {
  user: ApiUser;
  status: ContactStatus;
}
export interface ContactsResponse {
  accepted: ContactEntry[];
  outgoing: ContactEntry[];
  incoming: ContactEntry[];
}

export interface ApiTransfer {
  id: string;
  direction: "sent" | "received";
  fileName: string;
  fileSize: string;
  status: "completed" | "failed";
  failureReason: string | null;
  createdAt: string;
  counterpart: ApiUser | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(API_URL + path, {
    ...options,
    credentials: "include",
    // Never serve an API response from the HTTP cache: these are per-user and
    // some are short-lived (the signaling token lasts 2 minutes). Firefox
    // heuristically cached the GET and replayed a stale token, which signaling
    // rejected as "Invalid token".
    cache: "no-store",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || "request_failed");
  }
  return data as T;
}

export const api = {
  // auth
  signup: (b: { displayName: string; email: string; password: string }) =>
    req<{ user: ApiUser }>("/auth/signup", { method: "POST", body: JSON.stringify(b) }),
  login: (b: { email: string; password: string }) =>
    req<{ user: ApiUser }>("/auth/login", { method: "POST", body: JSON.stringify(b) }),
  logout: () => req<{ ok: true }>("/auth/logout", { method: "POST" }),
  me: () => req<{ user: ApiUser }>("/auth/me"),
  wsToken: () => req<{ token: string }>("/auth/ws-token"),
  telegramLogin: (b: TelegramAuthData) =>
    req<{ user: ApiUser }>("/auth/telegram", { method: "POST", body: JSON.stringify(b) }),
  linkTelegram: (b: TelegramAuthData) =>
    req<{ user: ApiUser }>("/auth/link/telegram", { method: "POST", body: JSON.stringify(b) }),
  unlinkTelegram: () => req<{ user: ApiUser }>("/auth/unlink/telegram", { method: "POST" }),
  changePassword: (b: { currentPassword: string; newPassword: string }) =>
    req<{ ok: true }>("/auth/password", { method: "POST", body: JSON.stringify(b) }),
  setAccent: (accent: string) =>
    req<{ user: ApiUser }>("/auth/accent", { method: "POST", body: JSON.stringify({ accent }) }),

  // contacts
  listContacts: () => req<ContactsResponse>("/contacts"),
  addContact: (b: { userId?: string; email?: string }) =>
    req<{ contact: ContactEntry }>("/contacts", { method: "POST", body: JSON.stringify(b) }),
  deleteContact: (userId: string) =>
    req<{ ok: true }>(`/contacts/${userId}`, { method: "DELETE" }),

  // transfers / history
  listTransfers: () => req<{ transfers: ApiTransfer[] }>("/transfers"),
  createTransfer: (b: {
    recipientUserId?: string;
    fileName: string;
    fileSize: number | string;
    status: "completed" | "failed";
    failureReason?: string;
  }) => req<{ transfer: ApiTransfer }>("/transfers", { method: "POST", body: JSON.stringify(b) }),
  deleteTransfer: (id: string) => req<{ ok: true }>(`/transfers/${id}`, { method: "DELETE" }),

  // device pairing — requesting side (fresh device)
  pairingRequest: (b: { platform?: string; label?: string }) =>
    req<{ code: string; expiresAt: string }>("/pairing/request", {
      method: "POST",
      body: JSON.stringify(b),
    }),
  pairingStatus: (code: string) =>
    req<{ status: "pending" | "approved" | "expired"; user?: ApiUser }>(`/pairing/${code}/status`),

  // device pairing — approving side (already signed in)
  pairingInfo: (code: string) =>
    req<{ requestedPlatform: string | null; createdAt: string; expiresAt: string }>(
      `/pairing/${code}/info`,
    ),
  pairingApprove: (b: { code: string; label?: string }) =>
    req<{ ok: true; device: { id: string; label: string } }>("/pairing/approve", {
      method: "POST",
      body: JSON.stringify(b),
    }),

  // linked devices
  listDevices: () => req<{ devices: ApiDevice[] }>("/devices"),
  revokeDevice: (id: string) => req<{ ok: true }>(`/devices/${id}/revoke`, { method: "POST" }),
};

export interface ApiDevice {
  id: string;
  label: string;
  platform: string | null;
  createdAt: string;
  lastSeenAt: string;
  isCurrent: boolean;
}
