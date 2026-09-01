import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { api } from '../api.js'
import { Btn, Modal, Spinner, Toast } from '../components/UI.jsx'
import Markdown from '../components/stories/Markdown.jsx'
import MappingsEditor from '../components/stories/MappingsEditor.jsx'
import MetaPanel from '../components/stories/MetaPanel.jsx'
import ExportDialog from '../components/stories/ExportDialog.jsx'

const draftKey = (id) => `story-draft-${id}`

const loadDraft = (id) => {
  try { return JSON.parse(sessionStorage.getItem(draftKey(id))) } catch { return null }
}
const storeDraft = (id, draft) => {
  try { sessionStorage.setItem(draftKey(id), JSON.stringify(draft)) } catch { /* full/blocked: draft just won't survive refresh */ }
}
const clearDraft = (id) => {
  try { sessionStorage.removeItem(draftKey(id)) } catch { /* ignore */ }
}

const NEW_DEFAULTS = (kind) => ({
  title: '', body: '', kind, category_id: null, status: 'draft',
  nda_sensitive: false, labels: [], job_ids: [], mappings: [],
})

// View + edit for one story/note, and create mode at /stories/new.
// Body, title and question mappings live in a sessionStorage draft buffer
// until an explicit save; metadata chips commit immediately (create mode is
// the exception: there is no record yet, everything goes with the POST).
export default function StoryView() {
  const { id } = useParams()
  const isNew = id === 'new'
  const [search] = useSearchParams()
  const navigate = useNavigate()

  const [story, setStory] = useState(null)      // server state (or staged meta in create mode)
  const [draft, setDraft] = useState(null)      // {title, body, mappings} while editing
  const [restored, setRestored] = useState(false)
  const [categories, setCategories] = useState([])
  const [jobs, setJobs] = useState([])
  const [knownQuestions, setKnownQuestions] = useState([])
  const [toast, setToast] = useState(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const editing = draft !== null

  useEffect(() => {
    api.getStoryCategories().then(setCategories).catch(() => {})
    api.getTracker().then(setJobs).catch(() => {})
    api.getKnownQuestions().then(setKnownQuestions).catch(() => {})
    const existing = loadDraft(isNew ? 'new' : id)
    if (isNew) {
      const meta = NEW_DEFAULTS(search.get('kind') === 'note' ? 'note' : 'story')
      setStory(meta)
      setDraft(existing || { title: '', body: '', mappings: [] })
      setRestored(!!existing)
      return
    }
    api.getStory(id)
      .then(s => {
        setStory(s)
        if (existing) {
          setDraft(existing)
          setRestored(true)
        }
      })
      .catch(e => setToast({ type: 'error', message: `Load failed: ${e.message}` }))
  }, [id])

  // persist the draft buffer on every keystroke; it dies with the tab
  useEffect(() => {
    if (editing) storeDraft(isNew ? 'new' : id, draft)
  }, [draft])

  const dirty = editing && (isNew
    ? (draft.title !== '' || draft.body !== '' || draft.mappings.length > 0)
    : (draft.title !== story?.title || draft.body !== story?.body ||
       JSON.stringify(draft.mappings.map(m => [m.question, m.score, m.note || null])) !==
       JSON.stringify(story?.mappings.map(m => [m.question, m.score, m.note || null]))))

  const startEdit = () => {
    setDraft({
      title: story.title,
      body: story.body,
      mappings: story.mappings.map(m => ({ question: m.question, score: m.score, note: m.note || '' })),
    })
    setRestored(false)
  }

  const stopEdit = () => {
    clearDraft(isNew ? 'new' : id)
    setDraft(null)
    setRestored(false)
    setConfirmDiscard(false)
    if (isNew) navigate('/stories')
  }

  const requestCancel = () => (dirty ? setConfirmDiscard(true) : stopEdit())

  const cleanMappings = (ms) => ms
    .filter(m => m.question.trim())
    .map(m => ({ question: m.question, score: m.score, note: m.note?.trim() ? m.note : null }))

  const save = async () => {
    setSaving(true)
    try {
      if (isNew) {
        const res = await api.createStory({
          ...story, title: draft.title, body: draft.body,
          mappings: story.kind === 'note' ? [] : cleanMappings(draft.mappings),
        })
        clearDraft('new')
        if (res.title_dup) setToast({ type: 'warn', message: 'Heads-up: another entry in this category has the same title.' })
        navigate(`/stories/${res.story.id}`)
        return
      }
      const res = await api.updateStory(id, {
        title: draft.title, body: draft.body,
        mappings: story.kind === 'note' ? [] : cleanMappings(draft.mappings),
      })
      setStory(res.story)
      clearDraft(id)
      setDraft(null)
      setRestored(false)
      setToast(res.title_dup
        ? { type: 'warn', message: 'Saved. Heads-up: another entry in this category has the same title.' }
        : { type: 'success', message: 'Saved. Previous version kept for one-step revert.' })
    } catch (e) {
      setToast({ type: 'error', message: `Not saved: ${e.message}` })
    } finally {
      setSaving(false)
    }
  }

  const commitMeta = async (field, value) => {
    if (isNew) { // no record yet: just stage it
      setStory(s => ({ ...s, [field]: value }))
      return
    }
    try {
      const res = await api.updateStory(id, { [field]: value })
      setStory(res.story)
      if (res.title_dup) setToast({ type: 'warn', message: 'Another entry in this category has the same title.' })
    } catch (e) {
      setToast({ type: 'error', message: `Change not applied: ${e.message}` })
    }
  }

  const revert = async () => {
    try {
      const s = await api.revertStory(id)
      setStory(s)
      setToast({ type: 'success', message: 'Reverted to previous save (revert again to undo).' })
    } catch (e) {
      setToast({ type: 'error', message: `Revert failed: ${e.message}` })
    }
  }

  if (!story) {
    return <div style={{ padding: 60, display: 'flex', justifyContent: 'center' }}><Spinner size={28} /></div>
  }

  return (
    <div className="fade-up" style={{ maxWidth: 860 }}>
      <div style={{ marginBottom: 14 }}>
        <Link to="/stories" style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)', textDecoration: 'none' }}>
          ← all stories
        </Link>
      </div>

      {/* Title + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {editing ? (
          <input
            value={draft.title}
            onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
            placeholder={story.kind === 'note' ? 'Note title…' : 'Story title…'}
            style={{
              flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)',
              color: 'var(--text)', padding: '10px 12px', borderRadius: 6,
              fontSize: 17, fontWeight: 700, outline: 'none',
            }}
          />
        ) : (
          <h1 style={{ fontSize: 20, fontWeight: 800, flex: 1 }}>{story.title}</h1>
        )}
        {!editing && !isNew && (
          <>
            {story.has_previous && (
              <Btn variant="ghost" size="sm" onClick={revert}>↩ revert to previous save</Btn>
            )}
            <Btn variant="ghost" size="sm" onClick={() => setExportOpen(true)}>⇓ Export…</Btn>
            <Btn variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Delete…</Btn>
            <Btn onClick={startEdit}>Edit</Btn>
          </>
        )}
      </div>

      <MetaPanel
        story={story} categories={categories} jobs={jobs}
        immediate={!isNew} onCommit={commitMeta}
      />

      {/* Draft-buffered zone */}
      <div style={{
        border: `1px solid ${editing ? 'var(--accent2)' : 'var(--border)'}`,
        borderRadius: 'var(--radius)', background: 'var(--surface)', padding: '14px 16px',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
          fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
          letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)',
        }}>
          <span>Body{story.kind === 'story' ? ' & question mappings' : ''} — {editing ? 'draft, not saved until you hit Save' : 'saved content'}</span>
          {dirty && (
            <span style={{ color: 'var(--accent3)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent3)', display: 'inline-block' }} />
              unsaved changes
            </span>
          )}
          {restored && (
            <span style={{ color: 'var(--accent2)' }}>draft restored after refresh</span>
          )}
        </div>

        {editing ? (
          <>
            <textarea
              value={draft.body}
              onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
              placeholder="Markdown body… (GFM: headings, lists, tables, code blocks)"
              rows={Math.min(28, Math.max(10, draft.body.split('\n').length + 2))}
              style={{
                width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)',
                color: 'var(--text)', padding: 12, borderRadius: 6, outline: 'none',
                fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.6, resize: 'vertical',
              }}
            />
            {story.kind === 'story' && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                  Question mappings
                </div>
                <MappingsEditor
                  mappings={draft.mappings}
                  onChange={ms => setDraft(d => ({ ...d, mappings: ms }))}
                  knownQuestions={knownQuestions}
                />
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : isNew ? 'Create' : 'Save'}</Btn>
              <Btn variant="secondary" onClick={requestCancel}>Cancel</Btn>
            </div>
          </>
        ) : (
          <>
            <Markdown>{story.body}</Markdown>
            {story.mappings.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                  Question mappings
                </div>
                {story.mappings.map(m => (
                  <div key={m.id} style={{
                    display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 10px',
                    marginBottom: 4, background: 'var(--surface2)',
                    border: '1px solid var(--border)', borderRadius: 6, fontSize: 12,
                  }}>
                    <span style={{
                      fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, flexShrink: 0,
                      color: m.score == null ? 'var(--text3)'
                        : m.score >= 4 ? 'var(--accent)'
                        : m.score >= 2 ? 'var(--accent3)' : 'var(--danger)',
                    }}>
                      {m.score == null ? '–/5' : `${m.score}/5`}
                    </span>
                    <span>
                      “{m.question}”
                      {m.note && <span style={{ color: 'var(--text3)', marginLeft: 6 }}>({m.note})</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {!isNew && (
        <ExportDialog
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          ids={[id]}
          defaultMetadata={false}
          summary={`"${story.title}"`}
          singleTitle={story.title}
          onDone={res => setToast({ type: 'success', message: `Exported to ${res.filename}.` })}
        />
      )}

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={<span style={{ color: 'var(--danger)' }}>⚠ Delete "{story.title}"?</span>}
        width={480}
      >
        <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 18, lineHeight: 1.6 }}>
          Hard delete — no recycle bin, no undo. Removed with this {story.kind}:{' '}
          <b>{story.mappings.length}</b> question mapping{story.mappings.length === 1 ? '' : 's'},{' '}
          <b>{story.labels.length}</b> label link{story.labels.length === 1 ? '' : 's'} and{' '}
          <b>{story.job_ids.length}</b> job link{story.job_ids.length === 1 ? '' : 's'}.
          The labels and tracked jobs themselves are untouched.
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Btn>
          <Btn variant="danger" onClick={async () => {
            try {
              await api.deleteStory(id)
              navigate('/stories')
            } catch (e) {
              setConfirmDelete(false)
              setToast({ type: 'error', message: `Delete failed: ${e.message}` })
            }
          }}>Delete permanently</Btn>
        </div>
      </Modal>

      <Modal open={confirmDiscard} onClose={() => setConfirmDiscard(false)} title="Discard unsaved changes?" width={460}>
        <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 18, lineHeight: 1.6 }}>
          The body{story.kind === 'story' ? ' and question mappings' : ''} go back to the last save.
          Metadata changes (category, labels, status, NDA, kind, job links) were already saved and are not undone.
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setConfirmDiscard(false)}>Keep editing</Btn>
          <Btn variant="danger" onClick={stopEdit}>Discard draft</Btn>
        </div>
      </Modal>

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  )
}
