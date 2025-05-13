import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
} from 'react'
import { Editor } from 'slate'
import { useIsomorphicLayoutEffect } from './use-isomorphic-layout-effect'
import { useSlateStatic } from './use-slate-static'

function isError(error: any): error is Error {
  return error instanceof Error
}

type Callback = () => void

export interface SlateSelectorOptions {
  /**
   * If true, defer calling the selector function until after `Editable` has
   * finished rendering. This ensures that `ReactEditor.findPath` won't return
   * an outdated path if called inside the selector.
   */
  deferred?: boolean
}

/**
 * A React context for sharing the editor selector context in a way to control rerenders
 */

export const SlateSelectorContext = createContext<{
  addEventListener: (
    callback: Callback,
    options: SlateSelectorOptions
  ) => () => void
  flushDeferred: () => void
}>({} as any)

const refEquality = (a: any, b: any) => a === b

/**
 * Use redux style selectors to prevent rerendering on every keystroke.
 *
 * Bear in mind rerendering can only prevented if the returned value is a value
 * type or for reference types (e.g. objects and arrays) add a custom equality
 * function.
 *
 * @example
 * const isSelectionActive = useSlateSelector(editor => Boolean(editor.selection));
 */
export function useSlateSelector<T>(
  selector: (editor: Editor) => T,
  equalityFn: (a: T, b: T) => boolean = refEquality,
  { deferred }: SlateSelectorOptions = {}
) {
  const editor = useSlateStatic()
  const [, forceRender] = useReducer(s => s + 1, 0)

  const context = useContext(SlateSelectorContext)
  if (!context) {
    throw new Error(
      `The \`useSlateSelector\` hook must be used inside the <Slate> component's context.`
    )
  }
  const { addEventListener } = context

  const latestSubscriptionCallbackError = useRef<Error | undefined>()
  const latestSelector = useRef<(editor: Editor) => T>(() => null as any)
  const latestSelectedState = useRef<T>(null as any as T)
  let selectedState: T

  try {
    if (
      selector !== latestSelector.current ||
      latestSubscriptionCallbackError.current
    ) {
      const selectorResult = selector(editor)

      if (equalityFn(latestSelectedState.current, selectorResult)) {
        selectedState = latestSelectedState.current
      } else {
        selectedState = selectorResult
      }
    } else {
      selectedState = latestSelectedState.current
    }
  } catch (err) {
    if (latestSubscriptionCallbackError.current && isError(err)) {
      err.message += `\nThe error may be correlated with this previous error:\n${latestSubscriptionCallbackError.current.stack}\n\n`
    }

    throw err
  }

  latestSelector.current = selector
  latestSelectedState.current = selectedState
  latestSubscriptionCallbackError.current = undefined

  useIsomorphicLayoutEffect(
    () => {
      function checkForUpdates() {
        try {
          const newSelectedState = latestSelector.current(editor)

          if (equalityFn(newSelectedState, latestSelectedState.current)) {
            return
          }

          latestSelectedState.current = newSelectedState
        } catch (err) {
          // we ignore all errors here, since when the component
          // is re-rendered, the selectors are called again, and
          // will throw again, if neither props nor store state
          // changed
          if (err instanceof Error) {
            latestSubscriptionCallbackError.current = err
          } else {
            latestSubscriptionCallbackError.current = new Error(String(err))
          }
        }

        forceRender()
      }

      const unsubscribe = addEventListener(checkForUpdates, { deferred })

      checkForUpdates()

      return () => unsubscribe()
    },
    // don't rerender on equalityFn change since we want to be able to define it inline
    [editor, addEventListener, deferred]
  )

  return selectedState
}

/**
 * Create selector context with editor updating on every editor change
 */
export function useSelectorContext() {
  const eventListeners = useRef(new Set<Callback>())
  const deferredEventListeners = useRef(new Set<Callback>())

  const onChange = useCallback(() => {
    eventListeners.current.forEach(listener => listener())
  }, [])

  const flushDeferred = useCallback(() => {
    deferredEventListeners.current.forEach(listener => listener())
    deferredEventListeners.current.clear()
  }, [])

  const selectorContext = useMemo(() => {
    return {
      addEventListener: (
        callbackProp: Callback,
        { deferred = false }: SlateSelectorOptions
      ) => {
        const callback = deferred
          ? () => deferredEventListeners.current.add(callbackProp)
          : callbackProp

        eventListeners.current.add(callback)

        return () => {
          eventListeners.current.delete(callback)
        }
      },
      flushDeferred,
    }
  }, [eventListeners, flushDeferred])

  return { selectorContext, onChange }
}

export function useFlushDeferredSelectorsOnRender() {
  const { flushDeferred } = useContext(SlateSelectorContext)
  useIsomorphicLayoutEffect(flushDeferred)
}
