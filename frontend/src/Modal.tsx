import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { CloseIcon } from './icons.tsx'

type ModalProps = {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  size?: 'default' | 'small'
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Accessible dialog: Escape closes it, focus moves inside on open and returns
 * to the opener on close, Tab cycles within the panel, and the page behind
 * stops scrolling.
 */
export function Modal({ open, title, onClose, children, size = 'default' }: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)

  useLayoutEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) {
      return
    }

    const opener = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const firstField = panel?.querySelector<HTMLElement>(
      'input:not([disabled]), textarea:not([disabled]), select:not([disabled])',
    )
    ;(firstField ?? panel)?.focus()

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab' || !panel) {
        return
      }

      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      opener?.focus?.()
    }
  }, [open])

  if (!open) {
    return null
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="overlay-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        className={`overlay-panel${size === 'small' ? ' overlay-panel-small' : ''}`}
        tabIndex={-1}
      >
        <div className="overlay-head">
          <h2 id={titleId} className="auth-title">
            {title}
          </h2>
          <button className="overlay-close" type="button" onClick={onClose} aria-label="Close">
            <CloseIcon size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
