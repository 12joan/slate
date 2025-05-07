import {Ancestor, Element, Editor} from "slate"
import {ReactEditor} from "../../plugin/react-editor"
import { Key } from 'slate-dom'

export interface ChunkTree {
  type: 'root'
  movedNodeKeys: Set<Key>
  modifiedChunks: Set<Chunk>
  children: ChunkDescendant[]
}

export interface Chunk {
  type: 'chunk'
  key: Key
  parent: ChunkAncestor
  children: ChunkDescendant[]
}

export interface ChunkLeaf {
  type: 'leaf'
  key: Key
  node: Element
}

export type ChunkAncestor = ChunkTree | Chunk
export type ChunkDescendant = Chunk | ChunkLeaf
export type ChunkNode = ChunkTree | Chunk | ChunkLeaf

type ChildEntry = [Element, Key]

const childEntriesToLeaves = (entries: ChildEntry[]): ChunkLeaf[] => entries.map(([node, key]) => ({
  type: 'leaf',
  key,
  node,
}))

const NODE_TO_CHUNK_TREE = new WeakMap<Ancestor, ChunkTree>()

export const getChunkTreeForNode = (editor: Editor, node: Ancestor, reconcile: boolean) => {
  let chunkTree = NODE_TO_CHUNK_TREE.get(node)

  if (!chunkTree) {
    chunkTree = {
      type: 'root',
      movedNodeKeys: new Set(),
      modifiedChunks: new Set(),
      children: [],
    }

    NODE_TO_CHUNK_TREE.set(node, chunkTree)
  }

  if (reconcile) {
    chunkTree.modifiedChunks.clear()
    const manager = new ChunkTreeManager(editor, chunkTree)
    manager.reconcile(node.children as Element[])
    chunkTree.movedNodeKeys.clear()
  }

  return chunkTree
}

class ChunkTreeManager {
  private editor: Editor
  private root: ChunkTree
  private reachedEnd: boolean
  // These refer to the node in the chunk tree currently being processed
  private pointerChunk: ChunkAncestor
  private pointerIndex: number
  private pointerIndexStack: number[]
  private cachedPointerNode: ChunkDescendant | null | undefined

  constructor(editor: Editor, chunkTree: ChunkTree) {
    this.editor = editor
    this.root = chunkTree
    this.pointerChunk = chunkTree
    this.pointerIndex = -1
    this.pointerIndexStack = []
    this.reachedEnd = false
  }

  public reconcile(children: Element[]) {
    // Sparse array of cached child keys
    const childKeys = new Array<Key | undefined>(children.length)

    const getChildKey = (childNode: Element, childIndex: number): Key => {
      const cachedKey = childKeys[childIndex]
      if (cachedKey) return cachedKey
      const key = ReactEditor.findKey(this.editor, childNode)
      childKeys[childIndex] = key
      return key
    }

    const getChildEntries = (nodes: Element[], startIndex: number): ChildEntry[] =>
      nodes.map((node, i) => [node, getChildKey(node, startIndex + i)])

    let childrenPointerIndex = 0

    const readChildren = (n: number): Element[] => {
      if (n === 1) {
        return [children[childrenPointerIndex++]]
      }

      const slicedChildren = children.slice(childrenPointerIndex, childrenPointerIndex + n)
      childrenPointerIndex += n
      return slicedChildren
    }

    const lookAheadForChild = (childNode: Element, childKey: Key) => {
      const elementResult = children.indexOf(childNode, childrenPointerIndex)
      if (elementResult > -1) return elementResult - childrenPointerIndex

      for (let i = childrenPointerIndex; i < children.length; i++) {
        const otherChildNode = children[i]
        const otherChildKey = getChildKey(otherChildNode, i)
        if (otherChildKey === childKey) return i - childrenPointerIndex
      }

      return -1
    }

    // Scan nodes in the chunk tree
    let treeNode: ChunkLeaf | null
    while (treeNode = this.readLeaf()) {
      // Check where the tree node appears in the children array. Nodes are
      // removed from the chunk tree on move_node, so the only way for lookAhead
      // to be greater than 0 is if nodes have been inserted in the children
      // array prior to the tree node.
      // TODO: Use movedNodeKeys
      const lookAhead = lookAheadForChild(treeNode.node, treeNode.key)

      // If the tree node is not present in children, remove it
      if (lookAhead === -1) {
        this.remove()
        continue
      }

      // Get the matching Slate node and any nodes that may have been inserted
      // prior to it. Insert these into the chunk tree.
      const insertedChildren = readChildren(lookAhead + 1)
      const matchingChildNode = insertedChildren.pop()!

      if (insertedChildren.length) {
        const insertedEntries = getChildEntries(insertedChildren, childrenPointerIndex)
        this.insertBefore(insertedEntries)
      }

      // Make sure the chunk tree contains the most recent version of all nodes
      if (treeNode.node !== matchingChildNode) {
        treeNode.node = matchingChildNode
        this.invalidateChunk()
      }
    }

    if (childrenPointerIndex < children.length) {
      const remainingChildren = children.slice(childrenPointerIndex)
      const remainingEntries = getChildEntries(remainingChildren, childrenPointerIndex)
      this.append(remainingEntries)
    }
  }

  private get pointerSiblings(): ChunkDescendant[] {
    return this.pointerChunk.children
  }

  private get pointerNode(): ChunkDescendant | null {
    if (this.cachedPointerNode !== undefined) return this.cachedPointerNode

    if (this.reachedEnd || this.pointerIndex === -1) {
      this.cachedPointerNode = null
      return null
    }

    const pointerNode = this.pointerSiblings[this.pointerIndex]
    this.cachedPointerNode = pointerNode
    return pointerNode
  }

  private enterChunk() {
    if (this.pointerNode?.type !== 'chunk') {
      throw new Error('Cannot enter non-chunk');
    }

    this.pointerIndexStack.push(this.pointerIndex)
    this.pointerChunk = this.pointerNode
    this.pointerIndex = 0
    this.cachedPointerNode = undefined

    if (this.pointerChunk.children.length === 0) {
      throw new Error('Cannot enter empty chunk')
    }
  }

  /**
   * Set the pointer to the parent chunk
   */
  private exitChunk() {
    if (this.pointerChunk.type === 'root') {
      throw new Error('Cannot exit root');
    }

    const previousPointerChunk = this.pointerChunk
    this.pointerChunk = previousPointerChunk.parent
    this.pointerIndex = this.pointerIndexStack.pop()!
    this.cachedPointerNode = undefined
  }

  /**
   * Remove the current node and decrement the pointer, deleting any ancestor
   * chunk that becomes empty as a result
   */
  private remove() {
    this.pointerSiblings.splice(this.pointerIndex--, 1)

    if (this.pointerSiblings.length === 0 && this.pointerChunk.type === 'chunk') {
      this.exitChunk()
      this.remove()
    } else {
      this.invalidateChunk()
    }
  }

  /**
   * Add the current chunk and all ancestor chunks to the list of modified
   * chunks
   */
  private invalidateChunk() {
    for (let c = this.pointerChunk; c.type === 'chunk'; c = c.parent) {
      this.root.modifiedChunks.add(c)
    }
  }

  /**
   * Insert nodes before the current node, leaving the pointer pointing to the
   * current node
   */
  private insertBefore(entries: ChildEntry[]) {
    // TODO: Use algorithm
    const leaves = childEntriesToLeaves(entries)
    this.pointerSiblings.splice(this.pointerIndex, 0, ...leaves)
    this.pointerIndex += leaves.length
    this.invalidateChunk()
  }

  /**
   * Insert nodes at the end of the chunk tree, leaving the pointer unchanged
   */
  private append(entries: ChildEntry[]) {
    const chunkSize = 100

    const toChunks = (leaves: ChunkLeaf[], parent: ChunkAncestor): ChunkDescendant[] => {
      if (leaves.length <= chunkSize) return leaves

      const chunks: Chunk[] = []
      const perChunk = Math.ceil(leaves.length / chunkSize)

      for (let i = 0; i < chunkSize; i++) {
        const chunkNodes = leaves.slice(i * perChunk, (i + 1) * perChunk)

        if (chunkNodes.length > 0) {
          const chunk: Chunk = {
            type: 'chunk',
            key: new Key(),
            parent,
            children: [],
          }

          chunk.children = toChunks(chunkNodes, chunk)
          chunks.push(chunk)
        }
      }

      return chunks
    }

    this.root.children.push(...toChunks(childEntriesToLeaves(entries), this.root))
  }

  /**
   * Move the pointer to the next leaf in the chunk tree and return it
   */
  private readLeaf(): ChunkLeaf | null {
    if (this.reachedEnd) return null

    // Get the next sibling or aunt node
    while (true) {
      if (this.pointerIndex + 1 < this.pointerSiblings.length) {
        this.pointerIndex++
        this.cachedPointerNode = undefined
        break
      } else if (this.pointerChunk.type === 'root') {
        this.reachedEnd = true
        return null
      } else {
        this.exitChunk()
      }
    }

    // If the next sibling or aunt is a chunk, descend into it
    while (this.pointerNode?.type === 'chunk') {
      this.enterChunk()
    }

    return this.pointerNode
  }
}
