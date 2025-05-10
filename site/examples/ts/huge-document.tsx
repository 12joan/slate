import { faker } from '@faker-js/faker'
import React, {
  CSSProperties,
  Dispatch,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { createEditor as slateCreateEditor, Descendant, Editor } from 'slate'
import {
  Editable,
  RenderElementProps,
  RenderChunkProps,
  Slate,
  withReact,
} from 'slate-react'

import { HeadingElement, ParagraphElement } from './custom-types.d'

const SUPPORTS_EVENT_TIMING =
  typeof window !== 'undefined' && 'PerformanceEventTiming' in window

const SUPPORTS_LOAF_TIMING =
  typeof window !== 'undefined' &&
  'PerformanceLongAnimationFrameTiming' in window

interface Config {
  blocks: number
  chunking: boolean
  chunkSize: number
  chunkDivs: boolean
  chunkOutlines: boolean
  contentVisibilityMode: 'none' | 'element' | 'chunk'
}

const blocksOptions = [
  2, 1000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 30000, 40000, 50000,
  100000, 200000,
]

const chunkSizeOptions = [3, 10, 100, 1000]

const searchParams =
  typeof document === 'undefined'
    ? null
    : new URLSearchParams(document.location.search)

const parseNumber = (key: string, defaultValue: number) =>
  parseInt(searchParams?.get(key) ?? '', 10) || defaultValue

const parseBoolean = (key: string, defaultValue: boolean) => {
  const value = searchParams?.get(key)
  if (value) return value === 'true'
  return defaultValue
}

const parseEnum = <T extends string>(
  key: string,
  options: T[],
  defaultValue: T
): T => {
  const value = searchParams?.get(key) as T | null | undefined
  if (value && options.includes(value)) return value
  return defaultValue
}

const initialConfig: Config = {
  blocks: parseNumber('blocks', 10000),
  chunking: parseBoolean('chunking', true),
  chunkSize: parseNumber('chunk_size', 1000),
  chunkDivs: parseBoolean('chunk_divs', true),
  chunkOutlines: parseBoolean('chunk_outlines', false),
  contentVisibilityMode: parseEnum(
    'content_visibility',
    ['none', 'element', 'chunk'],
    'chunk'
  ),
}

const setSearchParams = (config: Config) => {
  if (searchParams) {
    searchParams.set('blocks', config.blocks.toString())
    searchParams.set('chunking', config.chunking ? 'true' : 'false')
    searchParams.set('chunk_size', config.chunkSize.toString())
    searchParams.set('chunk_divs', config.chunkDivs ? 'true' : 'false')
    searchParams.set('chunk_outlines', config.chunkOutlines ? 'true' : 'false')
    searchParams.set('content_visibility', config.contentVisibilityMode)
    history.replaceState({}, '', `?${searchParams.toString()}`)
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

const initialInitialValue =
  typeof window === 'undefined' ? [] : getInitialValue(initialConfig.blocks)

const createEditor = (config: Config) => {
  const editor = withReact(slateCreateEditor())

  editor.getChunkSize = node =>
    config.chunking && Editor.isEditor(node) ? config.chunkSize : null

  return editor
}

const HugeDocumentExample = () => {
  const [rendering, setRendering] = useState(false)
  const [config, baseSetConfig] = useState<Config>(initialConfig)
  const [initialValue, setInitialValue] = useState(initialInitialValue)
  const [editor, setEditor] = useState(() => createEditor(config))
  const [editorVersion, setEditorVersion] = useState(0)

  const setConfig = useCallback(
    (partialConfig: Partial<Config>) => {
      const newConfig = { ...config, ...partialConfig }

      setRendering(true)
      baseSetConfig(newConfig)
      setSearchParams(newConfig)

      setTimeout(() => {
        setRendering(false)
        setInitialValue(getInitialValue(newConfig.blocks))
        setEditor(createEditor(newConfig))
        setEditorVersion(n => n + 1)
      })
    },
    [config]
  )

  const renderElement = useCallback(
    (props: RenderElementProps) => (
      <Element
        {...props}
        contentVisibility={config.contentVisibilityMode === 'element'}
      />
    ),
    [config.contentVisibilityMode]
  )

  const renderChunk = useCallback(
    (props: RenderChunkProps) => (
      <Chunk
        {...props}
        contentVisibilityLowest={config.contentVisibilityMode === 'chunk'}
        outline={config.chunkOutlines}
      />
    ),
    [config.contentVisibilityMode, config.chunkOutlines]
  )

  return (
    <>
      <PerformanceControls
        editor={editor}
        config={config}
        setConfig={setConfig}
      />

      {rendering ? (
        <div>Rendering&hellip;</div>
      ) : (
        <Slate key={editorVersion} editor={editor} initialValue={initialValue}>
          <Editable
            renderElement={renderElement}
            renderChunk={config.chunkDivs ? renderChunk : undefined}
            spellCheck
            autoFocus
          />
        </Slate>
      )}
    </>
  )
}

const Chunk = ({
  attributes,
  children,
  lowest,
  contentVisibilityLowest,
  outline,
}: RenderChunkProps & {
  contentVisibilityLowest: boolean
  outline: boolean
}) => {
  const style: CSSProperties = {
    contentVisibility: contentVisibilityLowest && lowest ? 'auto' : undefined,
    border: outline ? '1px solid red' : undefined,
    padding: outline ? 20 : undefined,
    marginBottom: outline ? 20 : undefined,
  }

  return (
    <div {...attributes} style={style}>
      {children}
    </div>
  )
}

const Element = ({
  attributes,
  children,
  element,
  contentVisibility,
}: RenderElementProps & { contentVisibility: boolean }) => {
  const style: CSSProperties = {
    contentVisibility: contentVisibility ? 'auto' : undefined,
  }

  switch (element.type) {
    case 'heading-one':
      return (
        <h1 {...attributes} style={style}>
          {children}
        </h1>
      )
    default:
      return (
        <p {...attributes} style={style}>
          {children}
        </p>
      )
  }
}

const PerformanceControls = ({
  editor,
  config,
  setConfig,
}: {
  editor: Editor
  config: Config
  setConfig: Dispatch<Partial<Config>>
}) => {
  const [configurationOpen, setConfigurationOpen] = useState(true)
  const [keyPressDurations, setKeyPressDurations] = useState<number[]>([])
  const [lastLongAnimationFrameDuration, setLastLongAnimationFrameDuration] =
    useState<number | null>(null)

  const lastKeyPressDuration: number | null = keyPressDurations[0] ?? null

  const averageKeyPressDuration =
    keyPressDurations.length === 10
      ? Math.round(keyPressDurations.reduce((total, d) => total + d) / 10)
      : null

  useEffect(() => {
    if (!SUPPORTS_EVENT_TIMING) return

    const observer = new PerformanceObserver(list => {
      list.getEntries().forEach(entry => {
        if (entry.name === 'keypress') {
          const duration = Math.round(
            // @ts-ignore Entry type is missing processingStart and processingEnd
            entry.processingEnd - entry.processingStart
          )
          setKeyPressDurations(durations => [
            duration,
            ...durations.slice(0, 9),
          ])
        }
      })
    })

    // @ts-ignore Options type is missing durationThreshold
    observer.observe({ type: 'event', durationThreshold: 16 })

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!SUPPORTS_LOAF_TIMING) return

    const { apply } = editor
    let afterOperation = false

    editor.apply = operation => {
      apply(operation)
      afterOperation = true
    }

    const observer = new PerformanceObserver(list => {
      list.getEntries().forEach(entry => {
        if (afterOperation) {
          setLastLongAnimationFrameDuration(Math.round(entry.duration))
          afterOperation = false
        }
      })
    })

    // Register the observer for events
    observer.observe({ type: 'long-animation-frame' })

    return () => observer.disconnect()
  }, [editor])

  return (
    <div className="performance-controls">
      <p>
        <label>
          Blocks:{' '}
          <select
            value={config.blocks}
            onChange={event =>
              setConfig({
                blocks: parseInt(event.target.value, 10),
              })
            }
          >
            {blocksOptions.map(blocks => (
              <option key={blocks} value={blocks}>
                {blocks.toString().replace(/(\d{3})$/, ',$1')}
              </option>
            ))}
          </select>
        </label>
      </p>

      <details
        open={configurationOpen}
        onToggle={event => setConfigurationOpen(event.currentTarget.open)}
      >
        <summary>Configuration</summary>

        <p>
          <label>
            <input
              type="checkbox"
              checked={config.chunking}
              onChange={event =>
                setConfig({
                  chunking: event.target.checked,
                })
              }
            />{' '}
            Chunking enabled
          </label>
        </p>

        {config.chunking && (
          <>
            <p>
              <label>
                <input
                  type="checkbox"
                  checked={config.chunkDivs}
                  onChange={event =>
                    setConfig({
                      chunkDivs: event.target.checked,
                    })
                  }
                />{' '}
                Render each chunk as a separate <code>&lt;div&gt;</code>
              </label>
            </p>

            {config.chunkDivs && (
              <p>
                <label>
                  <input
                    type="checkbox"
                    checked={config.chunkOutlines}
                    onChange={event =>
                      setConfig({
                        chunkOutlines: event.target.checked,
                      })
                    }
                  />{' '}
                  Outline each chunk
                </label>
              </p>
            )}

            <p>
              <label>
                Chunk size:{' '}
                <select
                  value={config.chunkSize}
                  onChange={event =>
                    setConfig({
                      chunkSize: parseInt(event.target.value, 10),
                    })
                  }
                >
                  {chunkSizeOptions.map(chunkSize => (
                    <option key={chunkSize} value={chunkSize}>
                      {chunkSize}
                    </option>
                  ))}
                </select>
              </label>
            </p>
          </>
        )}

        <p>
          <label>
            <code>content-visibility: auto</code> on:{' '}
            <select
              value={config.contentVisibilityMode}
              onChange={event =>
                setConfig({
                  contentVisibilityMode: event.target.value as any,
                })
              }
            >
              <option value="none">None</option>
              <option value="element">Elements</option>
              {config.chunking && config.chunkDivs && (
                <option value="chunk">Lowest chunks</option>
              )}
            </select>
          </label>
        </p>
      </details>

      <details>
        <summary>Statistics</summary>

        <p>
          Last keypress (ms):{' '}
          {SUPPORTS_EVENT_TIMING
            ? lastKeyPressDuration ?? '-'
            : 'Not supported'}
        </p>

        <p>
          Average of last 10 keypresses (ms):{' '}
          {SUPPORTS_EVENT_TIMING
            ? averageKeyPressDuration ?? '-'
            : 'Not supported'}
        </p>

        <p>
          Last long animation frame (ms):{' '}
          {SUPPORTS_LOAF_TIMING
            ? lastLongAnimationFrameDuration ?? '-'
            : 'Not supported'}
        </p>

        {SUPPORTS_EVENT_TIMING && lastKeyPressDuration === null && (
          <p>Events shorter than 16ms may not be detected.</p>
        )}
      </details>
    </div>
  )
}

export default HugeDocumentExample
