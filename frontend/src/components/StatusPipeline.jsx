import { useState } from 'react'

const BASE_STAGES = ['CV Submitted', 'Applied', 'Discovery Call', 'Interview', 'Offer', 'Negotiation']

const STAGE_INFO = {
  'CV Submitted':   'CV / registration sent, awaiting response — before formally applying',
  'Applied':        'Application submitted',
  'Discovery Call': 'Intro / discovery call with recruiter or hiring manager',
  'Interview':      'First interview round — add further rounds with "+"',
  'Offer':          'Offer received',
  'Negotiation':    'Negotiating offer terms',
}

const ROUND_RE = /^Interview Round (\d+)$/

// `stages` carries two separate meanings per stage: WHETHER it was reached, and
// (optionally) the key date the user scheduled for it. Reaching a stage stores
// this sentinel rather than a date, so advancing a job never invents a key date
// — dates are only ever written when the user types one into Key Dates.
const STAGE_REACHED = 'reached'
const DATE_VALUE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/

// The user-set date for a stage value, or null when it's merely "reached".
function stageDate(value) {
  return DATE_VALUE_RE.test(value || '') ? value : null
}

// Per-stage accent colours — the single source for the card left-edge bar, the
// edit-mode glow, and the pipeline-overview diagram: a violet → indigo → blue
// → cyan → teal sweep that converges naturally on the theme's hired green, so
// a job visibly "warms up" as it advances. Rejected/withdrawn sit outside the
// progression.
const STAGE_COLORS = {
  none:             '#252538', // matches --border: visually "no stage yet"
  'CV Submitted':   '#8b5cf6', // violet — matches --accent2 family
  'Applied':        '#6366f1', // indigo
  'Discovery Call': '#3b82f6', // blue
  'Interview':      '#0ea5e9', // sky — every interview round shares this
  'Offer':          '#14b8a6', // teal
  'Negotiation':    '#10b981', // emerald
  hired:            '#00e5a0', // the accent green, fully arrived
  rejected:         '#ef4444',
  withdrawn:        '#4a4a66',
}

// Colour for a stage name in either form ("Hired" node labels or "hired"
// status values); interview rounds share the Interview colour.
function stageColorFor(stage) {
  if (ROUND_RE.test(stage)) return STAGE_COLORS['Interview']
  return STAGE_COLORS[stage] || STAGE_COLORS[String(stage).toLowerCase()] || STAGE_COLORS.none
}

// Stages that happen at a scheduled time of day, so their date can carry an
// optional "T HH:MM" component (stored as "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM").
function stageSupportsTime(stage) {
  return stage === 'Discovery Call' || stage === 'Interview' || ROUND_RE.test(stage)
}

// Stages whose date is an event you act on (a call or interview you attend) —
// these surface in the calendar, upcoming-date chips, and the Key Dates editor.
// The rest (CV Submitted, Applied, Offer, Negotiation) are historic progression
// markers stamped when the stage is selected; the actionable deadline that
// follows an offer is the "Decision Date" extra date, not the Offer stamp.
function isActionStage(stage) {
  return stageSupportsTime(stage)
}

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

// Extra interview rounds slot in right after "Interview" (which is round 1), so the number of
// rounds is entirely user-driven — there is no fixed "final" round.
function getEffectiveStages(customStages = []) {
  const idx = BASE_STAGES.indexOf('Interview')
  return [...BASE_STAGES.slice(0, idx + 1), ...customStages, ...BASE_STAGES.slice(idx + 1)]
}

// Marks `stage` reached and backfills every earlier stage (in `orderedStages`) that isn't reached yet,
// so progress always reads as continuous instead of skipping steps. Never touches a stage that already
// has a value, so a user-set key date is preserved.
function markStageReached(orderedStages, stages, stage, value = STAGE_REACHED) {
  const idx = orderedStages.indexOf(stage)
  const updated = { ...stages }
  for (let i = 0; i <= idx; i++) {
    if (!updated[orderedStages[i]]) updated[orderedStages[i]] = value
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
    const idx = STAGES.indexOf(stage)
    if (stages[stage]) {
      if (idx === lastReachedIdx) {
        // Clicking the current (furthest) stage steps back off it
        const updated = { ...stages }
        delete updated[stage]
        onChange(updated)
      } else {
        // Clicking an earlier stage reverts to it: it becomes the current
        // stage — everything after is cleared, gaps before it are backfilled
        const kept = {}
        STAGES.slice(0, idx + 1).forEach(s => { if (stages[s]) kept[s] = stages[s] })
        onChange(markStageReached(STAGES, kept, stage))
      }
    } else {
      onChange(markStageReached(STAGES, stages, stage))
    }
  }

  const addStage = () => {
    const name = nextRoundName(customStages)
    const newCustom = [...customStages, name]
    onCustomStagesChange(newCustom)

    // Retroactive insert: if the job is already past where this round sits,
    // stamp it as passed (using the previous reached stage's date) so the
    // pipeline stays continuous and the current-stage marker doesn't move.
    const ordered = getEffectiveStages(newCustom)
    const idx = ordered.indexOf(name)
    if (ordered.slice(idx + 1).some(s => stages[s])) {
      onChange({ ...stages, [name]: STAGE_REACHED })
    }
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
                    {stages[stage] && (
                      <div style={{ color: 'var(--accent)', fontSize: 9, marginTop: 2 }}>
                        {stageDate(stages[stage]) ? `✓ ${stages[stage].replace('T', ' · ')}` : '✓ reached — no date set'}
                      </div>
                    )}
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

    </div>
  )
}

export { BASE_STAGES, STAGE_INFO, STAGE_TO_STATUS, STAGE_COLORS, stageColorFor, markStageReached, getEffectiveStages, nextRoundName, ROUND_RE, stageSupportsTime, isActionStage, STAGE_REACHED, stageDate }
