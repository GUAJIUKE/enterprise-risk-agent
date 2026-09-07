import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { DemoStudio } from './demo/DemoStudio'
import { useRoute } from './router'
import './styles/app.css'
import './demo/demo.css'

function Root() {
  const route = useRoute()
  return route === '/demo' ? <DemoStudio /> : <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
