import { Theme } from '@radix-ui/themes'
import Home from './Home'
import Editor from './Editor'
import Preview from './Preview'
import Studio from './Studio'

export default function App() {
  // Minimal routing — swap for a router when routes multiply.
  const path = window.location.pathname
  const page = path.startsWith('/editor') ? (
    <Editor />
  ) : path.startsWith('/preview') ? (
    <Preview />
  ) : path.startsWith('/studio') ? (
    <Studio />
  ) : (
    <Home />
  )
  return (
    <Theme appearance="light" accentColor="ruby" grayColor="sand" radius="large">
      {page}
    </Theme>
  )
}
