/**
 * IndexedDB autosave (T-013, PLAN §4, M4).
 *
 * Debounced persistence of the document envelope (doc + view) to IndexedDB.
 * Pure core logic is in core/serialize.ts; this is the browser-only storage layer.
 */

import type { Doc } from '../core/types';
import { serializeDoc, deserializeDoc, type FileEnvelope } from '../core/serialize';

const DB_NAME = 'vexboard';
const STORE_NAME = 'autosave';
const DB_VERSION = 1;
const AUTOSAVE_KEY = 'current';
const DEBOUNCE_MS = 1000;

/** Open (or create) the IndexedDB database. */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Save the envelope to IndexedDB. */
export async function saveAutosave(envelope: FileEnvelope): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(envelope, AUTOSAVE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Load the envelope from IndexedDB. */
export async function loadAutosave(): Promise<{ envelope: FileEnvelope; warnings: string[] } | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(AUTOSAVE_KEY);
    request.onsuccess = () => {
      if (request.result) {
        const envelope = request.result as FileEnvelope;
        // Re-validate on load (migrations run in deserializeDoc).
        const result = deserializeDoc(JSON.stringify(envelope));
        resolve({ envelope: result.envelope, warnings: result.warnings });
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/** Clear the autosave (e.g., on explicit "new board" or user request). */
export async function clearAutosave(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(AUTOSAVE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Create a debounced autosave function.
 * Call `autosave(doc, view)` on every document/view change.
 * The actual write happens after DEBOUNCE_MS of inactivity.
 */
export interface Autosaver {
  update(doc: Doc, view?: { x: number; y: number; zoom: number }): void;
  flush(): Promise<void>;
}

/**
 * Create a debounced autosave.
 * Call `autosaver.update(doc, view)` on every document/view change.
 * The actual write happens after DEBOUNCE_MS of inactivity, or immediately
 * when `autosaver.flush()` is called.
 */
export function createAutosaver(): Autosaver {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let pendingEnvelope: FileEnvelope | null = null;

  const flush = async (): Promise<void> => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (pendingEnvelope) {
      try {
        await saveAutosave(pendingEnvelope);
      } catch (e) {
        console.warn('[autosave] failed:', e);
      }
      pendingEnvelope = null;
    }
  };

  return {
    update(doc: Doc, view?: { x: number; y: number; zoom: number }) {
      const json = serializeDoc(doc, view);
      pendingEnvelope = JSON.parse(json);

      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(flush, DEBOUNCE_MS);
    },
    flush,
  };
}