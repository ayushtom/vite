import { message } from './message.js'
import { message as virtual } from 'virtual:message'
import colors from 'picocolors'
import './style.css'
import image from '../tile.svg?no-inline'
import ModuleWorker from './worker.js?worker'
await import('/@vite/client')
document.documentElement.dataset.base = import.meta.env.BASE_URL
document.querySelector('#message').textContent = message
document.querySelector('#virtual').textContent =
  virtual + ':' + typeof colors.red
document.querySelector('#image').src = image
const lazy = await import('./nested/lazy.js')
document.querySelector('#lazy').textContent = lazy.message
const worker = new ModuleWorker()
worker.onmessage = ({ data }) =>
  (document.querySelector('#worker').textContent = data)
const classic = new Worker(new URL('./classic.js', import.meta.url), {
  type: 'classic',
})
classic.onmessage = ({ data }) =>
  (document.querySelector('#classic').textContent = data)
import.meta.hot.accept('./message.js', (mod) => {
  document.querySelector('#message').textContent = mod.message
})

export function originalLocation() {
  return 'source map marker'
}
