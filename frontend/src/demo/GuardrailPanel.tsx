/** Guardrails 面板。

 * 数据来源：
 *   - backend `summary` 事件是 source of truth，一次性下发累计值
 *   - 但为了让"运行中"阶段也能看到实时状态，我们用本地计数器即时反馈
 *   - summary 到达时用真实累计值覆盖本地计数 → 双重校验，不会重复累加
 */

import type { GuardrailState } from './types'

interface Row {
  label: string
  value: string
  ok?: boolean | null
}

export function GuardrailPanel({ g, maxSteps }: { g: GuardrailState; maxSteps: number }) {
  const rows: Row[] = [
    {
      label: 'Max Steps',
      value: `${g.steps} / ${maxSteps}` + (g.maxStepsHit ? ' · reached' : ''),
      ok: g.steps <= maxSteps && !g.maxStepsHit,
    },
    {
      label: 'Schema Validation',
      value: `${g.schemaPass} passed / ${g.schemaFail} failed`,
      ok: g.schemaFail === 0,
    },
    {
      label: 'Tool Timeout',
      value: `${g.toolTimeout}s configured · ${g.timeouts} timeout`,
      ok: g.timeouts === 0,
    },
    {
      label: 'Duplicate Call',
      value: g.duplicatesBlocked ? `${g.duplicatesBlocked} blocked` : '0 blocked',
      ok: g.duplicatesBlocked === 0,
    },
    {
      label: 'Tool Errors',
      value: String(g.toolErrors),
      ok: g.toolErrors === 0,
    },
    {
      label: 'CoT Protection',
      value: g.cotProtection ? 'Enabled ✓' : 'Disabled',
      ok: g.cotProtection,
    },
  ]

  return (
    <div className="guardrails">
      <div className="guard-grid">
        {rows.map((r) => (
          <div
            key={r.label}
            className={`guard-cell ${r.ok === null ? '' : r.ok ? 'ok' : 'bad'}`}
          >
            <span className="gc-label">{r.label}</span>
            <span className="gc-value">{r.value}</span>
          </div>
        ))}
      </div>
      {g.hits.length > 0 && (
        <ul className="guard-hits">
          {g.hits.map((h, i) => (
            <li key={i} className={h.status}>
              <span className="gh-kind">{h.kind}</span>
              <span className="gh-status">{h.status}</span>
              <span className="gh-msg">{h.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
