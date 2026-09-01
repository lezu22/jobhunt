import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { Btn, SectionTitle, Toast } from '../components/UI.jsx'

const mono = { fontFamily: 'var(--mono)' }
const inputStyle = {
  background: 'var(--surface2)', border: '1px solid var(--border)',
  color: 'var(--text)', padding: '7px 10px', borderRadius: 6,
  fontSize: 12, outline: 'none',
}
const panel = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius)', padding: '14px 16px', marginBottom: 18,
}
const H = ({ children }) => (
  <div style={{ ...mono, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 10 }}>
    {children}
  </div>
)

const NO_CAT = '__uncat__'   // sentinel: force Uncategorised
const FOLLOW = '__follow__'  // record follows its file heading's resolution

// Staged import: pick file → review everything → one explicit commit.
export default function StoriesImport() {
  const navigate = useNavigate()
  const fileRef = useRef(null)
  const [pickError, setPickError] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState(null)     // server parse result
  const [catRes, setCatRes] = useState({})       // h2 name -> {action:'map'|'create', target, newName}
  const [records, setRecords] = useState([])     // editable candidates
  const [categories, setCategories] = useState([])
  const [preambleOpen, setPreambleOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [committing, setCommitting] = useState(false)
  const [done, setDone] = useState(null)         // commit result

  const pickFile = () => fileRef.current?.click()

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''  // same file can be re-picked after a fix
    if (!file) return
    setPickError(null)
    if (!/\.(md|txt)$/i.test(file.name)) {
      setPickError(`"${file.name}" is not a .md or .txt file.`)
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setPickError(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 2 MB.`)
      return
    }
    setParsing(true)
    try {
      const [res, cats] = await Promise.all([api.importParse(file), api.getStoryCategories()])
      setCategories(cats)
      setParsed(res)
      const cr = {}
      res.categories.forEach(c => {
        cr[c.name] = c.match
          ? { action: 'map', target: String(c.match.id), newName: c.name }
          : { action: 'create', target: '', newName: c.name }
      })
      setCatRes(cr)
      setRecords(res.records.map((r, i) => ({
        key: i,
        title: r.title,
        body: r.body,
        mappings: r.mappings,
        h2: r.category,                 // file heading (may be null)
        catChoice: FOLLOW,              // FOLLOW | NO_CAT | category id string
        kind: r.kind,                   // 'story' | 'note'
        drop: false,
        meta: r.meta,
        dupId: r.dup_id_match,
        dupTitles: r.dup_title_matches,
        bodyMatches: r.body_matches || [],
        dupChoice: r.dup_id_match ? 'update' : 'create',
        updateTarget: '',
        bodyOpen: false,
      })))
    } catch (err) {
      setPickError(err.message.replace(/^\d+: /, '').replace(/.*"detail":"([^"]+)".*/, '$1'))
    } finally {
      setParsing(false)
    }
  }

  const upd = (key, patch) => setRecords(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)))

  const mergeIntoPrevious = (idx) => setRecords(rs => {
    const prev = rs[idx - 1], cur = rs[idx]
    const merged = {
      ...prev,
      body: `${prev.body}\n\n${cur.body}`.trim(),
      mappings: [...prev.mappings, ...cur.mappings],
      kind: prev.kind === 'story' || cur.kind === 'story' ? 'story' : 'note',
    }
    return [...rs.slice(0, idx - 1), merged, ...rs.slice(idx + 1)]
  })

  const splitAfter = (idx) => setRecords(rs => {
    const blank = {
      key: Math.max(...rs.map(r => r.key)) + 1,
      title: '', body: '', mappings: [], h2: rs[idx].h2, catChoice: rs[idx].catChoice,
      kind: 'note', drop: false, meta: null, dupId: null, dupTitles: [],
      dupChoice: 'create', bodyOpen: true,
    }
    return [...rs.slice(0, idx + 1), blank, ...rs.slice(idx + 1)]
  })

  // Title-dup flag only counts when the record actually lands in the same
  // category as the match (recomputed live as resolutions change).
  const titleDupFor = (r, cat) => r.dupTitles.find(d =>
    typeof cat === 'number' ? d.category_id === cat : cat === null ? d.category_id === null : false)

  const catName = (id) => id == null ? 'Uncategorised' : (categories.find(c => c.id === id)?.name ?? `category ${id}`)
  const pct = (s) => `${Math.round(s * 100)}%`

  // Every existing record this candidate could plausibly update, best first:
  // id match, same-category title match, cross-category title matches, then
  // body-similar records. Deduped by story id.
  const updateCandidates = (r, cat) => {
    const sameCat = titleDupFor(r, cat)
    const list = []
    if (r.dupId) list.push({ id: r.dupId.story_id, label: `id match: “${r.dupId.title}”` })
    if (sameCat) list.push({ id: sameCat.story_id, label: `same title, same category: “${sameCat.title}” (body ${pct(sameCat.similarity)} similar)` })
    r.dupTitles.filter(d => d !== sameCat).forEach(d =>
      list.push({ id: d.story_id, label: `same title in ${catName(d.category_id)}: “${d.title}” (body ${pct(d.similarity)} similar)` }))
    r.bodyMatches.forEach(b =>
      list.push({ id: b.story_id, label: `body ${pct(b.similarity)} similar: “${b.title}” (${catName(b.category_id)})` }))
    const seen = new Set()
    return list.filter(x => !seen.has(x.id) && seen.add(x.id))
  }

  // What category does a record actually end up in? (id | null | {create: name})
  const resolveCat = (r) => {
    if (r.catChoice === NO_CAT) return null
    if (r.catChoice !== FOLLOW) return Number(r.catChoice)
    if (!r.h2) return null
    const res = catRes[r.h2]
    if (!res) return null
    if (res.action === 'map') return res.target === '' ? null : Number(res.target)
    return { create: res.newName || r.h2 }
  }

  const activeRecords = records.filter(r => !r.drop)
  const problems = useMemo(() => activeRecords.filter(r => !r.title.trim() || !r.body.trim()), [records])

  const commit = async () => {
    setCommitting(true)
    try {
      const payload = activeRecords.map(r => {
        const cat = resolveCat(r)
        const meta = r.meta || {}
        const cands = updateCandidates(r, cat)
        const updateTarget = (r.updateTarget && cands.some(c => c.id === r.updateTarget))
          ? r.updateTarget : (cands[0]?.id ?? null)
        return {
          action: r.dupChoice === 'skip' ? 'skip'
            : (r.dupChoice === 'update' && updateTarget) ? 'update' : 'create',
          target_story_id: updateTarget,
          title: r.title,
          body: r.body,
          kind: r.kind,
          status: meta.status || 'draft',
          nda_sensitive: meta.nda ?? false,
          category_id: typeof cat === 'number' ? cat : null,
          new_category_name: cat && typeof cat === 'object' ? cat.create : null,
          labels: meta.labels || [],
          job_ids: meta.jobs || [],
          mappings: r.kind === 'note' ? [] : r.mappings,
        }
      })
      const res = await api.importCommit(payload)
      setDone(res)
    } catch (e) {
      setToast({ type: 'error', message: `Nothing imported — ${e.message.replace(/^\d+: /, '').replace(/.*"detail":"([^"]+)".*/, '$1')}` })
    } finally {
      setCommitting(false)
    }
  }

  // ── phases ────────────────────────────────────────────────────────────────

  if (done) {
    return (
      <div className="fade-up" style={{ maxWidth: 700 }}>
        <SectionTitle>Import complete</SectionTitle>
        <div style={{ ...panel, fontSize: 13, lineHeight: 2 }}>
          <div>✔ {done.created} created, {done.updated} updated, {done.skipped} skipped</div>
          {done.categories_created.length > 0 && (
            <div>✔ new categor{done.categories_created.length === 1 ? 'y' : 'ies'}: {done.categories_created.join(', ')}</div>
          )}
          {done.dropped_job_links > 0 && (
            <div style={{ color: 'var(--accent3)' }}>⚠ {done.dropped_job_links} job link(s) referenced jobs that no longer exist and were dropped</div>
          )}
        </div>
        <Btn onClick={() => navigate('/stories')}>Go to Work Stories</Btn>
      </div>
    )
  }

  if (!parsed) {
    return (
      <div className="fade-up" style={{ maxWidth: 700 }}>
        <div style={{ marginBottom: 14 }}>
          <Link to="/stories" style={{ ...mono, fontSize: 11, color: 'var(--text2)', textDecoration: 'none' }}>← all stories</Link>
        </div>
        <SectionTitle>Import stories</SectionTitle>
        <div style={{ ...panel }}>
          <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, marginBottom: 16 }}>
            Upload a <b>.md</b> or <b>.txt</b> file (max 2 MB). <code>##</code> headings become
            categories, <code>###</code> headings become story titles, and lines like{' '}
            <code>question — Score: N/5</code> become question mappings. Everything is staged
            for review — nothing is saved until you commit.
          </div>
          {pickError && (
            <div style={{
              border: '1px solid var(--danger)', background: 'rgba(239,68,68,0.08)',
              borderRadius: 6, padding: '10px 14px', fontSize: 12, color: 'var(--danger)',
              marginBottom: 14, lineHeight: 1.6,
            }}>
              ⚠ {pickError}
            </div>
          )}
          <input ref={fileRef} type="file" accept=".md,.txt" onChange={onFile} hidden />
          <Btn onClick={pickFile} disabled={parsing}>
            {parsing ? 'Parsing…' : pickError ? 'Choose another file' : 'Choose file…'}
          </Btn>
        </div>
      </div>
    )
  }

  const catOptions = [
    { value: NO_CAT, label: 'Uncategorised' },
    ...categories.map(c => ({ value: String(c.id), label: c.name })),
  ]

  return (
    <div className="fade-up" style={{ maxWidth: 900 }}>
      <div style={{ marginBottom: 14 }}>
        <Link to="/stories" style={{ ...mono, fontSize: 11, color: 'var(--text2)', textDecoration: 'none' }}>← all stories</Link>
      </div>
      <SectionTitle>Review import — nothing saved yet</SectionTitle>

      {/* Counts */}
      <div style={panel}>
        <H>Parsed</H>
        <div style={{ ...mono, fontSize: 12, lineHeight: 1.9 }}>
          {parsed.counts.records} records · {parsed.counts.mappings} question mappings lifted ·{' '}
          {parsed.counts.notes_defaulted} defaulted to note (no mappings)
          {parsed.counts.preamble_lines > 0 && (
            <div style={{ color: 'var(--accent3)' }}>
              ⚠ {parsed.counts.preamble_lines} line(s) outside any ### section are NOT imported{' '}
              <span onClick={() => setPreambleOpen(o => !o)} style={{ cursor: 'pointer', textDecoration: 'underline' }}>
                {preambleOpen ? 'hide' : 'show'}
              </span>
              {preambleOpen && (
                <pre style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: 10, marginTop: 8, fontSize: 11, whiteSpace: 'pre-wrap', color: 'var(--text2)' }}>
                  {parsed.preamble}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Category resolution */}
      <div style={panel}>
        <H>Category resolution</H>
        {parsed.categories.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>No ## headings in the file — records go to Uncategorised unless set per record below.</div>
        )}
        {parsed.categories.map(c => {
          const res = catRes[c.name]
          return (
            <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, minWidth: 220 }}>{c.name}</span>
              <span style={{ ...mono, fontSize: 10, color: c.match ? 'var(--accent)' : 'var(--accent3)' }}>
                {c.match ? `matches existing "${c.match.name}"` : 'no existing match'} · {c.record_count} record(s)
              </span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
                <select
                  value={res.action}
                  onChange={e => setCatRes(cr => ({ ...cr, [c.name]: { ...res, action: e.target.value } }))}
                  style={inputStyle}
                >
                  <option value="create">create as new category</option>
                  <option value="map">map into existing…</option>
                </select>
                {res.action === 'create' ? (
                  <input
                    value={res.newName}
                    onChange={e => setCatRes(cr => ({ ...cr, [c.name]: { ...res, newName: e.target.value } }))}
                    style={{ ...inputStyle, width: 200 }}
                    title="Name for the new category"
                  />
                ) : (
                  <select
                    value={res.target}
                    onChange={e => setCatRes(cr => ({ ...cr, [c.name]: { ...res, target: e.target.value } }))}
                    style={inputStyle}
                  >
                    <option value="">Uncategorised</option>
                    {categories.map(cat => <option key={cat.id} value={String(cat.id)}>{cat.name}</option>)}
                  </select>
                )}
              </span>
            </div>
          )
        })}
      </div>

      {/* Records */}
      <div style={panel}>
        <H>Records ({activeRecords.length} to import, {records.length - activeRecords.length} dropped)</H>
        {records.map((r, idx) => {
          const cat = resolveCat(r)
          const titleDup = titleDupFor(r, cat)
          const flagged = r.dupId || titleDup
          const softSignals = [
            ...r.dupTitles.filter(d => d !== titleDup).map(d =>
              `same title exists in ${catName(d.category_id)} (body ${pct(d.similarity)} similar)`),
            ...r.bodyMatches.map(b =>
              `body ${pct(b.similarity)} similar to “${b.title}” (${catName(b.category_id)})`),
          ]
          const cands = updateCandidates(r, cat)
          return (
            <div key={r.key} style={{
              border: `1px solid ${r.drop ? 'var(--border)' : flagged ? 'var(--accent3)' : 'var(--border2)'}`,
              borderRadius: 6, padding: '10px 12px', marginBottom: 8,
              opacity: r.drop ? 0.45 : 1, background: 'var(--surface2)',
            }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={r.title} onChange={e => upd(r.key, { title: e.target.value })}
                       placeholder="title (required)"
                       style={{ ...inputStyle, flex: 2, minWidth: 220, fontWeight: 700 }} />
                <select value={r.drop ? 'drop' : r.kind}
                        onChange={e => e.target.value === 'drop'
                          ? upd(r.key, { drop: true })
                          : upd(r.key, { drop: false, kind: e.target.value })}
                        style={inputStyle}>
                  <option value="story">story</option>
                  <option value="note">note</option>
                  <option value="drop">drop (don't import)</option>
                </select>
                <select value={r.catChoice} onChange={e => upd(r.key, { catChoice: e.target.value })} style={inputStyle}>
                  <option value={FOLLOW}>
                    {r.h2 ? `heading: ${r.h2}` : 'heading: (none) → Uncategorised'}
                  </option>
                  {catOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <span style={{ ...mono, fontSize: 10, color: 'var(--text3)' }}>
                  {r.mappings.length} mapping(s){r.meta ? ' · has metadata' : ''}
                </span>
              </div>

              {(flagged || softSignals.length > 0) && !r.drop && (
                <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.7 }}>
                  {flagged && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--accent3)', flexWrap: 'wrap' }}>
                      ⚠ {r.dupId
                        ? <>metadata id matches existing “{r.dupId.title}”</>
                        : <>title matches existing “{titleDup.title}” in the same category (body {pct(titleDup.similarity)} similar)</>}
                      <select value={r.dupChoice} onChange={e => upd(r.key, { dupChoice: e.target.value })} style={{ ...inputStyle, padding: '4px 8px' }}>
                        <option value="update">update the existing record</option>
                        <option value="create">create as new</option>
                        <option value="skip">skip this record</option>
                      </select>
                    </div>
                  )}
                  {softSignals.map((s, i) => (
                    <div key={i} style={{ color: '#a78bfa' }}>◎ {s}</div>
                  ))}
                  {!flagged && softSignals.length > 0 && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--text2)', flexWrap: 'wrap' }}>
                      possible duplicate —
                      <select value={r.dupChoice} onChange={e => upd(r.key, { dupChoice: e.target.value })} style={{ ...inputStyle, padding: '4px 8px' }}>
                        <option value="create">create as new (default)</option>
                        <option value="update">update an existing record…</option>
                        <option value="skip">skip this record</option>
                      </select>
                    </div>
                  )}
                  {r.dupChoice === 'update' && cands.length > 1 && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, color: 'var(--text2)' }}>
                      target:
                      <select
                        value={r.updateTarget && cands.some(c => c.id === r.updateTarget) ? r.updateTarget : cands[0].id}
                        onChange={e => upd(r.key, { updateTarget: e.target.value })}
                        style={{ ...inputStyle, padding: '4px 8px', maxWidth: 480 }}
                      >
                        {cands.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 12, marginTop: 8, alignItems: 'center' }}>
                <span onClick={() => upd(r.key, { bodyOpen: !r.bodyOpen })}
                      style={{ ...mono, fontSize: 10, color: 'var(--accent)', cursor: 'pointer' }}>
                  {r.bodyOpen ? '▾ hide body' : `▸ body (${r.body.split('\n').length} lines)`}
                </span>
                {idx > 0 && !r.drop && (
                  <span onClick={() => mergeIntoPrevious(idx)} title="Append this record's body and mappings to the record above"
                        style={{ ...mono, fontSize: 10, color: 'var(--text2)', cursor: 'pointer' }}>⤴ merge into previous</span>
                )}
                {!r.drop && (
                  <span onClick={() => splitAfter(idx)} title="Insert an empty record after this one; cut & paste body text to split"
                        style={{ ...mono, fontSize: 10, color: 'var(--text2)', cursor: 'pointer' }}>✂ split (add record after)</span>
                )}
                {!r.body.trim() && !r.drop && (
                  <span style={{ ...mono, fontSize: 10, color: 'var(--danger)' }}>empty body — edit or drop</span>
                )}
              </div>
              {r.bodyOpen && (
                <textarea
                  value={r.body}
                  onChange={e => upd(r.key, { body: e.target.value })}
                  rows={Math.min(16, Math.max(4, r.body.split('\n').length + 1))}
                  style={{ ...inputStyle, width: '100%', marginTop: 8, fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6, resize: 'vertical' }}
                />
              )}
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 40 }}>
        <Btn onClick={commit} disabled={committing || activeRecords.length === 0 || problems.length > 0}>
          {committing ? 'Importing…' : `Import ${activeRecords.filter(r => r.dupChoice !== 'skip').length} record(s)`}
        </Btn>
        <Btn variant="secondary" onClick={() => { setParsed(null); setPickError(null) }}>Start over</Btn>
        {problems.length > 0 && (
          <span style={{ ...mono, fontSize: 11, color: 'var(--danger)' }}>
            {problems.length} record(s) have an empty title or body — fix or drop them first
          </span>
        )}
      </div>

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  )
}
