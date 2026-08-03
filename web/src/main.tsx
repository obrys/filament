import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Link } from 'react-router'
import { Dashboard } from './pages/Dashboard'
import { FilamentTypes } from './pages/FilamentTypes'
import { Spools } from './pages/Spools'
import { SpoolDetail } from './pages/SpoolDetail'
import { SpoolMaintenance } from './pages/SpoolMaintenance'
import { useChangeStream } from './realtime/useChangeStream'
import { VersionGate } from './realtime/VersionGate'
import { VersionBadge } from './components/VersionBadge'
import './styles.css'

function App() {
  useChangeStream()
  return (
    <BrowserRouter>
      <VersionGate />
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
          <Route path="/spools/maintenance" element={<SpoolMaintenance />} />
          <Route path="/spools/:id" element={<SpoolDetail />} />
        </Routes>
      </main>
      <VersionBadge />
    </BrowserRouter>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
)
