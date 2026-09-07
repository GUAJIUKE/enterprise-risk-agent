/** Demo Studio：LEFT = Engineering View（Runtime Console），RIGHT = Product View。 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { navigate } from '../router'
import { ProductPreview } from './ProductPreview'
import { RuntimeConsole } from './RuntimeConsole'
import { useDemoRun } from './useDemoRun'

const DEMO_QUESTION = '请分析星海科技有限公司的综合风险，并生成风险报告'

const SAMPLE_QUESTIONS = [
  '请分析星海科技有限公司的综合风险，并生成风险报告',
  '查询星海科技有限公司的法律风险',
  '星海科技有限公司成立于什么时候？',
  '企业资产负债率过高意味着什么？',
]

export function DemoStudio() {
  const [speed, setSpeed] = useState<'normal' | 'presentation'>('presentation')
  const [presentation, setPresentation] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [paused, setPaused] = useState(false)
  const [leftPct, setLeftPct] = useState(42)  // 默认 42% 适配 1920×1080 投屏
  const [input, setInput] = useState('')
  const { state, send, abort, clear, reset, checkHealth } = useDemoRun(speed)
  const splitRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  // 启动时检查 backend 健康
  useEffect(() => {
    void checkHealth()
    const id = setInterval(() => {
      if (state.backendHealth !== 'ready') void checkHealth()
    }, 5000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 拖动分隔条
  const onMouseDown = useCallback(() => {
    draggingRef.current = true
    document.body.classList.add('dragging')
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !splitRef.current) return
      const rect = splitRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setLeftPct(Math.min(60, Math.max(28, pct)))
    }
    const onUp = () => {
      draggingRef.current = false
      document.body.classList.remove('dragging')
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mousemove', onUp)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mousemove', onUp)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // Presentation 时自动开启演示节奏
  useEffect(() => {
    if (presentation) setSpeed('presentation')
  }, [presentation])

  const handleSend = useCallback(
    (text: string) => {
      setPaused(false)
      void send(text)
    },
    [send],
  )

  const handleLoadDemo = useCallback(() => {
    reset()
    setInput(DEMO_QUESTION)
  }, [reset])

  const handleReset = useCallback(() => {
    reset()
    setInput('')
    setPaused(false)
  }, [reset])

  const sseState = useMemo(() => {
    switch (state.status) {
      case 'streaming':
        return { txt: '● STREAMING', cls: 'live' }
      case 'connecting':
        return { txt: '● CONNECTING', cls: 'live' }
      case 'completed':
      case 'closed':
        return { txt: '○ CLOSED', cls: '' }
      case 'idle':
        return { txt: '○ IDLE', cls: '' }
      case 'aborted':
        return { txt: '✋ ABORTED', cls: 'warn' }
      case 'error':
        return { txt: '⛔ ERROR', cls: 'err' }
      default:
        return { txt: '○ IDLE', cls: '' }
    }
  }, [state.status])

  return (
    <div className={`demo-studio ${presentation ? 'presentation' : ''}`}>
      <header className="demo-topbar">
        {!presentation && (
          <div className="dt-left">
            <span className="dt-logo">🛡️</span>
            <div className="dt-title">
              <h1>Enterprise Risk Agent</h1>
              <p>DEMO STUDIO · Runtime Console × Product Preview</p>
            </div>
            <span className="dt-live">
              <i />
              LIVE
            </span>
          </div>
        )}

        <div className="dt-status">
          {state.backendHealth === 'ready' ? (
            <span className="pill ok">● BACKEND READY</span>
          ) : state.backendHealth === 'offline' ? (
            <span className="pill bad">○ BACKEND OFFLINE</span>
          ) : (
            <span className="pill">… CHECKING</span>
          )}
          <span className="pill">
            {(state.meta?.mode ?? 'unknown').toString().toUpperCase()}
          </span>
          <span className={`pill ${sseState.cls}`}>SSE {sseState.txt}</span>
        </div>

        <div className="dt-actions">
          <button
            className="dbtn primary"
            onClick={handleLoadDemo}
            title="填入示例问题（不会自动发送，需点 Send 才启动 Agent）"
          >
            ▶ LOAD DEMO
          </button>
          <button className="dbtn" onClick={handleReset}>
            ↺ RESET DEMO
          </button>
          {!presentation && (
            <select
              className="dsel"
              value={speed}
              onChange={(e) => setSpeed(e.target.value as 'normal' | 'presentation')}
              title="只影响 UI 展示节奏，不修改 Agent 真实行为"
            >
              <option value="normal">Demo Speed: Normal</option>
              <option value="presentation">Demo Speed: Presentation</option>
            </select>
          )}
          <button
            className={`dbtn ${presentation ? 'on' : ''}`}
            onClick={() => setPresentation((v) => !v)}
            title="1920×1080 面试投屏模式：隐藏冗余信息、放大部分字号"
          >
            🖥 Presentation
          </button>
          <button className="dbtn ghost" onClick={() => navigate('/')}>
            ← 产品页
          </button>
        </div>
      </header>

      <div className="demo-split" ref={splitRef}>
        <div className="demo-left" style={{ width: `${leftPct}%` }}>
          <div className="pane-label">
            <span>AGENT RUNTIME</span>
            <em>Developer View</em>
          </div>
          <RuntimeConsole
            state={state}
            paused={paused}
            autoScroll={autoScroll}
            presentation={presentation}
            onToggleAutoScroll={() => setAutoScroll((v) => !v)}
            onTogglePause={() => setPaused((v) => !v)}
            onClear={clear}
          />
        </div>

        <div className="demo-divider" onMouseDown={onMouseDown} title="拖动调整宽度">
          <span />
        </div>

        <div className="demo-right" style={{ width: `${100 - leftPct}%` }}>
          <div className="pane-label light">
            <span>PRODUCT PREVIEW</span>
            <em>User View</em>
          </div>
          <ProductPreview
            state={state}
            input={input}
            onInputChange={setInput}
            onSend={handleSend}
            onAbort={abort}
            presentation={presentation}
            sampleQuestions={SAMPLE_QUESTIONS}
            onLoadSample={(q) => setInput(q)}
          />
        </div>
      </div>
    </div>
  )
}
