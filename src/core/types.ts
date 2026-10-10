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

/** Edge anchor points on a node border (or 'auto' for automatic routing). */
export type Anchor = 'auto' | 'top' | 'right' | 'bottom' | 'left';

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
}

/** A named group that nodes can belong to. */
export interface Group {
  id: Id;
  name: string;
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
