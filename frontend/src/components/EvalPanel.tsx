/** Agent Eval 面板：工具选择准确率 / 任务成功率 / 平均步数 / 平均延迟。 */

import { useCallback, useEffect, useState } from 'react'
import type { EvalSummary } from '../types'
import { api } from '../services/api'

export function EvalPanel() {
  const [summary, setSummary] = useState<EvalSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const run = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setSummary(await api.eval())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void run()
  }, [run])

  return (
    <div className="eval-panel">
      <div className="eval-head">
        <div>
          <h4>🧪 Agent Eval</h4>
          <span className="eval-desc">基于 tests/eval_cases.json 的轻量评测</span>
        </div>
        <button className="ghost-btn" onClick={run} disabled={loading}>
          {loading ? '运行中…' : '重新运行'}
        </button>
      </div>

      {error && <div className="msg-error">⚠️ {error}</div>}

      {summary && (
        <>
          <div className="eval-stats">
            <div className="stat">
              <strong>{Math.round(summary.task_success_rate * 100)}%</strong>
              <span>Task Success</span>
            </div>
            <div className="stat">
              <strong>{Math.round(summary.tool_selection_accuracy * 100)}%</strong>
              <span>Tool Accuracy</span>
            </div>
            <div className="stat">
              <strong>{summary.avg_steps}</strong>
              <span>Avg Steps</span>
            </div>
            <div className="stat">
              <strong>{Math.round(summary.avg_latency_ms)}ms</strong>
              <span>Avg Latency</span>
            </div>
          </div>

          <div className="eval-cases">
            {summary.cases.map((c) => (
              <div key={c.id} className={`eval-case ${c.success ? 'pass' : 'fail'}`}>
                <div className="eval-case-head">
                  <span className={`tag ${c.success ? 'ok' : 'no'}`}>{c.success ? 'PASS' : 'FAIL'}</span>
                  <span className="eval-query">{c.query}</span>
                </div>
                <div className="eval-tools">
                  <div>
                    <span className="eval-label">期望</span>
                    {c.expected_tools.map((t) => (
                      <code key={t}>{t}</code>
                    ))}
                  </div>
                  <div>
                    <span className="eval-label">实际</span>
                    {c.actual_tools.map((t) => (
                      <code key={t} className="dim">
                        {t}
                      </code>
                    ))}
                  </div>
                </div>
                <div className="eval-case-foot">
                  accuracy {Math.round(c.tool_accuracy * 100)}% · {c.steps} steps · {c.latency_ms} ms
                </div>
              </div>
            ))}
          </div>

          <div className="eval-mode">
            运行模式：{summary.mode} / {summary.model} · 共 {summary.total_cases} 个用例
          </div>
        </>
      )}
    </div>
  )
}
