import { useEffect, useState } from 'react'
import { DownloadIcon } from './icons.tsx'

type QrCodeProps = {
  value: string
  /** Used for the downloaded file name. */
  name: string
  size?: number
}

const QR_OPTIONS = {
  errorCorrectionLevel: 'M',
  margin: 2,
  color: { dark: '#041016', light: '#ffffff' },
} as const

/** Renders a QR code for `value`, loading the encoder only when needed. */
export function QrCode({ value, name, size = 176 }: QrCodeProps) {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSvg(null)
    setFailed(false)

    import('qrcode')
      .then((qr) => qr.toString(value, { ...QR_OPTIONS, type: 'svg' }))
      .then((markup) => {
        if (!cancelled) {
          setSvg(markup)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [value])

  async function download() {
    const qr = await import('qrcode')
    const dataUrl = await qr.toDataURL(value, { ...QR_OPTIONS, width: 1024 })
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = `shrt-${name}.png`
    link.click()
  }

  return (
    <div className="qr">
      <div
        className="qr-frame"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`QR code for ${value}`}
      >
        {svg ? (
          <span className="qr-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <span className="qr-placeholder">{failed ? 'QR unavailable' : ''}</span>
        )}
      </div>
      <button
        className="button button-ghost button-compact"
        type="button"
        disabled={!svg}
        onClick={() => {
          void download()
        }}
      >
        <DownloadIcon size={14} />
        Download PNG
      </button>
    </div>
  )
}
