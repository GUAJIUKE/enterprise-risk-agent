/** Agent Loop：PLAN → ACTION → TOOL → OBSERVATION → (循环) → FINAL，当前阶段高亮。 */

import type { LoopPhase } from './types'

const PHASES: { key: LoopPhase; label: string; hint: string }[] = [
  { key: 'plan', label: 'PLAN', hint: '模型决定下一步' },
  { key: 'action', label: 'ACTION', hint: '输出 tool call' },
  { key: 'tool', label: 'TOOL', hint: 'BaseTool 执行' },
  { key: 'observation', label: 'OBSERVATION', hint: '结果回灌上下文' },
  { key: 'final', label: 'FINAL', hint: '产出最终答复' },
]

export function AgentLoop({ phase }: { phase: LoopPhase }) {
  const idx = PHASES.findIndex((p) => p.key === phase)

  return (
    <div className="agent-loop">
      {PHASES.map((p, i) => (
        <div className="loop-step" key={p.key}>
          <div className={`loop-box ${phase === p.key ? 'active' : ''} ${idx > i ? 'passed' : ''}`}>
            <span className="lb-label">{p.label}</span>
            <span className="lb-hint">{p.hint}</span>
          </div>
          {i < PHASES.length - 1 && (
            <div className="loop-arrow">{i === PHASES.length - 2 ? '↻ 回到 PLAN' : '↓'}</div>
          )}
        </div>
      ))}
    </div>
  )
}
