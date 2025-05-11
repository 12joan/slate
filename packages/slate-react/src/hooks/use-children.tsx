import React, { useCallback } from 'react'
import { Ancestor, Editor, Element, DecoratedRange, Text } from 'slate'
import { Key } from 'slate-dom'
import {
  RenderChunkProps,
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
import { getChunkTreeForNode } from '../chunking'
import ChunkTree from '../components/chunk-tree'

/**
 * Children.
 */

const useChildren = (props: {
  decorations: DecoratedRange[]
  node: Ancestor
  renderElement?: (props: RenderElementProps) => JSX.Element
  renderChunk?: (props: RenderChunkProps) => JSX.Element
  renderPlaceholder: (props: RenderPlaceholderProps) => JSX.Element
  renderText?: (props: RenderTextProps) => JSX.Element
  renderLeaf?: (props: RenderLeafProps) => JSX.Element
}) => {
  const {
    decorations,
    node,
    renderElement,
    renderChunk,
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
  const chunkSize = isLeafBlock ? null : editor.getChunkSize(node)
  const chunking = !!chunkSize

  // Update the index and parent of each child.
  // PERF: If chunking is enabled, this is done while traversing the chunk tree
  // to eliminate unnecessary weak map operations.
  if (!chunking) {
    node.children.forEach((n, i) => {
      NODE_TO_INDEX.set(n, i)
      NODE_TO_PARENT.set(n, node)
    })
  }

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
            renderChunk={renderChunk}
            renderPlaceholder={renderPlaceholder}
            renderLeaf={renderLeaf}
            renderText={renderText}
          />
        </SelectedContext.Provider>
      )
    },
    [
      editor,
      renderElement,
      renderChunk,
      renderPlaceholder,
      renderLeaf,
      renderText,
    ]
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

  if (!chunking) {
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
    reconcile: {
      chunkSize,
      onInsert: (n, i) => {
        NODE_TO_INDEX.set(n, i)
        NODE_TO_PARENT.set(n, node)
      },
      onUpdate: (n, i) => {
        NODE_TO_INDEX.set(n, i)
        NODE_TO_PARENT.set(n, node)
      },
      onIndexChange: (n, i) => {
        NODE_TO_INDEX.set(n, i)
      },
    },
  })

  return (
    <ChunkTree
      root={chunkTree}
      ancestor={chunkTree}
      renderElement={renderElementComponent}
      renderChunk={renderChunk}
    />
  )
}

export default useChildren
