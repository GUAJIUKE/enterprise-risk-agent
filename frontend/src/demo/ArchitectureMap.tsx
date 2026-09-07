/** Agent 架构图：Tool Router 是 fan-out 中心；Financial 连 Python；Knowledge Search 连 RAG。
 *
 * 真实运行时：
 *  - Agent → Orchestrator → LLM/Mock Planner → Tool Router
 *  - Tool Router 根据模型决定调用哪个 Tool，对应分支节点高亮
 */

import type { ArchNode } from './types'

interface Node {
  id: ArchNode
  label: string
  sub?: string
}

/** 拓扑：上层是入口；Tool Router 下面扇出 5 个工具；其中 Financial ⇢ Python, Knowledge ⇢ RAG。 */
const ENTRY: Node[] = [
  { id: 'user', label: 'User Request' },
]
const ROUTER_ROW: Node[] = [
  { id: 'orchestrator', label: 'Agent Orchestrator', sub: 'Plan → Action → Observation' },
]
const LLM: Node[] = [
  { id: 'llm', label: 'LLM / Mock Planner', sub: 'decides next action' },
]
const ROUTER: Node[] = [
  { id: 'router', label: 'Tool Router', sub: 'dispatch by name' },
]
const TOOLS: Node[][] = [
  [
    { id: 'company', label: 'Company Info', sub: '工商信息' },
    { id: 'risk', label: 'Risk Search', sub: '事件检索' },
    { id: 'financial', label: 'Financial Analysis', sub: '指标计算' },
    { id: 'knowledge', label: 'Knowledge Search', sub: '依据检索' },
    { id: 'report', label: 'Report Generator', sub: '汇总报告' },
  ],
]
const EXTENSIONS: Node[][] = [
  [],
  [{ id: 'python', label: 'Python', sub: 'deterministic calc' }],
  [],
  [{ id: 'rag', label: 'RAG Retriever', sub: 'Top-K + cosine' }],
  [],
]
const FINAL: Node[] = [
  { id: 'answer', label: 'Final Answer' },
]

export function ArchitectureMap({ active, compact }: { active: ArchNode[]; compact?: boolean }) {
  const isActive = (id: ArchNode) => active.includes(id)

  return (
    <div className={`arch ${compact ? 'compact' : ''}`}>
      <ArchRow nodes={ENTRY} active={active} />
      <ArchArrow />
      <ArchRow nodes={ROUTER_ROW} active={active} />
      <ArchArrow />
      <ArchRow nodes={LLM} active={active} />
      <ArchArrow />
      <ArchRow nodes={ROUTER} active={active} />
      <ArchArrow />

      <div className="arch-fanout">
        {[0, 1, 2, 3, 4].map((i) => (
          <div className="arch-fan-col" key={i}>
            {TOOLS[0][i] && (
              <div className={`arch-node ${isActive(TOOLS[0][i].id) ? 'active' : ''}`}>
                <span className="an-label">{TOOLS[0][i].label}</span>
                <span className="an-sub">{TOOLS[0][i].sub}</span>
              </div>
            )}
            {EXTENSIONS[i]?.[0] && (
              <>
                <div className={`arch-mini-arrow ${isActive(EXTENSIONS[i][0].id) ? 'active' : ''}`}>↓</div>
                <div className={`arch-node ext ${isActive(EXTENSIONS[i][0].id) ? 'active' : ''}`}>
                  <span className="an-label">{EXTENSIONS[i][0].label}</span>
                  <span className="an-sub">{EXTENSIONS[i][0].sub}</span>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <ArchArrow />
      <ArchRow nodes={FINAL} active={active} />
    </div>
  )
}

function ArchRow({ nodes, active }: { nodes: Node[]; active: ArchNode[] }) {
  const isActive = (id: ArchNode) => active.includes(id)
  return (
    <div className="arch-row">
      <div className="arch-nodes">
        {nodes.map((n) => (
          <div key={n.id} className={`arch-node ${isActive(n.id) ? 'active' : ''}`}>
            <span className="an-label">{n.label}</span>
            {n.sub && <span className="an-sub">{n.sub}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

function ArchArrow() {
  return <div className="arch-arrow">↓</div>
}
