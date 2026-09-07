/** 后端 API 客户端：普通请求 + SSE 流式请求。 */

import type {
  ChatMeta,
  EvalSummary,
  HealthInfo,
  RiskReport,
  SessionItem,
  TrajectoryStep,
} from '../types'

const BASE = '/api'

export interface StreamHandlers {
  onStart?: (meta: ChatMeta) => void
  onStep?: (step: TrajectoryStep) => void
  onToken?: (chunk: { text: string }) => void
  onReport?: (report: RiskReport) => void
  onDone?: (payload: { answer: string; meta: ChatMeta }) => void
  onError?: (message: string) => void
  /** 原始事件回调：Demo Studio 用它把同一条 SSE 流同时喂给左右两侧。 */
  onEvent?: (event: string, data: unknown) => void
}

async function getJSON<T>(path: string): Promise<T> {
  const resp = await fetch(`${BASE}${path}`)
  if (!resp.ok) throw new Error(`${path} 请求失败：${resp.status}`)
  const body = await resp.json()
  if (body.code !== 0) throw new Error(body.message || '请求失败')
  return body.data as T
}

export const api = {
  health: () => getJSON<HealthInfo>('/health'),
  tools: () => getJSON<{ count: number; tools: unknown[] }>('/tools'),
  sessions: () => getJSON<SessionItem[]>('/sessions'),
  getSession: (id: string) =>
    getJSON<{
      id: string
      title: string
      messages: { role: string; content: string }[]
      trajectory: TrajectoryStep[]
      report: RiskReport | null
    }>(`/sessions/${id}`),
  eval: () => getJSON<EvalSummary>('/eval'),
}

/**
 * SSE 流式对话：手动解析 event / data 帧（POST + fetch，兼容任意事件名）。
 */
export async function streamChat(
  message: string,
  sessionId: string | null,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const resp = await fetch(`${BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, session_id: sessionId }),
      signal,
    })
    if (!resp.ok || !resp.body) {
      handlers.onError?.(`服务返回异常：${resp.status}`)
      return
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // 按空行切分 SSE 帧
      let sepIndex: number
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sepIndex)
        buffer = buffer.slice(sepIndex + 2)
        handleFrame(frame, handlers)
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return
    handlers.onError?.((err as Error).message || '网络异常')
  }
}

function handleFrame(frame: string, handlers: StreamHandlers): void {
  const eventMatch = /^event:\s*(.+)$/m.exec(frame)
  const dataMatch = /^data:\s*(.+)$/m.exec(frame)
  if (!eventMatch || !dataMatch) return

  const event = eventMatch[1].trim()
  let data: unknown
  try {
    data = JSON.parse(dataMatch[1])
  } catch {
    return
  }

  // Demo Studio 依赖原始事件流做左右同步，先透传再走兼容分支
  handlers.onEvent?.(event, data)

  switch (event) {
    case 'start':
      handlers.onStart?.(data as ChatMeta)
      break
    case 'step':
      handlers.onStep?.(data as TrajectoryStep)
      break
    case 'token':
      handlers.onToken?.(data as { text: string })
      break
    case 'report':
      handlers.onReport?.(data as RiskReport)
      break
    case 'done': {
      const payload = data as { answer: string } & ChatMeta
      handlers.onDone?.({ answer: payload.answer, meta: payload })
      break
    }
    case 'error':
      handlers.onError?.((data as { message: string }).message)
      break
    default:
      break
  }
}
