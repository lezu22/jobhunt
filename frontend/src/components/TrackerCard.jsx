import { useState } from 'react'
import { Btn, Select, Label } from './UI.jsx'
import StatusPipeline, { STAGE_TO_STATUS, markStageReached, getEffectiveStages } from './StatusPipeline.jsx'

const STATUS_OPTIONS = [
  { value: 'none',         label: '– Not Applied' },
  { value: 'cv_submitted', label: 'CV Submitted' },
  { value: 'applied',      label: 'Applied' },
  { value: 'interview',    label: 'Interview' },
  { value: 'offer',        label: 'Offer' },
  { value: 'negotiating',  label: 'Negotiating' },
  { value: 'hired',        label: 'Hired' },
  { value: 'rejected',     label: 'Rejected' },
  { value: 'withdrawn',    label: 'Withdrawn' },
]

// Setting `status` directly is treated as the source of truth: the pipeline is trimmed to match
// exactly — backfilled up to the matching stage, and anything past it cleared — so reverting
// status (e.g. back to "Not Applied") also rolls back stages instead of leaving them stale.
// `customStages` (per-job extra interview rounds) are included so the trim/backfill accounts for them too.
function stagesForStatus(stages, status, customStages = []) {
  const orderedStages = getEffectiveStages(customStages)
  if (status === 'rejected' || status === 'withdrawn') return stages // terminal, but not a stage position — keep history
  if (status === 'hired') return markStageReached(orderedStages, stages, orderedStages[orderedStages.length - 1]) // implies the whole pipeline was reached
  if (status === 'none') {
    // Clear Applied-and-later, but keep any earlier informational stage (e.g. "CV Submitted")
    // since that's independent of the formal application status.
    const appliedIdx = orderedStages.indexOf('Applied')
    const updated = {}
    for (let i = 0; i < appliedIdx; i++) {
      if (stages[orderedStages[i]]) updated[orderedStages[i]] = stages[orderedStages[i]]
    }
    return updated
  }
  const stage = Object.keys(STAGE_TO_STATUS).find(k => STAGE_TO_STATUS[k] === status)
  if (!stage) return stages
  const idx = orderedStages.indexOf(stage)
  const updated = {}
  for (let i = 0; i <= idx; i++) {
    updated[orderedStages[i]] = stages[orderedStages[i]] || new Date().toISOString().split('T')[0]
  }
  return updated
}

// Status mirrors the furthest pipeline stage reached, in both directions — checking a stage
// advances it, unchecking one rolls it back — except a terminal status (rejected/withdrawn/hired)
// is a deliberate call that stage-editing alone shouldn't silently undo.
function statusForStages(stages, currentStatus) {
  if (currentStatus === 'rejected' || currentStatus === 'withdrawn' || currentStatus === 'hired') return currentStatus
  let derived = 'none'
  // Custom stages never appear in STAGE_TO_STATUS, so iterating its keys (already in progression
  // order) covers every status-mapped stage without needing the per-job effective stage list.
  for (const stage of Object.keys(STAGE_TO_STATUS)) {
    if (stages[stage]) derived = STAGE_TO_STATUS[stage]
  }
  return derived
}

export default function TrackerCard({ job, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [newNote, setNewNote] = useState('')
  const [newTask, setNewTask] = useState('')
  const [saving, setSaving] = useState(false)

  const startEdit = () => {
    setDraft({
      status: job.status || 'none',
      applied_date: job.applied_date || '',
      stages: { ...(job.stages || {}) },
      notes: [...(job.notes || [])],
      tasks: [...(job.tasks || [])],
      research: job.research || '',
      description: job.description || '',
      salary_raw: job.salary_raw || '',
      company: job.company || '',
      location: job.location || '',
      url: job.url || '',
      extra_dates: { ...(job.extra_dates || {}) },
      custom_stages: [...(job.custom_stages || [])],
    })
    setEditing(true)
    setExpanded(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      await onUpdate(job.id, draft)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const addNote = () => {
    if (!newNote.trim()) return
    setDraft(d => ({
      ...d,
      notes: [{ text: newNote.trim(), date: new Date().toLocaleString() }, ...(d.notes || [])],
    }))
    setNewNote('')
  }

  const addTask = () => {
    if (!newTask.trim()) return
    setDraft(d => ({
      ...d,
      tasks: [...(d.tasks || []), { text: newTask.trim(), done: false, created: new Date().toISOString() }],
    }))
    setNewTask('')
  }

  const toggleTask = (idx) => {
    setDraft(d => {
      const tasks = [...(d.tasks || [])]
      tasks[idx] = { ...tasks[idx], done: !tasks[idx].done }
      return { ...d, tasks }
    })
  }

  const removeTask = (idx) => {
    setDraft(d => ({ ...d, tasks: (d.tasks || []).filter((_, i) => i !== idx) }))
  }

  // Quick status change (not in edit mode) — keeps the pipeline stages in sync too.
  const quickStatus = async (val) => {
    const stages = stagesForStatus(job.stages || {}, val, job.custom_stages || [])
    await onUpdate(job.id, { status: val, stages })
  }

  const data = editing ? draft : job
  const stageCount = Object.keys(job.stages || {}).length
  const taskCount = (job.tasks || []).length
  const noteCount = (job.notes || []).length

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${statusColor(job.status)}`,
      borderRadius: 8, marginBottom: 10,
      overflow: 'hidden',
    }}>
      {/* Header row */}
      <div style={{ padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {job.url ? (
              <a href={job.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}
                onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                onMouseLeave={e => e.target.style.textDecoration = 'none'}
              >
                {job.title}
              </a>
            ) : job.title}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {job.company && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{job.company}</span>}
            {job.location && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>· {job.location}</span>}
            {job.salary_raw && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent3)' }}>💰 {job.salary_raw}</span>}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {job.cv_profile && (
              <span style={{ fontSize: 10, fontFamily: 'var(--mono)', padding: '2px 6px', borderRadius: 3, background: 'rgba(109,74,255,0.2)', color: '#a78bfa' }}>{job.cv_profile}</span>
            )}
            {job.source && (
              <span style={{ fontSize: 10, fontFamily: 'var(--mono)', padding: '2px 6px', borderRadius: 3, border: '1px solid var(--border)', color: 'var(--text3)' }}>{job.source}</span>
            )}
            {stageCount > 0 && <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{stageCount} stage{stageCount > 1 ? 's' : ''}</span>}
            {taskCount > 0 && <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{taskCount} task{taskCount > 1 ? 's' : ''}</span>}
            {noteCount > 0 && <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{noteCount} note{noteCount > 1 ? 's' : ''}</span>}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
          <select
            value={(editing ? draft.status : job.status) || 'none'}
            onChange={e => {
              const val = e.target.value
              if (editing) {
                setDraft(d => ({ ...d, status: val, stages: stagesForStatus(d.stages, val, d.custom_stages) }))
              } else {
                quickStatus(val)
              }
            }}
            style={{
              background: 'var(--surface2)', border: '1px solid var(--border)',
              color: 'var(--text)', padding: '5px 8px', borderRadius: 6,
              fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer',
              outline: 'none',
            }}
          >
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <div style={{ display: 'flex', gap: 6 }}>
            {job.url && (
              <a href={job.url} target="_blank" rel="noopener noreferrer" style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 10,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                color: 'var(--accent)', border: '1px solid var(--accent)',
                borderRadius: 6, padding: '5px 10px', textDecoration: 'none',
              }}>↗ View Posting</a>
            )}
            <Btn variant="ghost" size="sm" onClick={() => { setExpanded(!expanded); if (!editing) {} }}>
              {expanded ? '▲' : '▼'}
            </Btn>
            {!editing && <Btn variant="secondary" size="sm" onClick={startEdit}>Edit</Btn>}
            {!editing && <Btn variant="danger" size="sm" onClick={() => onDelete(job.id)}>Remove</Btn>}
          </div>
        </div>
      </div>

      {/* Stage pipeline (compact, always visible) */}
      {!expanded && stageCount > 0 && (
        <div style={{ padding: '0 16px 12px' }}>
          <StatusPipeline stages={job.stages || {}} customStages={job.custom_stages || []} readonly />
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: 20 }}>

          {/* Pipeline */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
              Application stages
            </div>
            <StatusPipeline
              stages={data.stages || {}}
              customStages={data.custom_stages || []}
              onChange={s => setDraft(d => ({ ...d, stages: s, status: statusForStages(s, d.status) }))}
              onCustomStagesChange={cs => setDraft(d => ({ ...d, custom_stages: cs }))}
              readonly={!editing}
            />
          </div>

          {editing && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
              <div>
                <Label>Company</Label>
                <input value={draft.company || ''} onChange={e => setDraft(d => ({ ...d, company: e.target.value }))}
                  style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 10px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 11, outline: 'none' }}
                />
              </div>
              <div>
                <Label>Location</Label>
                <input value={draft.location || ''} onChange={e => setDraft(d => ({ ...d, location: e.target.value }))}
                  style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 10px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 11, outline: 'none' }}
                />
              </div>
              <div>
                <Label>Salary</Label>
                <input value={draft.salary_raw || ''} onChange={e => setDraft(d => ({ ...d, salary_raw: e.target.value }))}
                  placeholder="e.g. £60k-£75k"
                  style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 10px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 11, outline: 'none' }}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <Label>Job URL</Label>
                <input value={draft.url || ''} onChange={e => setDraft(d => ({ ...d, url: e.target.value }))}
                  placeholder="https://..."
                  style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 10px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 11, outline: 'none' }}
                />
              </div>
            </div>
          )}

          {editing && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <div>
                <Label>Status</Label>
                <select
                  value={draft.status}
                  onChange={e => setDraft(d => ({ ...d, status: e.target.value, stages: stagesForStatus(d.stages, e.target.value) }))}
                  style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 10px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 11, outline: 'none' }}
                >
                  {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <Label>Applied Date</Label>
                <input type="date" value={draft.applied_date || ''}
                  onChange={e => setDraft(d => ({ ...d, applied_date: e.target.value }))}
                  style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 10px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 11, outline: 'none' }}
                />
              </div>
            </div>
          )}

          {/* Description */}
          {(editing || job.description) && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Description</div>
              {editing ? (
                <textarea
                  value={draft.description || ''}
                  onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                  placeholder="Role summary, requirements, anything worth keeping..."
                  rows={5}
                  style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: 10, borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', outline: 'none' }}
                />
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7, background: 'var(--surface2)', padding: 12, borderRadius: 6 }}>
                  {job.description}
                </div>
              )}
            </div>
          )}

          {/* Research notes */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              Research / Personal Notes
            </div>
            {editing ? (
              <textarea
                value={draft.research || ''}
                onChange={e => setDraft(d => ({ ...d, research: e.target.value }))}
                placeholder="Company research, role notes, prep thoughts..."
                rows={4}
                style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: 10, borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', outline: 'none' }}
              />
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7, minHeight: 40, background: 'var(--surface2)', padding: 12, borderRadius: 6, fontStyle: job.research ? 'normal' : 'italic' }}>
                {job.research || 'No research notes yet. Click Edit to add.'}
              </div>
            )}
          </div>

          {/* Tasks */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              Tasks / To-Do
            </div>
            {(data.tasks || []).map((task, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'var(--surface2)', borderRadius: 6, marginBottom: 5, fontSize: 12 }}>
                {editing ? (
                  <input type="checkbox" checked={task.done} onChange={() => toggleTask(i)} style={{ cursor: 'pointer', width: 14, height: 14 }} />
                ) : (
                  <span style={{ color: task.done ? 'var(--accent)' : 'var(--text3)', fontSize: 12 }}>{task.done ? '✓' : '○'}</span>
                )}
                <span style={{ flex: 1, textDecoration: task.done ? 'line-through' : 'none', color: task.done ? 'var(--text3)' : 'var(--text)' }}>
                  {task.text}
                </span>
                {task.date && <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{task.date}</span>}
                {editing && (
                  <button onClick={() => removeTask(i)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12, padding: '0 4px' }}>✕</button>
                )}
              </div>
            ))}
            {editing && (
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <input
                  value={newTask}
                  onChange={e => setNewTask(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addTask()}
                  placeholder="Add task (e.g. Prepare for technical interview)..."
                  style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 10px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 11, outline: 'none' }}
                />
                <Btn variant="secondary" size="sm" onClick={addTask}>+ Add</Btn>
              </div>
            )}
          </div>

          {/* Notes log */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              Activity Log
            </div>
            <div style={{ maxHeight: 180, overflowY: 'auto', background: 'var(--surface2)', borderRadius: 6, padding: (data.notes || []).length ? 8 : 12 }}>
              {(data.notes || []).length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>No notes yet.</div>
              ) : (
                (data.notes || []).map((note, i) => (
                  <div key={i} style={{ padding: '6px 0', borderBottom: i < data.notes.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)', marginBottom: 2 }}>{note.date}</div>
                    <div style={{ fontSize: 12, color: 'var(--text2)' }}>{note.text}</div>
                  </div>
                ))
              )}
            </div>
            {editing && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addNote()}
                  placeholder="Add a note..."
                  style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 10px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 11, outline: 'none' }}
                />
                <Btn variant="secondary" size="sm" onClick={addNote}>+ Note</Btn>
              </div>
            )}
          </div>

          {/* Extra dates */}
          {editing && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
                Key Dates
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                {['Interview Date', 'Technical Task Due', 'Decision Date', 'Start Date'].map(key => (
                  <div key={key}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', marginBottom: 4, textTransform: 'uppercase' }}>{key}</div>
                    <input
                      type="date"
                      value={draft.extra_dates?.[key] || ''}
                      onChange={e => setDraft(d => ({ ...d, extra_dates: { ...d.extra_dates, [key]: e.target.value || undefined } }))}
                      style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 10, outline: 'none' }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Key dates display (read mode) */}
          {!editing && Object.keys(job.extra_dates || {}).length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Key Dates</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {Object.entries(job.extra_dates).filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} style={{ fontSize: 11, fontFamily: 'var(--mono)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px' }}>
                    <span style={{ color: 'var(--text3)' }}>{k}: </span>
                    <span style={{ color: 'var(--accent3)' }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action row */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <Btn variant="danger" size="sm" onClick={() => onDelete(job.id)}>Remove</Btn>
            {editing ? (
              <>
                <Btn variant="secondary" size="sm" onClick={() => { setEditing(false); setDraft(null) }}>Cancel</Btn>
                <Btn variant="primary" size="sm" onClick={save} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </Btn>
              </>
            ) : (
              <Btn variant="secondary" size="sm" onClick={startEdit}>Edit Details</Btn>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function statusColor(status) {
  const map = {
    cv_submitted: '#5b8dee', applied: '#6d4aff', interview: '#f59e0b',
    offer: '#00e5a0', negotiating: '#00c090', hired: '#00e5a0',
    rejected: '#ef4444', withdrawn: '#4a4a66',
  }
  return map[status] || '#252538'
}
