import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { api } from './api';

/**
 * Durable outbox for recordings.
 *
 * The moment a recording stops, its file is moved out of the OS cache (which can be
 * purged) into the app's documents folder and listed here. Uploads are retried on
 * every app launch / foreground until the server confirms, and each upload carries a
 * stable clientId so a retry can never create a duplicate note.
 */

const STORAGE_KEY = 'recap.pendingRecordings.v1';
const DIR = `${FileSystem.documentDirectory}recordings/`;

export interface PendingRecording {
  id: string;
  uri: string;
  mode: string;
  duration: number;
  personId?: string | null;
  recordedAt: string;
  attempts: number;
  lastError?: string | null;
  lastAttemptAt?: string | null;
}

interface QueueState {
  items: PendingRecording[];
  uploading: string | null;
  set: (items: PendingRecording[]) => void;
  setUploading: (id: string | null) => void;
}

export const useRecordingQueue = create<QueueState>((set) => ({
  items: [],
  uploading: null,
  set: (items) => set({ items }),
  setUploading: (uploading) => set({ uploading }),
}));

export function newRecordingId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readQueue(): Promise<PendingRecording[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const items = raw ? (JSON.parse(raw) as PendingRecording[]) : [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: PendingRecording[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  useRecordingQueue.getState().set(items);
}

export async function loadQueue() {
  const items = await readQueue();
  // Drop entries whose file no longer exists
  const alive: PendingRecording[] = [];
  for (const item of items) {
    const info = await FileSystem.getInfoAsync(item.uri).catch(() => ({ exists: false }));
    if (info.exists) alive.push(item);
  }
  if (alive.length !== items.length) await writeQueue(alive);
  else useRecordingQueue.getState().set(alive);
  return alive;
}

/** Move a finished recording somewhere safe and add it to the outbox. */
export async function saveRecording(tempUri: string, meta: Omit<PendingRecording, 'uri' | 'attempts' | 'id'> & { id?: string }): Promise<PendingRecording> {
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  const id = meta.id ?? newRecordingId();
  const ext = tempUri.split('.').pop()?.split('?')[0] || 'm4a';
  const dest = `${DIR}${id}.${ext}`;
  try {
    await FileSystem.moveAsync({ from: tempUri, to: dest });
  } catch {
    // Some platforms can't move across volumes; copy instead
    await FileSystem.copyAsync({ from: tempUri, to: dest });
    FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
  }
  const item: PendingRecording = { ...meta, id, uri: dest, attempts: 0, lastError: null };
  const items = await readQueue();
  await writeQueue([...items.filter((i) => i.id !== id), item]);
  return item;
}

async function patchItem(id: string, patch: Partial<PendingRecording>) {
  const items = await readQueue();
  await writeQueue(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
}

export async function removeRecording(id: string) {
  const items = await readQueue();
  const item = items.find((i) => i.id === id);
  if (item) await FileSystem.deleteAsync(item.uri, { idempotent: true }).catch(() => {});
  await writeQueue(items.filter((i) => i.id !== id));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('The upload timed out')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Upload one recording. Resolves with the new note id; the file is deleted only on success. */
export async function uploadRecording(item: PendingRecording): Promise<string> {
  useRecordingQueue.getState().setUploading(item.id);
  try {
    const formData = new FormData();
    const ext = item.uri.split('.').pop() || 'm4a';
    formData.append('audio', { uri: item.uri, name: `recording.${ext}`, type: ext === 'm4a' ? 'audio/m4a' : `audio/${ext}` } as any);
    formData.append('mode', item.mode || 'general');
    formData.append('duration', String(Math.round(item.duration || 0)));
    formData.append('clientId', item.id);
    formData.append('recordedAt', item.recordedAt);
    if (item.personId) formData.append('personId', item.personId);

    // Generous timeout: long recordings on slow connections
    const res = await withTimeout(api.upload<{ id: string }>('/notes', formData), 10 * 60 * 1000);
    await removeRecording(item.id);
    return res.id;
  } catch (err) {
    await patchItem(item.id, {
      attempts: (item.attempts || 0) + 1,
      lastError: err instanceof Error ? err.message : 'Upload failed',
      lastAttemptAt: new Date().toISOString(),
    });
    throw err;
  } finally {
    useRecordingQueue.getState().setUploading(null);
  }
}

let draining: Promise<void> | null = null;

/** Try to upload everything in the outbox (one at a time). Safe to call often. */
export function processQueue(): Promise<void> {
  if (draining) return draining;
  draining = (async () => {
    const items = await loadQueue();
    for (const item of items) {
      try {
        await uploadRecording(item);
      } catch {
        // stays queued; retried next time the app is opened or foregrounded
      }
    }
  })().finally(() => {
    draining = null;
  });
  return draining;
}
