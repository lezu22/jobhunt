import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar.jsx'
import Dashboard from './pages/Dashboard.jsx'
import ConfigPage from './pages/Config.jsx'
import UrlsPage from './pages/Urls.jsx'
import ScrapePage from './pages/Scrape.jsx'
import ResultsPage from './pages/Results.jsx'
import TrackerPage from './pages/Tracker.jsx'
import StoriesPage from './pages/Stories.jsx'
import { api } from './api.js'

export default function App() {
  const [stats, setStats] = useState(null)

  const refreshStats = () => {
    api.getStats().then(setStats).catch(e => console.error('Failed to refresh stats:', e))
  }

  useEffect(() => {
    refreshStats()
    const interval = setInterval(refreshStats, 15000)
    return () => clearInterval(interval)
  }, [])

  return (
    <BrowserRouter>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <Sidebar stats={stats} />
        <main style={{
          flex: 1,
          overflowY: 'auto',
          padding: '36px 40px',
          background: 'var(--bg)',
        }}>
          {/* Subtle grid background */}
          <div style={{
            position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
            backgroundImage: `
              linear-gradient(rgba(37,37,56,0.4) 1px, transparent 1px),
              linear-gradient(90deg, rgba(37,37,56,0.4) 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px',
          }} />
          <div style={{ position: 'relative', zIndex: 1, maxWidth: 960 }}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/config" element={<ConfigPage />} />
              <Route path="/urls" element={<UrlsPage />} />
              <Route path="/scrape" element={<ScrapePage />} />
              <Route path="/results" element={<ResultsPage />} />
              <Route path="/tracker" element={<TrackerPage />} />
              <Route path="/stories" element={<StoriesPage />} />
            </Routes>
          </div>
        </main>
      </div>
    </BrowserRouter>
  )
}
