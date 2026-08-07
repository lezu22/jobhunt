import { useState } from 'react'

const BASE_STAGES = ['CV Submitted', 'Applied', 'Interview', 'Final Round', 'Offer', 'Negotiation']

const STAGE_INFO = {
  'CV Submitted': 'CV / registration sent, awaiting response — before formally applying',
  'Applied':      'Application submitted',
  'Interview':    'Main interview round',
  'Final Round':  'Final round / onsite',
  'Offer':        'Offer received',
  'Negotiation':  'Negotiating offer terms',
}

const ROUND_RE = /^Interview Round (\d+)$/

// The next auto-named round for a job that already has `customStages` interview rounds —
// standardized naming (not free text) so the same round means the same thing across every job,
// which is what lets the aggregate pipeline chart count them together.
function nextRoundName(customStages) {
  return `Interview Round ${customStages.length + 2}` // "Interview" itself is implicitly round 1
}

// Stages that also correspond to a top-level tracker `status` value, in progression order.
const STAGE_TO_STATUS = {
  'CV Submitted': 'cv_submitted',
  Applied:        'applied',
  Interview:      'interview',
  Offer:          'offer',
  Negotiation:    'negotiating',
}

// Custom interview rounds (e.g. "2nd Interview", "Panel Round") slot in right after "Interview" —
// same place "Final Round" already sits — so companies with more rounds than the default template aren't boxed in.
function getEffectiveStages(customStages = []) {
  const idx = BASE_STAGES.indexOf('Interview')
  return [...BASE_STAGES.slice(0, idx + 1), ...customStages, ...BASE_STAGES.slice(idx + 1)]
}

// Marks `stage` reached and backfills every earlier stage (in `orderedStages`) that isn't reached yet,
// so progress always reads as continuous instead of skipping steps.
function markStageReached(orderedStages, stages, stage, date = new Date().toISOString().split('T')[0]) {
  const idx = orderedStages.indexOf(stage)
  const updated = { ...stages }
  for (let i = 0; i <= idx; i++) {
    if (!updated[orderedStages[i]]) updated[orderedStages[i]] = date
  }
  return updated
}

export default function StatusPipeline({ stages = {}, customStages = [], onChange, onCustomStagesChange, readonly = false }) {
  const [hoveredStage, setHoveredStage] = useState(null)

  const STAGES = getEffectiveStages(customStages)
  const lastReachedIdx = STAGES.reduce((acc, s, i) => stages[s] ? i : acc, -1)
  const insertAfterIdx = BASE_STAGES.indexOf('Interview') + customStages.length // where the "+" control sits

  const toggleStage = (stage) => {
    if (readonly) return
    if (stages[stage]) {
      const updated = { ...stages }
      delete updated[stage]
      onChange(updated)
    } else {
      onChange(markStageReached(STAGES, stages, stage))
    }
  }

  const setDate = (stage, date) => {
    if (readonly) return
    const updated = { ...stages }
    if (date) updated[stage] = date
    else delete updated[stage]
    onChange(updated)
  }

  const addStage = () => {
    onCustomStagesChange([...customStages, nextRoundName(customStages)])
  }

  const removeStage = (stage) => {
    onCustomStagesChange(customStages.filter(s => s !== stage))
    if (stages[stage]) {
      const updated = { ...stages }
      delete updated[stage]
      onChange(updated)
    }
  }

  return (
    <div>
      {/* Visual pipeline */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 20, marginBottom: 16 }}>
        {STAGES.map((stage, i) => {
          const reached = !!stages[stage]
          const isCurrent = i === lastReachedIdx
          const isCustom = customStages.includes(stage)

          return (
            <div key={stage} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <div
                onClick={() => toggleStage(stage)}
                onMouseEnter={() => setHoveredStage(stage)}
                onMouseLeave={() => setHoveredStage(null)}
                data-stage={stage}
                style={{
                  position: 'relative',
                  width: 32, height: 32, borderRadius: '50%',
                  border: `2px solid ${isCurrent ? 'var(--accent)' : reached ? 'var(--accent)' : isCustom ? 'var(--accent2)' : 'var(--border)'}`,
                  background: isCurrent ? 'var(--accent)' : reached ? 'var(--accent-dim)' : 'var(--surface2)',
                  color: isCurrent ? '#000' : reached ? 'var(--accent)' : isCustom ? '#a78bfa' : 'var(--text3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: readonly ? 'default' : 'pointer',
                  fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 700,
                  transition: 'all 0.15s',
                  flexShrink: 0,
                  zIndex: 1,
                }}
              >
                {ROUND_RE.test(stage) ? `R${stage.match(ROUND_RE)[1]}` : stage.charAt(0)}
                {!readonly && isCustom && (
                  <button
                    onClick={e => { e.stopPropagation(); removeStage(stage) }}
                    title={`Remove "${stage}"`}
                    style={{
                      position: 'absolute', top: -6, right: -6, width: 14, height: 14, borderRadius: '50%',
                      background: 'var(--danger)', color: '#fff', border: '2px solid var(--surface)',
                      fontSize: 8, lineHeight: '10px', padding: 0, cursor: 'pointer', zIndex: 2,
                    }}
                  >✕</button>
                )}
                {hoveredStage === stage && (
                  <div style={{
                    position: 'absolute', bottom: '110%',
                    ...(i === 0 ? { left: 0 } : i === STAGES.length - 1 ? { right: 0 } : { left: '50%', transform: 'translateX(-50%)' }),
                    background: 'var(--surface3)', border: '1px solid var(--border)',
                    borderRadius: 4, padding: '6px 10px',
                    fontSize: 10, fontFamily: 'var(--mono)', whiteSpace: 'nowrap',
                    color: 'var(--text)', zIndex: 10,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                  }}>
                    <div style={{ fontWeight: 700 }}>{stage}{isCustom && ' (custom)'}</div>
                    <div style={{ color: 'var(--text2)', fontSize: 9, marginTop: 2 }}>{STAGE_INFO[stage] || 'Additional interview round'}</div>
                    {stages[stage] && <div style={{ color: 'var(--accent)', fontSize: 9, marginTop: 2 }}>✓ {stages[stage]}</div>}
                  </div>
                )}
              </div>
              {i < STAGES.length - 1 && (
                <div style={{
                  height: 2, width: 24, flexShrink: 0,
                  background: stages[STAGES[i + 1]] ? 'var(--accent)' : 'var(--border)',
                  transition: 'background 0.15s',
                }} />
              )}

              {/* Adds the next standardized "Interview Round N" — no typing, so the name is
                  consistent across every job and the aggregate chart can count it. */}
              {!readonly && i === insertAfterIdx && (
                <button
                  onClick={addStage}
                  title={`Add ${nextRoundName(customStages)}`}
                  style={{
                    width: 24, height: 24, borderRadius: '50%', flexShrink: 0, marginLeft: 6,
                    background: 'transparent', border: '1px dashed var(--border2)', color: 'var(--text3)',
                    fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >+</button>
              )}
            </div>
          )
        })}
      </div>

      {/* Stage labels + date inputs */}
      {!readonly && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
          {STAGES.map(stage => (
            <div key={stage}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {stage}
              </div>
              <input
                type="date"
                value={stages[stage] || ''}
                onChange={e => setDate(stage, e.target.value)}
                style={{
                  width: '100%', background: 'var(--surface2)',
                  border: '1px solid var(--border)', color: 'var(--text)',
                  padding: '5px 8px', borderRadius: 4,
                  fontFamily: 'var(--mono)', fontSize: 10,
                  outline: 'none',
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export { BASE_STAGES, STAGE_INFO, STAGE_TO_STATUS, markStageReached, getEffectiveStages, nextRoundName, ROUND_RE }
