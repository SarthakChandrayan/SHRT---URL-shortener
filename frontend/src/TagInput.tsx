import { useState, type KeyboardEvent } from 'react'
import { CloseIcon } from './icons.tsx'
import { MAX_TAG_LENGTH, MAX_TAGS, normalizeTag } from './tags.ts'

type TagInputProps = {
  id: string
  tags: string[]
  onChange: (tags: string[]) => void
  suggestions?: string[]
  disabled?: boolean
}

/** Type a tag and press Enter or comma; Backspace on empty removes the last. */
export function TagInput({ id, tags, onChange, suggestions = [], disabled }: TagInputProps) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  /** Adds tags; returns false (keeping the draft) if any were rejected. */
  function add(...raws: string[]): boolean {
    const next = [...tags]
    let problem: string | null = null

    for (const raw of raws) {
      const tag = normalizeTag(raw)

      if (!tag) {
        if (raw.trim()) {
          problem = `Tags are 1–${MAX_TAG_LENGTH} letters, numbers, spaces, - or _`
        }
        continue
      }

      if (next.length >= MAX_TAGS) {
        problem = `Up to ${MAX_TAGS} tags`
        break
      }

      if (!next.includes(tag)) {
        next.push(tag)
      }
    }

    if (next.length !== tags.length) {
      onChange(next)
    }
    setError(problem)
    return problem === null
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      if (add(draft)) {
        setDraft('')
      }
    } else if (event.key === 'Backspace' && !draft && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }

  const listId = `${id}-suggestions`
  const remaining = suggestions.filter((tag) => !tags.includes(tag))

  return (
    <div className="tag-input-wrap">
      <div className={`tag-input${disabled ? ' is-disabled' : ''}`}>
        {tags.map((tag) => (
          <span key={tag} className="tag">
            {tag}
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              disabled={disabled}
              onClick={() => onChange(tags.filter((item) => item !== tag))}
            >
              <CloseIcon size={11} />
            </button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          autoComplete="off"
          spellCheck={false}
          list={remaining.length ? listId : undefined}
          placeholder={tags.length ? '' : 'marketing, q4…'}
          value={draft}
          disabled={disabled || tags.length >= MAX_TAGS}
          onChange={(event) => {
            const value = event.target.value
            // Pasting "a, b, c" adds each tag.
            if (value.includes(',')) {
              const parts = value.split(',')
              add(...parts.slice(0, -1))
              setDraft(parts.at(-1) ?? '')
            } else {
              setDraft(value)
              setError(null)
            }
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (add(draft)) {
              setDraft('')
            }
          }}
        />
        {remaining.length ? (
          <datalist id={listId}>
            {remaining.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        ) : null}
      </div>
      {error ? <p className="option-status is-error">{error}</p> : null}
    </div>
  )
}
