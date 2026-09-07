/** 中间聊天区：快捷问题 + 消息列表（Streaming）+ 输入框。 */

import { useEffect, useRef, useState } from 'react'
import type { Message } from '../types'
import { Markdown } from './Markdown'
import { SAMPLE_QUESTIONS } from './Sidebar'

const QUICK = SAMPLE_QUESTIONS.slice(0, 4).map((q) => q.text)

interface Props {
  messages: Message[]
  running: boolean
  onSend: (text: string) => void
  onAbort: () => void
  /** 受控输入（Demo Studio 的 RUN DEMO 需要预填但不自动发送） */
  inputValue?: string
  onInputChange?: (value: string) => void
}

export function ChatPanel({ messages, running, onSend, onAbort, inputValue, onInputChange }: Props) {
  const [inner, setInner] = useState('')
  const input = inputValue !== undefined ? inputValue : inner
  const setInput = (v: string) => (onInputChange ? onInputChange(v) : setInner(v))
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const submit = () => {
    const text = input.trim()
    if (!text || running) return
    onSend(text)
    setInput('')
  }

  return (
    <section className="chat-panel">
      <div className="messages">
        {messages.length === 0 && (
          <div className="welcome">
            <div className="welcome-emoji">🏷️</div>
            <h2>企业风险分析智能体</h2>
            <p>
              输入企业名称与关注点，Agent 会自主规划步骤、调用工具、检索知识库，
              并生成结构化风险报告。
            </p>
            <div className="welcome-chips">
              {QUICK.map((q) => (
                <button key={q} onClick={() => onSend(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`msg-row ${msg.role}`}>
            <div className="avatar">{msg.role === 'user' ? '🧑' : '🤖'}</div>
            <div className="bubble">
              {msg.role === 'user' ? (
                <div className="plain-text">{msg.content}</div>
              ) : (
                <Markdown content={msg.content} />
              )}
              {msg.streaming && <span className="caret" />}
              {msg.error && <div className="msg-error">⚠️ {msg.error}</div>}
              {msg.meta && !msg.streaming && msg.meta.steps !== undefined && (
                <div className="msg-meta">
                  {msg.meta.mode === 'mock' ? '🧪 Mock Mode' : '🌐 Real LLM'} · {msg.meta.steps} steps ·{' '}
                  {msg.meta.latency_ms} ms · {msg.meta.model}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="例如：帮我分析一下星海科技有限公司的经营风险，并生成一份风险报告"
          rows={2}
        />
        {running ? (
          <button className="send-btn stop" onClick={onAbort}>
            ■ 停止
          </button>
        ) : (
          <button className="send-btn" onClick={submit} disabled={!input.trim()}>
            发送 ➤
          </button>
        )}
      </div>
    </section>
  )
}
