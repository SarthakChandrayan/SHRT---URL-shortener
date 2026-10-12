import { useEffect, useState } from 'react'

type ReportState<T> = {
  data: T | null
  loading: boolean
  error: string | null
}

/**
 * Loads a report whenever `key` changes. The previous data stays on screen
 * while the next range loads, so switching 7d → 30d doesn't flash empty.
 */
export function useReport<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
): ReportState<T> & { retry: () => void } {
  const [state, setState] = useState<ReportState<T>>({ data: null, loading: true, error: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState((current) => ({ ...current, loading: true, error: null }))

    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ data, loading: false, error: null })
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState((current) => ({
            ...current,
            loading: false,
            error: error instanceof Error ? error.message : 'Could not load analytics',
          }))
        }
      })

    return () => controller.abort()
    // `load` is recreated each render; `key` captures what it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])

  return { ...state, retry: () => setAttempt((value) => value + 1) }
}
