import AsyncStorage from '@react-native-async-storage/async-storage';

// A small persisted log of files this phone has received, so the Receive screen
// can list them with share/open actions across app restarts (not just the last
// one). Capped so it can't grow without bound.

export interface ReceivedFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  location: string; // content:// (Downloads) or a file path fallback
  at: number; // epoch ms
  folder?: string; // set when it arrived as part of a folder transfer
}

const KEY = 'owlsend.received';
const MAX = 100;

export async function loadReceived(): Promise<ReceivedFile[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ReceivedFile[]) : [];
  } catch {
    return [];
  }
}

export async function addReceived(file: ReceivedFile): Promise<ReceivedFile[]> {
  const list = await loadReceived();
  const next = [file, ...list].slice(0, MAX);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  return next;
}

export async function clearReceived(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}
}
