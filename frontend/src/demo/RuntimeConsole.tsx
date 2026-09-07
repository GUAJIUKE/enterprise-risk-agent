/** 左侧 Agent Runtime Console：开发者视角，全部数据来自同一条 SSE 流。
 *
 * 布局（P1-2）：
 *   ┌─ sticky overview (Status + Pipeline + Loop + Guardrails)─┐
 *   ├─ 独立滚动 Runtime Timeline                              ┤
 *   ├─ 可折叠 Architecture                                     ┤
 *   └─ 可折叠 Raw Event Stream                                  ┘
 *
 * Pause View 只冻结 Timeline 渲染（Agent 真实状态继续更新）。
 */

import { useEffect, useRef, useState } from 'react'
import { AgentLoop } from './AgentLoop'
import { ArchitectureMap } from './ArchitectureMap'
import { EventCard } from './EventCard'
import { GuardrailPanel } from './GuardrailPanel'
import { PipelineBar } from './PipelineBar'
import { RawEventStream } from './RawEventStream'
import type { DemoState } from './types'

interface Props {
  state: DemoState
  paused: boolean
  autoScroll: boolean
  presentation: boolean
  onToggleAutoScroll: () => void
  onTogglePause: () => void
  onClear: () => void
}

const STATUS_TEXT: Record<DemoState['status'], string> = {
  idle: 'IDLE',
  connecting: 'CONNECTING',
  streaming: 'STREAMING',
  completed: 'COMPLETED',
  closed: 'CLOSED',
  error: 'ERROR',
  aborted: 'ABORTED',
}

function Section({
  title,
  children,
  defaultOpen = true,
  right,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  right?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`console-section ${open ? '' : 'closed'}`}>
      <button className="cs-head" onClick={() => setOpen((v) => !v)}>
        <span className="cs-caret">{open ? '▾' : '▸'}</span>
        <span className="cs-title">{title}</span>
        <span className="cs-right" onClick={(e) => e.stopPropagation()}>
          {right}
        </span>
      </button>
      {open && <div className="cs-body">{children}</div>}
    </section>
  )
}

export function RuntimeConsole({
  state,
  paused,
  autoScroll,
  presentation,
  onToggleAutoScroll,
  onTogglePause,
  onClear,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const overviewRef = useRef<HTMLDivElement>(null)
  const [frozen, setFrozen] = useState<number | null>(null)

  // Pause View 只冻结 Timeline 渲染（Agent 真实状态在右侧继续更新）
  useEffect(() => {
    setFrozen(paused ? state.events.length : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused])

  const visible = frozen !== null ? state.events.slice(0, frozen) : state.events

  useEffect(() => {
    if (autoScroll && !paused) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [visible.length, autoScroll, paused])

  const meta = state.meta
  const maxSteps = meta?.max_steps ?? meta?.guardrails?.max_steps ?? 8
  const healthPill = state.backendHealth

  return (
    <div className={`runtime-console ${presentation ? 'presentation' : ''}`}>
      <div className="console-toolbar">
        <button className={`ctl ${autoScroll ? 'on' : ''}`} onClick={onToggleAutoScroll}>
          Auto Scroll {autoScroll ? 'ON' : 'OFF'}
        </button>
        <button
          className={`ctl ${paused ? 'on' : ''}`}
          onClick={onTogglePause}
          title="只暂停 Timeline 渲染；Agent 后台任务继续执行"
        >
          {paused ? '▶ Resume Timeline' : '⏸ Pause Timeline'}
        </button>
        <button className="ctl" onClick={onClear} title="只清除 Timeline 与 Raw Events，不动其它状态">
          🧹 Clear Timeline
        </button>
        {paused && <span className="ctl-note">timeline paused · agent keeps running</span>}
      </div>

      {/* sticky 顶部 overview — 一屏内能看完"原理 + 进度 + 护栏" */}
      <div className="overview" ref={overviewRef}>
        <div className={`console-status ${state.status}`}>
          <div className="status-main">
            <span className="status-dot" />
            <strong>{STATUS_TEXT[state.status]}</strong>
            <span
              className={`health-pill ${healthPill}`}
              title={healthPill === 'ready' ? 'GET /api/health OK' : healthPill === 'offline' ? '后端不可达' : '检查中'}
            >
              {healthPill === 'ready'
                ? '● BACKEND READY'
                : healthPill === 'offline'
                ? '○ BACKEND OFFLINE'
                : '… checking'}
            </span>
          </div>
          <div className="status-grid">
            <div>
              <span>REQUEST ID</span>
              <b>{state.requestId ?? '—'}</b>
            </div>
            <div>
              <span>SESSION ID</span>
              <b>{meta?.session_id ?? '—'}</b>
            </div>
            <div>
              <span>MODE</span>
              <b>{meta ? (meta.mode === 'mock' ? 'MOCK' : 'REAL LLM') : '—'}</b>
            </div>
            <div>
              <span>MODEL</span>
              <b>{meta?.model ?? '—'}</b>
            </div>
            <div>
              <span>STEPS</span>
              <b>
                {state.guardrails.steps} / {maxSteps}
              </b>
            </div>
            <div>
              <span>TOTAL LATENCY</span>
              <b>{state.latencyMs ? `${(state.latencyMs / 1000).toFixed(2)}s` : '—'}</b>
            </div>
          </div>
        </div>

        <Section title="PIPELINE">
          <PipelineBar pipeline={state.pipeline} />
        </Section>

        <Section title="AGENT LOOP">
          <AgentLoop phase={state.loopPhase} />
        </Section>

        <Section title="GUARDRAILS">
          <GuardrailPanel g={state.guardrails} maxSteps={maxSteps} />
        </Section>
      </div>

      {/* 独立滚动 Timeline */}
      <div className="timeline-wrap">
        <div className="timeline-head">RUNTIME TIMELINE</div>
        <div className="timeline">
          {visible.length === 0 && (
            <div className="timeline-empty">
              {state.backendHealth === 'offline'
                ? 'BACKEND OFFLINE · 请确认后端已启动（uvicorn app.main:app）'
                : state.backendHealth === 'checking'
                ? '等待 /api/health 响应…'
                : 'IDLE · 点击右上角 LOAD DEMO 填入示例问题，再点 Send 启动 Agent'}
            </div>
          )}
          {visible.map((ev) => (
            <EventCard key={ev.id} event={ev} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* 可折叠 Architecture 与 Raw Events */}
      <Section title="AGENT ARCHITECTURE" defaultOpen={presentation}>
        <ArchitectureMap active={state.activeNodes} compact={presentation} />
      </Section>

      <RawEventStream events={state.rawEvents} />

      <footer className="console-foot">
        Reasoning details are intentionally not exposed. Only execution summaries and tool traces are shown.
      </footer>
    </div>
  )
}
