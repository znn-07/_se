-- Field Notes schema.

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'paper',
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_notes_order ON notes (pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_tags_note ON note_tags (note_id);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags (tag_id);

-- A few seeded notes so a fresh deployment has something to look at.
INSERT OR IGNORE INTO notes (id, title, body, color, pinned, created_at, updated_at) VALUES
  (
    'seed-welcome',
    'Welcome to Field Notes',
    'A small, paper-warm notebook that lives at the edge.

Everything you write is stored in Cloudflare D1, so it survives refreshes and devices. Press N for a new note, or hit / to search your shelf.',
    'butter',
    1,
    '2026-11-05T09:12:00.000Z',
    '2026-11-05T09:12:00.000Z'
  ),
  (
    'seed-d1',
    'D1 is SQLite at the edge',
    'Notes, tags and the little join table between them all live in a single D1 database. The Worker answers /api/notes with JSON and hands every other request back to the static React bundle.',
    'sky',
    0,
    '2026-11-04T15:40:00.000Z',
    '2026-11-04T15:40:00.000Z'
  ),
  (
    'seed-keys',
    'Small rituals',
    'N  — new note
/  — jump to search
Cmd / Ctrl + Enter  — save the note you are writing
Esc  — close the editor',
    'sage',
    0,
    '2026-11-03T11:05:00.000Z',
    '2026-11-03T11:05:00.000Z'
  );

INSERT OR IGNORE INTO tags (name) VALUES
  ('welcome'),
  ('cloudflare'),
  ('d1'),
  ('tips');

INSERT OR IGNORE INTO note_tags (note_id, tag_id)
SELECT 'seed-welcome', id FROM tags WHERE name IN ('welcome', 'cloudflare');
INSERT OR IGNORE INTO note_tags (note_id, tag_id)
SELECT 'seed-d1', id FROM tags WHERE name IN ('cloudflare', 'd1');
INSERT OR IGNORE INTO note_tags (note_id, tag_id)
SELECT 'seed-keys', id FROM tags WHERE name IN ('tips');
