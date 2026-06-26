// Sync contents/ → R2 bucket `monet-contents` (mirror; git stays the backup).
//
// Incremental: a manifest (path → sha256) is stored IN the bucket as
// `.sync-manifest.json`, so CI stays incremental without committing anything back.
// Only changed/new files are uploaded. Mirror mode = we never delete remote objects.
//
// Auth: uses wrangler. Locally via your `wrangler login`; in CI via
// CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID env (inherited).
//
// Run: npm run sync:contents

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, statSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUCKET = 'monet-contents'
const MANIFEST_KEY = '.sync-manifest.json'
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const CONTENTS = join(ROOT, 'contents')
// Sync honors .gitignore: anything ignored (source/ backups, pose_out/ scratch,
// .DS_Store, …) is skipped. gitignore is the single source of truth, so sync
// exclusions never drift from it.

const CONTENT_TYPES = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.json': 'application/json',
}

function wrangler(args, opts = {}) {
  // npm puts node_modules/.bin on PATH, so `wrangler` resolves when run via npm.
  return spawnSync('wrangler', args, { encoding: 'utf8', ...opts })
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function isIgnored(p) {
  return spawnSync('git', ['check-ignore', '-q', p], { cwd: ROOT }).status === 0
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (isIgnored(full)) continue // honor .gitignore (prunes ignored dirs + files)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

function fetchRemoteManifest() {
  const tmp = join(mkdtempSync(join(tmpdir(), 'r2sync-')), 'manifest.json')
  const r = wrangler(['r2', 'object', 'get', `${BUCKET}/${MANIFEST_KEY}`, '--remote', `--file=${tmp}`])
  if (r.status === 0 && existsSync(tmp)) {
    try {
      return JSON.parse(readFileSync(tmp, 'utf8'))
    } catch {
      return {}
    }
  }
  return {} // first run / no manifest yet
}

function putObject(key, file, contentType) {
  const args = ['r2', 'object', 'put', `${BUCKET}/${key}`, '--remote', `--file=${file}`]
  if (contentType) args.push(`--content-type=${contentType}`)
  const r = wrangler(args, { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`upload failed: ${key}`)
}

function main() {
  if (!existsSync(CONTENTS)) {
    console.error(`no contents/ dir at ${CONTENTS}`)
    process.exit(1)
  }
  const files = walk(CONTENTS)
  const manifest = fetchRemoteManifest()
  const next = {}
  let uploaded = 0
  let skipped = 0

  for (const file of files) {
    const key = relative(CONTENTS, file).split('\\').join('/')
    const hash = sha256(file)
    next[key] = hash
    if (manifest[key] === hash) {
      skipped++
      continue
    }
    const ct = CONTENT_TYPES[extname(file).toLowerCase()]
    console.log(`↑ ${key}${ct ? ` (${ct})` : ''}`)
    putObject(key, file, ct)
    uploaded++
  }

  // Persist the manifest back into the bucket.
  const tmp = join(mkdtempSync(join(tmpdir(), 'r2sync-')), 'manifest.json')
  writeFileSync(tmp, JSON.stringify(next, null, 2))
  putObject(MANIFEST_KEY, tmp, 'application/json')

  console.log(`\nsync done → r2://${BUCKET}  (uploaded ${uploaded}, unchanged ${skipped}, total ${files.length})`)
}

main()
