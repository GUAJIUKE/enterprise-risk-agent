/**
 * Demo Studio 的单一数据源 Hook。
 *
 * 关键设计：
 * 1) 一次 Agent 请求 = 一条 SSE 流 = 一份 state。
 *    左 Console 与右 Product Preview 都从这里取数 → 不存在"左右不同步"。
 * 2) RuntimeEvent 自带 `step` 字段，patchLastToolEvent 用 step + tool 双键定位 Tool Card。
 * 3) SSE 生命周期：idle / connecting / streaming / closed / aborted / error。
 * 4) AbortController 取消后，state 立刻切到 aborted 并 append 事件。
 * 5) Guardrails 真实运行计数 + 后端 summary 一次性下发为 source of truth。
 *
 * Presentation 速度只影响事件"上屏节奏"（UI pacing），不修改后端真实数据。
 */

import { useCallback, useMemo, useReducer, useRef } from 'react'
import { api, streamChat } from '../services/api'
import type { RiskReport, TrajectoryStep } from '../types'
import {
  EMPTY_GUARDRAILS,
  EMPTY_PIPELINE,
  TOOL_LABEL,
  type ArchNode,
  type DemoState,
  type EventKind,
  type LoopPhase,
  type PipelineKey,
  type RuntimeEvent,
} from './types'

const TOOL_PIPELINE: Record<string, PipelineKey> = {
  company_info_tool: 'company',
  risk_search_tool: 'risk',
  financial_analysis_tool: 'financial',
  knowledge_search_tool: 'rag',
  report_generator_tool: 'report',
}

const TOOL_ARCH: Record<string, ArchNode[]> = {
  company_info_tool: ['router', 'company'],
  risk_search_tool: ['router', 'risk'],
  financial_analysis_tool: ['router', 'financial', 'python'],
  knowledge_search_tool: ['router', 'knowledge', 'rag'],
  report_generator_tool: ['router', 'report'],
}

/** Presentation 模式下的 UI 展示间隔（毫秒），只作用于主要步骤。 */
const PACE_MS: Record<string, number> = {
  planning_start: 240,
  plan: 360,
  tool_start: 320,
  tool_result: 460,
  calculation: 560,
  rag_result: 620,
  guardrail: 520,
  context_injection: 480,
  final_start: 420,
}

type Action =
  | { type: 'health'; v: 'checking' | 'ready' | 'offline' }
  | { type: 'send'; text: string; requestId: string }
  | { type: 'event'; event: string; data: any }
  | { type: 'sse_state'; state: 'connecting' | 'streaming' | 'closed' }
  | { type: 'abort' }
  | { type: 'clear' }
  | { type: 'reset' }

const INITIAL: DemoState = {
  status: 'idle',
  backendHealth: 'checking',
  meta: null,
  events: [],
  pipeline: EMPTY_PIPELINE,
  loopPhase: 'idle',
  activeNodes: [],
  guardrails: EMPTY_GUARDRAILS,
  rawEvents: [],
  messages: [],
  steps: [],
  report: null,
  answer: '',
  latencyMs: 0,
  requestId: null,
}

let eventSeq = 0

function makeEvent(
  kind: EventKind,
  title: string,
  t: number,
  payload: Record<string, any>,
  tool?: string,
  status?: RuntimeEvent['status'],
  step?: number,
): RuntimeEvent {
  return { id: ++eventSeq, kind, title, t, payload, tool, status, step }
}

function summarize(name: string, data: any): string {
  switch (name) {
    case 'planning_start':
      return `step=${data.step} ${data.message}`
    case 'plan':
      return `step=${data.step} next=${data.next_action}`
    case 'tool_start':
      return `${data.tool}(step=${data.step}) schema=${data.schema_validated ? '✓' : '✗'}`
    case 'tool_result':
      return `${data.tool}(step=${data.step}) ${data.status} dur=${data.duration_ms}ms`
    case 'rag_result':
      return `query="${data.query}" top_k=${data.top_k}`
    case 'calculation':
      return `${data.metrics?.length ?? 0} metrics · level=${data.risk_level}`
    case 'guardrail':
      return `${data.guardrail?.kind} → ${data.guardrail?.status}`
    case 'context_injection':
      return `tool=${data.tool} injected=${(data.injected || []).length}`
    case 'token':
      return `${(data.text ?? '').length} chars`
    case 'report':
      return `report arrived (overall=${data.overall_risk ?? data.report?.overall_risk ?? '?'})`
    case 'summary':
      return `steps=${data.steps} tool_calls=${data.tool_calls} errors=${data.errors ?? 0} latency=${data.total_latency_ms}ms`
    case 'done':
      return `steps=${data.steps} latency_ms=${data.latency_ms}`
    default:
      return Object.keys(data ?? {}).slice(0, 4).join(', ')
  }
}

/** 找最近一个 step+tool 匹配的 TOOL Card，把状态补全。 */
function patchLastToolEvent(
  events: RuntimeEvent[],
  step: number,
  tool: string,
  patch: Partial<RuntimeEvent>,
): RuntimeEvent[] {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.kind === 'tool' && e.step === step && e.tool === tool) {
      const next = [...events]
      next[i] = { ...e, ...patch }
      return next
    }
  }
  return events
}

function reducer(state: DemoState, action: Action): DemoState {
  switch (action.type) {
    case 'health':
      return { ...state, backendHealth: action.v }

    case 'send':
      return {
        ...state,
        status: 'connecting',
        requestId: action.requestId,
        events: [],
        rawEvents: [],
        pipeline: { ...EMPTY_PIPELINE, understand: 'running' },
        loopPhase: 'plan',
        activeNodes: ['user', 'orchestrator'],
        guardrails: { ...EMPTY_GUARDRAILS, cotProtection: state.guardrails.cotProtection },
        meta: null,
        steps: [],
        report: null,
        answer: '',
        latencyMs: 0,
        messages: [
          { id: `u_${Date.now()}`, role: 'user', content: action.text },
          { id: `a_${Date.now()}`, role: 'assistant', content: '', streaming: true },
        ],
      }

    case 'clear':
      return { ...state, events: [], rawEvents: [] }

    case 'reset':
      return { ...INITIAL, backendHealth: state.backendHealth }

    case 'sse_state':
      if (action.state === 'streaming') {
        return { ...state, status: 'streaming' }
      }
      if (action.state === 'connecting') {
        return { ...state, status: 'connecting' }
      }
      // closed
      if (state.status === 'aborted' || state.status === 'error') return state
      return { ...state, status: 'closed' }

    case 'abort': {
      if (state.status !== 'streaming' && state.status !== 'connecting') return state
      return {
        ...state,
        status: 'aborted',
        loopPhase: 'idle',
        activeNodes: [],
        events: [
          ...state.events,
          makeEvent('aborted', 'REQUEST ABORTED BY USER', 0, { Message: '用户主动停止；Agent 后台任务已断开' }),
        ],
      }
    }

    case 'event':
      return applyEvent(state, action.event, action.data)

    default:
      return state
  }
}

function applyEvent(state: DemoState, name: string, data: any): DemoState {
  const t = typeof data?.t_ms === 'number' ? data.t_ms : 0
  const raw = { id: ++eventSeq, name, t, summary: summarize(name, data), data }
  // token 事件单独聚合
  const rawEvents =
    name === 'token'
      ? (() => {
          const last = state.rawEvents[state.rawEvents.length - 1]
          if (last && last.name === 'token') {
            const merged = [...state.rawEvents]
            merged[merged.length - 1] = { ...last, summary: `streaming · ${last.summary}` }
            return merged
          }
          return [...state.rawEvents, raw]
        })()
      : [...state.rawEvents, raw]

  const base: DemoState = { ...state, rawEvents }

  switch (name) {
    case 'start': {
      const g = data.guardrails ?? {}
      return {
        ...base,
        status: 'streaming',
        meta: data,
        loopPhase: 'plan',
        activeNodes: ['user', 'orchestrator'],
        pipeline: { ...EMPTY_PIPELINE, understand: 'running' },
        guardrails: {
          ...EMPTY_GUARDRAILS,
          cotProtection: g.cot_protection ?? true,
          maxSteps: g.max_steps ?? 8,
          toolTimeout: g.tool_timeout_s ?? 15,
        },
        events: [
          makeEvent('system', 'AGENT INITIALIZED', t, {
            mode: data.mode,
            model: data.model,
            'Available Tools': `${data.available_tools?.length ?? 0} 个`,
            'Max Steps': data.max_steps,
            'Knowledge Base': data.rag_stats ? `${data.rag_stats.documents} docs / ${data.rag_stats.chunks} chunks` : 'n/a',
          }),
        ],
      }
    }

    case 'planning_start': {
      const phase: LoopPhase = (data.executed_tools?.length ?? 0) === 0 ? 'plan' : 'plan'
      return {
        ...base,
        loopPhase: phase,
        activeNodes: ['llm'],
        events: [
          ...base.events,
          makeEvent(
            'planning',
            data.message || `PLANNING · step ${data.step}`,
            t,
            {
              Step: data.step,
              'Executed Tools': (data.executed_tools || []).join(' → ') || '（无）',
              'Loop Phase': 'PLAN',
            },
            undefined,
            'running',
            data.step,
          ),
        ],
      }
    }

    case 'plan':
      return {
        ...base,
        loopPhase: 'action',
        activeNodes: ['llm'],
        pipeline: { ...base.pipeline, [TOOL_PIPELINE[data.next_action] ?? 'understand']: 'running' },
        events: [
          ...base.events,
          makeEvent(
            'plan',
            `PLANNING · step ${data.step}`,
            t,
            {
              'Next Action': data.next_action,
              Arguments: data.arguments,
              Reason: data.thought_summary,
            },
            data.next_action,
            'running',
            data.step,
          ),
        ],
      }

    case 'tool_start': {
      const tool: string = data.tool
      const schemaOk = data.schema_validated !== false
      return {
        ...base,
        loopPhase: 'tool',
        activeNodes: TOOL_ARCH[tool] ?? ['router'],
        pipeline: { ...base.pipeline, [TOOL_PIPELINE[tool] ?? 'understand']: 'running' },
        guardrails: {
          ...base.guardrails,
          steps: Math.max(base.guardrails.steps, data.step ?? 0),
          schemaPass: base.guardrails.schemaPass + (schemaOk ? 1 : 0),
          schemaFail: base.guardrails.schemaFail + (schemaOk ? 0 : 1),
        },
        events: [
          ...base.events,
          makeEvent(
            'tool',
            `TOOL CALL · ${tool}`,
            t,
            {
              Arguments: data.input,
              'Schema Validation': schemaOk ? '✓ passed' : `✗ ${data.schema_error}`,
              Timeout: `${data.timeout_s}s`,
              'Executed By': data.executed_by ?? 'Python Tool Runtime',
              'Computed By': '—',  // 仅 financial 计算时会下发 calculation 事件覆盖
              Status: 'RUNNING',
            },
            tool,
            'running',
            data.step,
          ),
        ],
      }
    }

    case 'tool_result': {
      const tool: string = data.tool
      const ok = data.status === 'success'
      const key = TOOL_PIPELINE[tool]
      const events = patchLastToolEvent(base.events, data.step, tool, {
        status: ok ? 'success' : 'error',
        payload: {
          Status: ok ? 'SUCCESS' : 'ERROR',
          Duration: `${data.duration_ms}ms`,
          Output: data.output,
          Error: data.error,
        },
      })
      return {
        ...base,
        events: [
          ...events,
          makeEvent(
            'observation',
            `OBSERVATION · ${TOOL_LABEL[tool] ?? tool}`,
            t,
            { Status: ok ? 'SUCCESS' : 'ERROR', Latency: `${data.duration_ms}ms`, Output: data.output ?? data.error },
            tool,
            ok ? 'success' : 'error',
            data.step,
          ),
        ],
        loopPhase: 'observation',
        activeNodes: TOOL_ARCH[tool] ?? [],
        pipeline: key ? { ...base.pipeline, [key]: ok ? 'success' : 'error' } : base.pipeline,
        guardrails: {
          ...base.guardrails,
          toolErrors: base.guardrails.toolErrors + (ok ? 0 : 1),
        },
      }
    }

    case 'calculation':
      // 计算事件到达时，把对应 Tool Card 上的 "Computed By" 升级为 COMPUTED BY PYTHON
      const calTool = data.tool
      const calEvents = patchLastToolEvent(base.events, data.step, calTool, {
        payload: {
          ...(base.events.find((e) => e.step === data.step && e.tool === calTool)?.payload ?? {}),
          'Computed By': 'Python',
        },
      })
      return {
        ...base,
        activeNodes: ['router', 'financial', 'python'],
        events: [
          ...calEvents,
          makeEvent('calculation', 'COMPUTED BY PYTHON', t, {
            Tool: data.tool,
            'Computed By': data.computed_by ?? 'Python',
            Period: data.period,
            'Risk Level': data.risk_level,
            'Risk Score': data.risk_score,
            Metrics: data.metrics,
            Analysis: data.analysis,
          }, data.tool, 'success', data.step),
        ],
      }

    case 'rag_result':
      return {
        ...base,
        activeNodes: ['router', 'knowledge', 'rag'],
        pipeline: { ...base.pipeline, rag: 'success' },
        events: [
          ...base.events,
          makeEvent('rag', 'RAG RETRIEVAL', t, {
            Query: data.query,
            'Top-K': data.top_k,
            'Knowledge Base': data.stats ? `${data.stats.documents} Documents / ${data.stats.chunks} Chunks` : 'n/a',
            Retrieved: data.documents,
          }, data.tool, 'success', data.step),
        ],
      }

    case 'context_injection':
      return {
        ...base,
        events: [
          ...base.events,
          makeEvent(
            'context_injection',
            'TRUSTED CONTEXT INJECTION',
            t,
            {
              Tool: data.tool,
              Injected: data.injected,
              'Model Supplied': data.model_supplied,
              Note: data.note,
            },
            data.tool,
            'success',
            data.step,
          ),
        ],
      }

    case 'guardrail': {
      const g = data.guardrail ?? {}
      const isDup = g.kind === 'duplicate_call'
      const isTimeout = g.kind === 'tool_timeout'
      const isSchema = g.kind === 'schema_validation'
      const isUnknown = g.kind === 'unknown_tool'
      const isMax = g.kind === 'max_steps'
      return {
        ...base,
        events: [
          ...base.events,
          makeEvent(
            'guardrail',
            `GUARDRAIL · ${g.kind}`,
            t,
            { Type: g.kind, Status: g.status, Message: g.message },
            g.tool,
            g.status === 'blocked' || g.status === 'failed' ? 'error' : 'warn',
            data.step,
          ),
        ],
        guardrails: {
          ...base.guardrails,
          duplicatesBlocked: base.guardrails.duplicatesBlocked + (isDup ? 1 : 0),
          timeouts: base.guardrails.timeouts + (isTimeout ? 1 : 0),
          schemaFail: base.guardrails.schemaFail + (isSchema ? 1 : 0),
          toolErrors: base.guardrails.toolErrors + (g.kind === 'tool_error' ? 1 : 0),
          unknownTools: base.guardrails.unknownTools + (isUnknown ? 1 : 0),
          maxStepsHit: base.guardrails.maxStepsHit || isMax,
          hits: [...base.guardrails.hits, { kind: g.kind, status: g.status, message: g.message, t }],
        },
      }
    }

    case 'step':
      return { ...base, steps: [...base.steps, data as TrajectoryStep] }

    case 'final_start':
      return {
        ...base,
        loopPhase: 'final',
        activeNodes: ['answer'],
        events: [...base.events, makeEvent('stream', 'STREAMING FINAL ANSWER (SSE)', t, { Steps: data.steps })],
      }

    case 'token': {
      const text: string = data.text ?? ''
      const messages = [...base.messages]
      if (messages.length) {
        const last = messages[messages.length - 1]
        messages[messages.length - 1] = { ...last, content: last.content + text }
      }
      return { ...base, messages, answer: base.answer + text }
    }

    case 'report':
      // 后端 envelope: data.report = {...}
      return { ...base, report: (data.report ?? data) as RiskReport }

    case 'summary': {
      // 唯一 source of truth：用 summary 的累计值覆盖已有 running 计数
      return {
        ...base,
        latencyMs: data.total_latency_ms ?? 0,
        meta: base.meta
          ? {
              ...base.meta,
              summary: {
                steps: data.steps,
                tool_calls: data.tool_calls,
                executed_tools: data.executed_tools,
                errors: data.errors,
                timeouts: data.timeouts,
                schema_pass: data.schema_pass,
                schema_fail: data.schema_fail,
                duplicates_blocked: data.duplicates_blocked,
                total_latency_ms: data.total_latency_ms,
              },
            }
          : base.meta,
        guardrails: {
          ...base.guardrails,
          steps: data.steps ?? base.guardrails.steps,
          schemaPass: data.schema_pass ?? base.guardrails.schemaPass,
          schemaFail: data.schema_fail ?? base.guardrails.schemaFail,
          duplicatesBlocked: data.duplicates_blocked ?? base.guardrails.duplicatesBlocked,
          timeouts: data.timeouts ?? base.guardrails.timeouts,
          toolErrors: data.errors ?? base.guardrails.toolErrors,
          unknownTools: data.unknown_tools ?? base.guardrails.unknownTools,
          maxStepsHit: data.max_steps_hit ?? base.guardrails.maxStepsHit,
        },
      }
    }

    case 'done': {
      const messages = [...base.messages]
      if (messages.length) {
        messages[messages.length - 1] = { ...messages[messages.length - 1], content: data.answer, streaming: false }
      }
      return {
        ...base,
        status: 'completed',
        messages,
        answer: data.answer,
        latencyMs: data.latency_ms ?? base.latencyMs,
        loopPhase: 'final',
        activeNodes: ['answer'],
        pipeline: { ...base.pipeline, done: 'success' },
        guardrails: { ...base.guardrails, steps: data.steps ?? base.guardrails.steps },
        events: [
          ...base.events,
          makeEvent('final', 'AGENT COMPLETED', t, {
            Steps: data.steps,
            'Tool Calls': data.trajectory?.filter((s: TrajectoryStep) => s.action !== 'finalize').length ?? 0,
            Errors: data.error ? 1 : 0,
            'Total Latency': `${data.latency_ms}ms`,
            Mode: data.mode,
            Model: data.model,
          }),
        ],
      }
    }

    case 'error':
      return {
        ...base,
        status: 'error',
        events: [
          ...base.events,
          makeEvent('error', 'AGENT ERROR', t, { Message: data.message ?? data }, undefined, 'error'),
        ],
      }

    default:
      return base
  }
}

export function useDemoRun(speed: 'normal' | 'presentation') {
  const [state, dispatch] = useReducer(reducer, INITIAL)
  const speedRef = useRef(speed)
  speedRef.current = speed
  const abortRef = useRef<AbortController | null>(null)
  const sessionRef = useRef<string | null>(null)
  const runIdRef = useRef(0)
  const requestIdRef = useRef('')

  // 初始检查 backend
  const checkHealth = useCallback(async () => {
    dispatch({ type: 'health', v: 'checking' })
    try {
      const h = await api.health()
      dispatch({ type: 'health', v: 'ready' })
      // 把 health 也写进 meta
      dispatch({
        type: 'event',
        event: '__health__',
        data: { _meta: { mode: h.mode, model: h.model, max_steps: h.max_steps } },
      })
      return h
    } catch (_e) {
      dispatch({ type: 'health', v: 'offline' })
      return null
    }
  }, [])

  const send = useCallback(async (text: string) => {
    if (!text.trim()) return
    const runId = ++runIdRef.current
    requestIdRef.current = `req_${Date.now().toString(36)}`
    dispatch({ type: 'send', text, requestId: requestIdRef.current })

    const check = (fn: () => void) => {
      if (runIdRef.current === runId) fn()
    }

    const controller = new AbortController()
    abortRef.current = controller
    dispatch({ type: 'sse_state', state: 'connecting' })

    const queue: { event: string; data: any }[] = []
    let draining = false
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    const drain = async () => {
      if (draining) return
      draining = true
      while (queue.length) {
        const item = queue.shift()!
        check(() => dispatch({ type: 'event', event: item.event, data: item.data }))
        const pace = speedRef.current === 'presentation' ? PACE_MS[item.event] ?? 0 : 0
        if (pace) await sleep(pace + Math.round(Math.random() * 80))
      }
      draining = false
    }

    try {
      await streamChat(
        text,
        sessionRef.current,
        {
          onStart: (meta) => {
            check(() => {
              if (meta.session_id) sessionRef.current = meta.session_id
              dispatch({ type: 'sse_state', state: 'streaming' })
            })
          },
          onEvent: (event, data) => {
            if (event === 'close') return
            queue.push({ event, data })
            void drain()
          },
          onError: (message) =>
            check(() => {
              dispatch({ type: 'event', event: 'error', data: { message } })
              dispatch({ type: 'sse_state', state: 'closed' })
            }),
        },
        controller.signal,
      )
      check(() => dispatch({ type: 'sse_state', state: 'closed' }))
    } catch (err: any) {
      // AbortError 不算错误，只切到 aborted
      if (err?.name === 'AbortError') {
        check(() => dispatch({ type: 'abort' }))
      } else {
        check(() => {
          dispatch({ type: 'event', event: 'error', data: { message: String(err) } })
          dispatch({ type: 'sse_state', state: 'closed' })
        })
      }
    }
  }, [])

  const abort = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    dispatch({ type: 'abort' })
  }, [])

  const clear = useCallback(() => dispatch({ type: 'clear' }), [])
  const reset = useCallback(() => {
    runIdRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    sessionRef.current = null
    dispatch({ type: 'reset' })
  }, [])

  return useMemo(
    () => ({ state, send, abort, clear, reset, checkHealth }),
    [state, send, abort, clear, reset, checkHealth],
  )
}

export type DemoRun = ReturnType<typeof useDemoRun>
export type { LoopPhase }
