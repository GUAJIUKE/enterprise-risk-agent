/** 风险可视化仪表盘：等级卡片 + 进度条 + 指标 + 证据 + 建议。 */

import type { RiskLevel, RiskReport } from '../types'

const LEVEL_META: Record<RiskLevel, { color: string; emoji: string; label: string }> = {
  LOW: { color: 'low', emoji: '🟢', label: '低风险' },
  MEDIUM: { color: 'medium', emoji: '🟡', label: '中等风险' },
  HIGH: { color: 'high', emoji: '🔴', label: '高风险' },
}

const LEVEL_SCORE: Record<RiskLevel, number> = { LOW: 25, MEDIUM: 60, HIGH: 90 }

function RiskCard({ title, level, emoji }: { title: string; level: RiskLevel; emoji: string }) {
  const meta = LEVEL_META[level]
  return (
    <div className={`risk-card ${meta.color}`}>
      <div className="risk-card-top">
        <span className="risk-emoji">{emoji}</span>
        <span className="risk-card-title">{title}</span>
      </div>
      <div className={`risk-level level-${meta.color}`}>{level}</div>
      <div className="risk-card-label">{meta.label}</div>
      <div className="bar">
        <div className={`bar-fill ${meta.color}`} style={{ width: `${LEVEL_SCORE[level]}%` }} />
      </div>
    </div>
  )
}

export function RiskDashboard({ report }: { report: RiskReport }) {
  const overall = LEVEL_META[report.overall_risk]

  return (
    <div className="dashboard">
      <div className="dash-hero">
        <div>
          <div className="dash-company">{report.company_name}</div>
          <div className="dash-sub">Overall Risk</div>
        </div>
        <div className={`dash-badge ${overall.color}`}>
          <span>{overall.emoji}</span>
          {report.overall_risk}
        </div>
      </div>

      <div className="dash-score">
        <div className="dash-score-head">
          <span>综合风险评分</span>
          <strong>{report.overall_score} / 100</strong>
        </div>
        <div className="bar big">
          <div className={`bar-fill ${overall.color}`} style={{ width: `${report.overall_score}%` }} />
        </div>
      </div>

      <div className="risk-grid">
        <RiskCard title="Financial Risk" level={report.financial_risk} emoji="📉" />
        <RiskCard title="Legal Risk" level={report.legal_risk} emoji="⚖️" />
        <RiskCard title="Operation Risk" level={report.operation_risk} emoji="🏭" />
      </div>

      {report.metrics.length > 0 && (
        <section className="dash-section">
          <h4>📊 关键财务指标</h4>
          <div className="metric-grid">
            {report.metrics.map((m) => (
              <div className="metric" key={m.name}>
                <span className="metric-name">{m.name}</span>
                <strong className="metric-value">
                  {m.value}
                  {m.unit}
                </strong>
                <span className="metric-comment">{m.comment}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {report.evidence.length > 0 && (
        <section className="dash-section">
          <h4>🔍 Risk Evidence</h4>
          <ul className="evidence-list">
            {report.evidence.map((e, idx) => (
              <li key={idx} className={`evidence ${LEVEL_META[e.severity].color}`}>
                <span className="dot" />
                <div>
                  <div className="evidence-text">{e.text}</div>
                  <div className="evidence-source">来源：{e.source || '-'}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.recommendations.length > 0 && (
        <section className="dash-section">
          <h4>💡 Recommendations</h4>
          <ol className="rec-list">
            {report.recommendations.map((r, idx) => (
              <li key={idx}>{r}</li>
            ))}
          </ol>
        </section>
      )}

      {report.sources.length > 0 && (
        <div className="dash-sources">
          数据来源：{report.sources.join(' · ')}
        </div>
      )}
    </div>
  )
}
