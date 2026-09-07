/** Agent 执行过程面板：只展示工具调用与简短状态说明，不展示模型内部推理。 */

import { useState } from 'react'
import type { TrajectoryStep } from '../types'

const TOOL_LABEL: Record<string, string> = {
  company_info_tool: '🏢 Company Info',
  risk_search_tool: '⚠️ Risk Search',
  financial_analysis_tool: '📊 Financial Analysis',
  knowledge_search_tool: '📚 Knowledge Retrieval',
  report_generator_tool: '📝 Report Generator',
  finalize: '✅ Final Answer',
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function StatusIcon({ status }: { status: TrajectoryStep['status'] }) {
  if (status === 'running') return <span className="spin">⟳</span>
  if (status === 'error') return <span className="status-icon error">✕</span>
  if (status === 'pending') return <span className="status-icon pending">○</span>
  return <span className="status-icon success">✓</span>
}

export function TracePanel({
  steps,
  running,
}: {
  steps: TrajectoryStep[]
  running: boolean
}) {
  const [open, setOpen] = useState<Record<number, boolean>>({})

  if (!steps.length && !running) {
    return (
      <div className="trace-empty">
        <div className="empty-emoji">🛰️</div>
        <p>Agent 执行轨迹会实时显示在这里</p>
        <span>每一步包含 Tool / Input / Output / Duration / Status</span>
      </div>
    )
  }

  return (
    <div className="trace-list">
      {steps.map((step) => {
        const expanded = open[step.step] ?? false
        return (
          <div key={step.step} className={`trace-card ${step.status}`}>
            <div
              className="trace-head"
              onClick={() => setOpen({ ...open, [step.step]: !expanded })}
              role="button"
              tabIndex={0}
            >
              <StatusIcon status={step.status} />
              <div className="trace-title">
                <strong>{TOOL_LABEL[step.action] ?? step.action}</strong>
                <span>{step.thought_summary}</span>
              </div>
              <span className="trace-duration">{step.duration_ms} ms</span>
              <span className="chevron">{expanded ? '▾' : '▸'}</span>
            </div>

            {expanded && (
              <div className="trace-body">
                <div className="kv">
                  <span>Tool</span>
                  <code>{step.action}</code>
                </div>
                <div className="kv-col">
                  <span>Input</span>
                  <pre>{pretty(step.input)}</pre>
                </div>
                <div className="kv-col">
                  <span>{step.error ? 'Error' : 'Output'}</span>
                  <pre>{step.error ? step.error : pretty(step.observation)}</pre>
                </div>
                <div className="kv">
                  <span>Duration</span>
                  <code>{step.duration_ms} ms</code>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {running && (
        <div className="trace-card running">
          <div className="trace-head">
            <span className="spin">⟳</span>
            <div className="trace-title">
              <strong>Agent 正在思考…</strong>
              <span>判断下一步 Action</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
