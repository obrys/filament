import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Link, NavLink } from 'react-router'
import { Dashboard } from './pages/Dashboard'
import { FilamentTypes } from './pages/FilamentTypes'
import { Spools } from './pages/Spools'
import { SpoolDetail } from './pages/SpoolDetail'
import { SpoolMaintenance } from './pages/SpoolMaintenance'
import { useChangeStream } from './realtime/useChangeStream'
import { VersionGate } from './realtime/VersionGate'
import { VersionBadge } from './components/VersionBadge'
import { ThemeToggle } from './components/ThemeToggle'
import { SpoolViz } from './components/SpoolViz'
import { IconDashboard, IconSpool, IconTypes } from './components/icons'
import './styles.css'

const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'is-active' : undefined)

function App() {
  useChangeStream()
  return (
    <BrowserRouter>
      <VersionGate />
      <header className="topbar">
        <Link to="/" className="brand">
          <SpoolViz size={30} fill={0.82} className="brand__mark" />
          <span className="brand__text">Filament</span>
        </Link>
        <nav>
          <NavLink to="/" end className={navClass}><IconDashboard /><span>Dashboard</span></NavLink>
          <NavLink to="/types" className={navClass}><IconTypes /><span>Types</span></NavLink>
          <NavLink to="/spools" className={navClass}><IconSpool /><span>Spools</span></NavLink>
        </nav>
        <ThemeToggle />
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
