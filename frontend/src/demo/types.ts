/** Demo Studio 共享类型。所有字段来自后端 SSE（真实运行时数据），UI 不伪造数据。 */

import type { ChatMeta, RiskReport, TrajectoryStep } from '../types'

/** Timeline 事件种类（决定 badge / 图标 / 边框色）。 */
export type EventKind =
  | 'user'
  | 'system'
  | 'plan'
  | 'planning'
  | 'tool'
  | 'observation'
  | 'rag'
  | 'calculation'
  | 'guardrail'
  | 'context_injection'
  | 'stream'
  | 'final'
  | 'error'
  | 'aborted'

export interface RuntimeEvent {
  id: number
  kind: EventKind
  /** 相对请求开始的毫秒数（后端 t_ms，真实值）。 */
  t: number
  title: string
  tool?: string
  /** step 编号（按后端真实 step 字段固化，让 patchLastToolEvent 不依赖 payload.step）。 */
  step?: number
  /** 当前事件状态：running / success / error / warn / aborted。 */
  status?: 'running' | 'success' | 'error' | 'warn' | 'aborted'
  payload: Record<string, any>
}

export type PipelineKey = 'understand' | 'company' | 'risk' | 'financial' | 'rag' | 'report' | 'done'
export type PipelineState = 'waiting' | 'running' | 'success' | 'error'
export type Pipeline = Record<PipelineKey, PipelineState>

export type LoopPhase = 'idle' | 'plan' | 'action' | 'tool' | 'observation' | 'final'

export type ArchNode =
  | 'user'
  | 'orchestrator'
  | 'llm'
  | 'router'
  | 'company'
  | 'risk'
  | 'financial'
  | 'python'
  | 'knowledge'
  | 'rag'
  | 'report'
  | 'answer'

/** Guardrail 数据来源说明：以 backend summary 事件为 source of truth，
 *  UI 仅以 running 计数器实时反馈，避免重复累加导致前后不一致。
 */
export interface GuardrailState {
  maxSteps: number
  steps: number
  toolTimeout: number
  /** 累计通过校验的工具次数（来自 summary + 当前运行的 tool_start 计数） */
  schemaPass: number
  schemaFail: number
  duplicatesBlocked: number
  timeouts: number
  toolErrors: number
  unknownTools: number
  maxStepsHit: boolean
  cotProtection: boolean
  hits: { kind: string; status: string; message: string; t: number }[]
}

export interface DemoMeta extends ChatMeta {
  rag_stats?: { documents: number; chunks: number; sources: string[] }
  guardrails?: { max_steps: number; tool_timeout_s: number; max_tool_repeat: number; cot_protection: boolean }
  available_tools?: string[]
  /** 当 SSE summary 事件到达时写入。 */
  summary?: {
    steps: number
    tool_calls: number
    executed_tools: string[]
    errors: number
    timeouts: number
    schema_pass: number
    schema_fail: number
    duplicates_blocked: number
    total_latency_ms: number
  }
}

export interface RawEvent {
  id: number
  name: string
  t: number
  summary: string
  data: unknown
}

export type DemoStatus =
  | 'idle'                // 页面刚加载、未连接 backend
  | 'connecting'          // 等待 /health 或 SSE 发 start
  | 'streaming'           // SSE 正在收事件
  | 'completed'           // SSE 自然结束（收到 done）
  | 'closed'              // SSE 关闭（自然结束或被 abort）
  | 'error'               // SSE/Agent 错误
  | 'aborted'             // 用户主动 stop

export interface DemoState {
  status: DemoStatus
  /** 后端真实 /health 结果：null=未知，'ready' 或 'offline' */
  backendHealth: 'checking' | 'ready' | 'offline'
  meta: DemoMeta | null
  events: RuntimeEvent[]
  pipeline: Pipeline
  loopPhase: LoopPhase
  activeNodes: ArchNode[]
  guardrails: GuardrailState
  rawEvents: RawEvent[]
  // 右侧产品态
  messages: { id: string; role: 'user' | 'assistant'; content: string; streaming?: boolean; error?: string }[]
  steps: TrajectoryStep[]
  report: RiskReport | null
  answer: string
  latencyMs: number
  /** 当前 run 的 request_id */
  requestId: string | null
}

export const PIPELINE_ORDER: { key: PipelineKey; label: string; tool?: string }[] = [
  { key: 'understand', label: 'Understand' },
  { key: 'company', label: 'Company', tool: 'company_info_tool' },
  { key: 'risk', label: 'Risk', tool: 'risk_search_tool' },
  { key: 'financial', label: 'Financial', tool: 'financial_analysis_tool' },
  { key: 'rag', label: 'RAG', tool: 'knowledge_search_tool' },
  { key: 'report', label: 'Report', tool: 'report_generator_tool' },
  { key: 'done', label: 'Done' },
]

export const EMPTY_PIPELINE: Pipeline = {
  understand: 'waiting',
  company: 'waiting',
  risk: 'waiting',
  financial: 'waiting',
  rag: 'waiting',
  report: 'waiting',
  done: 'waiting',
}

export const EMPTY_GUARDRAILS: GuardrailState = {
  maxSteps: 8,
  steps: 0,
  toolTimeout: 15,
  schemaPass: 0,
  schemaFail: 0,
  duplicatesBlocked: 0,
  timeouts: 0,
  toolErrors: 0,
  unknownTools: 0,
  maxStepsHit: false,
  cotProtection: true,
  hits: [],
}

export const TOOL_LABEL: Record<string, string> = {
  company_info_tool: 'Company Info',
  risk_search_tool: 'Risk Search',
  financial_analysis_tool: 'Financial Analysis',
  knowledge_search_tool: 'Knowledge Search',
  report_generator_tool: 'Report Generator',
}

/** 唯一一个有"Python 计算财务指标"专属卡片；其它工具是 EXECUTED BY Python Tool Runtime。 */
export const TOOL_COMPUTED_BY_PYTHON: Record<string, boolean> = {
  financial_analysis_tool: true,
}

export const EVENT_META: Record<EventKind, { badge: string; icon: string }> = {
  user: { badge: 'USER', icon: '👤' },
  system: { badge: 'AGENT', icon: '⚙️' },
  planning: { badge: 'PLAN', icon: '🧭' },
  plan: { badge: 'PLAN', icon: '🧭' },
  tool: { badge: 'TOOL', icon: '🔧' },
  observation: { badge: 'OBS', icon: '📥' },
  rag: { badge: 'RAG', icon: '📚' },
  calculation: { badge: 'PYTHON', icon: '🧮' },
  guardrail: { badge: 'GUARD', icon: '🛡️' },
  context_injection: { badge: 'TRUST', icon: '🔐' },
  stream: { badge: 'SSE', icon: '📡' },
  final: { badge: 'DONE', icon: '✅' },
  error: { badge: 'ERROR', icon: '⛔' },
  aborted: { badge: 'STOP', icon: '✋' },
}
