import { Theme } from '@radix-ui/themes'
import Whiteroom from './Whiteroom'
import Editor from './Editor'
import Preview from './Preview'
import Webcodex from './Webcodex'
import MouthLab from './MouthLab'

export default function App() {
  // The white room is home (/). /desktop is the same room in overlay mode (the desktop overlay shell
  // loads it). /preview and /editor are the dev tools.
  const path = window.location.pathname
  const route = path.startsWith('/editor')
    ? { page: <Editor />, title: 'Monet · Editor' }
    : path.startsWith('/preview')
      ? { page: <Preview />, title: 'Monet · Preview' }
      : path.startsWith('/webcodex')
        ? { page: <Webcodex />, title: 'Monet · WebCodecs bench' }
        : path.startsWith('/mouth')
          ? { page: <MouthLab />, title: 'Monet · Mouth lab' }
          : path.startsWith('/desktop')
            ? { page: <Whiteroom overlay />, title: 'Monet · Desktop' }
            : { page: <Whiteroom />, title: 'Monet · White Room' }
  document.title = route.title
  const page = route.page
  return (
    <Theme appearance="light" accentColor="ruby" grayColor="sand" radius="large">
      {page}
    </Theme>
  )
}
