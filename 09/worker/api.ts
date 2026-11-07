import { NOTE_COLORS, type NoteColor, type NoteInput } from '../shared/types'
import {
  createNote,
  deleteNote,
  deleteTag,
  getNote,
  getTagCounts,
  listNotes,
  setPinned,
  updateNote,
  type D1Database,
} from './db'

export interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>
  }
  DB: D1Database
}

class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

function json(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  })
}

function empty(status: number): Response {
  return new Response(null, { status, headers: CORS_HEADERS })
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.')
  }
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, 24)
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(name)
    if (tags.length >= 8) break
  }
  return tags
}

function parseNoteInput(raw: unknown): NoteInput {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(400, 'Expected a JSON object describing the note.')
  }
  const obj = raw as Record<string, unknown>
  const title = typeof obj.title === 'string' ? obj.title.trim().slice(0, 200) : ''
  const body = typeof obj.body === 'string' ? obj.body.slice(0, 20_000) : ''

  if (!title && !body.trim()) {
    throw new HttpError(400, 'A note needs a title or some text.')
  }

  const color = NOTE_COLORS.includes(obj.color as NoteColor)
    ? (obj.color as NoteColor)
    : 'paper'

  return {
    title,
    body,
    color,
    tags: normalizeTags(obj.tags),
    pinned: typeof obj.pinned === 'boolean' ? obj.pinned : undefined,
  }
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return empty(204)

  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const method = request.method

  try {
    if (path === '/api/health' && method === 'GET') {
      return json({
        ok: true,
        service: 'field-notes',
        time: new Date().toISOString(),
      })
    }

    if (path === '/api' && method === 'GET') {
      return json({
        name: 'Field Notes API',
        storage: 'Cloudflare D1',
        endpoints: [
          'GET    /api/notes?q=&tag=&pinned=1',
          'POST   /api/notes',
          'GET    /api/notes/:id',
          'PUT    /api/notes/:id',
          'PATCH  /api/notes/:id',
          'DELETE /api/notes/:id',
          'GET    /api/tags',
          'DELETE /api/tags/:name',
        ],
      })
    }

    if (path === '/api/notes' && method === 'GET') {
      const notes = await listNotes(env.DB, {
        q: url.searchParams.get('q') ?? undefined,
        tag: url.searchParams.get('tag') ?? undefined,
        pinned: url.searchParams.get('pinned') === '1' ? true : undefined,
      })
      return json({ notes })
    }

    if (path === '/api/notes' && method === 'POST') {
      const input = parseNoteInput(await readJson(request))
      const note = await createNote(env.DB, input)
      return json({ note }, 201)
    }

    const noteMatch = path.match(/^\/api\/notes\/([^/]+)$/)
    if (noteMatch) {
      const id = decodeURIComponent(noteMatch[1])

      if (method === 'GET') {
        const note = await getNote(env.DB, id)
        if (!note) throw new HttpError(404, 'Note not found.')
        return json({ note })
      }

      if (method === 'PUT') {
        const input = parseNoteInput(await readJson(request))
        const note = await updateNote(env.DB, id, input)
        if (!note) throw new HttpError(404, 'Note not found.')
        return json({ note })
      }

      if (method === 'PATCH') {
        const raw = await readJson(request)
        const obj = raw as Record<string, unknown>
        if (typeof obj?.pinned !== 'boolean') {
          throw new HttpError(400, 'PATCH expects { "pinned": boolean }.')
        }
        const note = await setPinned(env.DB, id, obj.pinned)
        if (!note) throw new HttpError(404, 'Note not found.')
        return json({ note })
      }

      if (method === 'DELETE') {
        const removed = await deleteNote(env.DB, id)
        if (!removed) throw new HttpError(404, 'Note not found.')
        return empty(204)
      }

      throw new HttpError(405, 'Method not allowed for this route.')
    }

    if (path === '/api/tags' && method === 'GET') {
      const tags = await getTagCounts(env.DB)
      return json({ tags })
    }

    const tagMatch = path.match(/^\/api\/tags\/(.+)$/)
    if (tagMatch && method === 'DELETE') {
      const removed = await deleteTag(env.DB, decodeURIComponent(tagMatch[1]))
      if (!removed) throw new HttpError(404, 'Tag not found.')
      return empty(204)
    }

    throw new HttpError(404, 'API route not found.')
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message }, error.status)
    }
    const detail = error instanceof Error ? error.message : 'Unknown error'
    return json(
      { error: 'Something went wrong on the server.', detail },
      500,
    )
  }
}

export { HttpError }
