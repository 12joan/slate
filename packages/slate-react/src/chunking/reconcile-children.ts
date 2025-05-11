import { Editor, Descendant } from 'slate'
import { ChunkTree, ChunkLeaf } from './types'
import { ChunkTreeHelper, ChunkTreeHelperOptions } from './chunk-tree-helper'
import { ChildrenHelper } from './children-helper'

export interface ReconcileOptions extends ChunkTreeHelperOptions {
  chunkTree: ChunkTree
  children: Descendant[]
  chunkSize: number
  debug?: boolean
}

/**
 * Update the chunk tree to match the children array, inserting, removing and
 * updating differing nodes
 */
export const reconcileChildren = (
  editor: Editor,
  { chunkTree, children, chunkSize, debug }: ReconcileOptions
) => {
  chunkTree.modifiedChunks.clear()

  const chunkTreeHelper = new ChunkTreeHelper(chunkTree, { chunkSize, debug })
  const childrenHelper = new ChildrenHelper(editor, children)

  let treeLeaf: ChunkLeaf | null

  // Read leaves from the tree one by one, each one representing a single Slate
  // node. Each leaf from the tree is compared to the current node in the
  // children array to determine whether nodes have been inserted, removed or
  // updated.
  while ((treeLeaf = chunkTreeHelper.readLeaf())) {
    // Check where the tree node appears in the children array. Nodes are
    // removed from the chunk tree on move_node, so the only way for lookAhead
    // to be greater than 0 is if nodes have been inserted in the children array
    // prior to the tree node.
    // TODO: Use movedNodeKeys
    const lookAhead = childrenHelper.lookAhead(treeLeaf.node, treeLeaf.key)

    // If the tree leaf is not present in children, remove it
    if (lookAhead === -1) {
      chunkTreeHelper.remove()
      continue
    }

    // Get the matching Slate node and any nodes that may have been inserted
    // prior to it. Insert these into the chunk tree.
    const insertedChildrenStartIndex = childrenHelper.pointerIndex
    const insertedChildren = childrenHelper.read(lookAhead + 1)
    const matchingChild = insertedChildren.pop()!

    if (insertedChildren.length) {
      const leavesToInsert = childrenHelper.toChunkLeaves(
        insertedChildren,
        insertedChildrenStartIndex
      )

      chunkTreeHelper.insertBefore(leavesToInsert)
    }

    // Make sure the chunk tree contains the most recent version of the Slate
    // node
    if (treeLeaf.node !== matchingChild) {
      treeLeaf.node = matchingChild
      chunkTreeHelper.invalidateChunk()
    }
  }

  // If there are still Slate nodes remaining from the children array that were
  // not matched to nodes in the tree, insert them at the end of the tree
  if (!childrenHelper.reachedEnd) {
    const remainingChildren = childrenHelper.remaining()

    const leavesToInsert = childrenHelper.toChunkLeaves(
      remainingChildren,
      childrenHelper.pointerIndex
    )

    // Move the pointer back to the final leaf in the tree, or the start of the
    // tree if the tree is currently empty
    chunkTreeHelper.returnToPreviousLeaf()

    chunkTreeHelper.insertAfter(leavesToInsert)
  }

  chunkTree.movedNodeKeys.clear()
}
