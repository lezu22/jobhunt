import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { Btn, Card, SectionTitle } from '../components/UI.jsx'

export default function ScrapePage() {
  const [config, setConfig] = useState(null)
  const [urls, setUrls] = useState([])
  const [salaryMin, setSalaryMin] = useState('')
  const [salaryMax, setSalaryMax] = useState('')
  const [running, setRunning] = useState(false)
  const [jobId, setJobId] = useState(null)
  const [progress, setProgress] = useState(null)
  const [done, setDone] = useState(false)
  const [error, setError] = useState(null)
  const [checkpoint, setCheckpoint] = useState(null)
  const pollRef = useRef(null)
  const nav = useNavigate()

  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => {})
    api.getUrls().then(setUrls).catch(() => {})
    api.getCheckpoint().then(setCheckpoint).catch(() => {})
  }, [])

  const totalRoles = config ? Object.values(config).reduce((a, r) => a + r.length, 0) : 0
  const totalTasks = totalRoles * urls.length

  const startScrape = async (resume = false) => {
    setError(null)
    setDone(false)
    setProgress(null)
    setRunning(true)
    try {
      const { job_id } = await api.startScrape({
        min_salary: salaryMin ? parseFloat(salaryMin) : null,
        max_salary: salaryMax ? parseFloat(salaryMax) : null,
        resume,
      })
      setJobId(job_id)
      pollRef.current = setInterval(async () => {
        try {
          const status = await api.pollScrape(job_id)
          setProgress(status)
          if (status.status === 'done') {
            clearInterval(pollRef.current)
            setRunning(false)
            setDone(true)
            setCheckpoint(null)
          } else if (status.status === 'error') {
            clearInterval(pollRef.current)
            setRunning(false)
            setError(status.error || 'Unknown error')
          }
        } catch(e) {
          clearInterval(pollRef.current)
          setRunning(false)
          setError(e.message)
        }
      }, 1000)
    } catch (e) {
      setRunning(false)
      setError(e.message)
    }
  }

  const clearCheckpoint = async () => {
    await api.clearCheckpoint()
    setCheckpoint(null)
  }

  useEffect(() => () => clearInterval(pollRef.current), [])

  const pct = progress?.progress?.percent || 0
  const completed = progress?.progress?.completed || 0
  const total = progress?.progress?.total || totalTasks || 1

  return (
    <div className="fade-up">
      <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 4 }}>Run Scraper</h1>
      <p style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text3)', marginBottom: 28 }}>
        // scrape all configured urls for all target roles. progress is saved after each role — you can safely stop and resume.
      </p>

      {/* Checkpoint resume banner */}
      {checkpoint?.has_checkpoint && !running && !done && (
        <Card style={{ marginBottom: 20, borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--accent3)', fontWeight: 700, marginBottom: 4 }}>
                ⚡ Unfinished scrape detected
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', lineHeight: 1.8 }}>
                {checkpoint.roles_completed} roles completed · {checkpoint.jobs_found_so_far} jobs found so far
                {checkpoint.generated_at && ` · started ${new Date(checkpoint.generated_at).toLocaleString()}`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="primary" size="sm" onClick={() => startScrape(true)}>▷ Resume</Btn>
              <Btn variant="danger" size="sm" onClick={clearCheckpoint}>✕ Discard</Btn>
            </div>
          </div>
        </Card>
      )}

      {/* Config summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <Card>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Search Config</div>
          {!config || Object.keys(config).length === 0 ? (
            <p style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--danger)' }}>⚠ No config saved.</p>
          ) : (
            Object.entries(config).map(([cv, roles]) => (
              <div key={cv} style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>{cv}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>{roles.length} roles</span>
              </div>
            ))
          )}
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
            {totalRoles} roles × {urls.length} URLs = <strong style={{ color: 'var(--text2)' }}>{totalTasks} searches</strong>
          </div>
        </Card>

        <Card>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Target URLs</div>
          {urls.length === 0 ? (
            <p style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--danger)' }}>⚠ No URLs saved.</p>
          ) : (
            urls.slice(0, 7).map((url, i) => {
              const domain = (() => { try { return new URL(url).hostname } catch { return url } })()
              return (
                <div key={i} style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)', marginBottom: 4 }}>
                  {domain}
                </div>
              )
            })
          )}
          {urls.length > 7 && <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>+{urls.length - 7} more</div>}
        </Card>
      </div>

      {/* Salary filter */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Salary Filter (optional — unlisted salaries always included)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {[['Min Salary (£)', salaryMin, setSalaryMin], ['Max Salary (£)', salaryMax, setSalaryMax]].map(([lbl, val, set]) => (
            <div key={lbl}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginBottom: 6 }}>{lbl}</div>
              <input type="number" value={val} onChange={e => set(e.target.value)}
                placeholder={lbl.includes('Min') ? 'e.g. 60000' : 'e.g. 120000'} disabled={running}
                style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '9px 12px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 12, outline: 'none' }} />
            </div>
          ))}
        </div>
      </Card>

      {/* Run button */}
      {!running && !done && (
        <Btn
          variant="primary" size="lg"
          onClick={() => startScrape(false)}
          disabled={!config || Object.keys(config).length === 0 || urls.length === 0}
          style={{ fontSize: 14, padding: '14px 28px' }}
        >
          ▷ Start Scraping ({totalTasks} searches)
        </Btn>
      )}

      {/* Progress */}
      {running && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div className="spin" style={{ width: 18, height: 18, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', flexShrink: 0 }} />
            <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
              {progress?.progress?.skipped ? 'Resuming...' : 'Scraping...'} {pct}%
            </div>
            <div style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
              {completed} / {total}
            </div>
          </div>
          <div style={{ background: 'var(--surface2)', borderRadius: 4, height: 6, marginBottom: 14, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 4, width: `${pct}%`, transition: 'width 0.5s ease' }} />
          </div>
          {progress?.progress && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', lineHeight: 1.9 }}>
              {progress.progress.current_cv && <div>CV: <span style={{ color: 'var(--accent)' }}>{progress.progress.current_cv}</span></div>}
              {progress.progress.current_role && <div>Role: <span style={{ color: 'var(--text2)' }}>{progress.progress.current_role}</span></div>}
              {progress.progress.current_url && (
                <div>Source: <span style={{ color: 'var(--text2)' }}>
                  {(() => { try { return new URL(progress.progress.current_url).hostname } catch { return progress.progress.current_url } })()}
                </span></div>
              )}
              {progress.progress.skipped && <div style={{ color: 'var(--accent3)' }}>↩ resuming from checkpoint</div>}
            </div>
          )}
          <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginTop: 12 }}>
            ⓘ Progress is saved after each role. You can safely close this tab and resume later.
          </p>
        </Card>
      )}

      {/* Done */}
      {done && (
        <Card style={{ borderColor: 'rgba(0,229,160,0.4)' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--accent)', fontWeight: 700, marginBottom: 12 }}>✓ Scrape complete!</div>
          {progress?.result_summary && (
            <div style={{ marginBottom: 16 }}>
              {Object.entries(progress.result_summary).map(([cv, roles]) => (
                <div key={cv} style={{ marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{cv}</div>
                  {Object.entries(roles).map(([role, count]) => (
                    <div key={role} style={{ fontFamily: 'var(--mono)', fontSize: 11, color: count > 0 ? 'var(--accent)' : 'var(--text3)', marginLeft: 12 }}>
                      {role}: {count > 0 ? `${count} found` : 'none'}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn variant="primary" onClick={() => nav('/results')}>View Results →</Btn>
            <Btn variant="secondary" onClick={() => { setDone(false); setProgress(null); setJobId(null) }}>Run Again</Btn>
          </div>
        </Card>
      )}

      {error && (
        <Card style={{ borderColor: 'rgba(239,68,68,0.4)', marginTop: 16 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--danger)' }}>✕ Error: {error}</div>
          <Btn variant="secondary" size="sm" style={{ marginTop: 10 }} onClick={() => setError(null)}>Dismiss</Btn>
        </Card>
      )}
    </div>
  )
}
