import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { Btn, Input, Modal, SectionTitle, Spinner, Toast } from '../components/UI.jsx'
import StoryCard from '../components/stories/StoryCard.jsx'

const UNCAT = 'none' // synthetic bucket id for category_id === null

// Same layout grammar as StoryCard: reorder ▲▼ column on the LEFT (bigger
// here, same colours/hover), expand/collapse chevron on the far RIGHT.
function CategoryHeader({ name, count, collapsed, onToggle, onMoveUp, onMoveDown }) {
  const arrow = (enabled, glyph, title, onClick, padding) => (
    <span onClick={onClick} title={title}
          style={{
            cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 0.7 : 0.15,
            fontSize: 13, lineHeight: 1, fontFamily: 'var(--mono)',
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
      <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text3)', padding: '0 4px' }}>
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
                  onMoveUp={i > 0 ? () => moveStory(sec.key, i, -1) : null}
                  onMoveDown={i < bucket.length - 1 ? () => moveStory(sec.key, i, +1) : null}
                />
              ))
            )}
          </div>
        )
      })}

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
