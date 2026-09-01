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

// Add/remove/reorder repeater for question mappings. Pure controlled
// component: edits go through onChange, persistence is the caller's problem
// (it lives in the draft buffer until an explicit save).
// `knownQuestions` feeds a datalist so a question already used on another
// story can be picked instead of retyped — identical wording keeps search
// results grouped across stories.
export default function MappingsEditor({ mappings, onChange, knownQuestions = [] }) {
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

  return (
    <div>
      {knownQuestions.length > 0 && (
        <datalist id="known-questions">
          {knownQuestions.map(q => (
            <option key={q.question} value={q.question}
                    label={`used ${q.uses}×${q.best_score != null ? `, best ${q.best_score}/5` : ''}`} />
          ))}
        </datalist>
      )}
      {mappings.map((m, i) => (
        <div key={i} style={{
          display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6,
          background: 'var(--surface2)', border: '1px solid var(--border)',
          borderRadius: 6, padding: '8px 10px',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span onClick={() => move(i, -1)}
                  style={{ cursor: i > 0 ? 'pointer' : 'default', opacity: i > 0 ? 0.6 : 0.15, fontSize: 9, fontFamily: 'var(--mono)', lineHeight: 1 }}>▲</span>
            <span onClick={() => move(i, +1)}
                  style={{ cursor: i < mappings.length - 1 ? 'pointer' : 'default', opacity: i < mappings.length - 1 ? 0.6 : 0.15, fontSize: 9, fontFamily: 'var(--mono)', lineHeight: 1 }}>▼</span>
          </div>
          <input
            value={m.question}
            onChange={e => update(i, 'question', e.target.value)}
            placeholder="Interview question this story answers… (type to pick an existing one)"
            list="known-questions"
            style={{ ...inputStyle, flex: 3 }}
          />
          <select
            value={m.score == null ? '' : String(m.score)}
            onChange={e => update(i, 'score', e.target.value === '' ? null : Number(e.target.value))}
            title="Score"
            style={{ ...inputStyle, width: 70, flex: 'none', fontFamily: 'var(--mono)' }}
          >
            {SCORES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <input
            value={m.note || ''}
            onChange={e => update(i, 'note', e.target.value)}
            placeholder="note"
            style={{ ...inputStyle, flex: 2 }}
          />
          <span onClick={() => remove(i)} title="Remove mapping"
                style={{ cursor: 'pointer', color: 'var(--danger)', fontFamily: 'var(--mono)', fontSize: 12, opacity: 0.7 }}>✕</span>
        </div>
      ))}
      <Btn variant="ghost" size="sm" onClick={add}>+ add question mapping</Btn>
    </div>
  )
}
