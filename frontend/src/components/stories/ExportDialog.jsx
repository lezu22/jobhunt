import { useEffect, useState } from 'react'
import { api } from '../../api.js'
import { Btn, Modal } from '../UI.jsx'

// Accent-green export dialog — deliberately the visual opposite of the red
// bulk-delete dialog that launches from the same toolbar (D20). The filename
// is shown in an editable field and nothing downloads until confirmed (Q3).
export default function ExportDialog({ open, onClose, ids, defaultMetadata, summary, singleTitle, onDone }) {
  const [filename, setFilename] = useState('')
  const [includeMetadata, setIncludeMetadata] = useState(defaultMetadata)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setIncludeMetadata(defaultMetadata)
    setError(null)
    setFilename(singleTitle
      ? `${singleTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'story'}.md`
      : `work-stories-${new Date().toISOString().slice(0, 10)}.md`)
  }, [open])

  const run = async () => {
    setWorking(true)
    setError(null)
    try {
      const res = await api.exportStories(ids, includeMetadata, filename.trim() || undefined)
      const blob = new Blob([res.markdown], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.filename
      a.click()
      URL.revokeObjectURL(url)
      onClose()
      onDone?.(res)
    } catch (e) {
      setError(e.message.replace(/^\d+: /, '').replace(/.*"detail":"([^"]+)".*/, '$1'))
    } finally {
      setWorking(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={<span style={{ color: 'var(--accent)' }}>⇓ Export {summary}</span>}
      width={480}
    >
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
          Filename
        </div>
        <input
          value={filename}
          onChange={e => setFilename(e.target.value)}
          style={{
            width: '100%', background: 'var(--surface2)', border: '1px solid var(--accent)',
            color: 'var(--text)', padding: '9px 12px', borderRadius: 6,
            fontSize: 12, fontFamily: 'var(--mono)', outline: 'none',
          }}
        />
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--text2)', cursor: 'pointer', marginBottom: 16, lineHeight: 1.5 }}>
        <input
          type="checkbox"
          checked={includeMetadata}
          onChange={e => setIncludeMetadata(e.target.checked)}
          style={{ accentColor: 'var(--accent)', marginTop: 2 }}
        />
        <span>
          Include metadata comments (invisible in rendered markdown; lets a re-import
          recognise each record by id and carry status/NDA/labels/job links back in)
        </span>
      </label>
      {error && (
        <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>⚠ {error}</div>
      )}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={run} disabled={working || !filename.trim()}>
          {working ? 'Exporting…' : 'Export'}
        </Btn>
      </div>
    </Modal>
  )
}
