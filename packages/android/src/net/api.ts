import {apiFetch} from './session';

// Mirrors the subset of packages/web/src/api.ts the mobile app needs. Same
// endpoints, same shapes — just Bearer-authenticated instead of cookie-based.

export interface ApiUser {
  id: string;
  displayName: string;
  email: string | null;
  accentPreference: string | null;
  createdAt: string;
}

export interface ApiDevice {
  id: string;
  label: string;
  platform: string | null;
  createdAt: string;
  lastSeenAt: string;
  isCurrent: boolean;
}

export type ContactStatus = 'accepted' | 'outgoing' | 'incoming';
export interface ContactEntry {
  user: ApiUser;
  status: ContactStatus;
  alias?: string | null;
}
export interface ContactsResponse {
  accepted: ContactEntry[];
  outgoing: ContactEntry[];
  incoming: ContactEntry[];
}

export function contactName(entry: ContactEntry): string {
  return entry.alias?.trim() || entry.user.displayName;
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export const api = {
  me: () => apiFetch<{user: ApiUser}>('/auth/me'),
  wsToken: () => apiFetch<{token: string}>('/auth/ws-token'),
  turnCredentials: () =>
    apiFetch<{iceServers: IceServerConfig[]; ttl: number}>('/turn-credentials'),
  listDevices: () => apiFetch<{devices: ApiDevice[]}>('/devices'),
  listContacts: () => apiFetch<ContactsResponse>('/contacts'),
  // Add a contact by email, or accept an incoming request by the requester's id.
  addContact: (b: {userId?: string; email?: string}) =>
    apiFetch<{contact: ContactEntry}>('/contacts', {
      method: 'POST',
      body: JSON.stringify(b),
    }),
  deleteContact: (userId: string) =>
    apiFetch<{ok: true}>(`/contacts/${userId}`, {method: 'DELETE'}),

  // Pairing: this fresh device asks for a code, then polls until an already
  // signed-in device (web/desktop) approves it — at which point the status
  // response carries the session token in its body (see api/routes/pairing.ts).
  pairingRequest: (b: {platform?: string; label?: string}) =>
    apiFetch<{code: string; expiresAt: string}>('/pairing/request', {
      method: 'POST',
      body: JSON.stringify(b),
    }),
  pairingStatus: (code: string) =>
    apiFetch<{
      status: 'pending' | 'approved' | 'expired';
      user?: ApiUser;
      token?: string;
    }>(`/pairing/${code}/status`),
};
