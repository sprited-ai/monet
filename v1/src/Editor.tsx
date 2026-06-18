import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  Container,
  Flex,
  Grid,
  Card,
  Heading,
  Text,
  Link,
  Badge,
  SegmentedControl,
} from '@radix-ui/themes'
import StackedVideo from './StackedVideo'

type Item = { key: string; name: string; size: number; type: 'animation' | 'still' }
type Filter = 'all' | 'animation' | 'still'

function kb(n: number) {
  return n > 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
}

function ext(key: string) {
  return key.slice(key.lastIndexOf('.') + 1).toLowerCase()
}

export default function Editor() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [hovered, setHovered] = useState<string | null>(null)
  const [readyKey, setReadyKey] = useState<string | null>(null)
  const [origins, setOrigins] = useState<Record<string, [number, number]>>({})
  const [aspects, setAspects] = useState<Record<string, number>>({}) // content w/h, from loaded media
  const [framingOf, setFramingOf] = useState<Record<string, string>>({})
  const [framings, setFramings] = useState<Record<string, { frame: [number, number] }>>({})

  useEffect(() => {
    Promise.all([
      fetch('/contents').then((r) => r.json() as Promise<{ items: Item[] }>),
      fetch('/contents/index.json')
        .then((r) => r.json())
        .catch(() => ({ items: {} })),
      fetch('/contents/framings.json')
        .then((r) => r.json())
        .catch(() => ({ framings: {} })),
    ])
      .then(([list, idx, fr]) => {
        setItems(list.items)
        // origin: stills carry their own; animations inherit their framing's.
        const map: Record<string, [number, number]> = {}
        const fmap: Record<string, string> = {}
        for (const [name, e] of Object.entries(idx.items ?? {}) as [string, any][]) {
          if (e.framing) fmap[name] = e.framing
          const o = e.origin ?? fr.framings?.[e.framing]?.origin
          if (o) map[name] = o
        }
        setOrigins(map)
        setFramingOf(fmap)
        setFramings(fr.framings ?? {})
      })
      .catch(() => setError('Could not load contents from the worker.'))
      .finally(() => setLoading(false))
  }, [])

  const counts = useMemo(
    () => ({
      all: items.length,
      animation: items.filter((i) => i.type === 'animation').length,
      still: items.filter((i) => i.type === 'still').length,
    }),
    [items],
  )
  const shown = items.filter((i) => filter === 'all' || i.type === filter)

  const rememberAspect = (key: string, el: HTMLImageElement) => {
    if (el.naturalWidth && !aspects[key]) {
      setAspects((a) => ({ ...a, [key]: el.naturalWidth / el.naturalHeight }))
    }
  }

  return (
    <Container size="4" px="4" py="6">
      <Flex direction="column" gap="3" mb="5">
        <Flex align="center" gap="3">
          <Heading size="7">Monet Editor</Heading>
          {!loading && !error && <Badge color="ruby">{items.length} items</Badge>}
        </Flex>
        <Text color="gray" size="2">
          Previewing <code>monet-contents</code> · hover an animation to play.{' '}
          <Link href="/">← home</Link>
        </Text>
        {!loading && !error && (
          <SegmentedControl.Root
            value={filter}
            onValueChange={(v) => setFilter(v as Filter)}
            size="1"
          >
            <SegmentedControl.Item value="all">All ({counts.all})</SegmentedControl.Item>
            <SegmentedControl.Item value="animation">
              Animations ({counts.animation})
            </SegmentedControl.Item>
            <SegmentedControl.Item value="still">Stills ({counts.still})</SegmentedControl.Item>
          </SegmentedControl.Root>
        )}
      </Flex>

      {loading && <Text color="gray">Loading…</Text>}
      {error && <Text color="red">{error}</Text>}

      <Grid columns={{ initial: '2', sm: '3', md: '4' }} gap="4">
        {shown.map((it) => (
          <Card
            key={it.key}
            onMouseEnter={() => setHovered(it.key)}
            onMouseLeave={() => {
              setHovered((h) => (h === it.key ? null : h))
              setReadyKey((k) => (k === it.key ? null : k))
            }}
          >
            <Flex direction="column" gap="2">
              <div style={boxStyle}>
                {it.type === 'animation' ? (
                  <>
                    {/* poster stays until the clip is actually playing — no flicker */}
                    <img
                      src={`/contents/${it.key.replace(/\.mp4$/, '.thumbnail.webp')}`}
                      alt={it.name}
                      loading="lazy"
                      onLoad={(e) => rememberAspect(it.key, e.currentTarget)}
                      style={{
                        ...fillStyle,
                        opacity: hovered === it.key && readyKey === it.key ? 0 : 1,
                      }}
                    />
                    {hovered === it.key && (
                      <StackedVideo
                        src={`/contents/${it.key}`}
                        autoPlay
                        loop
                        onReady={() => setReadyKey(it.key)}
                        style={{ ...fillStyle, position: 'absolute', inset: 0 }}
                      />
                    )}
                  </>
                ) : (
                  <img
                    src={`/contents/${it.key}`}
                    alt={it.name}
                    loading="lazy"
                    onLoad={(e) => rememberAspect(it.key, e.currentTarget)}
                    style={fillStyle}
                  />
                )}
                {framings[framingOf[it.name]]?.frame && (
                  <SafeBound frame={framings[framingOf[it.name]].frame} aspect={aspects[it.key] ?? 1} />
                )}
                {origins[it.name] && (
                  <Crosshair
                    x={origins[it.name][0]}
                    y={origins[it.name][1]}
                    aspect={aspects[it.key] ?? 1}
                  />
                )}
              </div>
              <Flex justify="between" align="center" gap="2">
                <Text size="1" weight="medium" truncate title={it.name}>
                  {it.name}
                </Text>
                <Flex align="center" gap="2" style={{ flexShrink: 0 }}>
                  <Badge size="1" variant="soft" color={it.type === 'animation' ? 'ruby' : 'gray'}>
                    {ext(it.key)}
                  </Badge>
                  <Text size="1" color="gray">
                    {kb(it.size)}
                  </Text>
                </Flex>
              </Flex>
            </Flex>
          </Card>
        ))}
      </Grid>
    </Container>
  )
}

// Map a content-space point (0–1) into the square box, accounting for contain letterbox.
function toBox(x: number, y: number, aspect: number): [number, number] {
  if (aspect >= 1) {
    const h = 1 / aspect
    return [x, (1 - h) / 2 + y * h]
  }
  const w = aspect
  return [(1 - w) / 2 + x * w, y]
}

// The 1024² safe bound — the true reference region (= center 1024 crop of the
// regular frame; see monet-idle-small.png). Centered in each framing's frame.
const SAFE = 1024
function SafeBound({ frame, aspect }: { frame: [number, number]; aspect: number }) {
  const [W, H] = frame
  const fw = Math.min(1, SAFE / W)
  const fh = Math.min(1, SAFE / H)
  const x = (1 - fw) / 2
  const y = (1 - fh) / 2
  const [l, t] = toBox(x, y, aspect)
  const [r, b] = toBox(x + fw, y + fh, aspect)
  return (
    <div
      title="1024² safe bound"
      style={{
        position: 'absolute',
        left: `${l * 100}%`,
        top: `${t * 100}%`,
        width: `${(r - l) * 100}%`,
        height: `${(b - t) * 100}%`,
        border: '1px dashed rgba(40,130,255,0.9)',
        borderRadius: 2,
        pointerEvents: 'none',
      }}
    />
  )
}

// Crosshair at the normalized origin (x, y in content space) over the square box.
function Crosshair({ x, y, aspect }: { x: number; y: number; aspect: number }) {
  const [cx, cy] = toBox(x, y, aspect)
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      style={{
        position: 'absolute',
        left: `${cx * 100}%`,
        top: `${cy * 100}%`,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
      }}
    >
      <line x1="8" y1="1" x2="8" y2="15" stroke="#ff0050" strokeWidth="1.5" />
      <line x1="1" y1="8" x2="15" y2="8" stroke="#ff0050" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="1.4" fill="#ff0050" />
    </svg>
  )
}

// Square media box with a transparency checkerboard (reveals alpha + baked bgs).
const boxStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  aspectRatio: '1 / 1',
  borderRadius: 8,
  overflow: 'hidden',
  backgroundColor: '#fff',
  backgroundImage:
    'linear-gradient(45deg, #dcdcdc 25%, transparent 25%), linear-gradient(-45deg, #dcdcdc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #dcdcdc 75%), linear-gradient(-45deg, transparent 75%, #dcdcdc 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
}

// Media (img/canvas) fills the box, preserving aspect — letterboxed for wide clips.
const fillStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  height: '100%',
  objectFit: 'contain',
}
