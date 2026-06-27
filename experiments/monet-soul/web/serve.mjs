// serve.mjs — a tiny zero-dependency static server for the experience prototype.
//
// Serves the REPO ROOT (so `/contents/monet/*.mp4` and `../soul.mjs` both resolve), then points you
// at the web app. ES modules + <video> need http(s), not file://, so this is the way to run it.
// Supports HTTP Range requests — Chrome's <video> loader requests media by range and hangs on a
// plain 200, so this is required for the clips to actually play.
//
//   node experiments/monet-soul/web/serve.mjs     →  open the printed URL
//
import { createServer } from 'node:http'
import { stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, normalize, extname, dirname } from 'node:path'

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), '../../..')) // repo root
const APP = '/experiments/monet-soul/web/'
const PORT = Number(process.env.PORT) || 8777

const MIME = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.mp4': 'video/mp4', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp',
}

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(req.url.split('?')[0])
    if (path.endsWith('/')) path += 'index.html'
    const file = normalize(join(ROOT, path))
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return } // no path traversal
    const s = await stat(file)
    const type = MIME[extname(file)] || 'application/octet-stream'
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range)
    if (range) {
      const start = range[1] ? parseInt(range[1], 10) : 0
      const end = range[2] ? parseInt(range[2], 10) : s.size - 1
      if (start > end || start >= s.size) { res.writeHead(416, { 'content-range': `bytes */${s.size}` }).end(); return }
      res.writeHead(206, {
        'content-type': type, 'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${s.size}`, 'content-length': end - start + 1, 'cache-control': 'no-cache',
      })
      createReadStream(file, { start, end }).pipe(res)
    } else {
      res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': s.size, 'cache-control': 'no-cache' })
      createReadStream(file).pipe(res)
    }
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(PORT, () => {
  console.log(`\n  🐤  Monet is awake at:  http://localhost:${PORT}${APP}\n`)
})
