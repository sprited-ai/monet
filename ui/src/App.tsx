import { Theme } from '@radix-ui/themes'
import Whiteroom from './Whiteroom'
import Editor from './Editor'
import Preview from './Preview'

export default function App() {
  // The white room is home (/). /preview and /editor are the dev tools.
  const path = window.location.pathname
  const page = path.startsWith('/editor') ? (
    <Editor />
  ) : path.startsWith('/preview') ? (
    <Preview />
  ) : (
    <Whiteroom />
  )
  return (
    <Theme appearance="light" accentColor="ruby" grayColor="sand" radius="large">
      {page}
    </Theme>
  )
}
