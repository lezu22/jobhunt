import { useState } from 'react'
import { Btn } from '../UI.jsx'

const SCORES = [
  { value: '', label: '–' },
  ...[0, 1, 2, 3, 4, 5].map(n => ({ value: String(n), label: `${n}/5` })),
]

const inputStyle = {
  background: 'var(--surface2)', border: '1px solid var(--border)',
  color: 'var(--text)', padding: '7px 10px', borderRadius: 6,
  fontSize: 12, outline: 'none', width: '100%',
}

const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim()

const wordSet = (s) => new Set(norm(s).replace(/[^\w\s]/g, '').split(' ').filter(Boolean))

// Overlap coefficient on word sets — same idea as the backend's import
// similarity, cheap enough to run per keystroke on a few dozen questions.
const overlap = (a, b) => {
  if (!a.size || !b.size) return 0
  let inter = 0
  a.forEach(w => { if (b.has(w)) inter += 1 })
  return inter / Math.min(a.size, b.size)
}

// The nearest existing question a typed one seems to duplicate (ignoring an
// exact match, which IS deliberate reuse).
const nearMatch = (text, known) => {
  const t = norm(text)
  if (t.length < 8) return null
  const ws = wordSet(text)
  let best = null
  for (const q of known) {
    if (norm(q.question) === t && q.question === text.trim()) continue  // already identical
    const s = norm(q.question) === t ? 1 : overlap(ws, wordSet(q.question))
    if (s >= 0.8 && (!best || s > best.s)) best = { ...q, s }
  }
  return best && best.question !== text ? best : null
}

// Add/remove/reorder repeater for question mappings. Pure controlled
// component: edits go through onChange, persistence is the caller's problem
// (it lives in the draft buffer until an explicit save).
// `knownQuestions` powers "pick existing" and duplicate-wording detection so
// the same question keeps identical text across stories.
export default function MappingsEditor({ mappings, onChange, knownQuestions = [] }) {
  const [pickerFor, setPickerFor] = useState(null)  // row index | null
  const [pickerFilter, setPickerFilter] = useState('')

  const update = (i, field, value) => {
    const next = mappings.map((m, j) => (j === i ? { ...m, [field]: value } : m))
    onChange(next)
  }
  const move = (i, delta) => {
    const j = i + delta
    if (j < 0 || j >= mappings.length) return
    const next = [...mappings]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const remove = (i) => onChange(mappings.filter((_, j) => j !== i))
  const add = () => onChange([...mappings, { question: '', score: null, note: '' }])

  const openPicker = (i) => {
    setPickerFilter('')
    setPickerFor(pickerFor === i ? null : i)
  }
  const pick = (i, q) => {
    update(i, 'question', q.question)
    setPickerFor(null)
  }

  const pickerRows = knownQuestions.filter(q =>
    !pickerFilter.trim() || norm(q.question).includes(norm(pickerFilter)))

  return (
    <div>
      {mappings.map((m, i) => {
        const dup = nearMatch(m.question, knownQuestions)
        return (
          <div key={i} style={{
            background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '8px 10px', marginBottom: 6,
          }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span onClick={() => move(i, -1)}
                      style={{ cursor: i > 0 ? 'pointer' : 'default', opacity: i > 0 ? 0.6 : 0.15, fontSize: 9, fontFamily: 'var(--mono)', lineHeight: 1 }}>▲</span>
                <span onClick={() => move(i, +1)}
                      style={{ cursor: i < mappings.length - 1 ? 'pointer' : 'default', opacity: i < mappings.length - 1 ? 0.6 : 0.15, fontSize: 9, fontFamily: 'var(--mono)', lineHeight: 1 }}>▼</span>
              </div>
              <input
                value={m.question}
                onChange={e => update(i, 'question', e.target.value)}
                placeholder="Interview question this story answers…"
                style={{ ...inputStyle, flex: 3, background: 'var(--surface)', minWidth: 160 }}
              />
              {knownQuestions.length > 0 && (
                <Btn size="sm" variant={pickerFor === i ? 'primary' : 'ghost'} onClick={() => openPicker(i)}>
                  {pickerFor === i ? '▴ existing' : '▾ existing'}
                </Btn>
              )}
              <select
                value={m.score == null ? '' : String(m.score)}
                onChange={e => update(i, 'score', e.target.value === '' ? null : Number(e.target.value))}
                title="Score"
                style={{ ...inputStyle, width: 70, flex: 'none', fontFamily: 'var(--mono)', background: 'var(--surface)' }}
              >
                {SCORES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <input
                value={m.note || ''}
                onChange={e => update(i, 'note', e.target.value)}
                placeholder="note"
                style={{ ...inputStyle, flex: 2, background: 'var(--surface)', minWidth: 90 }}
              />
              <span onClick={() => remove(i)} title="Remove mapping"
                    style={{ cursor: 'pointer', color: 'var(--danger)', fontFamily: 'var(--mono)', fontSize: 12, opacity: 0.7 }}>✕</span>
            </div>

            {/* styled picker: search + rows, replaces the unthemable native datalist */}
            {pickerFor === i && (
              <div style={{
                marginTop: 8, border: '1px solid var(--border2)', borderRadius: 6,
                background: 'var(--surface)', overflow: 'hidden',
              }}>
                <input
                  autoFocus
                  value={pickerFilter}
                  onChange={e => setPickerFilter(e.target.value)}
                  placeholder="Filter existing questions…"
                  style={{ ...inputStyle, border: 'none', borderBottom: '1px solid var(--border)', borderRadius: 0 }}
                />
                <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {pickerRows.length === 0 && (
                    <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>
                      No existing question matches.
                    </div>
                  )}
                  {pickerRows.map(q => (
                    <div key={q.question}
                         onClick={() => pick(i, q)}
                         style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                         onMouseEnter={e => e.currentTarget.style.background = 'var(--surface3)'}
                         onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <span style={{ fontSize: 12, flex: 1 }}>{q.question}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>
                        used {q.uses}×{q.best_score != null ? ` · best ${q.best_score}/5` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* typed wording nearly matches an existing question → offer to merge */}
            {dup && pickerFor !== i && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 7, fontSize: 11, color: 'var(--accent3)', flexWrap: 'wrap' }}>
                ◎ close to existing “{dup.question}” (used {dup.uses}×)
                <span onClick={() => update(i, 'question', dup.question)}
                      style={{ color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'var(--mono)', fontSize: 10 }}>
                  use existing wording
                </span>
                <span style={{ color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 10 }}>or keep typing to keep yours</span>
              </div>
            )}
          </div>
        )
      })}
      <Btn variant="ghost" size="sm" onClick={add}>+ add question mapping</Btn>
    </div>
  )
}
