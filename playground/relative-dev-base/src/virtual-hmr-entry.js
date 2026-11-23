import { message } from 'virtual:hot-message'
document.querySelector('#virtual-hmr').textContent = message
if (import.meta.hot) {
  import.meta.hot.accept('virtual:hot-message', (mod) => {
    document.querySelector('#virtual-hmr').textContent = mod.message
  })
}
