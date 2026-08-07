import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { Card, SectionTitle, Btn, Spinner, Toast, Modal } from '../components/UI.jsx'
import JobCard from '../components/JobCard.jsx'

export default function ResultsPage() {
  const [results, setResults] = useState(null)
  const [trackedIds, setTrackedIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [searchQ, setSearchQ] = useState('')
  const [cvFilter, setCvFilter] = useState('')
  const [hideTracked, setHideTracked] = useState(false)
  const [toast, setToast] = useState(null)
  const [collapsed, setCollapsed] = useState({})
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false)
  const [purging, setPurging] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }

  useEffect(() => {
    Promise.all([
      api.getResults(),
      api.getTrackerIds(),  // Lightweight: just IDs
    ]).then(([res, ids]) => {
      setResults(res)
      setTrackedIds(new Set(ids))
    }).catch(e => showToast('Failed to load results: ' + e.message, 'error')).finally(() => setLoading(false))
  }, [])

  const trackJob = async (job, cvProfile, roleSearched) => {
    try {
      await api.addToTracker({ ...job, cv_profile: cvProfile, role_searched: roleSearched })
      setTrackedIds(s => new Set([...s, job.id]))
      showToast(`"${job.title}" added to tracker!`)
    } catch (e) {
      showToast('Failed to track: ' + e.message, 'error')
    }
  }

  const untrackJob = async (jobId) => {
    try {
      await api.deleteFromTracker(jobId)
      setTrackedIds(s => { const n = new Set(s); n.delete(jobId); return n })
      showToast('Removed from tracker')
    } catch (e) {
      showToast('Failed: ' + e.message, 'error')
    }
  }

  const toggleSection = (key) => setCollapsed(c => ({ ...c, [key]: !c[key] }))

  const confirmDeleteResult = async () => {
    const job = deleteTarget
    setDeleting(true)
    try {
      await api.deleteResult(job.id)
      setResults(r => {
        if (!r) return r
        const next = { ...r, results: {} }
        for (const [cv, roles] of Object.entries(r.results || {})) {
          next.results[cv] = {}
          for (const [role, jobs] of Object.entries(roles || {})) {
            next.results[cv][role] = (jobs || []).filter(j => j.id !== job.id)
          }
        }
        return next
      })
      setTrackedIds(s => { const n = new Set(s); n.delete(job.id); return n })
      setDeleteTarget(null)
      showToast(`"${job.title}" deleted`)
    } catch (e) {
      showToast('Delete failed: ' + e.message, 'error')
    } finally {
      setDeleting(false)
    }
  }

  const purgeUntracked = async () => {
    setPurging(true)
    try {
      const { removed } = await api.purgeUntrackedResults()
      const fresh = await api.getResults()
      setResults(fresh)
      setShowPurgeConfirm(false)
      showToast(`Removed ${removed} untracked result${removed !== 1 ? 's' : ''}`)
    } catch (e) {
      showToast('Cleanup failed: ' + e.message, 'error')
    } finally {
      setPurging(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, gap: 12 }}>
        <Spinner /> <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text3)' }}>Loading results...</span>
      </div>
    )
  }

  const allResults = results?.results || {}
  const cvs = Object.keys(allResults)
  const isPartial = results?._partial
  const generatedAt = results?.generated_at

  const cvEntries = Object.entries(allResults).filter(([cv]) => !cvFilter || cv === cvFilter)
  let totalFound = 0

  const allJobsFlat = Object.values(allResults).flatMap(roles => Object.values(roles || {}).flatMap(jobs => jobs || []))
  const untrackedCount = allJobsFlat.filter(j => !trackedIds.has(j.id)).length

  // The same job can independently match multiple role searches, so it's saved (and rendered) once
  // per match — tracking/deleting acts on the shared id, so every duplicate listing moves together.
  const duplicateCounts = allJobsFlat.reduce((acc, j) => { acc[j.id] = (acc[j.id] || 0) + 1; return acc }, {})

  return (
    <div className="fade-up">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 4 }}>Results</h1>
          <p style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text3)' }}>
            {generatedAt
              ? `// ${isPartial ? '⚡ partial results — scrape still in progress · ' : ''}last scraped: ${new Date(generatedAt).toLocaleString()}`
              : '// no results yet — run the scraper first'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {trackedIds.size > 0 && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '6px 12px', borderRadius: 20 }}>
              {trackedIds.size} tracked
            </div>
          )}
          {untrackedCount > 0 && (
            <Btn variant="danger" size="sm" onClick={() => setShowPurgeConfirm(true)}>
              Delete All Untracked ({untrackedCount})
            </Btn>
          )}
        </div>
      </div>

      {isPartial && (
        <Card style={{ marginBottom: 20, borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.04)' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--accent3)' }}>
            ⚡ These are partial results from an incomplete scrape. Go to <strong>Run Scraper</strong> to resume or start fresh.
          </div>
        </Card>
      )}

      {!generatedAt && (
        <Card style={{ textAlign: 'center', padding: 60, color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 12 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>◫</div>
          No results yet. Go to <strong style={{ color: 'var(--accent)' }}>Run Scraper</strong>.
        </Card>
      )}

      {generatedAt && (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Filter by title or company..."
              style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 12px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 12, outline: 'none', width: 240 }}
            />
            <select
              value={cvFilter}
              onChange={e => setCvFilter(e.target.value)}
              style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 12px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 12, outline: 'none' }}
            >
              <option value="">All CVs</option>
              {cvs.map(cv => <option key={cv} value={cv}>{cv}</option>)}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={hideTracked} onChange={e => setHideTracked(e.target.checked)} style={{ cursor: 'pointer' }} />
              Hide tracked
            </label>
          </div>

          {cvEntries.map(([cvName, roles]) => {
            if (!roles) return null
            const roleEntries = Object.entries(roles).filter(([, jobs]) => jobs && jobs.length > 0)
            if (!roleEntries.length) return null

            return (
              <div key={cvName} style={{ marginBottom: 28 }}>
                <SectionTitle>{cvName}</SectionTitle>
                {roleEntries.map(([role, jobs]) => {
                  const filtered = jobs.filter(job => {
                    if (searchQ && !job.title.toLowerCase().includes(searchQ.toLowerCase()) && !(job.company || '').toLowerCase().includes(searchQ.toLowerCase())) return false
                    if (hideTracked && trackedIds.has(job.id)) return false
                    return true
                  })
                  totalFound += jobs.length
                  if (!filtered.length) return null

                  const key = `${cvName}:${role}`
                  const isCollapsed = collapsed[key]
                  const trackedInRole = filtered.filter(j => trackedIds.has(j.id)).length

                  return (
                    <div key={role} style={{ marginBottom: 16 }}>
                      <div onClick={() => toggleSection(key)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '6px 0', marginBottom: 6, userSelect: 'none' }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', transform: isCollapsed ? 'none' : 'rotate(90deg)', display: 'inline-block', transition: 'transform 0.15s' }}>▶</span>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{role}</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>({filtered.length})</span>
                        {trackedInRole > 0 && (
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '1px 7px', borderRadius: 10 }}>
                            {trackedInRole} tracked
                          </span>
                        )}
                      </div>
                      {!isCollapsed && filtered.map(job => (
                        <JobCard
                          key={job.id}
                          job={job}
                          cvProfile={cvName}
                          roleSearched={role}
                          isTracked={trackedIds.has(job.id)}
                          duplicateCount={duplicateCounts[job.id]}
                          onTrack={trackJob}
                          onUntrack={untrackJob}
                          onDelete={setDeleteTarget}
                        />
                      ))}
                    </div>
                  )
                })}
              </div>
            )
          })}

          {totalFound === 0 && (
            <Card style={{ textAlign: 'center', padding: 60, color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 12 }}>
              No jobs found in the results. Try adjusting your search config or salary filters.
            </Card>
          )}
        </>
      )}
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <Modal open={showPurgeConfirm} onClose={() => setShowPurgeConfirm(false)} title="Delete all untracked?" width={400}>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>
          This will permanently remove all {untrackedCount} untracked result{untrackedCount !== 1 ? 's' : ''} from Results. Tracked jobs are kept. This can't be undone.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setShowPurgeConfirm(false)}>Cancel</Btn>
          <Btn variant="danger" onClick={purgeUntracked} disabled={purging}>{purging ? 'Removing...' : 'Delete All Untracked'}</Btn>
        </div>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete this job?" width={420}>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>
          This permanently removes <strong style={{ color: 'var(--text)' }}>{deleteTarget?.title}</strong> from Results
          {trackedIds.has(deleteTarget?.id) ? ' and from your Tracker' : ''} — everywhere. This can't be undone.
          {deleteTarget && duplicateCounts[deleteTarget.id] > 1 && (
            <> This job matched {duplicateCounts[deleteTarget.id]} different role searches, so it's listed {duplicateCounts[deleteTarget.id]} times below — deleting it removes <strong>all</strong> of those listings at once, not just this one.</>
          )}
          {trackedIds.has(deleteTarget?.id) && (
            <> If you only want to stop tracking it but keep it in Results, untick <strong>Tracked</strong> instead of deleting.</>
          )}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Btn>
          <Btn variant="danger" onClick={confirmDeleteResult} disabled={deleting}>{deleting ? 'Deleting...' : 'Delete'}</Btn>
        </div>
      </Modal>
    </div>
  )
}
