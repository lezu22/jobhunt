import { Btn, Badge } from './UI.jsx'

export default function JobCard({ job, cvProfile, roleSearched, isTracked, duplicateCount, onTrack, onUntrack, onDelete }) {
  const salary = job.salary?.raw

  return (
    <div style={{
      background: 'var(--surface2)',
      border: `1px solid ${isTracked ? 'rgba(0,229,160,0.35)' : 'var(--border)'}`,
      borderLeft: isTracked ? '3px solid var(--accent)' : '1px solid var(--border)',
      borderRadius: 8, padding: 16, marginBottom: 8,
      transition: 'border-color 0.15s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>{job.title}</div>
          {job.company && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{job.company}</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          <span style={{
            fontSize: 10, fontFamily: 'var(--mono)', padding: '2px 7px',
            borderRadius: 3, background: 'rgba(109,74,255,0.2)', color: '#a78bfa',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>{cvProfile}</span>
          {duplicateCount > 1 && (
            <span
              title={`This same job matched ${duplicateCount} different role searches, so it's listed ${duplicateCount} times. Tracking or deleting it affects every listing at once.`}
              style={{
                fontSize: 9, fontFamily: 'var(--mono)', padding: '2px 7px',
                borderRadius: 3, background: 'rgba(245,158,11,0.15)', color: 'var(--accent3)',
                textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'help',
              }}
            >listed ×{duplicateCount}</span>
          )}
          {isTracked && <Badge status="applied" />}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: job.description ? 8 : 0, alignItems: 'center' }}>
        <span style={{
          fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)',
          border: '1px solid var(--border)', padding: '2px 7px', borderRadius: 4,
        }}>{job.source}</span>
        {salary && (
          <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--accent3)' }}>
            💰 {salary}
          </span>
        )}
        {job.location && (
          <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>📍 {job.location}</span>
        )}
      </div>

      {job.description && (
        <div style={{
          fontSize: 12, color: 'var(--text2)', lineHeight: 1.65,
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
          overflow: 'hidden', marginBottom: 10,
        }}>
          {job.description}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        {job.url && (
          <a href={job.url} target="_blank" rel="noopener noreferrer"
            style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)' }}>
            ↗ View posting
          </a>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, alignItems: 'center' }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
            fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700,
            color: isTracked ? 'var(--accent)' : 'var(--text2)',
          }}>
            <input
              type="checkbox"
              checked={isTracked}
              onChange={() => isTracked ? onUntrack(job.id) : onTrack(job, cvProfile, roleSearched)}
              style={{ cursor: 'pointer', width: 14, height: 14, accentColor: 'var(--accent)' }}
            />
            Tracked
          </label>
          <Btn variant="danger" size="sm" onClick={() => onDelete(job)}>Delete</Btn>
        </div>
      </div>
    </div>
  )
}
