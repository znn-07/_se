import { Check, Loader2, Plus, Trash2, X } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { NOTE_COLORS, type Note, type NoteColor, type NoteInput } from '../../shared/types'
import { isMacLike } from '../lib/utils'

const COLOR_META: Record<NoteColor, { label: string; bg: string; accent: string }> = {
  paper: { label: 'Paper', bg: '#fbf6ea', accent: '#c9a24a' },
  butter: { label: 'Butter', bg: '#f7e9b8', accent: '#c99a2e' },
  rose: { label: 'Rose', bg: '#f6ded8', accent: '#c2452a' },
  sage: { label: 'Sage', bg: '#dfe8d5', accent: '#5f7a4a' },
  sky: { label: 'Sky', bg: '#dbe6ee', accent: '#3d6b92' },
  ink: { label: 'Ink', bg: '#242019', accent: '#c9a24a' },
}

interface NoteEditorProps {
  note: Note | null
  tagSuggestions: string[]
  onClose: () => void
  onSave: (input: NoteInput, id: string | null) => Promise<unknown>
  onDelete: (id: string) => Promise<void>
}

export default function NoteEditor({
  note,
  tagSuggestions,
  onClose,
  onSave,
  onDelete,
}: NoteEditorProps) {
  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  const [color, setColor] = useState<NoteColor>(note?.color ?? 'paper')
  const [tags, setTags] = useState<string[]>(note?.tags ?? [])
  const [tagDraft, setTagDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tagInputRef = useRef<HTMLInputElement>(null)

  const canSave = title.trim().length > 0 || body.trim().length > 0
  const quickTags = tagSuggestions
    .filter((tag) => !tags.some((t) => t.toLowerCase() === tag.toLowerCase()))
    .slice(0, 8)

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  async function save() {
    if (!canSave || saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(
        { title: title.trim(), body, color, tags, pinned: note?.pinned },
        note?.id ?? null,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this note.')
      setSaving(false)
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  function addTag(raw: string) {
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, 24)
    if (!name) return
    if (tags.some((t) => t.toLowerCase() === name.toLowerCase())) {
      setTagDraft('')
      return
    }
    if (tags.length >= 8) return
    setTags((prev) => [...prev, name])
    setTagDraft('')
  }

  function removeTag(name: string) {
    setTags((prev) => prev.filter((t) => t !== name))
  }

  function onTagKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addTag(tagDraft)
    } else if (event.key === 'Backspace' && !tagDraft && tags.length > 0) {
      removeTag(tags[tags.length - 1])
    }
  }

  async function handleDelete() {
    if (!note) return
    setSaving(true)
    setError(null)
    try {
      await onDelete(note.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this note.')
      setSaving(false)
    }
  }

  const meta = COLOR_META[color]
  const saveHint = isMacLike() ? '⌘↵' : 'Ctrl↵'

  return (
    <div className="drawer-layer" role="dialog" aria-modal="true" aria-label={note ? 'Edit note' : 'New note'}>
      <button
        type="button"
        className="drawer-backdrop"
        aria-label="Close editor"
        onClick={onClose}
      />
      <div className="drawer">
        <div className="drawer-accent" style={{ background: meta.accent }} />

        <header className="drawer-head">
          <span className="drawer-eyebrow">
            {note ? 'Editing note' : 'New note'}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close editor"
          >
            <X size={18} />
          </button>
        </header>

        <div className="drawer-body">
          <input
            className="editor-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Untitled note"
            maxLength={200}
            autoFocus
          />

          <textarea
            className="editor-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Start writing…"
            spellCheck
          />

          <div className="editor-block">
            <span className="editor-label">Tags</span>
            <div className="tag-editor">
              {tags.map((tag) => (
                <button
                  type="button"
                  key={tag}
                  className="tag-chip"
                  onClick={() => removeTag(tag)}
                  title={`Remove #${tag}`}
                >
                  #{tag}
                  <X size={11} />
                </button>
              ))}
              <input
                ref={tagInputRef}
                className="tag-input"
                value={tagDraft}
                onChange={(event) => setTagDraft(event.target.value)}
                onKeyDown={onTagKeyDown}
                onBlur={() => addTag(tagDraft)}
                placeholder={tags.length ? 'Add tag…' : 'Add a tag…'}
                maxLength={24}
              />
            </div>
            {quickTags.length > 0 ? (
              <div className="quick-tags">
                {quickTags.map((tag) => (
                  <button
                    type="button"
                    key={tag}
                    className="quick-tag"
                    onClick={() => addTag(tag)}
                  >
                    <Plus size={10} />#{tag}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="editor-block">
            <span className="editor-label">Paper</span>
            <div className="swatches" role="group" aria-label="Note color">
              {NOTE_COLORS.map((option) => {
                const swatch = COLOR_META[option]
                return (
                  <button
                    type="button"
                    key={option}
                    className={`swatch${color === option ? ' is-active' : ''}`}
                    style={{ background: swatch.bg, borderColor: swatch.accent }}
                    onClick={() => setColor(option)}
                    aria-pressed={color === option}
                    title={swatch.label}
                  >
                    <span className="sr-only">{swatch.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {error ? <p className="editor-error">{error}</p> : null}
        </div>

        <footer className="drawer-foot">
          {note ? (
            confirming ? (
              <button
                type="button"
                className="btn ghost danger is-confirming"
                onClick={handleDelete}
                disabled={saving}
              >
                Confirm delete
              </button>
            ) : (
              <button
                type="button"
                className="btn ghost danger"
                onClick={() => setConfirming(true)}
                disabled={saving}
              >
                <Trash2 size={15} /> Delete
              </button>
            )
          ) : (
            <span />
          )}

          <div className="foot-right">
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => void save()}
              disabled={!canSave || saving}
            >
              {saving ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Check size={15} />
              )}
              Save
              <span className="save-hint">{saveHint}</span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
