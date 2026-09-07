/** 前端共享类型定义（与后端 Pydantic 模型一一对应）。 */

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

export interface Metric {
  name: string
  value: string | number
  unit?: string
  comment?: string
}

export interface RiskEvidence {
  text: string
  source?: string
  severity: RiskLevel
}

export interface RiskReport {
  company_name: string
  overall_risk: RiskLevel
  overall_score: number
  financial_risk: RiskLevel
  legal_risk: RiskLevel
  operation_risk: RiskLevel
  summary: string
  business_risk: string
  financial_analysis: string
  legal_analysis: string
  metrics: Metric[]
  evidence: RiskEvidence[]
  recommendations: string[]
  sources: string[]
}

export type StepStatus = 'pending' | 'running' | 'success' | 'error'

export interface TrajectoryStep {
  step: number
  thought_summary: string
  action: string
  input: Record<string, unknown>
  status: StepStatus
  duration_ms: number
  observation?: unknown
  error?: string | null
}

export interface ChatMeta {
  request_id?: string
  session_id?: string
  model?: string
  mode?: string
  steps?: number
  latency_ms?: number
  usage?: Record<string, number>
  max_steps?: number
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  report?: RiskReport | null
  trajectory?: TrajectoryStep[]
  meta?: ChatMeta
  error?: string
}

export interface EvalCaseResult {
  id: string
  query: string
  expected_tools: string[]
  actual_tools: string[]
  tool_accuracy: number
  success: boolean
  steps: number
  latency_ms: number
  error?: string | null
}

export interface EvalSummary {
  total_cases: number
  task_success_rate: number
  tool_selection_accuracy: number
  avg_steps: number
  avg_latency_ms: number
  mode: string
  model: string
  cases: EvalCaseResult[]
}

export interface SessionItem {
  id: string
  title: string
  updated_at: number
  message_count: number
}

export interface HealthInfo {
  status: string
  mode: string
  model: string
  max_steps: number
  tools: string[]
  rag: { documents: number; chunks: number; sources: string[] }
}
