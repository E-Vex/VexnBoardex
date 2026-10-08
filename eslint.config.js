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
  const otherLayers = Object.keys(LAYER_ALLOW).filter((l) => l !== layer);
  return {
    files: [`src/${layer}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            // Block any import that reaches into another layer's folder…
            ...otherLayers.map((l) => ({
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
);
