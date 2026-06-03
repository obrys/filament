import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import { Dashboard } from './pages/Dashboard'
import { FilamentTypes } from './pages/FilamentTypes'
import { Spools } from './pages/Spools'
import { SpoolDetail } from './pages/SpoolDetail'
import { useChangeStream } from './realtime/useChangeStream'
import './styles.css'

function App() {
  useChangeStream()
  return (
    <BrowserRouter>
      <header className="topbar">
        <Link to="/" className="brand">🧵 Filament</Link>
        <nav>
          <Link to="/">Dashboard</Link>
          <Link to="/types">Types</Link>
          <Link to="/spools">Spools</Link>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/types" element={<FilamentTypes />} />
          <Route path="/spools" element={<Spools />} />
          <Route path="/spools/:id" element={<SpoolDetail />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
)
