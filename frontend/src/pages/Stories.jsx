import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { Btn, Input, Modal, SectionTitle, Spinner, Toast } from '../components/UI.jsx'
import StoryCard from '../components/stories/StoryCard.jsx'
import ExportDialog from '../components/stories/ExportDialog.jsx'

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

const filterSelStyle = {
  background: 'var(--surface2)', border: '1px solid var(--border)',
  color: 'var(--text)', padding: '7px 10px', borderRadius: 6,
  fontSize: 12, outline: 'none',
}

export default function StoriesPage() {
  const [categories, setCategories] = useState(null)
  const [stories, setStories] = useState(null)
  const [jobs, setJobs] = useState([])
  const [labels, setLabels] = useState([])
  const [jobsById, setJobsById] = useState({})
  const [filters, setFilters] = useState({ category: '', label: '', job: '', status: '', kind: '', question: '' })
  const [questions, setQuestions] = useState([])
  const [sort, setSort] = useState('position')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)  // null = search inactive
  const [searching, setSearching] = useState(false)
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
  const [exportSel, setExportSel] = useState(false)  // export the selection
  const [exportAll, setExportAll] = useState(false)  // export everything
  const navigate = useNavigate()

  const load = () => Promise.all([
    api.getStoryCategories().then(setCategories),
    api.getStories({ ...filters, sort }).then(setStories),
    api.getStoryLabels().then(setLabels).catch(() => {}),
    api.getKnownQuestions().then(setQuestions).catch(() => {}),
  ]).catch(e => setToast({ type: 'error', message: `Load failed: ${e.message}` }))

  useEffect(() => { load() }, [filters, sort])

  useEffect(() => {
    api.getTracker().then(js => {
      setJobs(js)
      const map = {}
      js.forEach(j => { map[j.id] = j.company ? `${j.title} @ ${j.company}` : j.title })
      setJobsById(map)
    }).catch(() => {})
  }, [])

  // Search: debounced, replaces the grouped view while a query is present
  useEffect(() => {
    if (!query.trim()) { setResults(null); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(() => {
      api.searchStories(query)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 200)
    return () => clearTimeout(t)
  }, [query])

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
  const filtersActive = Object.values(filters).some(Boolean)
  const canReorder = !filtersActive && sort === 'position'
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
          <Btn size="sm" variant="ghost" onClick={() => navigate('/stories/import')}>⇪ Import</Btn>
          <Btn size="sm" variant="ghost" onClick={() => setExportAll(true)} disabled={!stories?.length}>⇓ Export all</Btn>
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text2)', margin: '-8px 0 16px' }}>
        {stories.length} entr{stories.length === 1 ? 'y' : 'ies'} across {categories.length} categor{categories.length === 1 ? 'y' : 'ies'} + uncategorised
      </div>

      {/* Search + filters */}
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 20,
        padding: '10px 12px', background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="🔍 Search stories, bodies and interview questions… (stemmed: “pushed back” finds “push back”)"
          style={{ ...filterSelStyle, flex: '1 1 320px', borderColor: query ? 'var(--accent)' : 'var(--border)' }}
        />
        {query ? (
          <Btn size="sm" variant="ghost" onClick={() => setQuery('')}>✕ clear search</Btn>
        ) : (
          <>
            <select value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))} style={filterSelStyle}>
              <option value="">all categories</option>
              <option value="none">Uncategorised</option>
              {categories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
            <select value={filters.label} onChange={e => setFilters(f => ({ ...f, label: e.target.value }))} style={filterSelStyle}>
              <option value="">all labels</option>
              {labels.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
            </select>
            <select value={filters.job} onChange={e => setFilters(f => ({ ...f, job: e.target.value }))} style={filterSelStyle}>
              <option value="">all jobs</option>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.company ? `${j.title} @ ${j.company}` : j.title}</option>)}
            </select>
            <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} style={filterSelStyle}>
              <option value="">any status</option>
              <option value="draft">draft</option>
              <option value="gap">gap</option>
              <option value="ready">ready</option>
            </select>
            <select value={filters.kind} onChange={e => setFilters(f => ({ ...f, kind: e.target.value }))} style={filterSelStyle}>
              <option value="">stories + notes</option>
              <option value="story">stories</option>
              <option value="note">notes</option>
            </select>
            <select value={filters.question} onChange={e => setFilters(f => ({ ...f, question: e.target.value }))}
                    style={{ ...filterSelStyle, maxWidth: 240 }} title="Show every story mapped to this question">
              <option value="">any question</option>
              {questions.map(q => (
                <option key={q.question} value={q.question}>
                  {q.question.length > 60 ? q.question.slice(0, 57) + '…' : q.question} ({q.uses}×)
                </option>
              ))}
            </select>
            <select value={sort} onChange={e => setSort(e.target.value)} style={filterSelStyle} title="Order within each category">
              <option value="position">my order</option>
              <option value="updated">last edited</option>
              <option value="title">title A–Z</option>
            </select>
            {(Object.values(filters).some(Boolean) || sort !== 'position') && (
              <Btn size="sm" variant="ghost" onClick={() => { setFilters({ category: '', label: '', job: '', status: '', kind: '', question: '' }); setSort('position') }}>
                reset
              </Btn>
            )}
          </>
        )}
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
          <Btn size="sm" onClick={() => setExportSel(true)}>⇓ Export selected…</Btn>
          <Btn size="sm" variant="secondary" onClick={() => { setMoveTarget(''); setMoveOpen(true) }}>
            Move to category…
          </Btn>
          <Btn size="sm" variant="danger" onClick={() => { setBulkExcluded(new Set()); setBulkOpen(true) }}>
            Delete selected…
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Btn>
        </div>
      )}

      {results !== null ? (
        /* ── ranked search results ── */
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>
            {searching ? 'searching…' : `${results.length} result${results.length === 1 ? '' : 's'} — question matches first, then body/title matches`}
          </div>
          {!searching && results.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text2)', fontStyle: 'italic' }}>
              Nothing matches “{query}”. Search is stemmed (pushed/push/pushing all match) — try fewer or different words.
            </div>
          )}
          {results.map(s => (
            <div key={s.id}
                 onClick={() => navigate(`/stories/${s.id}`)}
                 style={{
                   background: 'var(--surface)', border: '1px solid var(--border)',
                   borderRadius: 'var(--radius)', padding: '11px 14px', marginBottom: 8,
                   cursor: 'pointer',
                 }}
                 onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                 onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: '0.05em',
                               background: s.kind === 'note' ? 'rgba(91,141,238,0.25)' : 'rgba(109,74,255,0.25)',
                               color: s.kind === 'note' ? '#7ba7f2' : '#a78bfa' }}>
                  {s.kind.toUpperCase()}
                </span>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{s.title}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
                  {s.category_id == null ? 'Uncategorised' : categories.find(c => c.id === s.category_id)?.name}
                  {' · '}{s.status}{s.nda_sensitive ? ' · ⚠ NDA' : ''}
                </span>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, display: 'flex', gap: 8, alignItems: 'baseline' }}>
                {s.match.type === 'question' ? (
                  <>
                    <span style={{
                      fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, flexShrink: 0,
                      color: s.match.score == null ? 'var(--text3)'
                        : s.match.score >= 4 ? 'var(--accent)'
                        : s.match.score >= 2 ? 'var(--accent3)' : 'var(--danger)',
                    }}>
                      {s.match.score == null ? '–/5' : `${s.match.score}/5`}
                    </span>
                    <span>“{s.match.question}”{s.match.note && <span style={{ color: 'var(--text3)' }}> ({s.match.note})</span>}</span>
                  </>
                ) : (
                  <span style={{ color: 'var(--text2)' }}>…{s.match.snippet}…</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
      sections.map(sec => {
        const bucket = byBucket[sec.key] || []
        const isCollapsed = collapsed.has(sec.key)
        if (filtersActive && bucket.length === 0) return null
        return (
          <div key={sec.key} style={{ marginBottom: 26 }}>
            <CategoryHeader
              name={sec.name}
              count={bucket.length}
              collapsed={isCollapsed}
              onToggle={() => toggle(sec.key)}
              onMoveUp={canReorder && sec.isCat && sec.index > 0 ? () => moveCategory(sec.index, -1) : null}
              onMoveDown={canReorder && sec.isCat && sec.index < categories.length - 1 ? () => moveCategory(sec.index, +1) : null}
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
                  onMoveUp={canReorder && i > 0 ? () => moveStory(sec.key, i, -1) : null}
                  onMoveDown={canReorder && i < bucket.length - 1 ? () => moveStory(sec.key, i, +1) : null}
                />
              ))
            )}
          </div>
        )
      })
      )}

      {/* Export: metadata default ON for a full export, OFF for a selection */}
      <ExportDialog
        open={exportSel}
        onClose={() => setExportSel(false)}
        ids={selectedStories.map(s => s.id)}
        defaultMetadata={false}
        summary={`${selectedStories.length} selected`}
        onDone={res => setToast({ type: 'success', message: `Exported ${res.count} to ${res.filename}.` })}
      />
      <ExportDialog
        open={exportAll}
        onClose={() => setExportAll(false)}
        ids={null}
        defaultMetadata={true}
        summary={`all ${stories?.length ?? 0} entries`}
        onDone={res => setToast({ type: 'success', message: `Exported ${res.count} to ${res.filename}.` })}
      />

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
