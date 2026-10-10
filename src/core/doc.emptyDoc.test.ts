import { describe, expect, it } from 'vitest';

import { emptyDoc } from './doc';

describe('emptyDoc', () => {
  it('returns a fresh empty document', () => {
    expect(emptyDoc()).toEqual({
      nodes: {},
      edges: {},
      groups: {},
      order: [],
    });
  });

  it('returns a new object each call (no shared reference)', () => {
    const a = emptyDoc();
    const b = emptyDoc();
    expect(a).not.toBe(b);
    expect(a.nodes).not.toBe(b.nodes);
    expect(a.edges).not.toBe(b.edges);
    expect(a.groups).not.toBe(b.groups);
    expect(a.order).not.toBe(b.order);
  });

  it('mutating one does not affect another', () => {
    const a = emptyDoc();
    const b = emptyDoc();
    a.order.push('n1');
    expect(b.order).toEqual([]);
  });
});
