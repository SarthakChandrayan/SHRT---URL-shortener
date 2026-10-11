import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AlertIcon, CheckIcon, CloseIcon } from './icons.tsx'

type ToastKind = 'success' | 'error' | 'info'

type Toast = {
  id: number
  kind: ToastKind
  message: string
}

type ToastFn = (message: string, kind?: ToastKind) => void

const ToastContext = createContext<ToastFn | null>(null)

const TOAST_MS = 3200
const MAX_TOASTS = 3

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback<ToastFn>((message, kind = 'success') => {
    nextId.current += 1
    const id = nextId.current
    setToasts((current) => [...current.slice(-(MAX_TOASTS - 1)), { id, kind, message }])
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toast.id, onDismiss])

  return (
    <div
      className={`toast toast-${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
    >
      <span className="toast-icon">
        {toast.kind === 'error' ? <AlertIcon size={16} /> : <CheckIcon size={16} />}
      </span>
      <span className="toast-message">{toast.message}</span>
      <button
        className="toast-close"
        type="button"
        aria-label="Dismiss"
        onClick={() => onDismiss(toast.id)}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  )
}

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return ctx
}
