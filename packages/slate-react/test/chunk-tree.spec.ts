import { Element, Node, Transforms, createEditor } from 'slate'
import { Key } from 'slate-dom'
import { ReactEditor, withReact } from '../src'
import {
  Chunk,
  ChunkAncestor,
  ChunkDescendant,
  ChunkNode,
  ChunkTree,
  NODE_TO_CHUNK_TREE,
  getChunkTreeForNode,
} from '../src/components/chunking/chunk-tree'

const block = (text: string): Element => ({ children: [{ text }] })

const blocks = (count: number) =>
  Array.from(
    {
      length: count,
    },
    (_, i) => block(i.toString())
  )

type TreeShape = string | TreeShape[]

const getTreeShape = (chunkNode: ChunkNode): TreeShape => {
  if (chunkNode.type === 'leaf') {
    return Node.string(chunkNode.node)
  }

  return chunkNode.children.map(getTreeShape)
}

const getChildrenAndTreeForShape = (
  editor: ReactEditor,
  treeShape: TreeShape[]
): { children: Element[]; chunkTree: ChunkTree } => {
  const children: Element[] = []

  const shapeToNode = (
    ts: TreeShape,
    parent: ChunkAncestor
  ): ChunkDescendant => {
    if (Array.isArray(ts)) {
      const chunk: Chunk = {
        type: 'chunk',
        key: new Key(),
        parent,
        children: [],
      }

      chunk.children = ts.map(child => shapeToNode(child, chunk))

      return chunk
    }

    const node = block(ts)
    children.push(node)

    return {
      type: 'leaf',
      key: ReactEditor.findKey(editor, node),
      node,
    }
  }

  const chunkTree: ChunkTree = {
    type: 'root',
    modifiedChunks: new Set(),
    movedNodeKeys: new Set(),
    children: [],
  }

  chunkTree.children = treeShape.map(child => shapeToNode(child, chunkTree))

  return { children, chunkTree }
}

const createEditorWithShape = (treeShape: TreeShape[]) => {
  const editor = withReact(createEditor())
  const { children, chunkTree } = getChildrenAndTreeForShape(editor, treeShape)
  editor.children = children
  NODE_TO_CHUNK_TREE.set(editor, chunkTree)
  return editor
}

describe('getChunkTreeForNode', () => {
  describe('chunking initial value', () => {
    const getShapeForInitialCount = (count: number) => {
      const editor = withReact(createEditor())
      editor.children = blocks(count)
      const chunkTree = getChunkTreeForNode(editor, editor, {
        reconcile: true,
        chunkSize: 3,
      })
      return getTreeShape(chunkTree)
    }

    it('returns empty tree for 0 children', () => {
      expect(getShapeForInitialCount(0)).toEqual([])
    })

    it('returns flat tree for 1 child', () => {
      expect(getShapeForInitialCount(1)).toEqual(['0'])
    })

    it('returns flat tree for 3 children', () => {
      expect(getShapeForInitialCount(3)).toEqual(['0', '1', '2'])
    })

    it('returns 1 layer of chunking for 4 children', () => {
      expect(getShapeForInitialCount(4)).toEqual([['0', '1', '2'], ['3']])
    })

    it('returns 1 layer of chunking for 9 children', () => {
      expect(getShapeForInitialCount(9)).toEqual([
        ['0', '1', '2'],
        ['3', '4', '5'],
        ['6', '7', '8'],
      ])
    })

    it('returns 2 layers of chunking for 10 children', () => {
      expect(getShapeForInitialCount(10)).toEqual([
        [
          ['0', '1', '2'],
          ['3', '4', '5'],
          ['6', '7', '8'],
        ],
        [['9']],
      ])
    })

    it('returns 2 layers of chunking for 27 children', () => {
      expect(getShapeForInitialCount(27)).toEqual([
        [
          ['0', '1', '2'],
          ['3', '4', '5'],
          ['6', '7', '8'],
        ],
        [
          ['9', '10', '11'],
          ['12', '13', '14'],
          ['15', '16', '17'],
        ],
        [
          ['18', '19', '20'],
          ['21', '22', '23'],
          ['24', '25', '26'],
        ],
      ])
    })

    it('returns 3 layers of chunking for 28 children', () => {
      expect(getShapeForInitialCount(28)).toEqual([
        [
          [
            ['0', '1', '2'],
            ['3', '4', '5'],
            ['6', '7', '8'],
          ],
          [
            ['9', '10', '11'],
            ['12', '13', '14'],
            ['15', '16', '17'],
          ],
          [
            ['18', '19', '20'],
            ['21', '22', '23'],
            ['24', '25', '26'],
          ],
        ],
        [[['27']]],
      ])
    })
  })

  describe('inserting nodes', () => {
    describe('in empty editor', () => {
      it('inserts a single node', () => {
        const editor = createEditorWithShape([])
        Transforms.insertNodes(editor, block('x'), { at: [0] })

        const chunkTree = getChunkTreeForNode(editor, editor, {
          reconcile: true,
          chunkSize: 3,
        })

        expect(getTreeShape(chunkTree)).toEqual(['x'])
      })

      it('inserts 27 nodes with 2 layers of chunking', () => {
        const editor = createEditorWithShape([])
        Transforms.insertNodes(editor, blocks(27), { at: [0] })

        const chunkTree = getChunkTreeForNode(editor, editor, {
          reconcile: true,
          chunkSize: 3,
        })

        expect(getTreeShape(chunkTree)).toEqual([
          [
            ['0', '1', '2'],
            ['3', '4', '5'],
            ['6', '7', '8'],
          ],
          [
            ['9', '10', '11'],
            ['12', '13', '14'],
            ['15', '16', '17'],
          ],
          [
            ['18', '19', '20'],
            ['21', '22', '23'],
            ['24', '25', '26'],
          ],
        ])
      })

      it('inserts 28 nodes with 3 layers of chunking', () => {
        const editor = createEditorWithShape([])
        Transforms.insertNodes(editor, blocks(28), { at: [0] })

        const chunkTree = getChunkTreeForNode(editor, editor, {
          reconcile: true,
          chunkSize: 3,
        })

        expect(getTreeShape(chunkTree)).toEqual([
          [
            [
              ['0', '1', '2'],
              ['3', '4', '5'],
              ['6', '7', '8'],
            ],
            [
              ['9', '10', '11'],
              ['12', '13', '14'],
              ['15', '16', '17'],
            ],
            [
              ['18', '19', '20'],
              ['21', '22', '23'],
              ['24', '25', '26'],
            ],
          ],
          [[['27']]],
        ])
      })
    })

    describe('at end of editor', () => {
      it('inserts a single node at the top level', () => {
        const editor = createEditorWithShape(['0', ['1', '2', ['3', '4', '5']]])
        Transforms.insertNodes(editor, block('x'), { at: [6] })

        const chunkTree = getChunkTreeForNode(editor, editor, {
          reconcile: true,
          chunkSize: 3,
        })

        expect(getTreeShape(chunkTree)).toEqual([
          '0',
          ['1', '2', ['3', '4', '5']],
          'x',
        ])
      })

      it('inserts a single node into a chunk', () => {
        const editor = createEditorWithShape(['0', ['1', ['2', '3', '4']]])
        Transforms.insertNodes(editor, block('x'), { at: [5] })

        const chunkTree = getChunkTreeForNode(editor, editor, {
          reconcile: true,
          chunkSize: 3,
        })

        expect(getTreeShape(chunkTree)).toEqual([
          '0',
          ['1', ['2', '3', '4'], 'x'],
        ])
      })

      it('inserts a single node into a nested chunk', () => {
        const editor = createEditorWithShape(['0', ['1', '2', ['3', '4']]])
        Transforms.insertNodes(editor, block('x'), { at: [5] })

        const chunkTree = getChunkTreeForNode(editor, editor, {
          reconcile: true,
          chunkSize: 3,
        })

        expect(getTreeShape(chunkTree)).toEqual([
          '0',
          ['1', '2', ['3', '4', 'x']],
        ])
      })

      it('inserts 25 nodes after 2 nodes with 2 layers of chunking', () => {
        const editor = createEditorWithShape(['a', 'b'])
        Transforms.insertNodes(editor, blocks(25), { at: [2] })

        const chunkTree = getChunkTreeForNode(editor, editor, {
          reconcile: true,
          chunkSize: 3,
        })

        expect(getTreeShape(chunkTree)).toEqual([
          'a',
          'b',
          [
            ['0', '1', '2'],
            ['3', '4', '5'],
            ['6', '7', '8'],
          ],
          [
            ['9', '10', '11'],
            ['12', '13', '14'],
            ['15', '16', '17'],
          ],
          [
            ['18', '19', '20'],
            ['21', '22', '23'],
            ['24'],
          ],
        ])
      })

      it('inserts 26 nodes after 2 nodes with 3 layers of chunking', () => {
        const editor = createEditorWithShape(['a', 'b'])
        Transforms.insertNodes(editor, blocks(26), { at: [2] })

        const chunkTree = getChunkTreeForNode(editor, editor, {
          reconcile: true,
          chunkSize: 3,
        })

        expect(getTreeShape(chunkTree)).toEqual([
          'a',
          'b',
          [
            [
              ['0', '1', '2'],
              ['3', '4', '5'],
              ['6', '7', '8'],
            ],
            [
              ['9', '10', '11'],
              ['12', '13', '14'],
              ['15', '16', '17'],
            ],
            [
              ['18', '19', '20'],
              ['21', '22', '23'],
              ['24', '25'],
            ],
          ],
        ])
      })
    })

    describe('at start of editor', () => {
      it('inserts a single node at the top level', () => {
        const editor = createEditorWithShape(['0', '1'])
        Transforms.insertNodes(editor, block('x'), { at: [0] })

        const chunkTree = getChunkTreeForNode(editor, editor, {
          reconcile: true,
          chunkSize: 3,
        })

        expect(getTreeShape(chunkTree)).toEqual(['x', '0', '1'])
      })
    })

    describe('in the middle of editor', () => {
      describe('at the top level', () => {
        it('inserts a single node', () => {
          const editor = createEditorWithShape(['0', '1'])
          Transforms.insertNodes(editor, block('x'), { at: [1] })

          const chunkTree = getChunkTreeForNode(editor, editor, {
            reconcile: true,
            chunkSize: 3,
          })

          expect(getTreeShape(chunkTree)).toEqual(['0', 'x', '1'])
        })
      })

      describe('in the middle of a chunk', () => {
        it('inserts a single node', () => {
          const editor = createEditorWithShape([[['0', '1']]])
          Transforms.insertNodes(editor, block('x'), { at: [1] })

          const chunkTree = getChunkTreeForNode(editor, editor, {
            reconcile: true,
            chunkSize: 3,
          })

          expect(getTreeShape(chunkTree)).toEqual([[['0', 'x', '1']]])
        })

        it('inserts 8 nodes between 2 nodes', () => {
          const editor = createEditorWithShape([[['a', 'b']]])
          Transforms.insertNodes(editor, blocks(8), { at: [1] })

          const chunkTree = getChunkTreeForNode(editor, editor, {
            reconcile: true,
            chunkSize: 3,
          })

          expect(getTreeShape(chunkTree)).toEqual([[[
            'a',
            [
              ['0', '1', '2'],
              ['3', '4', '5'],
              ['6', '7'],
            ],
            'b',
          ]]])
        })
      })

      describe('at the end of a chunk', () => {
        it('inserts 2 nodes in 2 adjacent shallow chunks', () => {
          const editor = createEditorWithShape([['a', 'b'], ['c']])
          Transforms.insertNodes(editor, blocks(2), { at: [2] })

          const chunkTree = getChunkTreeForNode(editor, editor, {
            reconcile: true,
            chunkSize: 3,
          })

          expect(getTreeShape(chunkTree)).toEqual([
            ['a', 'b', '0'],
            ['1', 'c'],
          ])
        })
      })
    })
  })

  describe('removing nodes', () => {
    it('removes a node', () => {
      const editor = createEditorWithShape(['0', [['1']], '2'])
      Transforms.removeNodes(editor, { at: [1] })

      const chunkTree = getChunkTreeForNode(editor, editor, {
        reconcile: true,
        chunkSize: 3,
      })

      expect(getTreeShape(chunkTree)).toEqual(['0', '2'])
    })
  });

  describe('updating nodes', () => {
    it('invalidates ancestor chunks of updated slate nodes', () => {
      const editor = createEditorWithShape(['0', [['1']], '2'])
      Transforms.insertText(editor, 'x', { at: [1, 0] })

      const chunkTree = getChunkTreeForNode(editor, editor, {
        reconcile: true,
        chunkSize: 3,
      })

      const outerChunk = chunkTree.children[1] as Chunk
      const innerChunk = outerChunk.children[0]

      expect(getTreeShape(chunkTree)).toEqual(['0', [['x']], '2'])

      expect(chunkTree.modifiedChunks).toEqual(
        new Set([outerChunk, innerChunk])
      )
    })
  })
})
