import { useMemo, useState } from 'react'
import { sankey, sankeyLinkHorizontal, sankeyJustify } from 'd3-sankey'
import { Card, SectionTitle } from './UI.jsx'
import { BASE_STAGES, STAGE_INFO, stageColorFor } from './StatusPipeline.jsx'

// Node colours come from the shared per-stage palette so the diagram matches
// the card accents exactly. Only the two non-stage nodes get their own colour.
const TERMINAL_NODES = new Set(['Hired', 'Rejected', 'Withdrawn', 'Ghosted', 'Still Active'])

function nodeColor(name) {
  if (name === 'Still Active') return 'var(--accent3)'  // not a stage: amber "in flight"
  if (name === 'Not Applied') return stageColorFor('none') // entry node: same grey as the cards
  return stageColorFor(name)
}

const VB_W = 960
const VB_H = 360
const NODE_WIDTH = 12
const NODE_PADDING = 18

// Effective stage list for the aggregate chart: base stages plus every "Interview Round N" seen on
// ANY tracked job. Rounds are auto-named (never free text), so the same name means the same round
// across every job and can be summed.
function aggregateStages(jobs) {
  const maxRounds = jobs.reduce((max, j) => Math.max(max, (j.custom_stages || []).length), 0)
  const roundStages = Array.from({ length: maxRounds }, (_, i) => `Interview Round ${i + 2}`)
  const idx = BASE_STAGES.indexOf('Interview')
  return [...BASE_STAGES.slice(0, idx + 1), ...roundStages, ...BASE_STAGES.slice(idx + 1)]
}

// Traces each job's actual path — Not Applied -> every stage it reached, in order -> wherever it exited
// (Hired / Rejected / Withdrawn / Ghosted / Still Active) — and tallies how many jobs walked each edge. This is
// what makes the branch points real: a job rejected right after "Applied" contributes a
// Applied -> Rejected edge, not a generic share of the final node.
function buildSankeyData(jobs) {
  const stages = aggregateStages(jobs)
  const canonicalOrder = ['Not Applied', ...stages, 'Hired', 'Still Active', 'Withdrawn', 'Ghosted', 'Rejected']

  const linkWeights = {}
  jobs.forEach(job => {
    let lastIdx = -1
    stages.forEach((s, i) => { if (job.stages?.[s]) lastIdx = i })
    const path = ['Not Applied', ...stages.slice(0, lastIdx + 1)]
    const exit = job.status === 'hired' ? 'Hired'
      : job.status === 'rejected' ? 'Rejected'
      : job.status === 'withdrawn' ? 'Withdrawn'
      : job.status === 'ghosted' ? 'Ghosted'
      : 'Still Active'
    const seq = [...path, exit]
    for (let i = 0; i < seq.length - 1; i++) {
      const key = `${seq[i]}|||${seq[i + 1]}`
      linkWeights[key] = (linkWeights[key] || 0) + 1
    }
  })

  const used = new Set()
  Object.keys(linkWeights).forEach(key => { const [a, b] = key.split('|||'); used.add(a); used.add(b) })
  const nodeNames = canonicalOrder.filter(n => used.has(n))
  const nodeIndex = Object.fromEntries(nodeNames.map((n, i) => [n, i]))

  const links = Object.entries(linkWeights).map(([key, value]) => {
    const [source, target] = key.split('|||')
    return { source: nodeIndex[source], target: nodeIndex[target], value, targetName: target }
  })
  const nodes = nodeNames.map(name => ({ name }))

  return { nodes, links }
}

export default function PipelineOverview({ jobs }) {
  const [hoveredNode, setHoveredNode] = useState(null)

  const graph = useMemo(() => {
    if (!jobs.length) return null
    const { nodes, links } = buildSankeyData(jobs)
    const layout = sankey()
      .nodeId(d => d.index)
      .nodeWidth(NODE_WIDTH)
      .nodePadding(NODE_PADDING)
      .nodeAlign(sankeyJustify)
      .extent([[1, 30], [VB_W - 140, VB_H - 50]])
    return layout({
      nodes: nodes.map((d, i) => ({ ...d, index: i })),
      links: links.map(d => ({ ...d })),
    })
  }, [jobs])

  if (!graph) return null

  const linkPath = sankeyLinkHorizontal()

  return (
    <div style={{ marginBottom: 24 }}>
      <SectionTitle>pipeline overview</SectionTitle>
      <Card>
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
          {/* Links */}
          {graph.links.map((l, i) => {
            // Links into an outcome take its colour (a red rejected branch is
            // informative); stage-to-stage flow carries its source stage colour
            // so the diagram sweeps through the same progression as the cards.
            const color = TERMINAL_NODES.has(l.targetName) ? nodeColor(l.targetName) : nodeColor(l.source.name)
            const dim = hoveredNode && l.source.name !== hoveredNode && l.target.name !== hoveredNode
            return (
              <path
                key={i}
                d={linkPath(l)}
                fill="none"
                stroke={color}
                strokeWidth={Math.max(1, l.width)}
                strokeOpacity={dim ? 0.08 : 0.28}
                style={{ transition: 'stroke-opacity 0.15s' }}
              />
            )
          })}

          {/* Nodes */}
          {graph.nodes.map((n, i) => {
            const color = nodeColor(n.name)
            const labelRight = n.x0 > VB_W - 220 // terminal column: label to the right, horizontal
            return (
              <g
                key={i}
                onMouseEnter={() => setHoveredNode(n.name)}
                onMouseLeave={() => setHoveredNode(null)}
                style={{ cursor: 'default' }}
              >
                <rect
                  x={n.x0} y={n.y0} width={n.x1 - n.x0} height={Math.max(2, n.y1 - n.y0)}
                  rx={2} fill={color}
                  opacity={hoveredNode && hoveredNode !== n.name ? 0.45 : 1}
                  style={{ transition: 'opacity 0.15s' }}
                >
                  <title>{`${n.name}${STAGE_INFO[n.name] ? ` — ${STAGE_INFO[n.name]}` : ''} — ${n.value} job${n.value !== 1 ? 's' : ''}`}</title>
                </rect>
                {labelRight ? (
                  <>
                    <text x={n.x1 + 10} y={(n.y0 + n.y1) / 2 - 4} fontFamily="var(--mono)" fontSize="12" fontWeight="700" fill="var(--text)">
                      {n.value}
                    </text>
                    <text x={n.x1 + 10} y={(n.y0 + n.y1) / 2 + 10} fontFamily="var(--mono)" fontSize="10" fill="var(--text2)">
                      {n.name}
                    </text>
                  </>
                ) : (
                  <>
                    <text x={(n.x0 + n.x1) / 2} y={n.y0 - 10} textAnchor="middle" fontFamily="var(--mono)" fontSize="12" fontWeight="700" fill={n.value === 0 ? 'var(--text3)' : 'var(--text)'}>
                      {n.value}
                    </text>
                    <text
                      x={(n.x0 + n.x1) / 2} y={VB_H - 30} textAnchor="middle"
                      fontFamily="var(--mono)" fontSize="9" fill="var(--text3)"
                      transform={`rotate(-40 ${(n.x0 + n.x1) / 2} ${VB_H - 30})`}
                    >
                      {n.name.replace('Interview Round ', 'R')}
                    </text>
                  </>
                )}
              </g>
            )
          })}
        </svg>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', marginTop: 12 }}>
          // each job's actual path is traced individually — a job rejected right after "Applied" branches off there, not at the end
        </div>
      </Card>
    </div>
  )
}
