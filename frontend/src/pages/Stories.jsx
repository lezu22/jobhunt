import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { Btn, Input, Modal, SectionTitle, Spinner, Toast } from '../components/UI.jsx'
import StoryCard from '../components/stories/StoryCard.jsx'

const UNCAT = 'none' // synthetic bucket id for category_id === null

// Same layout grammar as StoryCard: reorder ▲▼ column on the LEFT (bigger
// here, same colours/hover), expand/collapse chevron on the far RIGHT.
function CategoryHeader({ name, count, collapsed, onToggle, onMoveUp, onMoveDown, onRename, onDelete }) {
  const arrow = (enabled, glyph, title, onClick, padding) => (
    <span onClick={onClick} title={title}
          style={{
            cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 0.7 : 0.15,
            fontSize: 15, lineHeight: 1, fontFamily: 'var(--mono)',
            padding, borderRadius: 4, userSelect: 'none',
          }}
          onMouseEnter={e => { if (enabled) e.target.style.background = 'var(--surface3)' }}
          onMouseLeave={e => e.target.style.background = 'transparent'}>{glyph}</span>
  )
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 4px', cursor: 'pointer', userSelect: 'none',
        borderBottom: '1px solid var(--border2)', marginBottom: 10,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', margin: '-10px 0 -10px -4px', flexShrink: 0, visibility: (onMoveUp || onMoveDown) ? 'visible' : 'hidden' }}
           onClick={e => e.stopPropagation()}>
        {arrow(!!onMoveUp, '▲', 'Move category up', onMoveUp, '8px 9px 4px')}
        {arrow(!!onMoveDown, '▼', 'Move category down', onMoveDown, '4px 9px 8px')}
      </div>
      <span style={{
        fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700,
        letterSpacing: '0.1em', textTransform: 'uppercase',
      }}>
        {name}
      </span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
        {count} {count === 1 ? 'entry' : 'entries'}
      </span>
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }} onClick={e => e.stopPropagation()}>
        {onRename && (
          <span onClick={onRename} title="Rename category"
                style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text3)', padding: '6px 8px', borderRadius: 4 }}
                onMouseEnter={e => { e.target.style.background = 'var(--surface3)'; e.target.style.color = 'var(--text2)' }}
                onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = 'var(--text3)' }}>✎</span>
        )}
        {onDelete && (
          <span onClick={onDelete} title="Delete category (stories move to Uncategorised)"
                style={{ cursor: 'pointer', fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--danger)', opacity: 0.7, padding: '6px 8px', borderRadius: 4 }}
                onMouseEnter={e => { e.target.style.background = 'var(--surface3)'; e.target.style.opacity = 1 }}
                onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.opacity = 0.7 }}>✕</span>
        )}
      </span>
      <span onClick={e => { e.stopPropagation(); onToggle() }}
            style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--accent)', padding: '0 4px', cursor: 'pointer' }}>
        {collapsed ? '▸' : '▾'}
      </span>
    </div>
  )
}

export default function StoriesPage() {
  const [categories, setCategories] = useState(null)
  const [stories, setStories] = useState(null)
  const [jobsById, setJobsById] = useState({})
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [toast, setToast] = useState(null)
  const [newCatOpen, setNewCatOpen] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkExcluded, setBulkExcluded] = useState(() => new Set())
  const [catAction, setCatAction] = useState(null) // {mode: 'rename'|'delete', cat}
  const [catName, setCatName] = useState('')
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState('') // '' = uncategorised
  const navigate = useNavigate()

  const load = () => Promise.all([
    api.getStoryCategories().then(setCategories),
    api.getStories().then(setStories),
  ]).catch(e => setToast({ type: 'error', message: `Load failed: ${e.message}` }))

  useEffect(() => {
    load()
    api.getTracker().then(jobs => {
      const map = {}
      jobs.forEach(j => { map[j.id] = j.company ? `${j.title} @ ${j.company}` : j.title })
      setJobsById(map)
    }).catch(() => {})
  }, [])

  // stories come position-sorted from the API; group them per bucket
  const byBucket = useMemo(() => {
    const map = { [UNCAT]: [] }
    ;(categories || []).forEach(c => { map[c.id] = [] })
    ;(stories || []).forEach(s => {
      const key = s.category_id == null ? UNCAT : s.category_id
      ;(map[key] = map[key] || []).push(s)
    })
    return map
  }, [categories, stories])

  const toggle = (key) => setCollapsed(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const moveCategory = async (index, delta) => {
    const ids = categories.map(c => c.id)
    const j = index + delta
    if (j < 0 || j >= ids.length) return
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    try {
      await api.reorderStoryCategories(ids)
      await load()
    } catch (e) {
      setToast({ type: 'error', message: `Reorder failed: ${e.message}` })
    }
  }

  const moveStory = async (bucketKey, index, delta) => {
    const bucket = byBucket[bucketKey]
    const ids = bucket.map(s => s.id)
    const j = index + delta
    if (j < 0 || j >= ids.length) return
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    try {
      await api.reorderStories(bucketKey === UNCAT ? null : bucketKey, ids)
      await load()
    } catch (e) {
      setToast({ type: 'error', message: `Reorder failed: ${e.message}` })
    }
  }

  if (!categories || !stories) {
    return <div style={{ padding: 60, display: 'flex', justifyContent: 'center' }}><Spinner size={28} /></div>
  }

  // ordered sections: user-ordered categories, then Uncategorised always last
  const sections = [
    ...categories.map((c, i) => ({ key: c.id, name: c.name, index: i, isCat: true })),
    { key: UNCAT, name: 'Uncategorised', isCat: false },
  ]

  const toggleSelect = (id, on) => setSelected(prev => {
    const next = new Set(prev)
    on ? next.add(id) : next.delete(id)
    return next
  })

  const selectedStories = (stories || []).filter(s => selected.has(s.id))
  const bulkTargets = selectedStories.filter(s => !bulkExcluded.has(s.id))

  const runBulkDelete = async () => {
    try {
      const res = await api.bulkDeleteStories(bulkTargets.map(s => s.id))
      setBulkOpen(false)
      setSelected(new Set())
      setToast({ type: 'success', message: `Deleted ${res.deleted} permanently.` })
      await load()
    } catch (e) {
      // transaction rolled back server-side: nothing was deleted
      setToast({ type: 'error', message: `Nothing deleted — ${e.message.replace(/^\d+: /, '').replace(/.*"detail":"([^"]+)".*/, '$1')}` })
    }
  }

  const runBulkMove = async () => {
    try {
      const target = moveTarget === '' ? null : Number(moveTarget)
      const res = await api.bulkMoveStories(selectedStories.map(s => s.id), target)
      setMoveOpen(false)
      setSelected(new Set())
      const name = target == null ? 'Uncategorised' : categories.find(c => c.id === target)?.name
      setToast({ type: 'success', message: `Moved ${res.moved} to ${name}.` })
      await load()
    } catch (e) {
      setToast({ type: 'error', message: `Nothing moved — ${e.message.replace(/^\d+: /, '').replace(/.*"detail":"([^"]+)".*/, '$1')}` })
    }
  }

  const runCatAction = async () => {
    try {
      if (catAction.mode === 'rename') {
        await api.renameStoryCategory(catAction.cat.id, catName)
      } else {
        const res = await api.deleteStoryCategory(catAction.cat.id)
        setToast({ type: 'success', message: `Category deleted; ${res.stories_moved_to_uncategorised} moved to Uncategorised.` })
      }
      setCatAction(null)
      await load()
    } catch (e) {
      setToast({ type: 'error', message: e.message.includes('409') ? 'A category with that name already exists.' : e.message })
    }
  }

  const createCategory = async () => {
    try {
      await api.createStoryCategory(newCatName)
      setNewCatOpen(false)
      setNewCatName('')
      await load()
    } catch (e) {
      setToast({ type: 'error', message: e.message.includes('409') ? 'A category with that name already exists.' : `Create failed: ${e.message}` })
    }
  }

  return (
    <div className="fade-up">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <SectionTitle>Work Stories</SectionTitle>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Btn size="sm" onClick={() => navigate('/stories/new?kind=story')}>+ Story</Btn>
          <Btn size="sm" variant="secondary" onClick={() => navigate('/stories/new?kind=note')}>+ Note</Btn>
          <Btn size="sm" variant="ghost" onClick={() => setNewCatOpen(true)}>+ Category</Btn>
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text2)', margin: '-8px 0 24px' }}>
        {stories.length} entr{stories.length === 1 ? 'y' : 'ies'} across {categories.length} categor{categories.length === 1 ? 'y' : 'ies'} + uncategorised
      </div>

      {selected.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18,
          padding: '9px 14px', background: 'var(--surface)',
          border: '1px solid var(--border2)', borderRadius: 'var(--radius)',
        }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>
            {selected.size} selected
          </span>
          <Btn size="sm" variant="secondary" onClick={() => { setMoveTarget(''); setMoveOpen(true) }}>
            Move to category…
          </Btn>
          <Btn size="sm" variant="danger" onClick={() => { setBulkExcluded(new Set()); setBulkOpen(true) }}>
            Delete selected…
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Btn>
        </div>
      )}

      {sections.map(sec => {
        const bucket = byBucket[sec.key] || []
        const isCollapsed = collapsed.has(sec.key)
        return (
          <div key={sec.key} style={{ marginBottom: 26 }}>
            <CategoryHeader
              name={sec.name}
              count={bucket.length}
              collapsed={isCollapsed}
              onToggle={() => toggle(sec.key)}
              onMoveUp={sec.isCat && sec.index > 0 ? () => moveCategory(sec.index, -1) : null}
              onMoveDown={sec.isCat && sec.index < categories.length - 1 ? () => moveCategory(sec.index, +1) : null}
              onRename={sec.isCat ? () => { setCatName(sec.name); setCatAction({ mode: 'rename', cat: categories[sec.index] }) } : null}
              onDelete={sec.isCat ? () => setCatAction({ mode: 'delete', cat: categories[sec.index] }) : null}
            />
            {!isCollapsed && (
              bucket.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', padding: '2px 4px' }}>
                  No stories or notes yet.
                </div>
              ) : bucket.map((s, i) => (
                <StoryCard
                  key={s.id}
                  story={s}
                  jobsById={jobsById}
                  selected={selected.has(s.id)}
                  onSelect={on => toggleSelect(s.id, on)}
                  onMoveUp={i > 0 ? () => moveStory(sec.key, i, -1) : null}
                  onMoveDown={i < bucket.length - 1 ? () => moveStory(sec.key, i, +1) : null}
                />
              ))
            )}
          </div>
        )
      })}

      {/* Bulk move: neutral/accent theme — a non-destructive sibling of the
          red delete dialog below */}
      <Modal
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title={`Move ${selectedStories.length} to category`}
        width={440}
      >
        <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 14, lineHeight: 1.6 }}>
          Moves the selected stories/notes into one category (appended at its end, in the
          order shown on the index). Bodies, labels, statuses and job links are untouched.
        </div>
        <div style={{ marginBottom: 16 }}>
          <select
            value={moveTarget}
            onChange={e => setMoveTarget(e.target.value)}
            style={{
              width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)',
              color: 'var(--text)', padding: '9px 12px', borderRadius: 6, fontSize: 12, outline: 'none',
            }}
          >
            <option value="">Uncategorised</option>
            {categories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setMoveOpen(false)}>Cancel</Btn>
          <Btn onClick={runBulkMove}>Move {selectedStories.length}</Btn>
        </div>
      </Modal>

      {/* Bulk delete: deliberately red/warning-themed so it can never be
          mistaken for the export dialog that launches from the same toolbar */}
      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={<span style={{ color: 'var(--danger)' }}>⚠ Permanently delete {selectedStories.length} selected</span>}
        width={620}
      >
        <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 14, lineHeight: 1.6 }}>
          Hard delete — no recycle bin. Each record's question mappings, label links and job
          links are removed with it (labels and jobs themselves are untouched).
          Uncheck a row to keep that record.
        </div>
        <div style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 16 }}>
          {selectedStories.map(s => (
            <label key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
              marginBottom: 4, borderRadius: 6, cursor: 'pointer',
              background: bulkExcluded.has(s.id) ? 'var(--surface2)' : 'rgba(239,68,68,0.08)',
              border: `1px solid ${bulkExcluded.has(s.id) ? 'var(--border)' : 'rgba(239,68,68,0.35)'}`,
              opacity: bulkExcluded.has(s.id) ? 0.55 : 1,
            }}>
              <input
                type="checkbox"
                checked={!bulkExcluded.has(s.id)}
                onChange={e => setBulkExcluded(prev => {
                  const next = new Set(prev)
                  e.target.checked ? next.delete(s.id) : next.add(s.id)
                  return next
                })}
                style={{ accentColor: 'var(--danger)', width: 14, height: 14 }}
              />
              <span style={{ fontSize: 12, fontWeight: 700 }}>{s.title}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginLeft: 'auto' }}>
                {s.kind} · {s.mappings.length} mapping{s.mappings.length === 1 ? '' : 's'} · {s.job_ids.length} job link{s.job_ids.length === 1 ? '' : 's'}
              </span>
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setBulkOpen(false)}>Cancel</Btn>
          <Btn variant="danger" disabled={bulkTargets.length === 0} onClick={runBulkDelete}>
            Delete {bulkTargets.length} permanently
          </Btn>
        </div>
      </Modal>

      <Modal
        open={catAction?.mode === 'rename'}
        onClose={() => setCatAction(null)}
        title={`Rename "${catAction?.cat.name}"`}
        width={420}
      >
        <Input label="New name" value={catName} onChange={setCatName} />
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 14 }}>
          Renaming never affects the stories linked to this category.
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setCatAction(null)}>Cancel</Btn>
          <Btn onClick={runCatAction} disabled={!catName.trim()}>Rename</Btn>
        </div>
      </Modal>

      <Modal
        open={catAction?.mode === 'delete'}
        onClose={() => setCatAction(null)}
        title={`Delete category "${catAction?.cat.name}"?`}
        width={460}
      >
        <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 18, lineHeight: 1.6 }}>
          Not destructive to content: its {catAction?.cat.story_count} stor{catAction?.cat.story_count === 1 ? 'y' : 'ies'} will
          move to <b>Uncategorised</b> (appended at the end). Only the category itself is removed.
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setCatAction(null)}>Cancel</Btn>
          <Btn variant="danger" onClick={runCatAction}>Delete category</Btn>
        </div>
      </Modal>

      <Modal open={newCatOpen} onClose={() => setNewCatOpen(false)} title="New category" width={420}>
        <Input label="Name" value={newCatName} onChange={setNewCatName} placeholder="e.g. Requirements Capture" />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setNewCatOpen(false)}>Cancel</Btn>
          <Btn onClick={createCategory} disabled={!newCatName.trim()}>Create</Btn>
        </div>
      </Modal>

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  )
}
