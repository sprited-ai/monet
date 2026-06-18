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
const ANIM = /\.webm$/i
const STILL = /\.(png|webp|jpe?g)$/i

// Dev only: serve the /contents resource straight from the local contents/ folder,
// bypassing R2 entirely. In production the Worker handles /contents from R2.
function devContents(): Plugin {
  const ROOT = resolve(import.meta.dirname, '../contents')
  const walk = (dir: string, base = ''): string[] => {
    const out: string[] = []
    for (const name of readdirSync(dir)) {
      if (name === '_pose_out' || name === '.DS_Store') continue
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
        if (url === '/contents') {
          const items = walk(ROOT)
            .filter((k) => ANIM.test(k) || STILL.test(k))
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
          createReadStream(file).pipe(res)
          return
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [devContents(), react(), cloudflare()],
  server: {
    port: 8788,
    strictPort: true,
  },
})
