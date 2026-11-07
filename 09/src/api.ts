import type {
  Note,
  NoteInput,
  NoteResponse,
  NotesResponse,
  TagsResponse,
} from '../shared/types'

interface RequestOptions {
  method?: string
  body?: unknown
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body } = options
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const payload = (await response.json()) as { error?: string; detail?: string }
      if (payload?.error) {
        message = payload.detail ? `${payload.error} ${payload.detail}` : payload.error
      }
    } catch {
      // Keep the status-based message.
    }
    throw new Error(message)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  async listNotes(): Promise<Note[]> {
    const { notes } = await request<NotesResponse>('/api/notes')
    return notes
  },

  async getTags(): Promise<TagsResponse['tags']> {
    const { tags } = await request<TagsResponse>('/api/tags')
    return tags
  },

  async createNote(input: NoteInput): Promise<Note> {
    const { note } = await request<NoteResponse>('/api/notes', {
      method: 'POST',
      body: input,
    })
    return note
  },

  async updateNote(id: string, input: NoteInput): Promise<Note> {
    const { note } = await request<NoteResponse>(
      `/api/notes/${encodeURIComponent(id)}`,
      { method: 'PUT', body: input },
    )
    return note
  },

  async setPinned(id: string, pinned: boolean): Promise<Note> {
    const { note } = await request<NoteResponse>(
      `/api/notes/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: { pinned } },
    )
    return note
  },

  async deleteNote(id: string): Promise<void> {
    await request<void>(`/api/notes/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },
}
