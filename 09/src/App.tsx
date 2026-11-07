import { Check, Inbox, Pin, Plus, RefreshCw, Search, Tag, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Note, NoteInput } from '../shared/types'
import { api } from './api'
import NoteCard from './components/NoteCard'
import NoteEditor from './components/NoteEditor'

type Filter = 'all' | 'pinned'
type Status = 'loading' | 'ready' | 'error'

interface Toast {
  id: number
  message: string
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)

  const [filter, setFilter] = useState<Filter>('all')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Note | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<number | null>(null)

  const loadNotes = useCallback(async () => {
    setStatus('loading')
    setLoadError(null)
    try {
      setNotes(await api.listNotes())
      setStatus('ready')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load your notes.')
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void loadNotes()
  }, [loadNotes])

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [])

  const notify = useCallback((message: string) => {
    setToast({ id: Date.now(), message })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }, [])

  const openNew = useCallback(() => {
    setEditing(null)
    setEditorOpen(true)
  }, [])

  const openEdit = useCallback((note: Note) => {
    setEditing(note)
    setEditorOpen(true)
  }, [])

  const closeEditor = useCallback(() => {
    setEditorOpen(false)
    setEditing(null)
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const isTyping =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)

      if (isTyping || editorOpen) return

      if (event.key === '/') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (
        event.key.toLowerCase() === 'n' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault()
        openNew()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editorOpen, openNew])

  const tagList = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>()
    for (const note of notes) {
      for (const tag of note.tags) {
        const key = tag.toLowerCase()
        const entry = map.get(key) ?? { name: tag, count: 0 }
        entry.count += 1
        map.set(key, entry)
      }
    }
    return [...map.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    )
  }, [notes])

  const visibleNotes = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const tagNeedle = activeTag?.toLowerCase() ?? null

    return notes
      .filter((note) => (filter === 'pinned' ? note.pinned : true))
      .filter((note) =>
        tagNeedle
          ? note.tags.some((tag) => tag.toLowerCase() === tagNeedle)
          : true,
      )
      .filter((note) =>
        needle
          ? note.title.toLowerCase().includes(needle) ||
            note.body.toLowerCase().includes(needle) ||
            note.tags.some((tag) => tag.toLowerCase().includes(needle))
          : true,
      )
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          b.updatedAt.localeCompare(a.updatedAt),
      )
  }, [notes, filter, activeTag, query])

  const pinnedCount = notes.filter((note) => note.pinned).length

  async function handleSave(input: NoteInput, id: string | null) {
    if (id) {
      const updated = await api.updateNote(id, input)
      setNotes((prev) => prev.map((note) => (note.id === updated.id ? updated : note)))
      notify('Note updated')
      closeEditor()
      return updated
    }
    const created = await api.createNote(input)
    setNotes((prev) => [created, ...prev])
    notify('Note created')
    closeEditor()
    return created
  }

  async function deleteById(id: string) {
    await api.deleteNote(id)
    setNotes((prev) => prev.filter((note) => note.id !== id))
    if (editing?.id === id) closeEditor()
    notify('Note deleted')
  }

  async function handleDelete(note: Note) {
    try {
      await deleteById(note.id)
    } catch {
      notify('Could not delete that note')
    }
  }

  async function handleTogglePin(note: Note) {
    const nextPinned = !note.pinned
    setNotes((prev) =>
      prev.map((item) =>
        item.id === note.id ? { ...item, pinned: nextPinned } : item,
      ),
    )
    try {
      const updated = await api.setPinned(note.id, nextPinned)
      setNotes((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      )
      notify(nextPinned ? 'Pinned to the top' : 'Unpinned')
    } catch {
      setNotes((prev) =>
        prev.map((item) => (item.id === note.id ? note : item)),
      )
      notify('Could not update that pin')
    }
  }

  function toggleTag(name: string) {
    setActiveTag((prev) =>
      prev && prev.toLowerCase() === name.toLowerCase() ? null : name,
    )
    setFilter('all')
  }

  function resetFilters() {
    setFilter('all')
    setActiveTag(null)
    setQuery('')
  }

  const heading = activeTag
    ? `#${activeTag}`
    : filter === 'pinned'
      ? 'Pinned notes'
      : query.trim()
        ? 'Search results'
        : 'All notes'

  const subtitle = `${visibleNotes.length} ${
    visibleNotes.length === 1 ? 'note' : 'notes'
  }${query.trim() ? ` matching “${query.trim()}”` : ''}`

  return (
    <>
      <div className="grain" aria-hidden="true" />

      <div className="shell">
        <aside className="rail">
          <div className="rail-top">
            <div className="brand">
              <span className="brand-mark" aria-hidden="true">
                FN
              </span>
              <span className="brand-text">
                <strong>Field Notes</strong>
                <small>a cloud notebook</small>
              </span>
            </div>

            <button type="button" className="new-note" onClick={openNew}>
              <Plus size={16} />
              <span>New note</span>
              <kbd>N</kbd>
            </button>
          </div>

          <nav className="filters" aria-label="Note filters">
            <button
              type="button"
              className={filter === 'all' && !activeTag ? 'is-active' : ''}
              onClick={() => {
                setFilter('all')
                setActiveTag(null)
              }}
            >
              <Inbox size={15} />
              <span>All notes</span>
              <em>{notes.length}</em>
            </button>
            <button
              type="button"
              className={filter === 'pinned' ? 'is-active' : ''}
              onClick={() => {
                setFilter('pinned')
                setActiveTag(null)
              }}
            >
              <Pin size={15} />
              <span>Pinned</span>
              <em>{pinnedCount}</em>
            </button>
          </nav>

          <section className="tag-panel">
            <h2 className="rail-label">
              <Tag size={12} /> Tags
            </h2>
            {tagList.length > 0 ? (
              <ul className="tag-list">
                {tagList.map((tag) => (
                  <li key={tag.name}>
                    <button
                      type="button"
                      className={
                        activeTag?.toLowerCase() === tag.name.toLowerCase()
                          ? 'is-active'
                          : ''
                      }
                      onClick={() => toggleTag(tag.name)}
                    >
                      <span>#{tag.name}</span>
                      <em>{tag.count}</em>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rail-empty">No tags yet.</p>
            )}
          </section>

          <div className="rail-foot">
            <span
              className={`sync-dot${status === 'ready' ? ' is-online' : ''}`}
              aria-hidden="true"
            />
            <span>
              {status === 'loading'
                ? 'Connecting…'
                : status === 'error'
                  ? 'Offline'
                  : 'Synced to D1'}
            </span>
          </div>
        </aside>

        <main className="board">
          <header className="board-head">
            <div className="board-title">
              <p className="eyebrow">
                {filter === 'pinned' ? 'Pinned shelf' : 'Notebook index'}
              </p>
              <h2>{heading}</h2>
              <p className="board-sub">{subtitle}</p>
            </div>

            <label className="search">
              <Search size={16} aria-hidden="true" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search notes"
                aria-label="Search notes"
              />
              {query ? (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              ) : (
                <kbd>/</kbd>
              )}
            </label>
          </header>

          {status === 'loading' ? (
            <div className="note-grid" aria-hidden="true">
              {Array.from({ length: 6 }).map((_, index) => (
                <div className="note skeleton" key={index}>
                  <span className="sk sk-title" />
                  <span className="sk sk-line" />
                  <span className="sk sk-line" />
                  <span className="sk sk-line short" />
                </div>
              ))}
            </div>
          ) : status === 'error' ? (
            <div className="empty">
              <div className="empty-mark">
                <RefreshCw size={28} />
              </div>
              <h3>The shelf is out of reach</h3>
              <p>{loadError ?? 'Could not load your notes.'}</p>
              <button type="button" className="btn primary" onClick={() => void loadNotes()}>
                Try again
              </button>
            </div>
          ) : visibleNotes.length > 0 ? (
            <div className="note-grid">
              {visibleNotes.map((note, index) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  index={index}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                  onTogglePin={handleTogglePin}
                />
              ))}
            </div>
          ) : (
            <div className="empty">
              <div className="empty-mark">
                <Inbox size={30} />
              </div>
              <h3>{notes.length ? 'Nothing matches that' : 'Your notebook is empty'}</h3>
              <p>
                {notes.length
                  ? 'Try clearing the search or the tag filters.'
                  : 'Capture a thought, a link, a small plan. Press N to begin.'}
              </p>
              <button
                type="button"
                className="btn primary"
                onClick={notes.length ? resetFilters : openNew}
              >
                {notes.length ? 'Clear filters' : 'Write the first note'}
              </button>
            </div>
          )}
        </main>
      </div>

      {editorOpen ? (
        <NoteEditor
          key={editing?.id ?? 'new'}
          note={editing}
          tagSuggestions={tagList.map((tag) => tag.name)}
          onClose={closeEditor}
          onSave={handleSave}
          onDelete={deleteById}
        />
      ) : null}

      {toast ? (
        <div className="toast" role="status" key={toast.id}>
          <Check size={15} />
          {toast.message}
        </div>
      ) : null}
    </>
  )
}
