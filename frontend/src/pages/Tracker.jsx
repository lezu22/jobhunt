import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'
import { SectionTitle, Spinner, Toast, Modal, Input, Select, Btn, Label } from '../components/UI.jsx'
import TrackerCard from '../components/TrackerCard.jsx'
import PipelineOverview from '../components/PipelineOverview.jsx'

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'none', label: 'Not Applied' },
  { value: 'cv_submitted', label: 'CV Submitted' },
  { value: 'applied', label: 'Applied' },
  { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer' },
  { value: 'negotiating', label: 'Negotiating' },
  { value: 'hired', label: 'Hired' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' },
]

const NEW_STATUS_OPTIONS = FILTERS.filter(f => f.value !== 'all')

const EMPTY_DRAFT = { title: '', company: '', location: '', url: '', salary: '', status: 'none', description: '' }

export default function TrackerPage() {
  const [jobs, setJobs] = useState([])
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addDraft, setAddDraft] = useState(EMPTY_DRAFT)
  const [adding, setAdding] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }

  const load = useCallback(async () => {
    try {
      const data = await api.getTracker()
      setJobs(data)
    } catch (e) {
      showToast('Failed to load tracker: ' + e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const updateJob = async (id, updates) => {
    try {
      const updated = await api.updateTracker(id, updates)
      setJobs(j => j.map(x => x.id === id ? updated : x))
      showToast('Updated!')
    } catch (e) {
      showToast('Update failed: ' + e.message, 'error')
      throw e
    }
  }

  const deleteJob = (id) => setDeleteTarget(id)

  const confirmDelete = async () => {
    const id = deleteTarget
    setDeleteTarget(null)
    try {
      await api.deleteFromTracker(id)
      setJobs(j => j.filter(x => x.id !== id))
      showToast('Removed from tracker')
    } catch (e) {
      showToast('Delete failed: ' + e.message, 'error')
    }
  }

  const canAdd = addDraft.title.trim().length > 0 && (!addDraft.url.trim() || /^https?:\/\//i.test(addDraft.url.trim()))

  const addJob = async () => {
    if (!canAdd) return
    setAdding(true)
    try {
      const created = await api.addToTracker({
        title: addDraft.title.trim(),
        company: addDraft.company.trim() || null,
        location: addDraft.location.trim() || null,
        url: addDraft.url.trim() || null,
        salary: { raw: addDraft.salary.trim() || null },
        status: addDraft.status,
        description: addDraft.description.trim() || null,
      })
      setJobs(j => [created, ...j.filter(x => x.id !== created.id)])
      setShowAdd(false)
      setAddDraft(EMPTY_DRAFT)
      showToast('Job added to tracker')
    } catch (e) {
      showToast('Add failed: ' + e.message, 'error')
    } finally {
      setAdding(false)
    }
  }

  const filtered = jobs.filter(job => {
    if (filter !== 'all' && job.status !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!job.title?.toLowerCase().includes(q) && !job.company?.toLowerCase().includes(q)) return false
    }
    return true
  })

  const counts = jobs.reduce((acc, j) => {
    acc[j.status || 'none'] = (acc[j.status || 'none'] || 0) + 1
    return acc
  }, {})

  return (
    <div className="fade-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 4 }}>Tracker</h1>
          <p style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text3)', marginBottom: 24 }}>
            // {jobs.length} application{jobs.length !== 1 ? 's' : ''} tracked in local database
          </p>
        </div>
        <Btn variant="primary" onClick={() => setShowAdd(true)}>+ Add Job</Btn>
      </div>

      {!loading && <PipelineOverview jobs={jobs} />}

      {/* Status filter chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            style={{
              padding: '6px 14px', borderRadius: 20, border: '1px solid',
              fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              borderColor: filter === f.value ? 'var(--accent)' : 'var(--border)',
              color: filter === f.value ? 'var(--accent)' : 'var(--text3)',
              background: filter === f.value ? 'var(--accent-dim)' : 'transparent',
              transition: 'all 0.15s',
            }}
          >
            {f.label}
            {counts[f.value === 'all' ? undefined : f.value] !== undefined && (
              <span style={{ marginLeft: 6, opacity: 0.7 }}>
                {f.value === 'all' ? jobs.length : (counts[f.value] || 0)}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by title or company..."
        style={{ marginBottom: 20, width: 280, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 12px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 12, outline: 'none' }}
      />

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', padding: 60 }}>
          <Spinner /> <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text3)' }}>Loading...</span>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 12 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>◉</div>
          {jobs.length === 0
            ? 'No jobs tracked yet. Browse Results and click "+ Track" on jobs you want to follow.'
            : 'No jobs match your current filter.'}
        </div>
      )}

      {/* Job list */}
      {filtered.map(job => (
        <TrackerCard
          key={job.id}
          job={job}
          onUpdate={updateJob}
          onDelete={deleteJob}
        />
      ))}

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <Modal open={showAdd} onClose={() => { setShowAdd(false); setAddDraft(EMPTY_DRAFT) }} title="Add Job" width={480}>
        <Input label="Title *" value={addDraft.title} onChange={v => setAddDraft(d => ({ ...d, title: v }))} placeholder="e.g. Senior Backend Engineer" />
        <Input label="Company" value={addDraft.company} onChange={v => setAddDraft(d => ({ ...d, company: v }))} placeholder="e.g. Acme Corp" />
        <Input label="Location" value={addDraft.location} onChange={v => setAddDraft(d => ({ ...d, location: v }))} placeholder="e.g. Remote, UK" />
        <Input label="URL" value={addDraft.url} onChange={v => setAddDraft(d => ({ ...d, url: v }))} placeholder="https://..." />
        <Input label="Salary" value={addDraft.salary} onChange={v => setAddDraft(d => ({ ...d, salary: v }))} placeholder="e.g. £60k-£75k" />
        <Select label="Status" value={addDraft.status} onChange={v => setAddDraft(d => ({ ...d, status: v }))} options={NEW_STATUS_OPTIONS} />
        <div style={{ marginBottom: 14 }}>
          <Label>Description</Label>
          <textarea
            value={addDraft.description}
            onChange={e => setAddDraft(d => ({ ...d, description: e.target.value }))}
            placeholder="Role summary, requirements, anything worth keeping..."
            rows={4}
            style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: 10, borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', outline: 'none' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
          <Btn variant="secondary" onClick={() => { setShowAdd(false); setAddDraft(EMPTY_DRAFT) }}>Cancel</Btn>
          <Btn variant="primary" onClick={addJob} disabled={!canAdd || adding}>{adding ? 'Adding...' : 'Add Job'}</Btn>
        </div>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Remove job?" width={380}>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>
          This will permanently remove this job from your tracker. This can't be undone.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Btn>
          <Btn variant="danger" onClick={confirmDelete}>Remove</Btn>
        </div>
      </Modal>
    </div>
  )
}
