import { faker } from '@faker-js/faker'
import React, { CSSProperties, Dispatch, useCallback, useEffect, useState } from 'react'
import { createEditor as slateCreateEditor, Descendant, Editor } from 'slate'
import { Editable, RenderElementProps, Slate, withReact } from 'slate-react'

import {
  HeadingElement,
  ParagraphElement,
} from './custom-types.d'

interface Config {
  blocks: number
  chunking: boolean
}

const SUPPORTS_EVENT_TIMING = typeof window !== 'undefined' && 'PerformanceEventTiming' in window
const SUPPORTS_LOAF_TIMING = typeof window !== 'undefined' && 'PerformanceLongAnimationFrameTiming' in window

const searchParams = typeof document === 'undefined' ? null : new URLSearchParams(document.location.search);

const initialConfig: Config = {
  blocks: parseInt(searchParams?.get('blocks') ?? '', 10) || 1000,
  chunking: searchParams?.get('chunking') === 'true',
}

const setSearchParams = (config: Config) => {
  if (searchParams) {
    searchParams.set('blocks', config.blocks.toString())
    searchParams.set('chunking', config.chunking ? 'true' : 'false')
    history.replaceState({}, '', '?' + searchParams.toString())
  }
}

const cachedInitialValue: Descendant[] = []

const getInitialValue = (blocks: number) => {
  if (cachedInitialValue.length >= blocks) {
    return cachedInitialValue.slice(0, blocks)
  }

  faker.seed(1)

  for (let i = cachedInitialValue.length; i < blocks; i++) {
    if (i % 100 === 0) {
      const heading: HeadingElement = {
        type: 'heading-one',
        children: [{ text: faker.lorem.sentence() }],
      }
      cachedInitialValue.push(heading)
    } else {
      const paragraph: ParagraphElement = {
        type: 'paragraph',
        children: [{ text: faker.lorem.paragraph() }],
      }
      cachedInitialValue.push(paragraph)
    }
  }

  return cachedInitialValue.slice()
}

const initialInitialValue = getInitialValue(initialConfig.blocks)

const createEditor = (config: Config) => {
  const editor = withReact(slateCreateEditor())

  editor.getChunkSize = (node) => config.chunking && Editor.isEditor(node)
    ? 100
    : null

  return editor
}

const HugeDocumentExample = () => {
  const [rendering, setRendering] = useState(false)
  const [config, baseSetConfig] = useState<Config>(initialConfig)
  const [initialValue, setInitialValue] = useState(initialInitialValue)
  const [editor, setEditor] = useState(() => createEditor(config))
  const [editorVersion, setEditorVersion] = useState(0)

  const setConfig = useCallback((newConfig: Config) => {
    setRendering(true)
    baseSetConfig(newConfig)
    setSearchParams(newConfig)

    setTimeout(() => {
      setRendering(false)
      setInitialValue(getInitialValue(newConfig.blocks))
      setEditor(createEditor(newConfig))
      setEditorVersion((n) => n + 1)
    })
  }, [])

  const renderElement = useCallback(
    (props: RenderElementProps) => <Element {...props} />,
    []
  )

  return (
    <>
      <DebugUI editor={editor} config={config} setConfig={setConfig} />

      {rendering
        ? <div>Rendering&hellip;</div>
        : (
          <Slate key={editorVersion} editor={editor} initialValue={initialValue}>
            <Editable renderElement={renderElement} spellCheck autoFocus />
          </Slate>
        )
      }
    </>
  )
}

const Element = ({ attributes, children, element }: RenderElementProps) => {
  switch (element.type) {
    case 'heading-one':
      return <h1 {...attributes}>{children}</h1>
    default:
      return <p {...attributes}>{children}</p>
  }
}

const DebugUI = ({
  editor,
  config,
  setConfig,
}: {
  editor: Editor
  config: Config
  setConfig: Dispatch<Config>
}) => {
  const [keyPressDurations, setKeyPressDurations] = useState<number[]>([])
  const [lastLongAnimationFrameDuration, setLastLongAnimationFrameDuration] = useState<number | null>(null)

  const lastKeyPressDuration: number | null = keyPressDurations[0] ?? null

  const averageKeyPressDuration = keyPressDurations.length === 10
    ? Math.round(keyPressDurations.reduce((total, d) => total + d) / 10)
    : null

  useEffect(() => {
    if (!SUPPORTS_EVENT_TIMING) return

    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (entry.name === 'keypress') {
          // @ts-ignore Entry type is missing processingStart and processingEnd
          const duration = Math.round(entry.processingEnd - entry.processingStart)
          setKeyPressDurations((durations) => [duration, ...durations.slice(0, 9)])
        }
      })
    })

    // @ts-ignore Options type is missing durationThreshold
    observer.observe({ type: "event", durationThreshold: 16 })

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!SUPPORTS_LOAF_TIMING) return

    const { apply } = editor
    let afterOperation = false

    editor.apply = (operation) => {
      apply(operation)
      afterOperation = true
    }

    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (afterOperation) {
          setLastLongAnimationFrameDuration(Math.round(entry.duration))
          afterOperation = false
        }
      })
    })

    // Register the observer for events
    observer.observe({ type: "long-animation-frame" })

    return () => observer.disconnect()
  }, [editor])

  return (
    <div className="debug-ui">
      <p><label>
        Blocks:{' '}
        <select
          value={config.blocks}
          onChange={(event) => setConfig({
            ...config,
            blocks: parseInt(event.target.value, 10),
          })}
        >
          <option value={1000}>1000</option>
          <option value={2500}>2500</option>
          <option value={5000}>5000</option>
          <option value={7500}>7500</option>
          <option value={10000}>10000</option>
          <option value={15000}>15000</option>
          <option value={20000}>20000</option>
          <option value={25000}>25000</option>
          <option value={30000}>30000</option>
          <option value={40000}>40000</option>
          <option value={50000}>50000</option>
          <option value={100000}>100000</option>
        </select>
      </label></p>

      <p><label>
        <input
          type="checkbox"
          checked={config.chunking}
          onChange={(event) => setConfig({
            ...config,
            chunking: event.target.checked,
          })}
        />{' '}
        Chunking enabled
      </label></p>

      <p>Last keypress (ms): {SUPPORTS_EVENT_TIMING ? lastKeyPressDuration ?? '-': 'Not supported' }</p>

      <p>Average of last 10 keypresses (ms): {SUPPORTS_EVENT_TIMING ? averageKeyPressDuration ?? '-' : 'Not supported' }</p>

      <p>Last long animation frame (ms): {SUPPORTS_LOAF_TIMING ? lastLongAnimationFrameDuration ?? '-' : 'Not supported'}</p>

      {SUPPORTS_EVENT_TIMING && lastKeyPressDuration === null && <p>Events shorter than 16ms may not be detected.</p>}
    </div>
  )
}

export default HugeDocumentExample
