// eslint.config.js — flat config.
// Enforces the layer dependency rule from docs/PLAN.md section 4:
//   core  → (nothing)
//   view  → core
//   io    → core
//   input → core, view
//   ui    → core, view, input
import tseslint from 'typescript-eslint';

/** Allowed intra-layer imports for each layer (`../x` form). */
const LAYER_ALLOW = {
  core: [],
  view: ['core'],
  io: ['core'],
  input: ['core', 'view'],
  ui: ['core', 'view', 'input'],
};

/** Build one `no-restricted-imports` override block for a layer directory. */
function layerBlock(layer) {
  const allowed = LAYER_ALLOW[layer];
  // Only layers NOT in this layer's allowlist are blocked — e.g. view may
  // import core (PLAN §4), so core must not appear in view's blocked list.
  const blocked = Object.keys(LAYER_ALLOW).filter(
    (l) => l !== layer && !allowed.includes(l),
  );
  return {
    files: [`src/${layer}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            // Block any import that reaches into a layer not allowed here…
            ...blocked.map((l) => ({
              group: [`**/${l}/**`, `../${l}`, `../${l}/**`],
              message: `Layer "${layer}" may not import from "${l}". Allowed: ${allowed.length ? allowed.join(', ') : 'nothing'} (see PLAN §4).`,
            })),
            // …and relative escapes out of src/ entirely.
            {
              group: ['../../../*'],
              message: 'Imports must stay inside src/ layers.',
            },
          ],
        },
      ],
    },
  };
}

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  ...Object.keys(LAYER_ALLOW).map(layerBlock),
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // e2e tests are BLACK BOX (T-002 brief R2): they may not import from
    // src/ — they only talk to the running page through Playwright.
    files: ['e2e/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../src/**', '../src', 'src/**'],
              message:
                'e2e tests must stay black-box: no imports from src/ (see T-002 R2).',
            },
          ],
        },
      ],
    },
  },
  {
    // T-003 R3 / T-004 R7: DOM-free source files — camera purity and grid
    // math enforced by tooling (PLAN D-18). No window/document/navigator/
    // devicePixelRatio/requestAnimationFrame/performance and no DOM types may
    // appear in these files.
    files: ['src/view/camera.ts', 'src/view/grid.ts', 'src/ui/hudFormat.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'window',
          message: 'DOM-free file (PLAN R3/R7, D-18): pure math only.',
        },
        {
          name: 'document',
          message: 'DOM-free file (PLAN R3/R7, D-18): pure math only.',
        },
        {
          name: 'navigator',
          message: 'DOM-free file (PLAN R3/R7, D-18): pure math only.',
        },
        {
          name: 'devicePixelRatio',
          message:
            'devicePixelRatio is handled only in the canvas host (PLAN D-07).',
        },
        {
          name: 'requestAnimationFrame',
          message: 'DOM-free file (PLAN R3/R7, D-18): pure math only.',
        },
        {
          name: 'performance',
          message: 'DOM-free file (PLAN R3/R7, D-18): pure math only.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "TSTypeReference > Identifier[name=/^(Window|Document|Navigator|Performance|Element|HTMLElement|HTMLCanvasElement|CanvasRenderingContext2D|Event|MouseEvent|PointerEvent|WheelEvent|KeyboardEvent|TouchEvent|DOMRect|DOMPoint|Screen)$/]",
          message:
            'DOM types are forbidden in DOM-free files (PLAN R3/R7, D-18).',
        },
      ],
    },
  },
);
