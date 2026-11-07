import type { Note, NoteColor, NoteInput } from '../shared/types'

/**
 * A deliberately small subset of the Workers D1 API, so the Worker and the
 * frontend can share one TypeScript project without pulling in the full
 * workers-types globals (which collide with the DOM lib used by React).
 */
export interface D1Result<T = unknown> {
  results?: T[]
  success: boolean
  meta: Record<string, unknown>
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = unknown>(): Promise<T | null>
  all<T = unknown>(): Promise<D1Result<T>>
  run(): Promise<D1Result>
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
  exec(query: string): Promise<unknown>
}

interface NoteRow {
  id: string
  title: string
  body: string
  color: string
  pinned: number
  created_at: string
  updated_at: string
}

interface TagRow {
  note_id: string
  name: string
}

export interface NoteQuery {
  q?: string
  tag?: string
  pinned?: boolean
}

function toNote(row: NoteRow, tags: string[]): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    color: row.color as NoteColor,
    pinned: row.pinned === 1,
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

async function tagsForNotes(
  db: D1Database,
  ids: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (ids.length === 0) return map
  const placeholders = ids.map(() => '?').join(', ')
  const { results } = await db
    .prepare(
      `SELECT nt.note_id AS note_id, t.name AS name
         FROM note_tags nt
         JOIN tags t ON t.id = nt.tag_id
        WHERE nt.note_id IN (${placeholders})
        ORDER BY t.name COLLATE NOCASE`,
    )
    .bind(...ids)
    .all<TagRow>()
  for (const row of results ?? []) {
    const list = map.get(row.note_id) ?? []
    list.push(row.name)
    map.set(row.note_id, list)
  }
  return map
}

export async function listNotes(
  db: D1Database,
  options: NoteQuery = {},
): Promise<Note[]> {
  const clauses: string[] = []
  const binds: unknown[] = []

  const q = options.q?.trim()
  if (q) {
    const like = `%${escapeLike(q)}%`
    clauses.push(
      "(n.title LIKE ? ESCAPE '\\' OR n.body LIKE ? ESCAPE '\\')",
    )
    binds.push(like, like)
  }

  if (options.tag) {
    clauses.push(
      `EXISTS (
         SELECT 1 FROM note_tags nt
         JOIN tags t ON t.id = nt.tag_id
         WHERE nt.note_id = n.id AND t.name = ? COLLATE NOCASE
       )`,
    )
    binds.push(options.tag)
  }

  if (options.pinned) {
    clauses.push('n.pinned = 1')
  }

  const sql = `SELECT n.* FROM notes n ${
    clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  } ORDER BY n.pinned DESC, n.updated_at DESC`

  const statement = binds.length ? db.prepare(sql).bind(...binds) : db.prepare(sql)
  const { results } = await statement.all<NoteRow>()
  const rows = results ?? []
  const tagMap = await tagsForNotes(
    db,
    rows.map((row) => row.id),
  )
  return rows.map((row) => toNote(row, tagMap.get(row.id) ?? []))
}

export async function getNote(db: D1Database, id: string): Promise<Note | null> {
  const row = await db
    .prepare('SELECT * FROM notes WHERE id = ?')
    .bind(id)
    .first<NoteRow>()
  if (!row) return null
  const tagMap = await tagsForNotes(db, [id])
  return toNote(row, tagMap.get(id) ?? [])
}

async function setNoteTags(
  db: D1Database,
  noteId: string,
  tags: string[],
): Promise<void> {
  await db.prepare('DELETE FROM note_tags WHERE note_id = ?').bind(noteId).run()

  for (const name of tags) {
    await db
      .prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)')
      .bind(name)
      .run()
    const tag = await db
      .prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE')
      .bind(name)
      .first<{ id: number }>()
    if (!tag) continue
    await db
      .prepare(
        'INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)',
      )
      .bind(noteId, tag.id)
      .run()
  }
}

export async function createNote(
  db: D1Database,
  input: NoteInput,
): Promise<Note> {
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO notes (id, title, body, color, pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.title,
      input.body,
      input.color,
      input.pinned ? 1 : 0,
      now,
      now,
    )
    .run()
  await setNoteTags(db, id, input.tags)
  const note = await getNote(db, id)
  if (!note) throw new Error('Failed to read back the created note.')
  return note
}

export async function updateNote(
  db: D1Database,
  id: string,
  input: NoteInput,
): Promise<Note | null> {
  const existing = await db
    .prepare('SELECT pinned FROM notes WHERE id = ?')
    .bind(id)
    .first<{ pinned: number }>()
  if (!existing) return null

  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE notes
          SET title = ?, body = ?, color = ?, pinned = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(
      input.title,
      input.body,
      input.color,
      input.pinned === undefined ? existing.pinned : input.pinned ? 1 : 0,
      now,
      id,
    )
    .run()
  await setNoteTags(db, id, input.tags)
  return getNote(db, id)
}

export async function setPinned(
  db: D1Database,
  id: string,
  pinned: boolean,
): Promise<Note | null> {
  const now = new Date().toISOString()
  const result = await db
    .prepare('UPDATE notes SET pinned = ?, updated_at = ? WHERE id = ?')
    .bind(pinned ? 1 : 0, now, id)
    .run()
  if (!result.meta.changes) return null
  return getNote(db, id)
}

export async function deleteNote(db: D1Database, id: string): Promise<boolean> {
  await db.prepare('DELETE FROM note_tags WHERE note_id = ?').bind(id).run()
  const result = await db.prepare('DELETE FROM notes WHERE id = ?').bind(id).run()
  return Boolean(result.meta.changes)
}

export async function getTagCounts(
  db: D1Database,
): Promise<Array<{ name: string; count: number }>> {
  const { results } = await db
    .prepare(
      `SELECT t.name AS name, COUNT(nt.note_id) AS count
         FROM tags t
         LEFT JOIN note_tags nt ON nt.tag_id = t.id
        GROUP BY t.id
        HAVING COUNT(nt.note_id) > 0
        ORDER BY count DESC, t.name COLLATE NOCASE`,
    )
    .all<{ name: string; count: number }>()
  return (results ?? []).map((row) => ({
    name: row.name,
    count: Number(row.count),
  }))
}

export async function deleteTag(
  db: D1Database,
  name: string,
): Promise<boolean> {
  const tag = await db
    .prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE')
    .bind(name)
    .first<{ id: number }>()
  if (!tag) return false
  await db.prepare('DELETE FROM note_tags WHERE tag_id = ?').bind(tag.id).run()
  await db.prepare('DELETE FROM tags WHERE id = ?').bind(tag.id).run()
  return true
}
