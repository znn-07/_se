export type NoteColor = 'paper' | 'butter' | 'rose' | 'sage' | 'sky' | 'ink'

export const NOTE_COLORS: NoteColor[] = ['paper', 'butter', 'rose', 'sage', 'sky', 'ink']

export interface Note {
  id: string
  title: string
  body: string
  color: NoteColor
  pinned: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface NoteInput {
  title: string
  body: string
  color: NoteColor
  tags: string[]
  pinned?: boolean
}

export interface NoteResponse {
  note: Note
}

export interface NotesResponse {
  notes: Note[]
}

export interface TagCount {
  name: string
  count: number
}

export interface TagsResponse {
  tags: TagCount[]
}

export interface ApiError {
  error: string
  detail?: string
}
