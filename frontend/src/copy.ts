export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  copyWithFallback(value)
}

function copyWithFallback(value: string) {
  const field = document.createElement('textarea')
  field.value = value
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.left = '-9999px'
  document.body.appendChild(field)
  field.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(field)

  if (!copied) {
    throw new Error('Copy failed')
  }
}
