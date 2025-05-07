import React from 'react'
import {Element} from 'slate'

const CHUNK_SIZE = 3

const ChunkedChildren = (props: {
  startIndex?: number
  nodes: Element[]
  children: (node: Element, i: number) => JSX.Element
}) => {
  const {
    startIndex = 0,
    nodes,
    children: renderNode,
  } = props

  if (nodes.length <= CHUNK_SIZE) {
    return nodes.map((node, i) => renderNode(node, startIndex + i))
  }

  const perChunk = Math.ceil(nodes.length / CHUNK_SIZE)
  const children: JSX.Element[] = []

  for (let i = 0; i < CHUNK_SIZE; i++) {
    const chunkNodes = nodes.slice(i * perChunk, (i + 1) * perChunk)
    const chunkStartIndex = startIndex + (i * perChunk)

    children.push(
      <MemoizedChunkedChildren key={i} startIndex={chunkStartIndex} nodes={chunkNodes}>
        {renderNode}
      </MemoizedChunkedChildren>
    )
  }

  return children
}

const MemoizedChunkedChildren = React.memo(ChunkedChildren, (prev, next) =>
  prev.startIndex === next.startIndex &&
  prev.children === next.children &&
  prev.nodes.length === next.nodes.length &&
  prev.nodes.every((prevNode, i) => prevNode === next.nodes[i])
) as unknown as typeof ChunkedChildren

export default MemoizedChunkedChildren
