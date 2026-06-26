import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'
import { readdirSync, statSync, existsSync, createReadStream } from 'node:fs'
import { join, resolve, extname } from 'node:path'

const CONTENT_TYPES: Record<string, string> = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
}
const ANIM = /\.mp4$/i
const STILL = /\.(png|webp|jpe?g)$/i

// Dev only: serve the /contents resource straight from the local contents/ folder,
// bypassing R2 entirely. In production the Worker handles /contents from R2.
function devContents(): Plugin {
  const ROOT = resolve(import.meta.dirname, '../../contents')
  const walk = (dir: string, base = ''): string[] => {
    const out: string[] = []
    for (const name of readdirSync(dir)) {
      if (['pose_out', 'archived', 'source', '.DS_Store'].includes(name)) continue
      const full = join(dir, name)
      const rel = base ? `${base}/${name}` : name
      if (statSync(full).isDirectory()) out.push(...walk(full, rel))
      else out.push(rel)
    }
    return out
  }
  return {
    name: 'dev-contents',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        // Dev: never cache contents — clips get re-baked often, and a phone over a tunnel
        // would otherwise keep showing a stale mp4 even after a reload.
        if (url === '/contents' || url.startsWith('/contents/')) res.setHeader('Cache-Control', 'no-store')
        if (url === '/contents') {
          const items = walk(ROOT)
            // exclude colocated sidecars (poster thumbnails, depth/normal map twins)
            .filter((k) => !/\.(thumbnail|depth|normal)\./.test(k) && (ANIM.test(k) || STILL.test(k)))
            .map((k) => ({
              key: k,
              name: k.replace(/^monet\//, '').replace(/\.[^.]+$/, ''),
              size: statSync(join(ROOT, k)).size,
              type: ANIM.test(k) ? 'animation' : 'still',
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ items }))
          return
        }
        if (url.startsWith('/contents/')) {
          const key = decodeURIComponent(url.slice('/contents/'.length))
          const file = join(ROOT, key)
          if (!file.startsWith(ROOT) || !existsSync(file)) {
            res.statusCode = 404
            res.end('not found')
            return
          }
          const ct = CONTENT_TYPES[extname(file).toLowerCase()]
          if (ct) res.setHeader('content-type', ct)
          // Safari requires HTTP Range support for <video> (else MEDIA_ERR_SRC_NOT_SUPPORTED).
          const size = statSync(file).size
          res.setHeader('Accept-Ranges', 'bytes')
          const range = req.headers.range
          if (range) {
            const m = /bytes=(\d*)-(\d*)/.exec(range)
            const start = m && m[1] ? parseInt(m[1], 10) : 0
            const end = m && m[2] ? parseInt(m[2], 10) : size - 1
            if (start > end || start >= size) {
              res.statusCode = 416
              res.setHeader('Content-Range', `bytes */${size}`)
              res.end()
              return
            }
            res.statusCode = 206
            res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
            res.setHeader('Content-Length', end - start + 1)
            createReadStream(file, { start, end }).pipe(res)
          } else {
            res.setHeader('Content-Length', size)
            createReadStream(file).pipe(res)
          }
          return
        }
        next()
      })
    },
  }
}

// Dev port: 1874 (the year of Monet's "Impression, Sunrise" — Impressionism's birth), chosen to
// stay clear of the usual dev-port clusters (3000 / 5173 / 8080 / 8788). Override with MONET_PORT
// (the desktop shell reads the same env, so the two stay in sync).
const PORT = Number(process.env.MONET_PORT) || 1874

// https://vite.dev/config/
export default defineConfig({
  plugins: [devContents(), react(), cloudflare()],
  server: {
    port: PORT,
    strictPort: true,
    host: true, // bind all interfaces (IPv4+IPv6) so a phone on the LAN / a tunnel can reach it
    allowedHosts: true, // dev: accept any Host (lets a cloudflared/ngrok tunnel hostname through)
  },
})
