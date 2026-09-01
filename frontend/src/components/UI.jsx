// Shared UI components
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export function Btn({ children, variant = 'primary', size = 'md', onClick, disabled, style = {} }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    border: 'none', borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'var(--mono)', fontWeight: 700, letterSpacing: '0.06em',
    textTransform: 'uppercase', transition: 'var(--transition)',
    opacity: disabled ? 0.5 : 1,
    fontSize: size === 'sm' ? 10 : 12,
    padding: size === 'sm' ? '5px 10px' : size === 'lg' ? '12px 22px' : '9px 16px',
  }
  const variants = {
    primary: { background: 'var(--accent)', color: '#000' },
    secondary: { background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)' },
    danger: { background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)' },
    ghost: { background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)' },
  }
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...style }}>
      {children}
    </button>
  )
}

export function Input({ label, value, onChange, placeholder, type = 'text', style = {} }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <Label>{label}</Label>}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          padding: '9px 12px',
          borderRadius: 6,
          fontSize: 12,
          outline: 'none',
          ...style,
        }}
        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
        onBlur={e => e.target.style.borderColor = 'var(--border)'}
      />
    </div>
  )
}

export function Select({ label, value, onChange, options, style = {} }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <Label>{label}</Label>}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%',
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          padding: '9px 12px',
          borderRadius: 6,
          fontSize: 12,
          outline: 'none',
          ...style,
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

export function Label({ children }) {
  return (
    <div style={{
      fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.1em', textTransform: 'uppercase',
      color: 'var(--text3)', marginBottom: 6,
    }}>
      {children}
    </div>
  )
}

export function Card({ children, style = {} }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: 20,
      ...style,
    }}>
      {children}
    </div>
  )
}

export function SectionTitle({ children }) {
  return (
    <div style={{
      fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.12em', textTransform: 'uppercase',
      color: 'var(--text3)', marginBottom: 14,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      {children}
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  )
}

export function Badge({ status }) {
  const map = {
    none:         { bg: 'rgba(74,74,102,0.3)',   color: 'var(--text3)',  label: '–' },
    cv_submitted: { bg: 'rgba(91,141,238,0.25)', color: '#7ba7f2',       label: 'CV Submitted' },
    applied:      { bg: 'rgba(109,74,255,0.25)', color: '#a78bfa',       label: 'Applied' },
    interview:    { bg: 'rgba(245,158,11,0.25)', color: '#fbbf24',       label: 'Interview' },
    offer:        { bg: 'rgba(0,229,160,0.25)',  color: 'var(--accent)', label: 'Offer' },
    negotiating:  { bg: 'rgba(0,192,144,0.25)',  color: '#3ddba8',       label: 'Negotiating' },
    hired:        { bg: 'rgba(0,229,160,0.35)',  color: 'var(--accent)', label: 'Hired' },
    rejected:     { bg: 'rgba(239,68,68,0.2)',   color: '#f87171',       label: 'Rejected' },
    withdrawn:    { bg: 'rgba(74,74,102,0.2)',   color: 'var(--text3)',  label: 'Withdrawn' },
    ghosted:      { bg: 'rgba(143,137,168,0.18)', color: '#a8a2c0',      label: 'Ghosted' },
  }
  const s = map[status] || map.none
  return (
    <span style={{
      display: 'inline-block', padding: '3px 9px', borderRadius: 4,
      fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)',
      letterSpacing: '0.06em', textTransform: 'uppercase',
      background: s.bg, color: s.color,
    }}>
      {s.label}
    </span>
  )
}

export function Spinner({ size = 18 }) {
  return (
    <div style={{
      width: size, height: size,
      border: `2px solid var(--border)`,
      borderTopColor: 'var(--accent)',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
    }} />
  )
}

export function Modal({ open, onClose, title, children, width = 560 }) {
  if (!open) return null
  // Rendered via portal directly into <body> — a position:fixed overlay nested inside an
  // animated ancestor (e.g. the page's .fade-up entrance transition) gets a containing block
  // other than the viewport, which silently mispositions it on tall pages. Escaping the DOM
  // tree entirely sidesteps that regardless of what ancestors do.
  return createPortal(
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 28, width, maxWidth: '95vw',
        maxHeight: '90vh', overflowY: 'auto',
        animation: 'fadeUp 0.2s ease',
      }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 20, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
          {title}
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}

export function Toast({ message, type = 'success', onClose, sticky }) {
  const color = type === 'error' ? 'var(--danger)' : type === 'warn' ? 'var(--accent3)' : 'var(--accent)'
  // Informational toasts hold 3s then fade over 2s; errors stay until
  // dismissed so a failure can't slip by unnoticed. ✕ always closes instantly.
  const stay = sticky ?? (type === 'error')
  const [fading, setFading] = useState(false)
  useEffect(() => {
    setFading(false)
    if (stay) return
    const hold = setTimeout(() => setFading(true), 3000)
    const gone = setTimeout(onClose, 5000)
    return () => { clearTimeout(hold); clearTimeout(gone) }
  }, [message, type, stay])
  // Portaled into <body> for the same reason as Modal: page content lives in
  // its own stacking context (z-index 1), so an in-tree toast would sit under
  // the modal overlay no matter how high its own z-index is.
  return createPortal(
    <div style={{
      opacity: fading ? 0 : 1,
      transition: 'opacity 2s ease',
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      background: 'var(--surface)', border: `1px solid ${color}`,
      borderRadius: 8, padding: '12px 18px',
      fontFamily: 'var(--mono)', fontSize: 12, color,
      boxShadow: `0 4px 24px rgba(0,0,0,0.4)`,
      animation: 'fadeUp 0.2s ease',
      display: 'flex', alignItems: 'center', gap: 10,
      maxWidth: 360,
    }}>
      {message}
      <span onClick={onClose} style={{ cursor: 'pointer', marginLeft: 'auto', opacity: 0.6 }}>✕</span>
    </div>,
    document.body
  )
}
