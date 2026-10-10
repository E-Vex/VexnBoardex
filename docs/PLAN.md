# VexBoard — Project Plan

> Status: v1.2 · Updated 2026-10-10 (M1 closed) · Owner of this file: **Planner**
> This file is the single source of truth for architecture, decisions and workflow.
> The implementer does not edit it. Changes come from the Planner only.

---

## 1. What we are building

VexBoard is a visual drawing and planning tool: an **infinite canvas**, running in the browser first and as a Desktop app later. You place and freely move:

- Text, Sticky Notes, Cards, Images
- Arrows / Connections between elements
- Groups, Colors, Tags

It is **not** a To-Do list. It is a free-form board for thinking: idea → project → tasks → done, or a learning roadmap, or a mind map.

**The real goal:** practice a workflow where an AI agent builds a *stateful, visual* product. The hard problems are state and UX, not syntax:

- Elements move but arrows don't follow.
- Zoom 300% puts text in the wrong place.
- Undo works for delete but not for move.
- An old saved file loads with missing elements.

The architecture below is designed so these four bugs are structurally prevented, not patched.

### Non-goals (for now)

Real-time collaboration, accounts or cloud sync, touch/mobile polish, plugins, a rich-text editor.

---

## 2. Roles and communication protocol

| Role | Who | Responsibility |
|---|---|---|
| **Owner** | the user | Product direction, final say, relays messages between the other two |
| **Planner** | Claude | Architecture, decisions, slicing work into tasks, reviewing reports |
| **Implementer** | coding agent | Writes code and tests exactly to the task brief; raises problems early |

### Rules of engagement

1. **Order of authority:** task brief > this PLAN > the implementer's own assumptions. If two of them conflict, stop and ask. Never resolve it silently.
2. **No silent Decisions.** If something is unspecified:
   - If it is small and reversible (a variable name, a file split), choose the simplest option and list it in the report under *Decisions made*.
   - If it touches **state layers, coordinates, commands/history, or the file format**, stop and ask *before* writing code.
3. **Scope discipline.** Do exactly what the brief says. Notice something else worth doing? Write it under *Suggestions* in the report. Do not do it.
4. **Locked decisions (section 3) and invariants (section 5) are binding.** Disagree? Say so in the report with a reason. Do not work around them.
5. **Definition of done** for every task:
   - All acceptance criteria in the brief are met.
   - `npm run check` passes (lint + typecheck + tests).
   - New behavior has tests. A bug fix starts with a failing test.
   - No unrelated changes in the diff.
6. **Commits:** small and focused, one logical change each, message prefixed with the task id, e.g. `[T-003] feat: screenToWorld`. Never one giant commit.
7. **Evidence over claims.** "Tests pass" is not enough. Paste the relevant command output in the report as plain text inside a fenced code block. A green CI run on the pull request is the evidence for the automated checks; report its URL.
8. **Branches and merging.** One branch per task, named `task/T-xxx-slug`, created from an up-to-date `main`. Never commit to `main`. The Owner merges pull requests with a merge commit (no squash). The implementer never merges.
9. **Verification experiments.** Deliberate-breakage experiments (proving that a test, lint rule or gate can fail) run only on a throwaway branch, never on a task branch, and are never merged.
10. **Secrets.** Never write a token, password or key into any file inside the repository working tree, tracked or not, and never commit one. Keep credentials in a credential helper or an environment variable outside the repo. Tokens must be fine-grained, limited to this repository, and expire.
11. **`AGENTS.md` stays short:** 50 lines at most.
12. **Reports start with the head SHA** of the task branch, and every piece of evidence (CI run URL, test output) refers to that SHA. Never force-push a branch that is already pushed unless the Planner approved it. If history is rewritten, the report says so, with before/after SHAs and the reason.
13. **Quota discipline.** Briefs list a priority order. Push after every commit. If budget runs low, stop at a clean commit boundary with everything pushed and say exactly what remains.

### Task brief format (Planner → Implementer)

```
# TASK T-xxx — <title>
Milestone / Depends on
## Read first        (which PLAN sections are binding)
## Goal              (one paragraph)
## Layers touched    (core / view / input / ui / io)
## Invariants        (which I-xx are at risk in this task)
## Requirements      (concrete, numbered)
## Out of scope      (explicit)
## Acceptance        (checkable commands / behaviors)
## Commits           (expected order)
## Report back
## Stop and ask if
```

### Report format (Implementer → Planner)

```
# REPORT T-xxx
## Summary                 (2–3 lines)
## Acceptance checklist    (each criterion: done / not done + evidence)
## Decisions made          (small choices; "none" if none)
## Questions / deviations  (anything that conflicts with PLAN or the brief; "none" if none)
## Risks noticed
## Suggestions             (not done, only proposed)
```

---

## 3. Locked decisions

| ID | Decision | Why |
|---|---|---|
| D-01 | **TypeScript (strict) + Vite.** Vanilla DOM for toolbars, **no UI framework**. | A canvas app is imperative; a framework adds a second state system to fight with. |
| D-02 | **Canvas 2D** for the board. A **DOM overlay** (textarea) for editing text. | Full control, easy PNG export, scales to thousands of nodes. DOM text editing handles input, IME and selection for free. |
| D-03 | **npm** and **Node 24** (LTS), pinned in `.nvmrc` and `engines.node`, enforced by `engine-strict=true` in `.npmrc`. Node 20 is end of life. Revisit when Node 26 becomes LTS. | Simple, reproducible, and CI uses the same version via `.nvmrc`. |
| D-04 | **Vitest** for unit tests (colocated `*.test.ts`). **Playwright** (Chromium only) for browser tests in `e2e/`, strictly black-box: e2e files never import from `src/`. | Core logic is testable without a browser; behavior needs a real one. |
| D-05 | **Three state layers:** Document, View, UI (section 4). | Mixing them causes the undo and zoom bugs. |
| D-06 | **`core/` is pure:** no DOM, no `Math.random`, no clock, no I/O. IDs and timestamps are passed in. Enforced by tooling (a core tsconfig *without* the DOM lib, plus lint import rules). | Deterministic, trivially testable, safe to reuse in Desktop. |
| D-07 | **World coordinates and camera.** 1 world unit = 1 CSS px at zoom 1. Camera `{ x, y, zoom }` where `(x, y)` is the **world point at the viewport's top-left**. `screen = (world − cam) × zoom`, `world = screen / zoom + cam`. `devicePixelRatio` is handled **only** in the canvas host. | One definition prevents the zoom/offset class of bugs. |
| D-08 | **Zoom range 0.05–8.** Zoom is always anchored at the cursor. | Keeps the point under the mouse fixed. |
| D-09 | **Commands compile to entity patches** `{ before, after }` per touched entity. History is a stack of patches. Undo applies the inverse. | One mechanism for create/move/delete/cascade means undo cannot "work for delete but not move". |
| D-10 | **On-demand rendering** (dirty flag + `requestAnimationFrame`). The renderer is a **pure function of (document, view, ui)** and keeps no state of its own. | No stale visuals, no wasted frames. |
| D-11 | **IDs are string UUIDs**, generated *outside* core (`crypto.randomUUID()` in input/ui) and injected into commands. | Keeps core deterministic (D-06). |
| D-12 | **File format:** JSON `{ app: "vexboard", version, doc, view? }`, a migration chain (`v1→v2→…`), and a defensive loader. | Old files must keep loading. |
| D-13 | **Z-order** is an `order: Id[]` array (bottom → top). Hit-testing checks top-most first. | Simple, explicit, serializable. |
| D-14 | **Modes** (Mind Map, Flowchart, Kanban) are behaviors layered on the *same* document model, not separate formats. Templates are saved documents. | Avoids three parallel data models. |
| D-15 | **Desktop = Tauri**, added at the end (M10). The web app must work unchanged inside it. | Keeps the web build the primary target. |
| D-16 | **Tooling as of M0:** Vite 8, Vitest 5, ESLint 10 with typescript-eslint, Prettier, `@playwright/test`. Layer boundaries are enforced by ESLint `no-restricted-imports` and a DOM-free `tsconfig.core.json`. | Tooling, not discipline, protects the architecture. |
| D-17 | **CI:** GitHub Actions, one job named `check`: hygiene guard → `npm run check` → `npm run build` → Playwright e2e. Runs on every pull request and every push to `main`. `main` requires this check to pass. The runner is pinned to `ubuntu-24.04`. | A green check is the acceptance evidence. |
| D-18 | **Camera functions are pure.** They return new values, never mutate, work in CSS pixels (never device pixels), and treat non-finite input as a no-op (return the camera unchanged). | A camera that becomes `NaN` makes everything vanish. |
| D-19 | **Input conventions.** Plain wheel pans. Ctrl/⌘ + wheel zooms at the cursor (this also covers trackpad pinch in Chrome and Firefox). Space + left-drag or middle-drag pans. `+`, `-`, `0` zoom in (×1.25), zoom out (×0.8) and reset to 100%, around the viewport center. Wheel zoom factor is `clamp(exp(−deltaPx × 0.002), 0.5, 2)`. Plain left-drag is reserved for selection and tools. Touch is out of scope for now. | Matches common whiteboard tools and keeps the primary mouse button free for editing. |
| D-20 | **Camera at startup:** the world origin is centered in the viewport at zoom 1 (`cameraCenteredOn`). A window resize keeps the camera's top-left world point fixed. Camera state lives in a pure `cameraStore` (`get`, `set`, `subscribe`). | Predictable start; one observable source of truth. |
| D-21 | **`order` holds node ids only** (bottom → top). Edges render beneath all nodes. Hit-testing checks nodes top-most first. | Simple, explicit z-order; clarifies D-13. |
| D-22 | **Commands are plain, serializable data.** `compileCommand(doc, command) → Patch` is pure and strict: an invalid command (unknown id, duplicate id, non-finite number, dangling reference) throws `CommandError`. A no-op command compiles to an empty patch. `applyPatch` is strict too: it throws `PatchConflictError` if a patch's `before` does not match the document. IDs come from the caller (D-11). | Desync bugs fail loudly in tests instead of silently corrupting a document. |
| D-23 | **Determinism is enforced by lint in `core/`:** no `Date` and no `Math.random` in non-test core files. | D-06 enforced by tooling. |
| D-24 | **Document validity** is defined by `validateDoc` (pure): `order` is exactly a permutation of the node ids; every map key equals its entity's id; every edge references two existing, distinct nodes; every `groupId` references an existing group; all numbers are finite, with `w > 0` and `h > 0`. Property tests run it after every command. | One definition of "valid", reused by the loader in M4. |

---

## 4. Architecture

### State layers

| Layer | Contains | Saved? | In undo history? |
|---|---|---|---|
| **Document** | nodes, edges, groups, z-order | Yes | Yes |
| **View** | camera `{ x, y, zoom }` | Optional | No |
| **UI** | selection, active tool, drag preview, hover, editing state | No | No |

### Folder layout and dependency rule

```
src/
  core/    document model, commands, patches, history, serialize, migrate, geometry
           (pure TypeScript, no DOM)
  view/    camera math, canvas host, renderer, hit-testing
  input/   pointer + keyboard → tool state machine → commands
  ui/      toolbar, inspector, text-editor overlay
  io/      file open/save, export (PNG/JSON)
```

Allowed imports (anything else is a violation):

```
core  → (nothing)
view  → core
io    → core
input → core, view
ui    → core, view, input
```

### Data model (sketch — the exact types are defined in tasks)

```ts
type Id = string

type Doc = {
  nodes: Record<Id, Node>
  edges: Record<Id, Edge>
  groups: Record<Id, Group>
  order: Id[]                    // z-order of node ids, bottom → top (D-21)
}

type Node = {
  id: Id
  kind: 'text' | 'sticky' | 'card' | 'image'
  x: number; y: number; w: number; h: number   // world coordinates
  text: string
  color: string
  tags: string[]
  groupId?: Id
}

type Edge = {
  id: Id
  from: { node: Id; anchor: 'auto' | 'top' | 'right' | 'bottom' | 'left' }
  to:   { node: Id; anchor: 'auto' | 'top' | 'right' | 'bottom' | 'left' }
  label?: string
}

type Group = { id: Id; name: string }

type Camera = { x: number; y: number; zoom: number }   // View layer state

// A command's result. Undo = apply the inverse.
type Patch = {
  nodes:  Record<Id, { before?: Node;  after?: Node  }>
  edges:  Record<Id, { before?: Edge;  after?: Edge  }>
  groups: Record<Id, { before?: Group; after?: Group }>
  order?: { before: Id[]; after: Id[] }
}
```

### Camera API (`src/view/camera.ts`, pure, no DOM)

```ts
type Camera = { x: number; y: number; zoom: number }   // (x, y) = world point at the viewport's top-left

worldToScreen(cam, p)                  // (p − cam) × zoom
screenToWorld(cam, p)                  // p / zoom + cam
panBy(cam, dxScreen, dyScreen)         // content follows the pointer: cam − d / zoom
zoomAt(cam, screenPoint, newZoom)      // clamp, then keep the world point under screenPoint fixed
zoomByFactorAt(cam, screenPoint, factor)
visibleWorldRect(cam, width, height)   // { x: cam.x, y: cam.y, w: width / zoom, h: height / zoom }
cameraCenteredOn(world, width, height, zoom)   // camera that puts `world` at the viewport center
```

### Core API (`src/core/`, pure: no DOM, no randomness, no clock)

```ts
type Command =                                   // plain data; ids are supplied by the caller
  | { type: 'node.create'; node: Node }          // appended on top of `order`
  | { type: 'node.move';   ids: Id[]; dx: number; dy: number }
  | { type: 'node.delete'; ids: Id[] }           // also removes every edge touching them, in the same patch (I-09)
  // edge.create / edge.delete arrive in M3

emptyDoc(): Doc
validateDoc(doc): string[]                       // [] when valid (D-24)
compileCommand(doc, command): Patch              // throws CommandError (D-22)
applyPatch(doc, patch): Doc                      // strict; throws PatchConflictError
invertPatch(patch): Patch
isEmptyPatch(patch): boolean
createDocStore(initial)                          // get(), dispatch(command) → Patch, subscribe(fn)
```

### Input as an explicit state machine

```
idle ──► panning
     ──► dragging (node move preview)
     ──► box-selecting
     ──► connecting (drag from a handle)
     ──► editing-text
```

During a drag, pointer-move updates **UI-layer preview state only**. On pointer-up, **one** command is dispatched. That is what makes a move a single undo step.

### Data flow

```
pointer/keyboard ─► input (tool state machine) ─► dispatch(command)
                                                      │
                                                      ▼
                                   core: command → Patch → new Doc ─► history
                                                      │
        View (camera) + UI (selection, preview) ──────┤
                                                      ▼
                                       renderer(doc, view, ui)  ─► canvas
```

---

## 5. Invariants

Briefs reference these by id. Violating one is a bug even if the feature "works".

| ID | Invariant |
|---|---|
| I-01 | **Edges reference node IDs, never coordinates.** Arrow geometry is computed at render time from current node positions. |
| I-02 | **All stored positions are world coordinates.** Screen↔world conversion exists in exactly one place (`view/camera`). No ad-hoc coordinate math elsewhere. |
| I-03 | **Every Document mutation goes through `dispatch(command)`.** No code mutates the document directly. |
| I-04 | **Pointer-move never commits.** It only updates UI preview state. A gesture commits as one command on pointer-up. |
| I-05 | **Camera and selection are not in history.** Undo never pans, zooms or changes selection (beyond what the patch itself implies). |
| I-06 | **`core/` stays pure** (D-06). |
| I-07 | **The renderer is pure** (D-10). It reads doc/view/ui and draws; it owns no state. |
| I-08 | **The file loader never silently drops data.** It preserves unknown fields and reports every repair it makes. |
| I-09 | **Deleting a node deletes its edges in the same patch**, so one undo restores both. |
| I-10 | **Overlays (DOM) derive their position and scale from the same camera** as the canvas. |

---

## 6. Milestones

Each milestone is sliced into **small tasks, each fitting one agent session**. Task numbering is tentative; the Planner re-slices as we learn.

### M0 — Foundation
Repo, toolchain, enforced layer boundaries, a canvas that fills the window.
- **T-001** Scaffold project (Vite + strict TS, Vitest, ESLint, Prettier, layer boundaries, DPR-aware canvas host, docs)
- **T-002** Playwright smoke test (page loads, canvas fills viewport, resizes correctly)
- **T-002b** CI workflow (GitHub Actions: hygiene guard, check, build, e2e)

*Done when:* `npm run check` and `npm run build` pass, and layer violations fail the tooling.

**Status: closed.** T-001, T-002 and T-002b are done; CI is green and enforced.

### M1 — Camera (infinite canvas)
- **T-003** Pure camera math: `worldToScreen`, `screenToWorld`, `panBy`, `zoomAt`, `zoomByFactorAt`, `visibleWorldRect`, clamp
- **T-004** Dotted grid, pure board renderer, HUD with camera and cursor coordinates, `cameraCenteredOn`, layer-rule matrix test
- **T-005** Pan and zoom input (pure state machine, wheel, keyboard, DOM glue) and `cameraStore`

*Done when:* `screenToWorld(worldToScreen(p)) == p` at several zooms, and the point under the cursor does not move while zooming.

**Status: closed.** T-003 to T-005 are merged; the HUD proves every camera change in the browser tests.

### M2 — Nodes
- **T-006** Document model in `core/`: types, `validateDoc`, strict `applyPatch` / `invertPatch`, node commands, `createDocStore`, seeded property tests (no UI)
- **T-007** Render nodes + create (double-click / toolbar); the HUD gains a `nodes` counter so e2e can observe the document
- **T-008** Select, move (preview → single commit), delete; hit-testing; the HUD gains a `selected` counter

*Done when:* nodes stay visually fixed in the world through any pan/zoom, and a drag is one document change.

### M3 — Edges
Connect by dragging from a handle, auto-anchors, arrowheads, cascade delete (I-09).
*Done when:* moving a node moves its arrows at every zoom level.

### M4 — Persistence → **MVP complete**
JSON export/import, autosave (debounced, IndexedDB), `version` field, migration scaffolding, committed old-version fixtures.
*Done when:* save → reload → deep-equal document; an old fixture loads correctly.

### M5 — Undo / Redo
History stack, coalescing, transactions (multi-node move = one step), shortcuts.
*Done when:* for every command type, `do → undo` gives the exact original document.

### M6 — Selection power
Shift-click, box-select, group move, copy / paste / duplicate (new IDs; edges kept only between copied nodes), z-order, keyboard shortcuts (Delete, Ctrl+Z/Y/C/V/A, arrow-key nudge).

### M7 — Rich content
Resize handles, in-place text editing (DOM overlay), sticky notes and cards, colors, tags with filtering, images, groups/frames.

### M8 — Export
PNG (offscreen render of content bounds at 2×, with padding), JSON; SVG optional.

### M9 — Modes and templates
Mind Map (tree auto-layout; Tab = child, Enter = sibling), Flowchart (shapes, orthogonal routing), Kanban (columns, snapping cards), Templates (saved documents).

### M10 — Desktop and performance
Tauri wrapper, native open/save dialogs, viewport culling and a spatial index; target: 5,000 nodes stay smooth.

---

## 7. Testing strategy

- **Core logic:** heavy unit tests (geometry, every command's apply/invert, serialize/deserialize round-trip, migrations). No browser needed.
- **Golden fixtures:** keep a saved file from every format version; test that each loads.
- **Regression tests for the four bug classes:**
  - move node → edge endpoints follow
  - zoom 300% → text overlay aligns with the node
  - move → undo → exact original position
  - load old fixture → no missing elements
- **Playwright:** drag, zoom and pan flows; screenshot checks at 10%, 100% and 300% zoom. E2E tests are black-box: they read the HUD, canvas pixels and computed styles only.
- **Property tests:** seeded random command sequences check document validity after every step, and that undoing all patches restores the initial document and redoing them restores the final one.
- **Layer matrix test:** every allowed and forbidden import pair is linted programmatically (`layerMatrix.test.ts`), so the dependency rule cannot silently break.
- **Rule:** found a bug? The first step is a failing test that reproduces it.
- **CI:** every pull request runs the hygiene guard, `check`, `build` and e2e in CI. Local passes are not enough to merge.

---

## 8. Risks and guardrails

| Risk | Guardrail |
|---|---|
| Skipping the command layer in M2 and bolting undo on later | I-03 and D-09 are locked; T-006 builds `dispatch` before any node UI exists |
| Coordinate bugs creeping in through ad-hoc math | I-02; one camera module; debug HUD from M1 |
| Text editing complexity (IME, multiline, zoom alignment) | Isolated behind one overlay component (I-10) |
| Edge routing for flowcharts | Straight and curved only until M9 |
| Scope creep (modes, templates) | Nothing from M9 starts before M8 is solid |
| Agent builds the wrong thing for several milestones | Requirements live here and in briefs, never only in chat; every report is checked against PLAN |
| Secrets leaking into the repo | Rule 10; CI hygiene guard; GitHub push protection; fine-grained, repo-limited, expiring tokens |
| CI runner image changes underneath us | Runner pinned to `ubuntu-24.04` (D-17); upgrade deliberately |
| Document and patch desync (history corrupts the document) | Strict `applyPatch` and `compileCommand` (D-22), `validateDoc` (D-24), seeded property tests |

---

## 9. Task board

Maintained by the Planner.

| Task | Title | Status |
|---|---|---|
| T-001 | Scaffold project | Done |
| T-002 | Playwright smoke test | Done |
| T-002b | CI workflow | Done (PR #3) |
| T-003 | Pure camera math | Done (PR #5) |
| T-004 | Grid, renderer, HUD | Done (PR #6) |
| T-005 | Pan and zoom input | Done (PR #7) |
| T-006 | Document model, patches, commands, store (core) | **Next — brief issued** |
| T-007 | Render nodes + create | Planned |
| T-008 | Select, move, delete + hit-testing | Planned |

---

## 10. Changelog

- **v1.2** (2026-10-10, M1 closed): input conventions, camera startup and store (D-19, D-20); document-model decisions (D-21 to D-24) and the Core API (section 4); workflow rules 12–13 (head SHA in reports, no silent force-push, quota discipline); property tests, layer matrix test and black-box e2e in the testing strategy; M1 closed; M2 sliced; task board updated.
- **v1.1** (2026-10-09, M0 closed): Node 24 pinned (D-03); Playwright black-box rule (D-04); tooling versions, CI and camera purity decisions (D-16 to D-18); camera API (section 4); new workflow rules 7–11 (evidence format, branches and merging, verification experiments, secrets, `AGENTS.md` cap); CI added to testing strategy and risks; M0 closed; task board updated.
- **v1.0** (2026-10-09): initial plan.
