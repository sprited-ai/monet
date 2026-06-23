import { useEffect, useRef, useState } from 'react'
import { Theme, Flex, Box, Text, TextArea, IconButton, Badge, ScrollArea, Spinner, Code } from '@radix-ui/themes'
import { PaperPlaneIcon, Pencil2Icon, ExitIcon } from '@radix-ui/react-icons'

type Part = { kind: 'text'; text: string } | { kind: 'tool'; name: string }
type Msg = { role: 'user' | 'assistant'; parts: Part[] }

// Persist the transcript + claude session id so a page refresh resumes the SAME
// claude session (--resume) instead of orphaning it. (Continuity — see docs/012.)
const STORE = 'monet-console-chat'
function loadSaved(): { sessionId: string | null; msgs: Msg[] } {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || '{}')
    return { sessionId: s.sessionId ?? null, msgs: Array.isArray(s.msgs) ? s.msgs : [] }
  } catch {
    return { sessionId: null, msgs: [] }
  }
}

function Bubble({ m }: { m: Msg }) {
  const mine = m.role === 'user'
  return (
    <Flex justify={mine ? 'end' : 'start'} px="2">
      <Box
        style={{
          maxWidth: '82%',
          background: mine ? 'var(--violet-9)' : 'var(--gray-3)',
          color: mine ? 'white' : 'var(--gray-12)',
          borderRadius: 14,
          padding: '10px 14px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {m.parts.map((p, i) =>
          p.kind === 'tool' ? (
            <Box key={i} my="1">
              <Text size="1" color="gray">
                🔧 <Code>{p.name}</Code>
              </Text>
            </Box>
          ) : (
            <Text key={i} size="2">
              {p.text}
            </Text>
          ),
        )}
        {m.role === 'assistant' && m.parts.length === 0 && <Text size="2">…</Text>}
      </Box>
    </Flex>
  )
}

export default function App() {
  const saved = useRef(loadSaved())
  const [msgs, setMsgs] = useState<Msg[]>(saved.current.msgs)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const sessionRef = useRef<string | null>(saved.current.sessionId)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    // persist transcript + session id (sessionRef updates alongside msgs during streaming)
    localStorage.setItem(STORE, JSON.stringify({ sessionId: sessionRef.current, msgs }))
  }, [msgs])

  function newChat() {
    sessionRef.current = null
    setMsgs([])
    localStorage.removeItem(STORE)
  }

  // append text to the trailing text part of the last assistant msg (or start one)
  function pushDelta(delta: string) {
    setMsgs((cur) => {
      const copy = cur.slice()
      const last = { ...copy[copy.length - 1] }
      const parts = last.parts.slice()
      const tail = parts[parts.length - 1]
      if (tail && tail.kind === 'text') parts[parts.length - 1] = { kind: 'text', text: tail.text + delta }
      else parts.push({ kind: 'text', text: delta })
      last.parts = parts
      copy[copy.length - 1] = last
      return copy
    })
  }
  function pushTool(name: string) {
    setMsgs((cur) => {
      const copy = cur.slice()
      const last = { ...copy[copy.length - 1] }
      last.parts = [...last.parts, { kind: 'tool', name }]
      copy[copy.length - 1] = last
      return copy
    })
  }

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setMsgs((c) => [...c, { role: 'user', parts: [{ kind: 'text', text }] }, { role: 'assistant', parts: [] }])
    setBusy(true)
    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId: sessionRef.current }),
      })
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`)
      const reader = resp.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const p of parts) {
          const line = p.split('\n').find((x) => x.startsWith('data:'))
          if (!line) continue
          try {
            const ev = JSON.parse(line.slice(5).trim())
            if (ev.type === 'session') sessionRef.current = ev.sessionId
            else if (ev.type === 'text') pushDelta(ev.delta)
            else if (ev.type === 'tool') pushTool(ev.name)
            else if (ev.type === 'error') pushDelta(`\n⚠️ ${ev.message}`)
          } catch {
            /* partial */
          }
        }
      }
    } catch (e) {
      pushDelta(`\n⚠️ ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Theme appearance="dark" accentColor="violet" grayColor="slate" radius="large">
      <Flex direction="column" style={{ height: '100dvh', maxWidth: 820, margin: '0 auto' }}>
        <Flex align="center" gap="2" px="4" py="3" style={{ borderBottom: '1px solid var(--gray-4)' }}>
          <Text size="4">🎨</Text>
          <Text weight="bold">Monetto</Text>
          <Badge color="green" variant="soft">
            claude code · gin
          </Badge>
          <Flex gap="1" style={{ marginLeft: 'auto' }}>
            <IconButton variant="ghost" color="gray" onClick={newChat} title="새 대화" disabled={busy}>
              <Pencil2Icon />
            </IconButton>
            <IconButton
              variant="ghost"
              color="gray"
              title="로그아웃"
              onClick={() => {
                window.location.href = '/cdn-cgi/access/logout'
              }}
            >
              <ExitIcon />
            </IconButton>
          </Flex>
        </Flex>

        <ScrollArea ref={scrollRef as any} style={{ flex: 1 }}>
          <Flex direction="column" gap="3" py="4">
            {msgs.length === 0 && (
              <Flex align="center" justify="center" style={{ height: 240 }}>
                <Text size="3" color="gray">
                  모네또랑 대화를 시작해봐.
                </Text>
              </Flex>
            )}
            {msgs.map((m, i) => (
              <Bubble key={i} m={m} />
            ))}
          </Flex>
        </ScrollArea>

        <Box px="3" py="3" style={{ borderTop: '1px solid var(--gray-4)' }}>
          <Flex gap="2" align="end">
            <Box style={{ flex: 1 }}>
              <TextArea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                placeholder="메시지… (Enter 전송, Shift+Enter 줄바꿈)"
                rows={1}
                style={{ resize: 'none' }}
              />
            </Box>
            <IconButton size="3" disabled={busy || !input.trim()} onClick={() => void send()}>
              {busy ? <Spinner /> : <PaperPlaneIcon />}
            </IconButton>
          </Flex>
        </Box>
      </Flex>
    </Theme>
  )
}
