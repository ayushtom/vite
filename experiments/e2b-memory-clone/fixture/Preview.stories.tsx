import React from 'react'
import './preview.css'
import icon from './icon.svg?no-inline'
export default { title: 'Preview', component: Preview }
function Preview(): React.JSX.Element {
  return (
    <main>
      <h1>Local relative Storybook</h1>
      <img src={icon} width="32" />
      <button>Same path, own runtime</button>
    </main>
  )
}
export const Default = {}
export const Alternate = {
  render: (): React.JSX.Element => <h1>Alternate relative state</h1>,
}
