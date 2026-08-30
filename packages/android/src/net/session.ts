import AsyncStorage from '@react-native-async-storage/async-storage';

// Where the backend lives. Same host as the web app / signaling; the API is
// behind the reverse proxy at /api and signaling at /ws. Hardcoded to the prod
// deployment for now — a settings field can override it later.
export const API_BASE = 'https://send.tarmalion.ru/api';
export const SIGNALING_URL = 'wss://send.tarmalion.ru/ws';

const TOKEN_KEY = 'owlsend.session.token';

// The mobile client can't use the httpOnly session cookie the web app relies on,
// so it holds the JWT itself (obtained from pairing) and sends it as a Bearer
// token. Cached in memory after the first read to avoid hitting storage per call.
let cachedToken: string | null = null;
let loaded = false;

export async function loadToken(): Promise<string | null> {
  if (!loaded) {
    cachedToken = await AsyncStorage.getItem(TOKEN_KEY);
    loaded = true;
  }
  return cachedToken;
}

export async function setToken(token: string | null): Promise<void> {
  cachedToken = token;
  loaded = true;
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

export function currentToken(): string | null {
  return cachedToken;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

// fetch against the API with the Bearer token attached and JSON in/out.
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = cachedToken ?? (await loadToken());
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      ...(options.body ? {'Content-Type': 'application/json'} : {}),
      ...(token ? {Authorization: `Bearer ${token}`} : {}),
      ...options.headers,
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || 'request_failed');
  }
  return data as T;
}
