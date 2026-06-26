-- Per-user memory v0 (docs/015 moat).
--
-- A "user" here is just an identity. For v0 it's anonymous: a uuid the client mints
-- on first visit (localStorage `monet.uid`) and sends as the `x-monet-uid` header.
-- Real login arrives later; when it does, an anon user's rows migrate into the
-- account (anon→account merge), which is why memories key on user_id, not a session.

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,             -- client-minted uuid (monet.uid)
  created_at  INTEGER NOT NULL,             -- epoch ms, first seen
  last_seen   INTEGER NOT NULL,             -- epoch ms, most recent /api/chat
  turns       INTEGER NOT NULL DEFAULT 0    -- user-message count → "how long we've talked"
);

-- Durable facts Monet chose to remember about this person / their shared story.
-- v0 = discrete lines, all injected into the system prompt each turn (few per user).
-- Consolidation/eviction (when a user accrues many) is future work.
CREATE TABLE IF NOT EXISTS memories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id),
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,             -- epoch ms
  turn        INTEGER NOT NULL DEFAULT 0    -- the turn it was learned on
);

CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id, created_at);
