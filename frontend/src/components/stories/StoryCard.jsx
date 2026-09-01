import { useState } from 'react'
import { Link } from 'react-router-dom'
import Markdown from './Markdown.jsx'

const KIND_STYLE = {
  story: { bg: 'rgba(109,74,255,0.25)', color: '#a78bfa', label: 'STORY' },
  note:  { bg: 'rgba(91,141,238,0.25)', color: '#7ba7f2', label: 'NOTE' },
}

const STATUS_STYLE = {
  draft: { bg: 'rgba(74,74,102,0.3)',   color: 'var(--text2)',  label: 'Draft' },
  gap:   { bg: 'rgba(245,158,11,0.25)', color: '#fbbf24',       label: 'Gap' },
  ready: { bg: 'rgba(0,229,160,0.25)',  color: 'var(--accent)', label: 'Ready' },
}

function Chip({ bg, color, children, title }) {
  return (
    <span title={title} style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)',
      letterSpacing: '0.05em', background: bg, color, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

export function scoreRangeText(story) {
  if (story.score_min == null) return null
  return story.score_min === story.score_max
    ? `${story.score_max}/5`
    : `${story.score_min}–${story.score_max}/5`
}

export default function StoryCard({ story, jobsById, onMoveUp, onMoveDown, selected, onSelect }) {
  const [expanded, setExpanded] = useState(false)
  const kind = KIND_STYLE[story.kind] || KIND_STYLE.story
  const status = STATUS_STYLE[story.status] || STATUS_STYLE.draft
  const range = scoreRangeText(story)

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', marginBottom: 8, overflow: 'hidden',
    }}>
      {/* Collapsed header row */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', cursor: 'pointer', userSelect: 'none',
        }}
      >
        {onSelect && (
          <span onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', margin: '-10px 0 -10px -4px', padding: '10px 2px 10px 4px' }}>
            <input
              type="checkbox"
              checked={selected}
              onChange={e => onSelect(e.target.checked)}
              title="Select for bulk actions"
              style={{ accentColor: 'var(--accent2)', width: 14, height: 14, cursor: 'pointer' }}
            />
          </span>
        )}
        {/* Whole zone swallows clicks so a near-miss never expands the card */}
        <div style={{ display: 'flex', flexDirection: 'column', margin: '-10px 0 -10px -8px', flexShrink: 0 }}
             onClick={e => e.stopPropagation()}>
          <span onClick={onMoveUp} title="Move up"
                style={{
                  cursor: onMoveUp ? 'pointer' : 'default', opacity: onMoveUp ? 0.7 : 0.15,
                  fontSize: 12, lineHeight: 1, fontFamily: 'var(--mono)',
                  padding: '8px 9px 5px', borderRadius: 4, userSelect: 'none',
                }}
                onMouseEnter={e => { if (onMoveUp) e.target.style.background = 'var(--surface3)' }}
                onMouseLeave={e => e.target.style.background = 'transparent'}>▲</span>
          <span onClick={onMoveDown} title="Move down"
                style={{
                  cursor: onMoveDown ? 'pointer' : 'default', opacity: onMoveDown ? 0.7 : 0.15,
                  fontSize: 12, lineHeight: 1, fontFamily: 'var(--mono)',
                  padding: '5px 9px 8px', borderRadius: 4, userSelect: 'none',
                }}
                onMouseEnter={e => { if (onMoveDown) e.target.style.background = 'var(--surface3)' }}
                onMouseLeave={e => e.target.style.background = 'transparent'}>▼</span>
        </div>
        <Chip bg={kind.bg} color={kind.color}>{kind.label}</Chip>
        <Link
          to={`/stories/${story.id}`}
          onClick={e => e.stopPropagation()}
          title="Open"
          style={{ fontWeight: 700, fontSize: 13, flexShrink: 1, minWidth: 0, color: 'var(--text)', textDecoration: 'none' }}
          onMouseEnter={e => e.target.style.color = 'var(--accent)'}
          onMouseLeave={e => e.target.style.color = 'var(--text)'}
        >
          {story.title}
        </Link>
        {story.nda_sensitive && (
          <Chip bg="rgba(245,158,11,0.2)" color="var(--accent3)" title="NDA sensitive">⚠ NDA</Chip>
        )}
        <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {story.labels.map(l => (
            <Chip key={l} bg="var(--surface3)" color="var(--text2)">{l}</Chip>
          ))}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {range && (
            <span title="Question score range" style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent3)' }}>
              ◆ {range}
            </span>
          )}
          {story.job_ids.length > 0 && (
            <Chip bg="rgba(0,229,160,0.12)" color="var(--accent)"
                  title={story.job_ids.map(id => jobsById[id] || id).join('\n')}>
              ⛓ {story.job_ids.length} job{story.job_ids.length > 1 ? 's' : ''}
            </Chip>
          )}
          <Chip bg={status.bg} color={status.color}>{status.label}</Chip>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)' }}>
            {expanded ? '▾' : '▸'}
          </span>
        </span>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '14px 16px 16px 34px' }}>
          <Markdown>{story.body}</Markdown>

          {story.mappings.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{
                fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
                letterSpacing: '0.1em', textTransform: 'uppercase',
                color: 'var(--text3)', marginBottom: 8,
              }}>
                Question mappings
              </div>
              {story.mappings.map(m => (
                <div key={m.id} style={{
                  display: 'flex', alignItems: 'baseline', gap: 10,
                  padding: '7px 10px', marginBottom: 4,
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  borderRadius: 6, fontSize: 12,
                }}>
                  <span style={{
                    fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, flexShrink: 0,
                    color: m.score == null ? 'var(--text3)'
                      : m.score >= 4 ? 'var(--accent)'
                      : m.score >= 2 ? 'var(--accent3)' : 'var(--danger)',
                  }}>
                    {m.score == null ? '–/5' : `${m.score}/5`}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    “{m.question}”
                    {m.note && (
                      <span style={{ color: 'var(--text3)', marginLeft: 6 }}>({m.note})</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {story.job_ids.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Linked jobs:
              </span>
              {story.job_ids.map(id => (
                <Chip key={id} bg="rgba(0,229,160,0.12)" color="var(--accent)">
                  {jobsById[id] || id}
                </Chip>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
