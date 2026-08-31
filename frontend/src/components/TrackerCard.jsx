import { useState, useEffect } from 'react'
import { Btn, Select, Label } from './UI.jsx'
import StatusPipeline, { STAGE_TO_STATUS, markStageReached, getEffectiveStages, stageSupportsTime, isActionStage, stageColorFor, STAGE_REACHED, stageDate } from './StatusPipeline.jsx'

const TERMINAL_STATUSES = ['hired', 'rejected', 'withdrawn']

// ── Single source of truth: the job's own stage list ─────────────────────────
// The dropdown is generated from getEffectiveStages(custom_stages), so any
// stage added to a card (Discovery Call, Interview Round N, ...) automatically
// becomes selectable. The stored `status` field keeps the old coarse vocabulary
// (applied/interview/offer/...) purely as a DERIVED value so filters, colours
// and stats keep working — it is never the source anymore.

function stageDropdownOptions(customStages = []) {
  return [
    { value: 'none', label: '– Not Applied' },
    ...getEffectiveStages(customStages).map(s => ({ value: s, label: s })),
    { value: 'hired',     label: 'Hired' },
    { value: 'rejected',  label: 'Rejected' },
    { value: 'withdrawn', label: 'Withdrawn' },
  ]
}

function furthestStage(orderedStages, stages) {
  let last = null
  orderedStages.forEach(s => { if (stages[s]) last = s })
  return last
}

// What the dropdown should display: a terminal status wins; otherwise the
// pipeline's current-stage marker (furthest stage reached).
function dropdownValueFor(status, stages = {}, customStages = []) {
  if (TERMINAL_STATUSES.includes(status)) return status
  return furthestStage(getEffectiveStages(customStages), stages) || 'none'
}

// Apply a dropdown selection to the pipeline: backfill up to the chosen stage,
// clear everything past it (so the marker moves in both directions), and derive
// the coarse status. Picking a stage on a rejected/withdrawn job revives it.
function applySelection(val, stages = {}, customStages = []) {
  const ordered = getEffectiveStages(customStages)
  if (val === 'none') {
    // A true reset: the card's identity derives from the furthest reached
    // stage, so keeping any stamp (even CV Submitted) would make the card
    // read as that stage and leave "Not Applied" unreachable.
    return { status: 'none', stages: {} }
  }
  if (val === 'hired') return { status: 'hired', stages: markStageReached(ordered, stages, ordered[ordered.length - 1]) }
  if (val === 'rejected' || val === 'withdrawn') return { status: val, stages } // terminal: keep history
  const idx = ordered.indexOf(val)
  if (idx === -1) return { status: statusForStages(stages, 'none'), stages }
  const updated = {}
  for (let i = 0; i <= idx; i++) {
    // Mark reached without inventing a date; any date the user already set is kept.
    updated[ordered[i]] = stages[ordered[i]] || STAGE_REACHED
  }
  return { status: statusForStages(updated, 'none'), stages: updated }
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

export default function TrackerCard({ job, onUpdate, onDelete, highlight = false }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)

  // When navigated to from the calendar, open the card so its details are visible
  useEffect(() => {
    if (highlight) setExpanded(true)
  }, [highlight])
  const [draft, setDraft] = useState(null)
  const [newNote, setNewNote] = useState('')
  const [newTask, setNewTask] = useState('')
  const [saving, setSaving] = useState(false)

  const startEdit = () => {
    // Migrate legacy extra_dates: "Interview Date" now lives on the Interview
    // stage itself, and "Technical Task Due" was retired.
    const stages = { ...(job.stages || {}) }
    const extraDates = { ...(job.extra_dates || {}) }
    if (extraDates['Interview Date'] && !stages['Interview']) {
      stages['Interview'] = extraDates['Interview Date']
    }
    delete extraDates['Interview Date']
    delete extraDates['Technical Task Due']

    setDraft({
      status: job.status || 'none',
      applied_date: job.applied_date || '',
      stages,
      notes: [...(job.notes || [])],
      tasks: [...(job.tasks || [])],
      research: job.research || '',
      description: job.description || '',
      salary_raw: job.salary_raw || '',
      company: job.company || '',
      location: job.location || '',
      url: job.url || '',
      extra_dates: extraDates,
      custom_stages: [...(job.custom_stages || [])],
      stage_details: { ...(job.stage_details || {}) },
    })
    setEditing(true)
    setExpanded(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const before = currentStageOf(job)
      const after = currentStageOf(draft)
      const payload = before === after
        ? draft
        : { ...draft, notes: [stageChangeNote(after), ...(draft.notes || [])] }
      await onUpdate(job.id, payload)
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

  const updateNote = (idx, text) => {
    setDraft(d => {
      const notes = [...(d.notes || [])]
      notes[idx] = { ...notes[idx], text }
      return { ...d, notes }
    })
  }

  const removeNote = (idx) => {
    setDraft(d => ({ ...d, notes: (d.notes || []).filter((_, i) => i !== idx) }))
  }

  const setStageDetail = (stage, text) => {
    setDraft(d => ({ ...d, stage_details: { ...d.stage_details, [stage]: text || undefined } }))
  }

  // Set a stage's date (and optional time) from the Key Dates section,
  // keeping the top-level status in sync just like the pipeline bubbles do.
  const setStageDate = (stage, value) => {
    setDraft(d => {
      const stages = { ...d.stages }
      if (value) stages[stage] = value
      // Clearing a date must not roll the pipeline back — a reached stage stays
      // reached, it just loses its key date. Use the bubbles to un-reach a stage.
      else if (stages[stage]) stages[stage] = STAGE_REACHED
      return { ...d, stages, status: statusForStages(stages, d.status) }
    })
  }

  // Quick selection (not in edit mode) — dropdown drives the pipeline directly.
  const quickSelect = async (val) => {
    const next = applySelection(val, job.stages || {}, job.custom_stages || [])
    const after = currentStageOf({ ...job, ...next })
    if (currentStageOf(job) !== after) next.notes = [stageChangeNote(after), ...(job.notes || [])]
    await onUpdate(job.id, next)
  }

  const data = editing ? draft : job
  const stageCount = Object.keys(job.stages || {}).length
  const taskCount = (job.tasks || []).length
  const noteCount = (job.notes || []).length

  // Closed-out applications recede visually. Driven off `data` (the draft while
  // editing) so the muting lifts the instant a status leaves rejected/withdrawn.
  const closed = data.status === 'rejected' || data.status === 'withdrawn'
  const cardClass = [editing && 'edit-glow', closed && 'card-closed'].filter(Boolean).join(' ')

  return (
    <div id={`tracker-job-${job.id}`} className={cardClass || undefined} style={{
      background: 'var(--surface)',
      border: `1px solid ${highlight ? 'var(--accent)' : 'var(--border)'}`,
      borderLeft: `3px solid ${stageColor(data)}`,
      borderRadius: 8, marginBottom: 10,
      overflow: 'hidden',
      boxShadow: highlight ? '0 0 0 2px var(--accent-dim), 0 0 24px rgba(0,229,160,0.25)' : 'none',
      transition: 'box-shadow 0.3s, border-color 0.3s',
      '--glow-color': stageColor(data),
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
          {/* Upcoming key dates — always visible so nothing sneaks up on you */}
          {upcomingDates(job).length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {upcomingDates(job).map(it => (
                <span key={it.label} style={{
                  fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 700,
                  padding: '3px 8px', borderRadius: 4,
                  background: 'var(--accent-dim)', border: '1px solid var(--accent)',
                  color: 'var(--accent)',
                }}>
                  ⏳ {it.label}: {formatUpcoming(it.value)}
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
          <select
            value={dropdownValueFor(data.status, data.stages || {}, data.custom_stages || [])}
            onChange={e => {
              const val = e.target.value
              if (editing) {
                setDraft(d => ({ ...d, ...applySelection(val, d.stages, d.custom_stages) }))
              } else {
                quickSelect(val)
              }
            }}
            style={{
              background: 'var(--surface2)', border: '1px solid var(--border)',
              color: 'var(--text)', padding: '5px 8px', borderRadius: 6,
              fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer',
              outline: 'none',
            }}
          >
            {stageDropdownOptions(data.custom_stages || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
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

          {/* Key dates — only the actionable ones are editable here (calls,
              interviews, final round, offer deadline, plus Decision/Start).
              Historic progression dates (CV Submitted, Applied, Negotiation) are
              stamped automatically when a stage is selected and stay read-only. */}
          {editing && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
                Key Dates
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                {getEffectiveStages(draft.custom_stages).filter(isActionStage).map(stage => {
                  const [datePart = '', timePart = ''] = (stageDate(draft.stages?.[stage]) || '').split('T')
                  return (
                    <div key={stage}>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', marginBottom: 4, textTransform: 'uppercase' }}>{stage}</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          type="date"
                          value={datePart}
                          onChange={e => {
                            const nd = e.target.value
                            setStageDate(stage, nd ? (timePart ? `${nd}T${timePart}` : nd) : '')
                          }}
                          style={{ flex: 1, minWidth: 0, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 10, outline: 'none' }}
                        />
                        {stageSupportsTime(stage) && (
                          <input
                            type="time"
                            value={timePart}
                            disabled={!datePart}
                            title={datePart ? 'Time (optional)' : 'Set a date first'}
                            onChange={e => setStageDate(stage, e.target.value ? `${datePart}T${e.target.value}` : datePart)}
                            style={{ width: 74, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 6px', borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 10, outline: 'none', opacity: datePart ? 1 : 0.4 }}
                          />
                        )}
                      </div>
                    </div>
                  )
                })}
                {['Decision Date', 'Start Date'].map(key => (
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
                  value={dropdownValueFor(draft.status, draft.stages, draft.custom_stages)}
                  onChange={e => setDraft(d => ({ ...d, ...applySelection(e.target.value, d.stages, d.custom_stages) }))}
                  style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 10px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 11, outline: 'none' }}
                >
                  {stageDropdownOptions(draft.custom_stages).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
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
                  ref={autoGrow}
                  onInput={e => autoGrow(e.target)}
                  style={{ width: '100%', minHeight: 120, maxHeight: 420, overflowY: 'auto', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: 10, borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', outline: 'none' }}
                />
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7, background: 'var(--surface2)', padding: 12, borderRadius: 6, whiteSpace: 'pre-wrap', maxHeight: 420, overflowY: 'auto' }}>
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
                    {editing ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <textarea
                          value={note.text}
                          onChange={e => updateNote(i, e.target.value)}
                          rows={Math.max(1, Math.ceil((note.text || '').length / 90))}
                          style={{ flex: 1, background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text2)', padding: '5px 8px', borderRadius: 4, fontFamily: 'inherit', fontSize: 12, resize: 'vertical', outline: 'none' }}
                        />
                        <button onClick={() => removeNote(i)} title="Delete note"
                          style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12, padding: '4px' }}>✕</button>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--text2)' }}>{note.text}</div>
                    )}
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

          {/* Per-round detail notes — what to expect, format, interviewers.
              Editable for every scheduled round; in read mode only rounds with
              something recorded are shown. */}
          {(() => {
            const rounds = getEffectiveStages(data.custom_stages || []).filter(isActionStage)
            const shown = editing ? rounds : rounds.filter(r => (data.stage_details || {})[r] || stageDate(data.stages?.[r]))
            if (shown.length === 0) return null
            return (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                  Interview Details
                </div>
                {shown.map(round => {
                  const when = stageDate(data.stages?.[round])
                  return (
                    <div key={round} style={{ marginBottom: 8, background: 'var(--surface2)', borderRadius: 6, padding: '8px 10px', borderLeft: `2px solid ${stageColorFor(round)}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{round}</span>
                        {when && (
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent3)' }}>{when.replace('T', ' · ')}</span>
                        )}
                      </div>
                      {editing ? (
                        <textarea
                          value={draft.stage_details?.[round] || ''}
                          onChange={e => setStageDetail(round, e.target.value)}
                          placeholder="Format, interviewers, what to expect, prep notes..."
                          rows={2}
                          style={{ width: '100%', background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text2)', padding: '6px 8px', borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 11, resize: 'vertical', outline: 'none' }}
                        />
                      ) : (
                        (data.stage_details || {})[round] && (
                          <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                            {data.stage_details[round]}
                          </div>
                        )
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {/* Key dates display (read mode): scheduled stages (with a time set)
              plus the extra dates. Legacy keys retired from editing are hidden. */}
          {!editing && (() => {
            const scheduled = Object.entries(job.stages || {}).filter(([, v]) => (v || '').includes('T'))
            const extras = Object.entries(job.extra_dates || {})
              .filter(([k, v]) => v && k !== 'Interview Date' && k !== 'Technical Task Due')
            if (scheduled.length === 0 && extras.length === 0) return null
            return (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Key Dates</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[...scheduled, ...extras].map(([k, v]) => (
                    <div key={k} style={{ fontSize: 11, fontFamily: 'var(--mono)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px' }}>
                      <span style={{ color: 'var(--text3)' }}>{k}: </span>
                      <span style={{ color: 'var(--accent3)' }}>{v.replace('T', ' · ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

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

// Grow a textarea with its content, up to a comfortable cap, then scroll.
// Used as both a ref callback (initial size on entering edit mode) and an
// onInput handler (resize while typing).
function autoGrow(el) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight + 2, 420) + 'px'
}

// Actionable dated items on this job (calls/interviews/final rounds/offers plus
// extra dates) that are today or later, soonest first — shown in the card header
// so upcoming actions are always visible. Progression markers (Applied, etc.)
// are history and stay out.
function upcomingDates(job) {
  const now = new Date()
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const items = []
  Object.entries(job.stages || {}).forEach(([label, v]) => {
    if (stageDate(v) && isActionStage(label)) items.push({ label, value: v })
  })
  Object.entries(job.extra_dates || {}).forEach(([label, v]) => {
    if (v && label !== 'Interview Date' && label !== 'Technical Task Due') items.push({ label, value: v })
  })
  return items
    .filter(it => it.value.split('T')[0] >= todayKey)
    .sort((a, b) => a.value.localeCompare(b.value))
    .slice(0, 3)
}

function formatUpcoming(value) {
  const [date, time] = value.split('T')
  const [y, m, d] = date.split('-')
  const sameYear = y === String(new Date().getFullYear())
  return `${d}/${m}${sameYear ? '' : '/' + y.slice(2)}${time ? ' · ' + time : ''}`
}

// The stage identity a card is "at" right now: terminal status, else the
// furthest reached pipeline stage. Shared with the Tracker page for sorting.
export function currentStageOf(job) {
  return dropdownValueFor(job.status || 'none', job.stages || {}, job.custom_stages || [])
}

export function stageColor(job) {
  return stageColorFor(currentStageOf(job))
}

const STAGE_LABELS = { none: 'Not Applied', hired: 'Hired', rejected: 'Rejected', withdrawn: 'Withdrawn' }

// Stage changes used to be implicitly datestamped in `stages`; now that stage
// dates are user-only, the "when did this move" history lives in the activity
// log instead — audit data, deletable like any other note.
function stageChangeNote(stage) {
  return { text: `Stage → ${STAGE_LABELS[stage] || stage}`, date: new Date().toLocaleString() }
}
