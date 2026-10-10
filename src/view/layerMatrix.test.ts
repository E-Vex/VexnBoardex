// Layer-rule matrix test (T-004 Part A-2).
//
// The T-003 lint fix only tested forbidden imports one-by-one. This test
// exercises EVERY ordered pair of layers through ESLint's Node API
// (`lintText` with a `filePath` inside each layer directory) so the allow
// matrix from PLAN §4 is enforced as a whole:
//
//   core  → (nothing)
//   view  → core
//   io    → core
//   input → core, view
//   ui    → core, view, input
//
// Same-layer imports are always allowed; every other cross-layer pair is
// forbidden. Additionally, `e2e/**` importing from `src/` is an error
// (T-002 R2, black-box).
//
// This file lives in src/view/ so vitest (include: src/**/*.test.ts) picks
// it up and tsconfig.json (include: src) type-checks it. It imports only
// `eslint` and `vitest` — neither is a project layer, so no layer rule is
// weakened.
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const LAYERS = ['core', 'view', 'io', 'input', 'ui'] as const;
type Layer = (typeof LAYERS)[number];

/** PLAN §4 allowed intra-layer targets for each layer. */
const ALLOW: Record<Layer, Layer[]> = {
  core: [],
  view: ['core'],
  io: ['core'],
  input: ['core', 'view'],
  ui: ['core', 'view', 'input'],
};

// One shared ESLint instance — config is loaded lazily on the first lint.
const eslint = new ESLint();

/**
 * Lint a single type-only import as if it lived in `sourceLayer`.
 * Returns true when the import is allowed (zero errors), false when a
 * `no-restricted-imports` violation fires.
 *
 * `import type` is used so no runtime binding is created. The binding is
 * named `_X` to satisfy `@typescript-eslint/no-unused-vars`
 * (`varsIgnorePattern: '^_'`). `no-restricted-imports` checks type imports
 * by default (`allowTypeImports` defaults to `false`), so the layer rule is
 * still enforced — confirmed by the debug run showing the rule fires for
 * `import type { _X } from '../io/foo'`.
 */
async function importAllowed(
  sourceLayer: Layer,
  importPath: string,
): Promise<boolean> {
  const code = `import type { _X } from '${importPath}';\n`;
  const filePath = `src/${sourceLayer}/__matrix_test__.ts`;
  const [result] = await eslint.lintText(code, { filePath });
  return result !== undefined && result.errorCount === 0;
}

describe('layer import rule matrix (PLAN §4)', () => {
  // Cross-layer pairs: allowed iff target ∈ ALLOW[source].
  for (const source of LAYERS) {
    for (const target of LAYERS) {
      if (source === target) continue;
      const allowed = ALLOW[source].includes(target);
      it(`${source} -> ${target} ${allowed ? 'is allowed' : 'is forbidden'}`, async () => {
        const ok = await importAllowed(source, `../${target}/foo`);
        expect(ok).toBe(allowed);
      });
    }
  }

  // Same-layer imports are always allowed.
  for (const layer of LAYERS) {
    it(`${layer} -> ${layer} (same layer, relative ./) is allowed`, async () => {
      const ok = await importAllowed(layer, './foo');
      expect(ok).toBe(true);
    });
  }

  // e2e tests may not import from src/ (T-002 R2, black-box).
  it('e2e -> src/ is forbidden', async () => {
    const code = `import type { _X } from '../src/foo';\n`;
    const [result] = await eslint.lintText(code, {
      filePath: 'e2e/__matrix_test__.ts',
    });
    expect(result?.errorCount ?? 0).toBeGreaterThan(0);
  });
});
