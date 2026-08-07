import { NavLink } from 'react-router-dom'

const NAV = [
  { path: '/', label: 'Dashboard', icon: '⬡' },
  { path: '/config', label: 'Search Config', icon: '◈' },
  { path: '/urls', label: 'Target URLs', icon: '⬡' },
  { path: '/scrape', label: 'Run Scraper', icon: '▷' },
  { path: '/results', label: 'Results', icon: '◫' },
  { path: '/tracker', label: 'Tracker', icon: '◉' },
]

export default function Sidebar({ stats }) {
  return (
    <aside style={{
      width: 210,
      minWidth: 210,
      background: 'var(--surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      position: 'sticky',
      top: 0,
    }}>
      <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--accent)', textTransform: 'uppercase' }}>
          // jobhunt
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginTop: 3, letterSpacing: '0.06em' }}>
          command centre
        </div>
      </div>

      <nav style={{ flex: 1, padding: '12px 0' }}>
        {NAV.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 20px',
              fontSize: 13,
              fontWeight: 600,
              color: isActive ? 'var(--accent)' : 'var(--text2)',
              background: isActive ? 'var(--accent-dim)' : 'transparent',
              borderLeft: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
              textDecoration: 'none',
              transition: 'var(--transition)',
              letterSpacing: '0.02em',
            })}
          >
            <span style={{ fontFamily: 'var(--mono)', fontSize: 14, lineHeight: 1 }}>{item.icon}</span>
            {item.label}
            {item.path === '/results' && stats?.results_count > 0 && (
              <span style={{ marginLeft: 'auto', background: 'var(--accent2)', color: '#fff', fontSize: 10, padding: '1px 6px', borderRadius: 10, fontFamily: 'var(--mono)' }}>
                {stats.results_count}
              </span>
            )}
            {item.path === '/tracker' && stats?.total > 0 && (
              <span style={{ marginLeft: 'auto', background: 'var(--accent2)', color: '#fff', fontSize: 10, padding: '1px 6px', borderRadius: 10, fontFamily: 'var(--mono)' }}>
                {stats.total}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
        {stats ? (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', lineHeight: 1.8 }}>
            <div>{stats.total || 0} tracked</div>
            <div>{stats.by_status?.applied || 0} applied</div>
            <div>{stats.by_status?.interview || 0} interviews</div>
            <div>{stats.by_status?.offer || 0} offers</div>
          </div>
        ) : (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>Loading...</div>
        )}
      </div>
    </aside>
  )
}
