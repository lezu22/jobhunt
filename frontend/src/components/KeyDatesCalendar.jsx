import { useMemo, useState } from 'react'
import { Card, SectionTitle, Modal } from './UI.jsx'
import { isActionStage } from './StatusPipeline.jsx'

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

// Retired extra_dates keys that may linger on old jobs — never shown.
const LEGACY_KEYS = ['Interview Date', 'Technical Task Due']

// Flatten actionable events on every job into {'YYYY-MM-DD': [event, ...]}.
// Only action stages (calls, interviews, final rounds, offers) and the extra
// dates count — progression markers like Applied are history, not actions.
// Stage values may carry a time ("YYYY-MM-DDTHH:MM"); extra dates never do.
function collectEvents(jobs) {
  const map = {}
  for (const job of jobs) {
    const push = (value, label) => {
      if (!value) return
      const [date, time] = value.split('T')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
      ;(map[date] = map[date] || []).push({
        jobId: job.id, title: job.title, company: job.company,
        label, time: time || null,
      })
    }
    Object.entries(job.stages || {}).forEach(([stage, v]) => {
      if (isActionStage(stage)) push(v, stage)
    })
    Object.entries(job.extra_dates || {}).forEach(([k, v]) => {
      if (!LEGACY_KEYS.includes(k)) push(v, k)
    })
  }
  // Timed events first (chronologically), then all-day ones
  Object.values(map).forEach(list => list.sort((a, b) =>
    (a.time || '99:99').localeCompare(b.time || '99:99') || a.label.localeCompare(b.label)
  ))
  return map
}

const pad2 = n => String(n).padStart(2, '0')

export default function KeyDatesCalendar({ jobs, onSelectJob }) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())   // 0-based
  const [selectedDay, setSelectedDay] = useState(null)   // 'YYYY-MM-DD'

  const events = useMemo(() => collectEvents(jobs), [jobs])

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1)
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const leadingBlanks = (new Date(year, month, 1).getDay() + 6) % 7  // Monday-first
  const todayKey = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`

  const cells = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const dayEvents = selectedDay ? (events[selectedDay] || []) : []
  const selectedLabel = selectedDay
    ? `${parseInt(selectedDay.slice(8), 10)} ${MONTHS[parseInt(selectedDay.slice(5, 7), 10) - 1]} ${selectedDay.slice(0, 4)}`
    : ''

  const navBtnStyle = {
    background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)',
    borderRadius: 6, padding: '4px 12px', cursor: 'pointer',
    fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700,
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <SectionTitle>key dates calendar</SectionTitle>
      <Card>
        {/* Month navigation */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <button onClick={prevMonth} style={navBtnStyle} title="Previous month">‹</button>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.04em' }}>
            {MONTHS[month]} {year}
          </div>
          <button onClick={nextMonth} style={navBtnStyle} title="Next month">›</button>
        </div>

        {/* Weekday header */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(34px, 1fr))', gap: 4, marginBottom: 4 }}>
          {WEEKDAYS.map(d => (
            <div key={d} style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '2px 0' }}>
              {d}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(34px, 1fr))', gap: 4 }}>
          {cells.map((day, i) => {
            if (day === null) return <div key={`blank-${i}`} />
            const key = `${year}-${pad2(month + 1)}-${pad2(day)}`
            const count = (events[key] || []).length
            const isToday = key === todayKey
            return (
              <div
                key={key}
                onClick={() => count > 0 && setSelectedDay(key)}
                title={count > 0 ? `${count} key date${count > 1 ? 's' : ''}` : undefined}
                style={{
                  position: 'relative', minWidth: 34, minHeight: 44,
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start',
                  padding: '4px 6px', borderRadius: 6,
                  // Two independent, combinable signals — deliberately on
                  // separate properties so neither can overwrite the other:
                  //   "today"      -> translucent green FILL (0.45 alpha keeps
                  //                   the day number at ~5:1 contrast)
                  //   "has events" -> accent EDGE (+ the count badge)
                  // A day that is both gets fill, edge and badge together.
                  border: `1px solid ${count > 0 ? 'var(--accent)' : 'var(--border)'}`,
                  background: isToday
                    ? 'rgba(0, 229, 160, 0.45)'
                    : count > 0 ? 'var(--surface2)' : 'transparent',
                  cursor: count > 0 ? 'pointer' : 'default',
                  transition: 'background 0.15s, border-color 0.15s',
                }}
              >
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: isToday || count > 0 ? 'var(--text)' : 'var(--text3)', fontWeight: isToday || count > 0 ? 700 : 400 }}>
                  {day}
                </span>
                {count > 0 && (
                  <span style={{
                    position: 'absolute', top: 4, right: 4,
                    minWidth: 16, height: 16, padding: '0 3px', borderRadius: 8,
                    background: 'var(--accent)', color: '#000',
                    // Opaque fill plus a solid ring, so the badge reads as its own
                    // chip on a plain cell and on the green "today" fill alike.
                    boxShadow: '0 0 0 2px var(--surface)',
                    fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {count > 9 ? '9+' : count}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      {/* Day detail popover */}
      <Modal open={!!selectedDay} onClose={() => setSelectedDay(null)} title={selectedLabel} width={420}>
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {dayEvents.map((ev, i) => (
            <div
              key={i}
              onClick={() => { setSelectedDay(null); onSelectJob?.(ev.jobId) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 6, marginBottom: 6,
                background: 'var(--surface2)', border: '1px solid var(--border)',
                cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ev.title}{ev.company ? ` · ${ev.company}` : ''}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent3)', marginTop: 2 }}>
                  {ev.label}
                </div>
              </div>
              {ev.time && (
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>
                  {ev.time}
                </span>
              )}
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}
