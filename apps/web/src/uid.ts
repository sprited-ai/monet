// Anon identity (docs/015 memory moat). A "user" for v0 is just a uuid the browser
// mints on first visit and keeps — no login, no server auth. It rides every /api/chat
// as the `x-monet-uid` header so the Worker can key this person's memory. Real login
// arrives later (anon→account merge); this id is the seam that survives that change.
// (This is how ChatGPT's anonymous sessions work: a device token, not an account.)

const KEY = 'monet.uid'

function mint(): string {
  try {
    return crypto.randomUUID()
  } catch {
    // crypto.randomUUID needs a secure context; fall back to a good-enough random id.
    return 'u-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
  }
}

let cached: string | null = null

// The stable per-browser id, created once and persisted. If localStorage is blocked
// (private mode, etc.) we still return a per-session id so the room works — memory
// just won't survive a reload.
export function getUid(): string {
  if (cached) return cached
  try {
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = mint()
      localStorage.setItem(KEY, id)
    }
    cached = id
    return id
  } catch {
    cached = mint()
    return cached
  }
}
