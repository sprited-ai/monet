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
  const [origins, setOrigins] = useState<Record<string, [number, number]>>({})

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
        for (const [name, e] of Object.entries(idx.items ?? {}) as [string, any][]) {
          const o = e.origin ?? fr.framings?.[e.framing]?.origin
          if (o) map[name] = o
        }
        setOrigins(map)
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

  return (
    <Container size="4" px="4" py="6">
      <Flex direction="column" gap="3" mb="5">
        <Flex align="center" gap="3">
          <Heading size="7">Content Editor</Heading>
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
            onMouseLeave={() => setHovered((h) => (h === it.key ? null : h))}
          >
            <Flex direction="column" gap="2">
              <div style={{ position: 'relative', lineHeight: 0 }}>
                {it.type === 'animation' ? (
                  hovered === it.key ? (
                    // composite the stacked-alpha clip (one WebGL context at a time)
                    <StackedVideo src={`/contents/${it.key}`} autoPlay loop style={mediaStyle} />
                  ) : (
                    <img
                      src={`/contents/${it.key.replace(/\.mp4$/, '.thumbnail.webp')}`}
                      alt={it.name}
                      loading="lazy"
                      style={mediaStyle}
                    />
                  )
                ) : (
                  <img src={`/contents/${it.key}`} alt={it.name} loading="lazy" style={mediaStyle} />
                )}
                {origins[it.name] && <Crosshair x={origins[it.name][0]} y={origins[it.name][1]} />}
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

// Transparency checkerboard — reveals alpha and exposes baked-in backgrounds.
const mediaStyle: CSSProperties = {
  width: '100%',
  borderRadius: 8,
  aspectRatio: '1 / 1',
  objectFit: 'contain',
  backgroundColor: '#fff',
  backgroundImage:
    'linear-gradient(45deg, #dcdcdc 25%, transparent 25%), linear-gradient(-45deg, #dcdcdc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #dcdcdc 75%), linear-gradient(-45deg, transparent 75%, #dcdcdc 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
}
