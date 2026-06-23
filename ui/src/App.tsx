import { Theme } from '@radix-ui/themes'
import Editor from './Editor'
import Preview from './Preview'

export default function App() {
  // Two routes only: /editor (asset grid) and /preview (stage). Everything else → /preview.
  const path = window.location.pathname
  const page = path.startsWith('/editor') ? <Editor /> : <Preview />
  return (
    <Theme appearance="light" accentColor="ruby" grayColor="sand" radius="large">
      {page}
    </Theme>
  )
}
