/**
 * Core document types (T-006 R1, PLAN §4 Data model).
 *
 * Pure TypeScript, no DOM (PLAN D-06). These are plain data types — a
 * document is serialisable JSON, a command is plain data, and a patch is
 * the difference between two documents.
 */

/** A string identifier for entities. Generated outside core (D-11). */
export type Id = string;

/** The visual kind of a node. */
export type NodeKind = 'text' | 'sticky' | 'card' | 'image';

/**
 * The outline shape of a node (T-032, M9 — flowchart shapes). Optional:
 * absent means `'rect'`, so every file written before shapes exists stays
 * valid without a migration (I-08). Kind-independent — `text` nodes simply
 * draw no outline, so a shape on them changes nothing visually.
 */
export type NodeShape = 'rect' | 'rounded' | 'diamond' | 'stadium';

/** Edge anchor points on a node border (or 'auto' for automatic routing). */
export type Anchor = 'auto' | 'top' | 'right' | 'bottom' | 'left';

/**
 * The routing style of an edge (T-033, M9 — orthogonal routing). Optional:
 * absent means `'auto'`, so every file written before routes exist stays
 * valid without a migration (I-08, no version bump) and renders
 * pixel-identically — 'auto' is today's straight arrow.
 */
export type EdgeRoute = 'auto' | 'straight' | 'orthogonal';

/**
 * The layout role of a group (T-035, M9 — Kanban). `'kanban'` marks a
 * column: a frame with fixed stored geometry whose cards snap into stacked
 * slots. Absent = a plain frame (T-024), so pre-kanban files stay valid
 * without a migration (I-08, no version bump).
 */
export type GroupRole = 'kanban';

/** A node placed on the canvas. Coordinates are world units (PLAN D-07). */
export interface Node {
  id: Id;
  kind: NodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
  tags: string[];
  groupId?: Id;
  /** For image nodes: the image source — a data URL (T-023). Optional so
   * older files (and non-image kinds) stay valid without it. */
  src?: string;
  /** The outline shape (T-032). Optional — absent renders as `'rect'`. */
  shape?: NodeShape;
}

/** One endpoint of an edge, referencing a node by id (I-01). */
export interface EdgeEndpoint {
  node: Id;
  anchor: Anchor;
}

/** An arrow / connection between two nodes. */
export interface Edge {
  id: Id;
  from: EdgeEndpoint;
  to: EdgeEndpoint;
  label?: string;
  /** The routing style (T-033). Optional — absent renders as `'auto'`. */
  route?: EdgeRoute;
}

/** A named group that nodes can belong to. */
export interface Group {
  id: Id;
  name: string;
  /**
   * The layout role of the group (T-035, M9 — Kanban). Optional: absent is
   * a plain frame whose rect is its members' bbox + padding (T-024).
   * `'kanban'` is a column — a frame with FIXED stored geometry (x/y/w/h,
   * required iff the role is set) whose member cards snap into stacked
   * slots. Behaviours attach to the DATA (D-14), not to a mode.
   */
  role?: GroupRole;
  /** Column geometry in world units (T-035) — present iff `role` is set. */
  x?: number;
  /** Column geometry in world units (T-035) — present iff `role` is set. */
  y?: number;
  /** Column geometry in world units (T-035) — present iff `role` is set. */
  w?: number;
  /** Column geometry in world units (T-035) — present iff `role` is set. */
  h?: number;
}

/**
 * The document: nodes, edges, groups and z-order. `order` holds node ids
 * only (bottom → top, D-21); edges render beneath all nodes.
 */
export interface Doc {
  nodes: Record<Id, Node>;
  edges: Record<Id, Edge>;
  groups: Record<Id, Group>;
  order: Id[];
}

/**
 * A change to a single entity in a patch: `before` is the entity's current
 * value (absent if it does not exist), `after` is the new value (absent to
 * delete). Both absent is not a change.
 */
export interface EntityChange<T> {
  before?: T;
  after?: T;
}

/**
 * A patch: the compiled result of a command. Undo = apply the inverse
 * (D-09). Each map is keyed by entity id; `order` is an optional change to
 * the z-order array.
 */
export interface Patch {
  nodes: Record<Id, EntityChange<Node>>;
  edges: Record<Id, EntityChange<Edge>>;
  groups: Record<Id, EntityChange<Group>>;
  order?: { before: Id[]; after: Id[] };
}

/**
 * A command — plain, serialisable data. IDs are supplied by the caller
 * (D-11). Compiling a command against a document produces a patch (D-22).
 */
export type Command =
  | { type: 'node.create'; node: Node }
  | { type: 'node.move'; ids: Id[]; dx: number; dy: number }
  | { type: 'node.delete'; ids: Id[] }
  | {
      type: 'node.duplicate';
      ids: Id[];
      offsetX?: number;
      offsetY?: number;
      newIds: Id[];
      newEdgeIds: Id[];
    }
  | {
      type: 'node.zOrder';
      ids: Id[];
      mode: 'front' | 'back' | 'forward' | 'backward';
    }
  | { type: 'node.update'; ids: Id[]; patch: NodeContentPatch }
  | { type: 'node.resize'; id: Id; x: number; y: number; w: number; h: number }
  | { type: 'group.assign'; groupId: Id; name: string; ids: Id[] }
  | { type: 'group.unassign'; ids: Id[] }
  /**
   * Create a group exactly as given (T-035, M9): a kanban column with its
   * fixed geometry (`role: 'kanban'` + x/y/w/h, validated like `validateDoc`)
   * or — in principle — a plain memberless frame. The T-024 `group.assign`
   * creates groups as a side effect of membership; a column must exist
   * BEFORE any card joins it (an empty column is the default kanban state).
   */
  | { type: 'group.create'; group: Group }
  /**
   * Update the listed groups' content (T-037, M9 — kanban column polish):
   * the name and, for columns, the stored geometry. The same command covers
   * rename, resize and move — one command, one undo step, mirroring
   * `node.update`/`node.resize`. The `role` is structural and NOT patchable
   * (a column becoming a plain frame would leave dangling card slots).
   */
  | { type: 'group.update'; ids: Id[]; patch: GroupContentPatch }
  /**
   * Delete the listed groups (T-035, M9): their member nodes survive,
   * ungrouped, in the SAME patch — one undo restores the groups and every
   * membership.
   */
  | { type: 'group.delete'; ids: Id[] }
  /**
   * Set (`groupId`) or clear (`null`) the group of the listed nodes (T-035,
   * M9) — the membership primitive `group.assign`/`group.unassign` lack:
   * moving a card between two EXISTING groups in one command. A regular
   * group left with no members is deleted in the same patch (the T-024
   * cascade); a kanban column never is (it may legitimately be empty).
   */
  | { type: 'node.setGroup'; ids: Id[]; groupId: Id | null }
  | { type: 'edge.create'; edge: Edge }
  | { type: 'edge.delete'; ids: Id[] }
  | { type: 'edge.update'; ids: Id[]; patch: EdgeContentPatch }
  /**
   * A batch of commands compiled as ONE patch (T-029, M9): each sub-command
   * is compiled against the document produced by the previous ones, and the
   * sub-patches merge into a single before/after pair per entity — so one
   * dispatch is one undo step. A gesture that needs several commands (mind
   * map: create a child node AND its edge) must not be several undo steps.
   */
  | { type: 'batch'; commands: Command[] };

/**
 * The editable content fields of a node (T-019, M7): text, colour and tags.
 * Geometry is edited through `node.resize` / `node.move`, never here.
 * `shape` joined in T-032 (M9) — an outline change is content, not geometry.
 */
export interface NodeContentPatch {
  text?: string;
  color?: string;
  tags?: string[];
  shape?: NodeShape;
}

/**
 * The editable content fields of a group (T-037, M9 — kanban column polish):
 * the name (a plain frame's label, a column's header title) and — for a
 * kanban column — the STORED geometry (x/y/w/h). Absent fields keep their
 * values; the merged result must satisfy `groupViolations` (a column needs
 * all four, finite, w > 0, h > 0 — a plain frame may carry NO geometry).
 * `role` is deliberately absent: it is structural, not content.
 */
export interface GroupContentPatch {
  name?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/**
 * The editable content fields of an edge (T-033, M9): the routing style.
 * Endpoints are structural (`edge.create` / `edge.delete`), never patched
 * here — the same split nodes have between content and geometry.
 */
export interface EdgeContentPatch {
  route?: EdgeRoute;
}
