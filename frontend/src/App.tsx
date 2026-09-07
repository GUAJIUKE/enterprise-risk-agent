import { useCallback, useEffect, useRef, useState } from 'react'
import { ChatPanel } from './components/ChatPanel'
import { Sidebar } from './components/Sidebar'
import { TracePanel } from './components/TracePanel'
import { RiskDashboard } from './components/RiskDashboard'
import { EvalPanel } from './components/EvalPanel'
import { navigate } from './router'
import { api, streamChat } from './services/api'
import type { HealthInfo, Message, RiskReport, SessionItem, TrajectoryStep } from './types'

type RightTab = 'trace' | 'dashboard' | 'eval'

export default function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [steps, setSteps] = useState<TrajectoryStep[]>([])
  const [report, setReport] = useState<RiskReport | null>(null)
  const [running, setRunning] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [tab, setTab] = useState<RightTab>('trace')
  const abortRef = useRef<AbortController | null>(null)
  const bootedRef = useRef(false)

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await api.sessions())
    } catch {
      /* 静默失败：会话列表不是核心链路 */
    }
  }, [])

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null))
    void refreshSessions()

    // 支持 ?q=xxx 自动发起提问（演示 / 截图 / 分享链接用）
    if (bootedRef.current) return
    bootedRef.current = true
    const question = new URLSearchParams(window.location.search).get('q')
    if (question) {
      window.history.replaceState({}, '', window.location.pathname)
      setTimeout(() => void send(question), 300)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSessions])

  /** 更新最后一条 assistant 消息 */
  const patchAssistant = useCallback((patch: Partial<Message>) => {
    setMessages((prev) => {
      if (!prev.length) return prev
      const next = [...prev]
      next[next.length - 1] = { ...next[next.length - 1], ...patch }
      return next
    })
  }, [])

  const send = useCallback(
    async (text: string) => {
      if (running || !text.trim()) return

      const userMsg: Message = { id: `u_${Date.now()}`, role: 'user', content: text }
      const botMsg: Message = {
        id: `a_${Date.now()}`,
        role: 'assistant',
        content: '',
        streaming: true,
        trajectory: [],
      }
      setMessages((prev) => [...prev, userMsg, botMsg])
      setSteps([])
      setReport(null)
      setTab('trace')
      setRunning(true)

      const controller = new AbortController()
      abortRef.current = controller
      // SSE 是逐步到达的，用 ref 累积比用 state 回调更可靠
      let accContent = ''
      let accSteps: TrajectoryStep[] = []

      await streamChat(
        text,
        sessionId,
        {
          onStart: (meta) => {
            if (meta.session_id) setSessionId(meta.session_id)
          },
          onStep: (step) => {
            accSteps = [...accSteps, step]
            setSteps(accSteps)
            patchAssistant({ trajectory: accSteps })
          },
          onToken: ({ text }) => {
            accContent += text
            patchAssistant({ content: accContent })
          },
          onReport: (r) => {
            setReport(r)
            patchAssistant({ report: r })
          },
          onDone: ({ answer, meta }) => {
            accContent = answer
            patchAssistant({ content: answer, streaming: false, meta })
          },
          onError: (message) => {
            patchAssistant({ streaming: false, error: message })
          },
        },
        controller.signal,
      )

      // token 事件单独处理（避免闭包覆盖）
      setRunning(false)
      abortRef.current = null
      void refreshSessions()
    },
    [patchAssistant, refreshSessions, running, sessionId],
  )

  const abort = useCallback(() => {
    abortRef.current?.abort()
    setRunning(false)
    patchAssistant({ streaming: false })
  }, [patchAssistant])

  const newChat = useCallback(() => {
    setMessages([])
    setSteps([])
    setReport(null)
    setSessionId(null)
  }, [])

  const selectSession = useCallback(async (id: string) => {
    try {
      const data = await api.getSession(id)
      setSessionId(id)
      setMessages(
        data.messages.map((m, idx) => ({
          id: `${id}_${idx}`,
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      )
      setSteps(data.trajectory || [])
      setReport(data.report)
      setTab(data.report ? 'dashboard' : 'trace')
    } catch {
      /* 会话不存在时保持当前视图 */
    }
  }, [])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-logo">🛡️</div>
          <div>
            <h1>Enterprise Risk Analyst</h1>
            <p>企业风险分析智能体 · LLM Agent + Tool Calling + RAG</p>
          </div>
        </div>
        <div className="topbar-right">
          <button className="demo-entry" onClick={() => navigate('/demo')} title="打开 Agent 演示控制台">
            🎛️ Demo Studio
          </button>
          <span className={`mode-badge ${health?.mode === 'mock' ? 'mock' : 'real'}`}>
            {health?.mode === 'mock' ? '🧪 Mock Mode' : '🌐 Real LLM'}
          </span>
          <span className="topbar-meta">{health ? `${health.model} · max ${health.max_steps} steps` : '连接中…'}</span>
        </div>
      </header>

      <main className="layout">
        <Sidebar
          sessions={sessions}
          currentSession={sessionId}
          health={health}
          onPickQuestion={send}
          onSelectSession={selectSession}
          onNewChat={newChat}
        />

        <ChatPanel messages={messages} running={running} onSend={send} onAbort={abort} />

        <section className="right-panel">
          <div className="tabs">
            <button className={tab === 'trace' ? 'active' : ''} onClick={() => setTab('trace')}>
              🛰️ Execution
            </button>
            <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>
              📊 Dashboard
            </button>
            <button className={tab === 'eval' ? 'active' : ''} onClick={() => setTab('eval')}>
              🧪 Eval
            </button>
          </div>

          <div className="tab-content">
            {tab === 'trace' && <TracePanel steps={steps} running={running} />}
            {tab === 'dashboard' &&
              (report ? <RiskDashboard report={report} /> : <div className="trace-empty">还没有生成报告，先问一句「生成星海科技有限公司风险报告」吧 ✨</div>)}
            {tab === 'eval' && <EvalPanel />}
          </div>
        </section>
      </main>
    </div>
  )
}
