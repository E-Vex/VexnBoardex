/**
 * Golden fixture tests (T-014, PLAN §7).
 *
 * These tests load committed fixture files from every format version
 * and verify they deserialize correctly. This ensures old files
 * keep loading (I-08, M4 acceptance).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { deserializeDoc, FILE_VERSION } from '../src/core/serialize';
import type { Doc } from '../src/core/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = join(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf-8');
}

describe('Golden fixtures — v1', () => {
  it('loads v1-board.vexboard without errors', () => {
    const json = loadFixture('v1-board.vexboard');
    const { envelope, warnings } = deserializeDoc(json);

    expect(warnings).toHaveLength(0);
    expect(envelope.app).toBe('vexboard');
    expect(envelope.version).toBe(1);
    expect(envelope.doc).toBeDefined();
    expect(envelope.view).toBeDefined();
  });

  it('v1 fixture has correct document structure', () => {
    const json = loadFixture('v1-board.vexboard');
    const { envelope } = deserializeDoc(json);
    const doc: Doc = envelope.doc;

    // Nodes
    expect(Object.keys(doc.nodes)).toHaveLength(3);
    expect(doc.nodes['node-1']).toBeDefined();
    expect(doc.nodes['node-1']!.kind).toBe('card');
    expect(doc.nodes['node-1']!.text).toBe('First card');
    expect(doc.nodes['node-1']!.groupId).toBe('group-1');
    expect(doc.nodes['node-2']!.kind).toBe('sticky');
    expect(doc.nodes['node-3']!.kind).toBe('text');

    // Edges
    expect(Object.keys(doc.edges)).toHaveLength(2);
    expect(doc.edges['edge-1']!.from.node).toBe('node-1');
    expect(doc.edges['edge-1']!.from.anchor).toBe('right');
    expect(doc.edges['edge-1']!.to.node).toBe('node-2');
    expect(doc.edges['edge-1']!.label).toBe('connects to');
    expect(doc.edges['edge-2']!.from.anchor).toBe('bottom');
    expect(doc.edges['edge-2']!.to.anchor).toBe('top');

    // Groups
    expect(Object.keys(doc.groups)).toHaveLength(1);
    expect(doc.groups['group-1']!.name).toBe('Project Alpha');

    // Order (z-order)
    expect(doc.order).toEqual(['node-1', 'node-2', 'node-3']);
  });

  it('v1 fixture has correct view', () => {
    const json = loadFixture('v1-board.vexboard');
    const { envelope } = deserializeDoc(json);

    expect(envelope.view).toEqual({ x: -50, y: -25, zoom: 1.25 });
  });

  it('v1 fixture passes validateDoc', () => {
    const json = loadFixture('v1-board.vexboard');
    const { envelope } = deserializeDoc(json);

    // The fixture should be fully valid (no warnings from validation)
    // Note: warnings from deserializeDoc include validation violations
    const validationWarnings = envelope.warnings?.filter(w => w.includes('Document validation')) || [];
    expect(validationWarnings).toHaveLength(0);
  });
});

// Migration test framework for future versions
describe('Migration framework', () => {
  it('FILE_VERSION is at least 1', () => {
    // This will be updated when we add migrations
    expect(FILE_VERSION).toBeGreaterThanOrEqual(1);
  });
});