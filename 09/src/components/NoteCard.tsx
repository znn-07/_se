import { Pencil, Pin, Trash2 } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import type { Note } from '../../shared/types'
import { formatRelative, tiltFor } from '../lib/utils'

interface NoteCardProps {
  note: Note
  index: number
  onEdit: (note: Note) => void
  onDelete: (note: Note) => void
  onTogglePin: (note: Note) => void
}

export default function NoteCard({
  note,
  index,
  onEdit,
  onDelete,
  onTogglePin,
}: NoteCardProps) {
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!confirming) return
    const timer = window.setTimeout(() => setConfirming(false), 3000)
    return () => window.clearTimeout(timer)
  }, [confirming])

  const style = {
    '--tilt': `${tiltFor(note.id)}deg`,
    '--delay': `${Math.min(index, 12) * 45}ms`,
  } as CSSProperties

  return (
    <article
      className={`note note--${note.color}`}
      style={style}
      onDoubleClick={() => onEdit(note)}
    >
      <header className="note-head">
        <h3 className="note-title">{note.title || 'Untitled note'}</h3>
        <button
          type="button"
          className={`pin-btn${note.pinned ? ' is-pinned' : ''}`}
          onClick={() => onTogglePin(note)}
          aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
          title={note.pinned ? 'Unpin note' : 'Pin note'}
        >
          <Pin size={14} strokeWidth={2} />
        </button>
      </header>

      {note.body ? <p className="note-body">{note.body}</p> : null}

      {note.tags.length > 0 ? (
        <ul className="note-tags" aria-label="Tags">
          {note.tags.map((tag) => (
            <li key={tag}>
              <span aria-hidden="true">#</span>
              {tag}
            </li>
          ))}
        </ul>
      ) : null}

      <footer className="note-foot">
        <span className="note-time">{formatRelative(note.updatedAt)}</span>
        <div className="note-actions">
          <button
            type="button"
            onClick={() => onEdit(note)}
            aria-label="Edit note"
            title="Edit note"
          >
            <Pencil size={14} />
          </button>
          {confirming ? (
            <button
              type="button"
              className="danger is-confirming"
              onClick={() => onDelete(note)}
            >
              Delete?
            </button>
          ) : (
            <button
              type="button"
              className="danger"
              onClick={() => setConfirming(true)}
              aria-label="Delete note"
              title="Delete note"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </footer>
    </article>
  )
}
