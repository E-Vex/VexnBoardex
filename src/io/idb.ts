/**
 * Shared IndexedDB connection for the board's browser-side stores (T-034).
 *
 * One database, explicit version history — so the stores can never race
 * each other on different schema versions:
 *
 * - v1 (T-013): the `autosave` store only.
 * - v2 (T-034): adds the `templates` store. An upgrade from v1 PRESERVES
 *   the autosave data (IndexedDB keeps existing object stores), which the
 *   templates e2e covers by reloading with a live autosave intact.
 *
 * Browser-only; the pure serialization lives in core/serialize.ts (D-06).
 */

const DB_NAME = 'vexboard';

/** The object stores the board keeps, in creation order. */
const STORES = ['autosave', 'templates'] as const;

/** Current schema version (see the header). */
export const DB_VERSION = 2;

/** Open (or upgrade) the board database at the current version. */
export function openBoardDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
