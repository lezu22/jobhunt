import { useState } from 'react'

const KINDS = [{ value: 'story', label: 'Story' }, { value: 'note', label: 'Note' }]
const STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'gap', label: 'Gap' },
  { value: 'ready', label: 'Ready' },
]

const fieldStyle = {
  background: 'var(--surface2)', border: '1px solid var(--border)',
  color: 'var(--text)', padding: '6px 9px', borderRadius: 6,
  fontSize: 12, outline: 'none',
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

// Metadata chips: category, labels, status, NDA, kind, job links.
// In normal mode every change calls onCommit(field, value) IMMEDIATELY — the
// panel is visually labelled so the instant-save boundary is obvious, in
// contrast to the draft-buffered body/mappings below it.
export default function MetaPanel({ story, categories, jobs, immediate, onCommit }) {
  const [labelInput, setLabelInput] = useState('')

  const addLabel = () => {
    const v = labelInput.trim()
    if (!v) return
    if (!story.labels.some(l => l.toLowerCase() === v.toLowerCase())) {
      onCommit('labels', [...story.labels, v])
    }
    setLabelInput('')
  }

  return (
    <div style={{
      border: '1px solid var(--border2)', borderRadius: 'var(--radius)',
      background: 'var(--surface)', padding: '12px 14px', marginBottom: 18,
    }}>
      <div style={{
        fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
        letterSpacing: '0.12em', textTransform: 'uppercase',
        color: immediate ? 'var(--accent)' : 'var(--text3)', marginBottom: 10,
      }}>
        Metadata — {immediate ? 'changes save immediately (cancel below does not undo these)' : 'saved when the record is created'}
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <Field label="Kind">
          <select value={story.kind} onChange={e => onCommit('kind', e.target.value)} style={fieldStyle}>
            {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={story.status} onChange={e => onCommit('status', e.target.value)} style={fieldStyle}>
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Category">
          <select
            value={story.category_id == null ? '' : String(story.category_id)}
            onChange={e => onCommit('category_id', e.target.value === '' ? null : Number(e.target.value))}
            style={fieldStyle}
          >
            <option value="">Uncategorised</option>
            {categories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="NDA">
          <input
            type="checkbox"
            checked={story.nda_sensitive}
            onChange={e => onCommit('nda_sensitive', e.target.checked)}
            style={{ accentColor: 'var(--accent3)', width: 15, height: 15, cursor: 'pointer' }}
          />
        </Field>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
        <Field label="Labels">
          <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
            {story.labels.map(l => (
              <span key={l} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px',
                borderRadius: 4, fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)',
                background: 'var(--surface3)', color: 'var(--text2)',
              }}>
                {l}
                <span onClick={() => onCommit('labels', story.labels.filter(x => x !== l))}
                      style={{ cursor: 'pointer', opacity: 0.6 }}>✕</span>
              </span>
            ))}
            <input
              value={labelInput}
              onChange={e => setLabelInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLabel() } }}
              onBlur={addLabel}
              placeholder="+ label ⏎"
              style={{ ...fieldStyle, width: 90, padding: '4px 8px', fontSize: 11 }}
            />
          </span>
        </Field>
        <Field label="Jobs">
          <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
            {story.job_ids.map(id => {
              const j = jobs.find(x => x.id === id)
              return (
                <span key={id} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px',
                  borderRadius: 4, fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)',
                  background: 'rgba(0,229,160,0.12)', color: 'var(--accent)',
                }}>
                  {j ? (j.company ? `${j.title} @ ${j.company}` : j.title) : id}
                  <span onClick={() => onCommit('job_ids', story.job_ids.filter(x => x !== id))}
                        style={{ cursor: 'pointer', opacity: 0.6 }}>✕</span>
                </span>
              )
            })}
            <select
              value=""
              onChange={e => { if (e.target.value) onCommit('job_ids', [...story.job_ids, e.target.value]) }}
              style={{ ...fieldStyle, width: 130, padding: '4px 8px', fontSize: 11 }}
            >
              <option value="">+ link job…</option>
              {jobs.filter(j => !story.job_ids.includes(j.id)).map(j => (
                <option key={j.id} value={j.id}>
                  {j.company ? `${j.title} @ ${j.company}` : j.title}
                </option>
              ))}
            </select>
          </span>
        </Field>
      </div>
    </div>
  )
}
