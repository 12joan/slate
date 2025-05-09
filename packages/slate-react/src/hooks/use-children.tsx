import React, { useCallback } from 'react'
import { Ancestor, Editor, Element, DecoratedRange, Text } from 'slate'
import { Key } from 'slate-dom'
import {
  RenderElementProps,
  RenderLeafProps,
  RenderPlaceholderProps,
  RenderTextProps,
} from '../components/editable'

import ElementComponent from '../components/element'
import TextComponent from '../components/text'
import { ReactEditor } from '../plugin/react-editor'
import { IS_NODE_MAP_DIRTY, NODE_TO_INDEX, NODE_TO_PARENT } from 'slate-dom'
import { SelectedContext } from './use-selected'
import { useSlateStatic } from './use-slate-static'
import {
  type Chunk as ChunkType,
  type ChunkAncestor as ChunkAncestorType,
  type ChunkTree as ChunkTreeType,
  getChunkTreeForNode,
} from '../components/chunking/chunk-tree'

/**
 * Children.
 */

const useChildren = (props: {
  decorations: DecoratedRange[]
  node: Ancestor
  renderElement?: (props: RenderElementProps) => JSX.Element
  renderPlaceholder: (props: RenderPlaceholderProps) => JSX.Element
  renderText?: (props: RenderTextProps) => JSX.Element
  renderLeaf?: (props: RenderLeafProps) => JSX.Element
}) => {
  const {
    decorations,
    node,
    renderElement,
    renderPlaceholder,
    renderText,
    renderLeaf,
  } = props
  // const decorate = useDecorate()
  const editor = useSlateStatic()
  IS_NODE_MAP_DIRTY.set(editor as ReactEditor, false)
  // const path = ReactEditor.findPath(editor, node)
  const isEditor = Editor.isEditor(node)
  const isBlock = !isEditor && Element.isElement(node) && !editor.isInline(node)
  const isLeafBlock = isBlock && Editor.hasInlines(editor, node)

  node.children.forEach((n, i) => {
    NODE_TO_INDEX.set(n, i)
    NODE_TO_PARENT.set(n, node)
  })

  const renderElementComponent = useCallback(
    (n: Element, cachedKey?: Key) => {
      const key = cachedKey ?? ReactEditor.findKey(editor, n)

      return (
        <SelectedContext.Provider key={`provider-${key.id}`} value={false}>
          <ElementComponent
            decorations={[]}
            element={n}
            key={key.id}
            renderElement={renderElement}
            renderPlaceholder={renderPlaceholder}
            renderLeaf={renderLeaf}
            renderText={renderText}
          />
        </SelectedContext.Provider>
      )
    },
    [editor, renderElement, renderPlaceholder, renderLeaf, renderText]
  )

  const renderTextComponent = (n: Text, i: number) => {
    const key = ReactEditor.findKey(editor, n)

    return (
      <TextComponent
        decorations={[]}
        key={key.id}
        isLast={i === node.children.length - 1}
        parent={node}
        renderPlaceholder={renderPlaceholder}
        renderLeaf={renderLeaf}
        renderText={renderText}
        text={n}
      />
    )
  }

  const chunkSize = isLeafBlock ? null : editor.getChunkSize(node)

  if (!chunkSize) {
    return node.children.map((n, i) =>
      Text.isText(n) ? renderTextComponent(n, i) : renderElementComponent(n)
    )
  }

  // const p = path.concat(i)
  // const key = cachedKey ?? ReactEditor.findKey(editor, n)
  // const range = Editor.range(editor, p)
  // const sel = selection && Range.intersection(range, selection)
  // const ds = decorate([n, p])

  // for (const dec of decorations) {
  //   const d = Range.intersection(dec, range)

  //   if (d) {
  //     ds.push(d)
  //   }
  // }

  const chunkTree = getChunkTreeForNode(editor, node, {
    reconcile: { chunkSize },
  })

  return (
    <ChunkTree
      root={chunkTree}
      chunk={chunkTree}
      renderElement={renderElementComponent}
    />
  )
}

const ChunkAncestor = <C extends ChunkAncestorType>(props: {
  root: ChunkTreeType
  chunk: C
  renderElement: (node: Element, key: Key) => JSX.Element
}) => {
  const { root, chunk, renderElement } = props

  return chunk.children.map(chunkNode =>
    chunkNode.type === 'chunk' ? (
      <div
        key={chunkNode.key.id}
        style={
          chunkNode.children.some(c => c.type === 'leaf')
            ? { contentVisibility: 'auto' }
            : {}
        }
      >
        <MemoizedChunk
          root={root}
          chunk={chunkNode}
          renderElement={renderElement}
        />
      </div>
    ) : (
      renderElement(chunkNode.node, chunkNode.key)
    )
  )
}

const ChunkTree = ChunkAncestor<ChunkTreeType>

const MemoizedChunk = React.memo(
  ChunkAncestor<ChunkType>,
  (prev, next) =>
    prev.root === next.root &&
    prev.renderElement === next.renderElement &&
    !next.root.modifiedChunks.has(next.chunk)
)

export default useChildren
