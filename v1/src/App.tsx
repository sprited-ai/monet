import { Theme } from '@radix-ui/themes'
import Home from './Home'
import Editor from './Editor'

export default function App() {
  // Minimal routing — two pages for now. Swap for a router when routes multiply.
  const isEditor = window.location.pathname.startsWith('/editor')
  return (
    <Theme appearance="light" accentColor="ruby" grayColor="sand" radius="large">
      {isEditor ? <Editor /> : <Home />}
    </Theme>
  )
}
