/** 左侧栏：历史会话 + Demo 示例问题 + 运行信息。 */

import type { HealthInfo, SessionItem } from '../types'

export const SAMPLE_QUESTIONS = [
  { icon: '🛰️', text: '分析星海科技有限公司的综合风险' },
  { icon: '⚖️', text: '查询星海科技有限公司的法律风险' },
  { icon: '📊', text: '分析星海科技有限公司的财务状况' },
  { icon: '📝', text: '生成星海科技有限公司风险报告' },
  { icon: '📚', text: '企业资产负债率过高意味着什么' },
]

interface Props {
  sessions: SessionItem[]
  currentSession: string | null
  health: HealthInfo | null
  onPickQuestion: (q: string) => void
  onSelectSession: (id: string) => void
  onNewChat: () => void
}

export function Sidebar({
  sessions,
  currentSession,
  health,
  onPickQuestion,
  onSelectSession,
  onNewChat,
}: Props) {
  return (
    <aside className="sidebar">
      <button className="new-chat" onClick={onNewChat}>
        <span>＋</span> 新建分析会话
      </button>

      <div className="side-block">
        <h3>💡 Demo 示例问题</h3>
        <div className="sample-list">
          {SAMPLE_QUESTIONS.map((q) => (
            <button key={q.text} className="sample-btn" onClick={() => onPickQuestion(q.text)}>
              <span className="sample-icon">{q.icon}</span>
              <span>{q.text}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="side-block grow">
        <h3>🗂️ 历史会话</h3>
        <div className="session-list">
          {sessions.length === 0 && <div className="side-empty">暂无会话，问点什么吧 ≧▽≦</div>}
          {sessions.map((s) => (
            <button
              key={s.id}
              className={`session-item ${s.id === currentSession ? 'active' : ''}`}
              onClick={() => onSelectSession(s.id)}
            >
              <span className="session-dot" />
              <span className="session-title">{s.title}</span>
              <span className="session-count">{s.message_count}</span>
            </button>
          ))}
        </div>
      </div>

      {health && (
        <div className="side-footer">
          <div className="mode-chip">
            <span className={`dot ${health.mode === 'mock' ? 'medium' : 'low'}`} />
            {health.mode === 'mock' ? 'MOCK MODE' : 'REAL LLM'}
          </div>
          <div className="side-meta">Model: {health.model}</div>
          <div className="side-meta">
            Tools: {health.tools.length} ｜ RAG: {health.rag.chunks} chunks
          </div>
          <div className="side-meta">Max Steps: {health.max_steps}</div>
        </div>
      )}
    </aside>
  )
}
