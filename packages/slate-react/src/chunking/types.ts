import { Descendant } from 'slate'
import { Key } from 'slate-dom'

export interface ChunkTree {
  type: 'root'
  children: ChunkDescendant[]

  /**
   * The keys of any Slate nodes that have been moved using move_node since the
   * last render
   *
   * TODO: Update this from editor.apply in withReact
   *
   * Detecting when a node has been moved to a different position in the
   * children array is inefficient when reconciling the chunk tree. This set
   * makes it easier to handle moved nodes correctly.
   */
  movedNodeKeys: Set<Key>

  /**
   * The chunks whose descendants have been modified during the most recent
   * reconciliation
   *
   * Used to determine when the otherwise memoized React components for each
   * chunk should be re-rendered.
   */
  modifiedChunks: Set<Chunk>
}

export interface Chunk {
  type: 'chunk'
  key: Key
  parent: ChunkAncestor
  children: ChunkDescendant[]
}

// A chunk leaf is unrelated to a Slate leaf; it is a leaf of the chunk tree,
// containing a single element that is a child of the Slate node the chunk tree
// belongs to .
export interface ChunkLeaf {
  type: 'leaf'
  key: Key
  node: Descendant
}

export type ChunkAncestor = ChunkTree | Chunk
export type ChunkDescendant = Chunk | ChunkLeaf
export type ChunkNode = ChunkTree | Chunk | ChunkLeaf
