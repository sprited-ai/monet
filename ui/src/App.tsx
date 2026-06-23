import { Theme } from '@radix-ui/themes'
import Whiteroom from './Whiteroom'
import Editor from './Editor'
import Preview from './Preview'

export default function App() {
  // The white room is home (/). /preview and /editor are the dev tools.
  const path = window.location.pathname
  const route = path.startsWith('/editor')
    ? { page: <Editor />, title: 'Monet · Editor' }
    : path.startsWith('/preview')
      ? { page: <Preview />, title: 'Monet · Preview' }
      : { page: <Whiteroom />, title: 'Monet · White Room' }
  document.title = route.title
  const page = route.page
  return (
    <Theme appearance="light" accentColor="ruby" grayColor="sand" radius="large">
      {page}
    </Theme>
  )
}
