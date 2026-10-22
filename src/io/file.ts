/**
 * File export / import (T-013, PLAN §4, D-12).
 *
 * Browser-only (uses DOM APIs: FileReader, Blob, a[download]).
 * Core serialization logic lives in core/serialize.ts (pure, no DOM).
 */

import type { Doc } from '../core/types';
import { deserializeDoc, serializeDoc, type FileEnvelope } from '../core/serialize';

/** Result of a file import. */
export interface ImportResult {
  envelope: FileEnvelope;
  warnings: string[];
}

/** Export the current document as a .vexboard JSON file (download). */
export function exportFile(doc: Doc, view?: { x: number; y: number; zoom: number }, filename?: string): void {
  const json = serializeDoc(doc, view);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `vexboard-${Date.now()}.vexboard`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Import a .vexboard JSON file (returns a promise that resolves on file load). */
export function importFile(file: File): Promise<ImportResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = deserializeDoc(reader.result as string);
        resolve({ envelope: result.envelope, warnings: result.warnings });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

/** Trigger a file picker for import. */
export function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.vexboard,application/json';
    input.onchange = () => {
      resolve(input.files?.[0] || null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Check if the browser supports the File System Access API (optional enhancement). */
export function supportsFileSystemAccess(): boolean {
  return 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;
}

/** Modern export using File System Access API (when available). */
export async function exportFileModern(doc: Doc, view?: { x: number; y: number; zoom: number }): Promise<void> {
  if (!supportsFileSystemAccess()) {
    exportFile(doc, view);
    return;
  }
  try {
    const handle = await (window as unknown as { showSaveFilePicker: (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
      suggestedName: `vexboard-${Date.now()}.vexboard`,
      types: [{ description: 'VexBoard files', accept: { 'application/json': ['.vexboard'] } }],
    });
    const writable = await handle.createWritable();
    const json = serializeDoc(doc, view);
    await writable.write(json);
    await writable.close();
  } catch {
    // User cancelled or API error; fall back to classic download.
    exportFile(doc, view);
  }
}

/** Modern import using File System Access API (when available). */
export async function importFileModern(): Promise<ImportResult | null> {
  if (!supportsFileSystemAccess()) {
    const file = await pickFile();
    return file ? importFile(file) : null;
  }
  try {
    const handles = await (window as unknown as { showOpenFilePicker: (options: { types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker({
      types: [{ description: 'VexBoard files', accept: { 'application/json': ['.vexboard'] } }],
    });
    const handle = handles[0];
    if (!handle) return null;
    const file = await handle.getFile();
    return importFile(file);
  } catch {
    return null; // User cancelled
  }
}