/**
 * Unit tests for serialization / deserialization (T-012).
 */

import { describe, expect, it } from 'vitest';

import { emptyDoc } from './doc';
import type { Doc } from './types';
import { serializeDoc, deserializeDoc, coerceDoc, FILE_VERSION } from './serialize';

function makeDoc(): Doc {
  const doc = emptyDoc();
  doc.nodes['n1'] = {
    id: 'n1',
    kind: 'card',
    x: 100,
    y: 200,
    w: 200,
    h: 120,
    text: 'Hello',
    color: '#d7e5f7',
    tags: ['tag1'],
  };
  doc.nodes['n2'] = {
    id: 'n2',
    kind: 'sticky',
    x: 400,
    y: 200,
    w: 160,
    h: 120,
    text: 'World',
    color: '#fef3a2',
    tags: [],
  };
  doc.edges['e1'] = {
    id: 'e1',
    from: { node: 'n1', anchor: 'right' },
    to: { node: 'n2', anchor: 'left' },
    label: 'link',
  };
  doc.groups['g1'] = { id: 'g1', name: 'Group 1' };
  doc.nodes['n1'].groupId = 'g1';
  doc.order = ['n1', 'n2'];
  return doc;
}

describe('serializeDoc', () => {
  it('produces valid JSON with correct envelope', () => {
    const doc = makeDoc();
    const json = serializeDoc(doc);
    const envelope = JSON.parse(json);

    expect(envelope.app).toBe('vexboard');
    expect(envelope.version).toBe(FILE_VERSION);
    expect(envelope.doc).toBeDefined();
    expect(envelope.doc.nodes.n1.text).toBe('Hello');
    expect(envelope.doc.edges.e1.label).toBe('link');
    expect(envelope.doc.groups.g1.name).toBe('Group 1');
    expect(envelope.doc.order).toEqual(['n1', 'n2']);
  });

  it('includes view when provided', () => {
    const doc = makeDoc();
    const view = { x: -100, y: -50, zoom: 1.5 };
    const json = serializeDoc(doc, view);
    const envelope = JSON.parse(json);

    expect(envelope.view).toEqual(view);
  });

  it('omits view when not provided', () => {
    const doc = makeDoc();
    const json = serializeDoc(doc);
    const envelope = JSON.parse(json);

    expect(envelope.view).toBeUndefined();
  });
});

describe('deserializeDoc', () => {
  it('round-trips a valid document', () => {
    const doc = makeDoc();
    const json = serializeDoc(doc);
    const { envelope, warnings } = deserializeDoc(json);

    expect(warnings).toHaveLength(0);
    expect(envelope.app).toBe('vexboard');
    expect(envelope.version).toBe(FILE_VERSION);
    expect(envelope.doc.nodes.n1).toEqual(doc.nodes.n1);
    expect(envelope.doc.nodes.n2).toEqual(doc.nodes.n2);
    expect(envelope.doc.edges.e1).toEqual(doc.edges.e1);
    expect(envelope.doc.groups.g1).toEqual(doc.groups.g1);
    expect(envelope.doc.order).toEqual(doc.order);
  });

  it('accepts unknown fields in envelope (forward compat)', () => {
    const doc = makeDoc();
    const json = serializeDoc(doc);
    const parsed = JSON.parse(json);
    parsed.unknownField = 'preserved';
    const { envelope, warnings } = deserializeDoc(JSON.stringify(parsed));

    expect(warnings).toHaveLength(0);
    expect(envelope.unknownField).toBe('preserved');
  });

  it('accepts unknown fields in nodes (forward compat)', () => {
    const doc = makeDoc();
    const json = serializeDoc(doc);
    const parsed = JSON.parse(json);
    parsed.doc.nodes.n1.unknownNodeField = 'kept';
    const { envelope, warnings } = deserializeDoc(JSON.stringify(parsed));

    expect(warnings).toHaveLength(0);
    expect((envelope.doc.nodes.n1 as unknown as Record<string, unknown>).unknownNodeField).toBe('kept');
  });

  it('warns on invalid app name', () => {
    const doc = makeDoc();
    const json = serializeDoc(doc);
    const parsed = JSON.parse(json);
    parsed.app = 'other-app';
    const { warnings } = deserializeDoc(JSON.stringify(parsed));

    expect(warnings.some((w) => w.includes('Unknown app'))).toBe(true);
  });

  it('warns on missing version', () => {
    const doc = makeDoc();
    const json = serializeDoc(doc);
    const parsed = JSON.parse(json);
    delete parsed.version;
    const { envelope, warnings } = deserializeDoc(JSON.stringify(parsed));

    expect(warnings.some((w) => w.includes('version'))).toBe(true);
    expect(envelope.version).toBe(FILE_VERSION);
  });

  it('throws on missing doc', () => {
    const json = JSON.stringify({ app: 'vexboard', version: 1 });
    expect(() => deserializeDoc(json)).toThrow('Missing or invalid "doc" field');
  });

  it('throws on invalid JSON', () => {
    expect(() => deserializeDoc('not json')).toThrow('Invalid JSON');
  });

  it('validates document and warns on violations', () => {
    const doc = makeDoc();
    // Create invalid doc: order doesn't match nodes
    const json = JSON.stringify({
      app: 'vexboard',
      version: FILE_VERSION,
      doc: {
        nodes: doc.nodes,
        edges: doc.edges,
        groups: doc.groups,
        order: ['n1'], // missing n2
      },
    });
    const { warnings } = deserializeDoc(json);
    expect(warnings.some((w) => w.includes('order-mismatch'))).toBe(true);
  });
});

describe('FILE_VERSION', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(FILE_VERSION)).toBe(true);
    expect(FILE_VERSION).toBeGreaterThan(0);
  });
});
describe('serialize — image src field (T-023)', () => {
  it('round-trips a data-URL src', () => {
    const doc = emptyDoc();
    doc.nodes['img'] = {
      id: 'img', kind: 'image', x: 0, y: 0, w: 100, h: 100,
      text: '', color: '#fff', tags: [], src: 'data:image/png;base64,AAAA',
    };
    doc.order = ['img'];
    const json = serializeDoc(doc);
    const back = deserializeDoc(json);
    expect(back.envelope.doc.nodes['img']!.src).toBe('data:image/png;base64,AAAA');
    expect(back.warnings).toEqual([]);
  });

  it('coerceDoc preserves a string src and drops a non-string one', () => {
    const good = coerceDoc({
      nodes: { a: { id: 'a', kind: 'image', x: 0, y: 0, w: 10, h: 10, text: '', color: '#fff', tags: [], src: 'data:x' } },
      edges: {}, groups: {}, order: ['a'],
    });
    expect(good.nodes['a']!.src).toBe('data:x');
    const bad = coerceDoc({
      nodes: { a: { id: 'a', kind: 'image', x: 0, y: 0, w: 10, h: 10, text: '', color: '#fff', tags: [], src: 7 } },
      edges: {}, groups: {}, order: ['a'],
    });
    expect(bad.nodes['a']!.src).toBeUndefined();
  });
});
