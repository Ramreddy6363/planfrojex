import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <p className="p-8 text-ui text-text-muted">PlanFrojex</p>
  </StrictMode>,
)
