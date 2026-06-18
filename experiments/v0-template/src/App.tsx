import { useState } from 'react'
import { Theme, Container, Flex, Card, Heading, Text, Button } from '@radix-ui/themes'
import { ChatBubbleIcon } from '@radix-ui/react-icons'

export default function App() {
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function ping() {
    setLoading(true)
    try {
      const res = await fetch('/api/hello')
      const data = (await res.json()) as { message: string }
      setMessage(data.message)
    } catch {
      setMessage('Failed to reach the Worker.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Theme appearance="light" accentColor="ruby" grayColor="sand" radius="large">
      <Container size="1" px="4">
        <Flex
          direction="column"
          gap="5"
          align="center"
          justify="center"
          style={{ minHeight: '100vh' }}
        >
          <Flex direction="column" gap="1" align="center">
            <Heading size="8">Monet · White Room</Heading>
            <Text color="gray" size="2">
              v1 — React + Radix Themes + Hono on Cloudflare Workers
            </Text>
          </Flex>

          <Card size="3" style={{ width: '100%' }}>
            <Flex direction="column" gap="3" align="center">
              <Button size="3" onClick={ping} loading={loading}>
                <ChatBubbleIcon />
                Ping the Worker
              </Button>
              {message && (
                <Text align="center" size="3">
                  {message}
                </Text>
              )}
            </Flex>
          </Card>
        </Flex>
      </Container>
    </Theme>
  )
}
