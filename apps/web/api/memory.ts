// Per-user memory (docs/015 moat). Monet remembers each person across visits.
//
// A "user" for v0 is anonymous: a uuid the browser mints and sends as `x-monet-uid`.
// This module owns the D1 side — load what she knows, persist what she's learned —
// so the route handler (index.ts) stays about the conversation. Every call is
// best-effort: the caller guards so a memory failure never breaks the room.

const UID_RE = /^[\w-]{8,64}$/

// Accept only sane ids (uuid-ish); reject junk so we never key memory on garbage.
export function validUid(uid: string | undefined | null): string | null {
  return uid && UID_RE.test(uid) ? uid : null
}

export type UserMemory = { turns: number; memories: string[] }

// Touch + load, one call at the top of /api/chat: upsert the user (create on first
// sight, bump last_seen and the exchange count), then return their remembered facts
// (oldest first, capped — v0 injects them all into the system prompt).
export async function loadUser(db: D1Database, uid: string, now: number): Promise<UserMemory> {
  await db
    .prepare(
      `INSERT INTO users (id, created_at, last_seen, turns) VALUES (?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen, turns = users.turns + 1`,
    )
    .bind(uid, now, now)
    .run()
  const u = await db.prepare(`SELECT turns FROM users WHERE id = ?`).bind(uid).first<{ turns: number }>()
  const rows = await db
    .prepare(`SELECT content FROM memories WHERE user_id = ? ORDER BY created_at ASC LIMIT 60`)
    .bind(uid)
    .all<{ content: string }>()
  return { turns: u?.turns ?? 1, memories: (rows.results ?? []).map((r) => r.content) }
}

// Pure read (no upsert, no turn bump) — for the debug view "what she remembers".
export async function readMemories(db: D1Database, uid: string): Promise<UserMemory> {
  const u = await db.prepare(`SELECT turns FROM users WHERE id = ?`).bind(uid).first<{ turns: number }>()
  const rows = await db
    .prepare(`SELECT content FROM memories WHERE user_id = ? ORDER BY created_at ASC LIMIT 200`)
    .bind(uid)
    .all<{ content: string }>()
  return { turns: u?.turns ?? 0, memories: (rows.results ?? []).map((r) => r.content) }
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

// Persist newly-learned facts, skipping any we already hold (case-insensitive exact
// match against what was loaded this turn). Returns the facts actually stored, so the
// caller can hand them straight to the live memory view (no racy re-read needed).
export async function remember(
  db: D1Database,
  uid: string,
  facts: string[],
  existing: string[],
  now: number,
  turn: number,
): Promise<string[]> {
  const have = new Set(existing.map(norm))
  const fresh: string[] = []
  for (const f of facts) {
    const c = f.trim().slice(0, 280)
    if (!c) continue
    const n = norm(c)
    if (have.has(n)) continue
    have.add(n)
    fresh.push(c)
  }
  if (!fresh.length) return []
  const stmt = db.prepare(`INSERT INTO memories (user_id, content, created_at, turn) VALUES (?, ?, ?, ?)`)
  await db.batch(fresh.map((c) => stmt.bind(uid, c, now, turn)))
  return fresh
}
