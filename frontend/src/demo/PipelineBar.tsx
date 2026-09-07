/** Pipeline 进度条：对已发生事件的 UI 映射（Agent 真实顺序仍由模型决定）。 */

import { PIPELINE_ORDER, type Pipeline } from './types'

const STATE_ICON: Record<string, string> = {
  waiting: '○',
  running: '◐',
  success: '✓',
  error: '✕',
}

export function PipelineBar({ pipeline }: { pipeline: Pipeline }) {
  return (
    <div className="pipeline">
      {PIPELINE_ORDER.map((node, i) => {
        const st = pipeline[node.key]
        return (
          <div className={`pipe-node ${st}`} key={node.key}>
            <span className="pipe-icon">{STATE_ICON[st]}</span>
            <span className="pipe-label">{node.label}</span>
            <span className="pipe-state">{st.toUpperCase()}</span>
            {i < PIPELINE_ORDER.length - 1 && <span className="pipe-arrow">→</span>}
          </div>
        )
      })}
    </div>
  )
}
