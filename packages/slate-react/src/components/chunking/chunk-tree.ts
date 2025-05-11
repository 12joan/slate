import { Ancestor, Element, Editor, Path } from 'slate'
import { ReactEditor } from '../../plugin/react-editor'
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
  node: Element
}

export type ChunkAncestor = ChunkTree | Chunk
export type ChunkDescendant = Chunk | ChunkLeaf
export type ChunkNode = ChunkTree | Chunk | ChunkLeaf

type ChildEntry = [Element, Key]

type SavedPointer =
  | 'start'
  | {
      chunk: ChunkAncestor
      node: ChunkDescendant
    }

const childEntryToLeaf = ([node, key]: ChildEntry): ChunkLeaf => ({
  type: 'leaf',
  key,
  node,
})

export const KEY_TO_CHUNK_TREE = new WeakMap<Key, ChunkTree>()

interface ReconcileOptions {
  chunkSize: number
  debug?: boolean
}

/**
 * Get or create the chunk tree for a Slate node
 *
 * If the reconcile option is set to true, the chunk tree will be updated to
 * match the current children of the node. The children are chunked
 * automatically using the given chunk size.
 */
export const getChunkTreeForNode = (
  editor: Editor,
  node: Ancestor,
  // istanbul ignore next
  options: {
    reconcile?: ReconcileOptions | false
  } = {}
) => {
  const key = ReactEditor.findKey(editor, node)
  let chunkTree = KEY_TO_CHUNK_TREE.get(key)

  if (!chunkTree) {
    chunkTree = {
      type: 'root',
      movedNodeKeys: new Set(),
      modifiedChunks: new Set(),
      children: [],
    }

    KEY_TO_CHUNK_TREE.set(key, chunkTree)
  }

  if (options.reconcile) {
    chunkTree.modifiedChunks.clear()
    const manager = new ChunkTreeManager(editor, chunkTree, options.reconcile)
    manager.reconcile(node.children as Element[])
    chunkTree.movedNodeKeys.clear()
  }

  return chunkTree
}

class ChunkTreeManager {
  private editor: Editor

  /**
   * The root of the chunk tree
   */
  private root: ChunkTree

  /**
   * The ideal size of a chunk
   */
  private chunkSize: number

  /**
   * Whether debug mode is enabled
   *
   * If enabled, the pointer state will be checked for internal consistency
   * after each mutating operation.
   */
  private debug: boolean

  // The chunk tree manager maintains a pointer that is used to traverse the
  // chunk tree

  /**
   * Whether the traversal has reached the end of the chunk tree
   *
   * When this is true, the pointerChunk and pointerIndex point to the last
   * top-level node in the chunk tree, although pointerNode returns null.
   */
  private reachedEnd: boolean

  /**
   * The chunk containing the current node
   */
  private pointerChunk: ChunkAncestor

  /**
   * The index of the current node within pointerChunk
   *
   * Can be -1 to indicate that the pointer is before the start of the tree,
   * before the first node.
   */
  private pointerIndex: number

  /**
   * Similar to a Slate path; tracks the path of pointerChunk relative to the
   * root.
   *
   * Used to move the pointer from the current chunk to the parent chunk more
   * efficiently.
   */
  private pointerIndexStack: number[]

  /**
   * Indexing the current chunk's children has a slight time cost, which adds up
   * when traversing very large trees, so the current node is cached.
   *
   * A value of undefined means that the current node is not cached. This
   * property must be set to undefined whenever the pointer is moved, unless
   * the pointer is guaranteed to point to the same node that it did previously.
   */
  private cachedPointerNode: ChunkDescendant | null | undefined

  constructor(editor: Editor, chunkTree: ChunkTree, options: ReconcileOptions) {
    this.editor = editor
    this.root = chunkTree
    this.chunkSize = options.chunkSize
    // istanbul ignore next
    this.debug = options.debug ?? false
    this.pointerChunk = chunkTree
    this.pointerIndex = -1
    this.pointerIndexStack = []
    this.reachedEnd = false
    this.validateState()
  }

  /**
   * Update the chunk tree to match the children array, inserting, removing and
   * updating differing nodes
   */
  public reconcile(children: Element[]) {
    // Fetching the key for a Slate node is expensive, so cache them in a
    // sparse array
    const childKeys = new Array<Key | undefined>(children.length)

    /**
     * Get the key for a Slate node using the cache
     */
    const getChildKey = (childNode: Element, childIndex: number): Key => {
      const cachedKey = childKeys[childIndex]
      if (cachedKey) return cachedKey
      const key = ReactEditor.findKey(this.editor, childNode)
      childKeys[childIndex] = key
      return key
    }

    /**
     * Convert an array of Slate nodes to an array of child entries, each
     * containing the node and its key
     *
     * @param startIndex Since keys are cached using the index of each Slate
     * node in the children array, the index of the first passed node is
     * required to access the cached keys.
     */
    const getChildEntries = (
      nodes: Element[],
      startIndex: number
    ): ChildEntry[] =>
      nodes.map((node, i) => [node, getChildKey(node, startIndex + i)])

    // Track progress through the children array
    let childrenPointerIndex = 0

    /**
     * Read a given number of Slate nodes from the children array
     */
    const readChildren = (n: number): Element[] => {
      // PERF: If only one child was requested (the most common case), use
      // array indexing instead of slice
      if (n === 1) {
        return [children[childrenPointerIndex++]]
      }

      const slicedChildren = children.slice(
        childrenPointerIndex,
        childrenPointerIndex + n
      )

      childrenPointerIndex += n
      return slicedChildren
    }

    /**
     * Determine whether a Slate node with a given key appears in the unread
     * part of the children array, and return its index relative to the current
     * children pointer if so
     *
     * Searching for the Slate node object itself using indexOf is most
     * efficient, but will fail to locate nodes that have been modified. In
     * this case, nodes should be identified by their keys instead.
     *
     * Searching an array of keys using indexOf is very inefficient since
     * fetching the keys for all children in advance is very slow. Insead, if
     * the node search fails to return a value, fetch the keys of each
     * remaining child one by one and compare it to the known key.
     */
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

    let treeLeaf: ChunkLeaf | null

    // Read leaves from the tree one by one, each one representing a single
    // Slate node. Each leaf from the tree is compared to the current node in
    // the children array to determine whether nodes have been inserted,
    // removed or updated.
    while ((treeLeaf = this.readLeaf())) {
      // Check where the tree node appears in the children array. Nodes are
      // removed from the chunk tree on move_node, so the only way for lookAhead
      // to be greater than 0 is if nodes have been inserted in the children
      // array prior to the tree node.
      // TODO: Use movedNodeKeys
      const lookAhead = lookAheadForChild(treeLeaf.node, treeLeaf.key)

      // If the tree leaf is not present in children, remove it
      if (lookAhead === -1) {
        this.remove()
        continue
      }

      // Get the matching Slate node and any nodes that may have been inserted
      // prior to it. Insert these into the chunk tree.
      const insertedChildren = readChildren(lookAhead + 1)
      const matchingChildNode = insertedChildren.pop()!

      if (insertedChildren.length) {
        const insertedEntries = getChildEntries(
          insertedChildren,
          childrenPointerIndex
        )

        this.insertBefore(insertedEntries.map(childEntryToLeaf))
      }

      // Make sure the chunk tree contains the most recent version of the
      // Slate node
      if (treeLeaf.node !== matchingChildNode) {
        treeLeaf.node = matchingChildNode
        this.invalidateChunk()
      }
    }

    // If there are still Slate nodes remaining from the children array
    // that were not matched to nodes in the tree, insert them at the end of
    // the tree
    if (childrenPointerIndex < children.length) {
      const remainingChildren = children.slice(childrenPointerIndex)

      const remainingEntries = getChildEntries(
        remainingChildren,
        childrenPointerIndex
      )

      // Move the pointer back to the final leaf in the tree, or the start of
      // the tree if the tree is currently empty
      this.returnToPreviousLeaf()
      this.insertAfter(remainingEntries.map(childEntryToLeaf))
    }
  }

  /**
   * Whether the pointer is at the start of the tree
   */
  private get atStart() {
    return this.pointerChunk.type === 'root' && this.pointerIndex === -1
  }

  /**
   * The siblings of the current node
   */
  private get pointerSiblings(): ChunkDescendant[] {
    return this.pointerChunk.children
  }

  /**
   * Get the current node (uncached)
   *
   * If the pointer is at the start or end of the document, returns null.
   *
   * Usually, the current node is a chunk leaf, although it can be a chunk
   * while insertions are in progress.
   */
  private getPointerNode(): ChunkDescendant | null {
    if (this.reachedEnd || this.pointerIndex === -1) {
      return null
    }

    return this.pointerSiblings[this.pointerIndex]
  }

  /**
   * Cached getter for the current node
   */
  private get pointerNode(): ChunkDescendant | null {
    if (this.cachedPointerNode !== undefined) return this.cachedPointerNode
    const pointerNode = this.getPointerNode()
    this.cachedPointerNode = pointerNode
    return pointerNode
  }

  /**
   * Get the path of a chunk relative to the root, returning null if the chunk
   * is not connected to the root
   */
  private getChunkPath(chunk: ChunkAncestor): number[] | null {
    const path: number[] = []

    for (let c = chunk; c.type === 'chunk'; c = c.parent) {
      const index = c.parent.children.indexOf(c)

      // istanbul ignore next
      if (index === -1) {
        return null
      }

      path.unshift(index)
    }

    return path
  }

  /**
   * Save the current pointer to be restored later
   */
  private savePointer(): SavedPointer {
    if (this.atStart) return 'start'

    // istanbul ignore next
    if (!this.pointerNode) {
      throw new Error('Cannot save pointer when pointerNode is null')
    }

    return {
      chunk: this.pointerChunk,
      node: this.pointerNode,
    }
  }

  /**
   * Restore the pointer to a previous state
   */
  private restorePointer(savedPointer: SavedPointer) {
    if (savedPointer === 'start') {
      this.pointerChunk = this.root
      this.pointerIndex = -1
      this.pointerIndexStack = []
      this.reachedEnd = false
      this.cachedPointerNode = undefined
      return
    }

    // Since nodes may have been inserted or removed prior to the saved
    // pointer since it was saved, the index and index stack must be
    // recomputed. This is slow, but this is fine since restoring a pointer is
    // not a frequent operation.

    const { chunk, node } = savedPointer
    const index = chunk.children.indexOf(node)

    // istanbul ignore next
    if (index === -1) {
      throw new Error(
        'Cannot restore point because saved node is no longer in saved chunk'
      )
    }

    const indexStack = this.getChunkPath(chunk)

    // istanbul ignore next
    if (!indexStack) {
      throw new Error(
        'Cannot restore point because saved chunk is no longer connected to root'
      )
    }

    this.pointerChunk = chunk
    this.pointerIndex = index
    this.pointerIndexStack = indexStack
    this.reachedEnd = false
    this.cachedPointerNode = node
    this.validateState()
  }

  /**
   * Assuming the current node is a chunk, move the pointer into that chunk
   *
   * @param end If true, place the pointer on the last node of the chunk.
   * Otherwise, place the pointer on the first node.
   */
  private enterChunk(end: boolean) {
    // istanbul ignore next
    if (this.pointerNode?.type !== 'chunk') {
      throw new Error('Cannot enter non-chunk')
    }

    this.pointerIndexStack.push(this.pointerIndex)
    this.pointerChunk = this.pointerNode
    this.pointerIndex = end ? this.pointerSiblings.length - 1 : 0
    this.cachedPointerNode = undefined
    this.validateState()

    // istanbul ignore next
    if (this.pointerChunk.children.length === 0) {
      throw new Error('Cannot enter empty chunk')
    }
  }

  /**
   * Assuming the current node is a chunk, move the pointer into that chunk
   * repeatedly until the current node is a leaf
   *
   * @param end If true, place the pointer on the last node of the chunk.
   * Otherwise, place the pointer on the first node.
   */
  private enterChunkUntilLeaf(end: boolean) {
    while (this.pointerNode?.type === 'chunk') {
      this.enterChunk(end)
    }
  }

  /**
   * Move the pointer to the parent chunk
   */
  private exitChunk() {
    // istanbul ignore next
    if (this.pointerChunk.type === 'root') {
      throw new Error('Cannot exit root')
    }

    const previousPointerChunk = this.pointerChunk
    this.pointerChunk = previousPointerChunk.parent
    this.pointerIndex = this.pointerIndexStack.pop()!
    this.cachedPointerNode = undefined
    this.validateState()
  }

  /**
   * Remove the current node and decrement the pointer, deleting any ancestor
   * chunk that becomes empty as a result
   */
  private remove() {
    this.pointerSiblings.splice(this.pointerIndex--, 1)
    this.cachedPointerNode = undefined

    if (
      this.pointerSiblings.length === 0 &&
      this.pointerChunk.type === 'chunk'
    ) {
      this.exitChunk()
      this.remove()
    } else {
      this.invalidateChunk()
    }

    this.validateState()
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
   * Insert leaves before the current leaf, leaving the pointer unchanged
   */
  private insertBefore(leaves: ChunkLeaf[]) {
    this.returnToPreviousLeaf()
    this.insertAfter(leaves)
    this.readLeaf()
  }

  /**
   * Insert leaves after the current leaf, leaving the pointer on the last
   * inserted leaf
   *
   * The insertion algorithm first checks for any chunk we're currently at the
   * end of that can receive additional leaves. Next, it tries to insert leaves
   * at the starts of any subsequent chunks.
   *
   * Any remaining leaves are passed to rawInsertAfter to be chunked and
   * inserted at the highest possible level.
   */
  private insertAfter(leaves: ChunkLeaf[]) {
    // istanbul ignore next
    if (leaves.length === 0) return

    let beforeDepth = 0
    let afterDepth = 0

    // While at the end of a chunk, insert any leaves that will fit, and then
    // exit the chunk
    while (
      this.pointerChunk.type === 'chunk' &&
      this.pointerIndex === this.pointerSiblings.length - 1
    ) {
      const remainingCapacity = this.chunkSize - this.pointerSiblings.length
      const toInsertCount = Math.min(remainingCapacity, leaves.length)

      if (toInsertCount > 0) {
        const leavesToInsert = leaves.splice(0, toInsertCount)
        this.rawInsertAfter(leavesToInsert, beforeDepth)
      }

      this.exitChunk()
      beforeDepth++
    }

    if (leaves.length === 0) return

    // Save the pointer so that we can come back here after inserting leaves
    // into the starts of subsequent blocks
    const rawInsertPointer = this.savePointer()

    // If leaves are inserted into the start of a subsequent block, then we
    // eventually need to restore the pointer to the last such inserted leaf
    let finalPointer: SavedPointer | null = null

    // Move the pointer into the chunk containing the next leaf, if it exists
    if (this.readLeaf()) {
      // While at the start of a chunk, insert any leaves that will fit, and
      // then exit the chunk
      while (this.pointerChunk.type === 'chunk' && this.pointerIndex === 0) {
        const remainingCapacity = this.chunkSize - this.pointerSiblings.length
        const toInsertCount = Math.min(remainingCapacity, leaves.length)

        if (toInsertCount > 0) {
          const leavesToInsert = leaves.splice(-toInsertCount, toInsertCount)

          // Insert the leaves at the start of the chunk
          this.pointerIndex = -1
          this.cachedPointerNode = undefined
          this.rawInsertAfter(leavesToInsert, afterDepth)

          // If this is the first batch of insertions at the start of a
          // subsequent chunk, set the final pointer to the last inserted leaf
          if (!finalPointer) {
            finalPointer = this.savePointer()
          }
        }

        this.exitChunk()
        afterDepth++
      }
    }

    this.restorePointer(rawInsertPointer)

    // If there are leaves left to insert, insert them between the end of the
    // previous chunk and the start of the first subsequent chunk, or wherever
    // the pointer ended up after the first batch of insertions
    const minDepth = Math.max(beforeDepth, afterDepth)
    this.rawInsertAfter(leaves, minDepth)

    if (finalPointer) {
      this.restorePointer(finalPointer)
    }

    this.validateState()
  }

  /**
   * Insert leaves immediately after the current node, leaving the pointer on
   * the last inserted leaf
   *
   * Leaves are chunked according to the number of nodes already in the parent
   * plus the number of nodes being inserted, or the minimum depth if larger
   */
  private rawInsertAfter(leaves: ChunkLeaf[], minDepth: number) {
    if (leaves.length === 0) return

    const groupIntoChunks = (
      leaves: ChunkLeaf[],
      parent: ChunkAncestor,
      perChunk: number
    ): ChunkDescendant[] => {
      if (perChunk === 1) return leaves
      const chunks: Chunk[] = []

      for (let i = 0; i < this.chunkSize; i++) {
        const chunkNodes = leaves.slice(i * perChunk, (i + 1) * perChunk)
        if (chunkNodes.length === 0) break

        const chunk: Chunk = {
          type: 'chunk',
          key: new Key(),
          parent,
          children: [],
        }

        chunk.children = groupIntoChunks(
          chunkNodes,
          chunk,
          perChunk / this.chunkSize
        )
        chunks.push(chunk)
      }

      return chunks
    }

    // Determine the chunking depth based on the number of existing nodes in
    // the chunk and the number of nodes being inserted
    const newTotal = this.pointerSiblings.length + leaves.length
    let depthForTotal = 0

    for (let i = this.chunkSize; i < newTotal; i *= this.chunkSize) {
      depthForTotal++
    }

    // A depth of 0 means no chunking
    const depth = Math.max(depthForTotal, minDepth)
    const perTopLevelChunk = Math.pow(this.chunkSize, depth)

    const chunks = groupIntoChunks(leaves, this.pointerChunk, perTopLevelChunk)
    this.pointerSiblings.splice(this.pointerIndex + 1, 0, ...chunks)
    this.pointerIndex += chunks.length
    this.cachedPointerNode = undefined
    this.invalidateChunk()
    this.validateState()
  }

  /**
   * Move the pointer to the next leaf in the chunk tree
   */
  private readLeaf(): ChunkLeaf | null {
    // istanbul ignore next
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

    this.validateState()

    // If the next sibling or aunt is a chunk, descend into it
    this.enterChunkUntilLeaf(false)

    return this.pointerNode as ChunkLeaf
  }

  /**
   * Move the pointer to the previous leaf in the chunk tree
   */
  private returnToPreviousLeaf() {
    // If we were at the end of the tree, descend into the end of the last
    // chunk in the tree
    if (this.reachedEnd) {
      this.reachedEnd = false
      this.enterChunkUntilLeaf(true)
      return
    }

    // Get the previous sibling or aunt node
    while (true) {
      if (this.pointerIndex >= 1) {
        this.pointerIndex--
        this.cachedPointerNode = undefined
        break
      } else if (this.pointerChunk.type === 'root') {
        this.pointerIndex = -1
        return
      } else {
        this.exitChunk()
      }
    }

    this.validateState()

    // If the previous sibling or aunt is a chunk, descend into it
    this.enterChunkUntilLeaf(true)
  }

  /**
   * If debug mode is enabled, ensure that the state is internally consistent
   */
  // istanbul ignore next
  private validateState() {
    if (!this.debug) return

    const validateDescendant = (node: ChunkDescendant) => {
      if (node.type === 'chunk') {
        const { parent, children } = node

        if (!parent.children.includes(node)) {
          throw new Error(
            `Debug: Chunk ${node.key.id} has an incorrect parent property`
          )
        }

        children.forEach(validateDescendant)
      }
    }

    this.root.children.forEach(validateDescendant)

    if (
      this.cachedPointerNode !== undefined &&
      this.cachedPointerNode !== this.getPointerNode()
    ) {
      throw new Error(
        'Debug: The cached pointer is incorrect and has not been invalidated'
      )
    }

    const actualIndexStack = this.getChunkPath(this.pointerChunk)

    if (!actualIndexStack) {
      throw new Error('Debug: The pointer chunk is not connected to the root')
    }

    if (!Path.equals(this.pointerIndexStack, actualIndexStack)) {
      throw new Error(
        `Debug: The cached index stack [${this.pointerIndexStack.join(
          ', '
        )}] does not match the path of the pointer chunk [${actualIndexStack.join(
          ', '
        )}]`
      )
    }
  }
}
