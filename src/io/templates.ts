/**
 * Named templates (T-034, PLAN M9, D-14) — browser-only storage, exactly like
 * autosave: a template IS a saved document (its FileEnvelope, doc + optional
 * view), kept in the `templates` store of the shared board database (./idb).
 *
 * A template record is `{ id, name, savedAt, envelope }`: the id and the
 * epoch-milliseconds save time are generated HERE (io is outside core's
 * purity boundary, D-06/D-11), the name is validated on save (trimmed,
 * non-empty). Saving never mutates the current document.
 */

import { type FileEnvelope } from '../core/serialize';
import { openBoardDb } from './idb';

const STORE_NAME = 'templates';

/** One saved template: a named saved document (D-14) plus its save time. */
export interface TemplateRecord {
  id: string;
  name: string;
  /** Epoch milliseconds at save time (io layer owns the clock). */
  savedAt: number;
  /** The saved document — exactly what serializeDoc produces. */
  envelope: FileEnvelope;
}

/**
 * Save the current document as a named template. The name is trimmed and
 * must be non-empty (throws otherwise). Returns the stored record.
 */
export async function saveTemplate(
  name: string,
  envelope: FileEnvelope,
): Promise<TemplateRecord> {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new Error('saveTemplate: name is empty');
  }
  const record: TemplateRecord = {
    id: crypto.randomUUID(),
    name: trimmed,
    savedAt: Date.now(),
    envelope,
  };
  const db = await openBoardDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record, record.id);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Every saved template, newest first (ties broken by id, so the order is
 * deterministic). Records that fail their own shape check are skipped, not
 * thrown — a listing must never take the toolbar down.
 */
export async function listTemplates(): Promise<TemplateRecord[]> {
  const db = await openBoardDb();
  const records: TemplateRecord[] = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as TemplateRecord[]);
    request.onerror = () => reject(request.error);
  });
  return records
    .filter(
      (r) =>
        typeof r?.id === 'string' &&
        typeof r?.name === 'string' &&
        typeof r?.savedAt === 'number' &&
        r?.envelope !== null &&
        typeof r?.envelope === 'object',
    )
    .sort((a, b) => b.savedAt - a.savedAt || (a.id < b.id ? -1 : 1));
}

/** Delete one template by id. Deleting an unknown id is a no-op. */
export async function deleteTemplate(id: string): Promise<void> {
  const db = await openBoardDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
