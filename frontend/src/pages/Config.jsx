import { useState, useEffect, useRef } from 'react'
import { api } from '../api.js'
import { Btn, Card, SectionTitle, Toast } from '../components/UI.jsx'

export default function ConfigPage() {
  const [config, setConfig] = useState({})
  const [salaryMin, setSalaryMin] = useState('')
  const [salaryMax, setSalaryMax] = useState('')
  const [toast, setToast] = useState(null)
  const [dirty, setDirty] = useState(false)
  const roleInputRefs = useRef({})

  useEffect(() => {
    api.getConfig().then(data => {
      setConfig(data || {})
    }).catch(() => {})
  }, [])

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }

  const save = async () => {
    try {
      await api.saveConfig(config)
      setDirty(false)
      showToast('Search config saved!')
    } catch (e) {
      showToast('Save failed: ' + e.message, 'error')
    }
  }

  const addCV = () => {
    const name = `cv_${Date.now()}`
    setConfig(c => ({ ...c, [name]: [] }))
    setDirty(true)
  }

  const renameCV = (oldName, newName) => {
    if (!newName || newName === oldName) return
    setConfig(c => {
      const next = {}
      Object.entries(c).forEach(([k, v]) => {
        next[k === oldName ? newName : k] = v
      })
      return next
    })
    setDirty(true)
  }

  const removeCV = (name) => {
    setConfig(c => { const n = { ...c }; delete n[name]; return n })
    setDirty(true)
  }

  const addRole = (cvName, role) => {
    if (!role.trim()) return
    setConfig(c => ({ ...c, [cvName]: [...(c[cvName] || []), role.trim()] }))
    setDirty(true)
  }

  const removeRole = (cvName, idx) => {
    setConfig(c => ({ ...c, [cvName]: c[cvName].filter((_, i) => i !== idx) }))
    setDirty(true)
  }

  const loadSample = () => {
    setConfig({
      "hybrid": ["Systems Integration Engineer","Autonomous Systems Engineer","Robotics Platform Engineer","Simulation & Testing Engineer","Validation Engineer Robotics","Technical Solutions Engineer Robotics"],
      "robotics": ["Python Software Engineer","Backend Engineer Python","Platform Engineer Python","Automation Engineer Python","Systems Software Engineer","Infrastructure Engineer Python","Integration Engineer Software"],
      "software": ["Robotics Software Engineer","ROS2 Engineer","Autonomy Engineer","Robotics Integration Engineer","Robotics Systems Engineer","Simulation Engineer Robotics","Robot Application Engineer","Field Robotics Engineer"]
    })
    setDirty(true)
  }

  return (
    <div className="fade-up">
      <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 4 }}>Search Config</h1>
      <p style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text3)', marginBottom: 24 }}>
        // define cv profiles and target roles. changes must be saved before running the scraper.
      </p>

      <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        <Btn variant="primary" onClick={save} disabled={!dirty}>
          {dirty ? '● Save Changes' : '✓ Saved'}
        </Btn>
        <Btn variant="secondary" onClick={addCV}>+ Add CV Profile</Btn>
        <Btn variant="ghost" onClick={loadSample}>Load Example Config</Btn>
      </div>

      {Object.keys(config).length === 0 && (
        <Card style={{ textAlign: 'center', padding: 40, color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 12 }}>
          No profiles yet. Click "Add CV Profile" or load the example config.
        </Card>
      )}

      {Object.entries(config).map(([cvName, roles]) => (
        <CVBlock
          key={cvName}
          cvName={cvName}
          roles={roles}
          onRename={(newName) => renameCV(cvName, newName)}
          onRemove={() => removeCV(cvName)}
          onAddRole={(r) => addRole(cvName, r)}
          onRemoveRole={(i) => removeRole(cvName, i)}
          roleInputRef={el => roleInputRefs.current[cvName] = el}
        />
      ))}

      <div style={{ marginTop: 28 }}>
        <SectionTitle>salary filter (global)</SectionTitle>
        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Min Salary (£)</div>
              <input
                type="number"
                value={salaryMin}
                onChange={e => setSalaryMin(e.target.value)}
                placeholder="e.g. 60000"
                style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '9px 12px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 12, outline: 'none' }}
              />
            </div>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Max Salary (£)</div>
              <input
                type="number"
                value={salaryMax}
                onChange={e => setSalaryMax(e.target.value)}
                placeholder="e.g. 120000"
                style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '9px 12px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 12, outline: 'none' }}
              />
            </div>
          </div>
          <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginTop: 10 }}>
            ⓘ Jobs with no listed salary are always included regardless of filter.
          </p>
        </Card>
      </div>

      <div style={{ marginTop: 20 }}>
        <SectionTitle>config preview</SectionTitle>
        <Card style={{ padding: 14 }}>
          <pre style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 240, overflowY: 'auto' }}>
            {JSON.stringify(config, null, 2)}
          </pre>
        </Card>
      </div>

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

function CVBlock({ cvName, roles, onRename, onRemove, onAddRole, onRemoveRole }) {
  const [nameEdit, setNameEdit] = useState(cvName)
  const [newRole, setNewRole] = useState('')

  const handleAddRole = () => {
    if (!newRole.trim()) return
    onAddRole(newRole)
    setNewRole('')
  }

  return (
    <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <input
          value={nameEdit}
          onChange={e => setNameEdit(e.target.value)}
          onBlur={() => onRename(nameEdit)}
          style={{ background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--accent)', fontFamily: 'var(--sans)', fontSize: 16, fontWeight: 700, padding: '2px 0', outline: 'none', minWidth: 120 }}
        />
        <Btn variant="danger" size="sm" onClick={onRemove}>✕ Remove</Btn>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 10 }}>
        {roles.map((role, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'var(--surface3)', border: '1px solid var(--border)',
            borderRadius: 4, padding: '5px 10px',
            fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)',
          }}>
            {role}
            <span onClick={() => onRemoveRole(i)} style={{ cursor: 'pointer', color: 'var(--text3)', marginLeft: 3, fontSize: 13, lineHeight: 1 }}>×</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={newRole}
          onChange={e => setNewRole(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAddRole()}
          placeholder="Add role e.g. Robotics Software Engineer..."
          style={{ flex: 1, background: 'var(--surface3)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 10px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 11, outline: 'none' }}
        />
        <Btn variant="secondary" size="sm" onClick={handleAddRole}>+ Role</Btn>
      </div>
    </div>
  )
}
