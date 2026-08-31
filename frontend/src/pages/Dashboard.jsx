import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { Card, SectionTitle, Btn, Badge, Toast } from '../components/UI.jsx'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [recent, setRecent] = useState([])
  const [toast, setToast] = useState(null)
  const nav = useNavigate()

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }

  useEffect(() => {
    api.getStats().then(setStats).catch(e => showToast('Failed to load stats: ' + e.message, 'error'))
    api.getTracker().then(jobs => setRecent(jobs.slice(0, 5))).catch(e => showToast('Failed to load recent activity: ' + e.message, 'error'))
  }, [])

  const s = stats || {}
  const byStatus = s.by_status || {}

  return (
    <div className="fade-up">
      <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 4 }}>Dashboard</h1>
      <p style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text3)', marginBottom: 28 }}>// your job hunt at a glance</p>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 32 }}>
        {[
          { label: 'Jobs Found', value: s.results_count || 0, color: 'var(--accent)' },
          { label: 'Tracked', value: s.total || 0, color: '#e8e8f2' },
          { label: 'Applied', value: byStatus.applied || 0, color: '#a78bfa' },
          { label: 'Interviews', value: byStatus.interview || 0, color: 'var(--accent3)' },
          { label: 'Offers', value: byStatus.offer || 0, color: 'var(--accent)' },
          { label: 'Hired', value: byStatus.hired || 0, color: 'var(--accent)' },
          { label: 'Rejected', value: byStatus.rejected || 0, color: '#f87171' },
          { label: 'Ghosted', value: byStatus.ghosted || 0, color: '#a8a2c0' },
          { label: 'Withdrawn', value: byStatus.withdrawn || 0, color: 'var(--text3)' },
          { label: 'Not Applied', value: byStatus.none || 0, color: 'var(--text3)' },
        ].map(item => (
          <Card key={item.label} style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 30, fontWeight: 800, fontFamily: 'var(--mono)', color: item.color, lineHeight: 1, marginBottom: 4 }}>
              {item.value}
            </div>
            <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {item.label}
            </div>
          </Card>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Quick actions */}
        <div>
          <SectionTitle>quick actions</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Btn variant="primary" size="lg" onClick={() => nav('/config')} style={{ justifyContent: 'flex-start' }}>
              ◈ Configure Search Profiles
            </Btn>
            <Btn variant="secondary" size="lg" onClick={() => nav('/scrape')} style={{ justifyContent: 'flex-start' }}>
              ▷ Run Scraper
            </Btn>
            <Btn variant="secondary" size="lg" onClick={() => nav('/results')} style={{ justifyContent: 'flex-start' }}>
              ◫ Browse Results
            </Btn>
            <Btn variant="secondary" size="lg" onClick={() => nav('/tracker')} style={{ justifyContent: 'flex-start' }}>
              ◉ View Tracker
            </Btn>
          </div>
        </div>

        {/* Recent activity */}
        <div>
          <SectionTitle>recent activity</SectionTitle>
          {recent.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 12 }}>
              No tracked jobs yet.
            </div>
          ) : (
            recent.map(job => (
              <div key={job.id} style={{
                background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8,
                padding: '12px 14px', marginBottom: 8,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{job.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
                    {job.company || '—'} · {job.applied_date || job.created_at?.split('T')[0] || ''}
                  </div>
                </div>
                <Badge status={job.status} />
              </div>
            ))
          )}
        </div>
      </div>
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
