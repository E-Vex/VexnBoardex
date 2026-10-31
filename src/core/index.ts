// core: document model, commands, patches, history, serialize, migrate, geometry — pure TypeScript, no DOM (PLAN §4, D-06).
export * from './geometry';
export * from './edgeGeometry';
export * from './types';
export { emptyDoc, validateDoc } from './doc';
export { deepEqual } from './deepEqual';
export { contentBounds } from './contentBounds';
export {
  applyPatch,
  invertPatch,
  isEmptyPatch,
  PatchConflictError,
} from './patch';
export { compileCommand, CommandError } from './commands';
export { createDocStore } from './store';
export type { DocStore } from './store';
export {
  hitTest,
  hitTestWithHandles,
  HANDLE_ANCHORS,
  HANDLE_HIT_RADIUS,
  type HitResult,
} from './hitTest';
export {
  serializeDoc,
  deserializeDoc,
  coerceDoc,
  FILE_VERSION,
  type FileEnvelope,
  type LoadResult,
} from './serialize';
