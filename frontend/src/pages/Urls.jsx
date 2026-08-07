import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { Btn, Card, SectionTitle, Toast } from '../components/UI.jsx'

const QUICK_URLS = [
  { label: 'LinkedIn', url: 'https://www.linkedin.com/jobs' },
  { label: 'Indeed UK', url: 'https://uk.indeed.com' },
  { label: 'Glassdoor UK', url: 'https://www.glassdoor.co.uk/Jobs/' },
  { label: 'Wellfound', url: 'https://wellfound.com/jobs' },
  { label: 'Welcome Jungle', url: 'https://uk.welcometothejungle.com/' },
  { label: 'TechNation', url: 'https://technation.io/' },
  { label: 'UK-RAS', url: 'https://uk-ras.org.uk/jobs' },
  { label: 'Reed', url: 'https://www.reed.co.uk' },
  { label: 'TotalJobs', url: 'https://www.totaljobs.com' },
  { label: 'ROS Jobs', url: 'https://jobs.ros.org' },
  { label: 'Adzuna', url: 'https://www.adzuna.co.uk' },
  { label: 'CWJobs', url: 'https://www.cwjobs.co.uk' },
]

export default function UrlsPage() {
  const [urls, setUrls] = useState([])
  const [newUrl, setNewUrl] = useState('')
  const [dirty, setDirty] = useState(false)
  const [toast, setToast] = useState(null)

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }

  useEffect(() => {
    api.getUrls().then(data => setUrls(Array.isArray(data) ? data : []))
      .catch(e => showToast('Failed to load URLs: ' + e.message, 'error'))
  }, [])

  const save = async () => {
    try {
      await api.saveUrls(urls)
      setDirty(false)
      showToast('URLs saved!')
    } catch (e) {
      showToast('Save failed: ' + e.message, 'error')
    }
  }

  const addUrl = (url) => {
    const val = (url || newUrl).trim()
    if (!val || urls.includes(val)) { setNewUrl(''); return }
    if (!/^https?:\/\/.+/i.test(val)) {
      showToast('Enter a valid URL starting with http:// or https://', 'error')
      return
    }
    setUrls(u => [...u, val])
    setNewUrl('')
    setDirty(true)
  }

  const removeUrl = (idx) => {
    setUrls(u => u.filter((_, i) => i !== idx))
    setDirty(true)
  }

  return (
    <div className="fade-up">
      <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 4 }}>Target URLs</h1>
      <p style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text3)', marginBottom: 24 }}>
        // job boards and company career pages to scrape. save changes before running the scraper.
      </p>

      <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        <Btn variant="primary" onClick={save} disabled={!dirty}>
          {dirty ? '● Save Changes' : '✓ Saved'}
        </Btn>
      </div>

      <Card style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Add URL</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={newUrl}
            onChange={e => setNewUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addUrl()}
            placeholder="https://careers.company.com"
            style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '9px 12px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 12, outline: 'none' }}
          />
          <Btn variant="primary" onClick={() => addUrl()}>+ Add</Btn>
        </div>
      </Card>

      <SectionTitle>suggested job boards</SectionTitle>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        {QUICK_URLS.map(q => (
          <Btn
            key={q.url}
            variant={urls.includes(q.url) ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => urls.includes(q.url) ? removeUrl(urls.indexOf(q.url)) : addUrl(q.url)}
          >
            {urls.includes(q.url) ? '✓ ' : '+ '}{q.label}
          </Btn>
        ))}
      </div>

      <SectionTitle>your urls ({urls.length})</SectionTitle>
      {urls.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: 40, color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 12 }}>
          No URLs added yet. Use the quick-add buttons above.
        </Card>
      ) : (
        urls.map((url, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '10px 14px', marginBottom: 7,
          }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', minWidth: 20 }}>{i + 1}.</span>
            <a href={url} target="_blank" rel="noopener noreferrer"
              style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {url}
            </a>
            <Btn variant="danger" size="sm" onClick={() => removeUrl(i)}>✕</Btn>
          </div>
        ))
      )}

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
