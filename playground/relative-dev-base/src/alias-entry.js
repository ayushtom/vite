import { stable } from './stable.js'
document.querySelector('#alias').textContent =
  stable + ':' + import.meta.env.BASE_URL
if (import.meta.hot) import.meta.hot.accept()
