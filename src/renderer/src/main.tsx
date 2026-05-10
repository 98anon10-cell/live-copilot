import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// StrictMode is intentionally omitted: it double-invokes effects which is fine for
// pure UI but creates duplicate audio capture / WebSocket clients here.
createRoot(document.getElementById('root')!).render(<App />)
