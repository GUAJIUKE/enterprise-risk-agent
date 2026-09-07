/** Timeline 事件卡片：不同事件类型使用不同 badge / 边框 / 内容布局。 */

import { useState, type ReactNode } from 'react'
import { JsonView } from './JsonView'
import { EVENT_META, TOOL_LABEL, TOOL_COMPUTED_BY_PYTHON, type RuntimeEvent } from './types'

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = ms % 1000
  return `${String(s).padStart(2, '0')}:${String(m).padStart(3, '0')}`
}

function KV({ label, value, tone }: { label: string; value: ReactNode; tone?: 'ok' | 'bad' | 'warn' }) {
  if (value === undefined || value === null || value === '') return null
  const rendered = typeof value === 'object' && !Array.isArray(value) && !(value as any)?.$$typeof
    ? JSON.stringify(value)
    : value
  return (
    <div className="kv">
      <span className="kv-k">{label}</span>
      <span className={`kv-v ${tone ?? ''}`}>{rendered}</span>
    </div>
  )
}

function LevelPill({ level }: { level: string }) {
  return <span className={`level-pill ${String(level).toLowerCase()}`}>{level}</span>
}

export function EventCard({ event }: { event: RuntimeEvent }) {
  const [open, setOpen] = useState(false)
  const meta = EVENT_META[event.kind]
  const p = event.payload ?? {}
  const pulse = event.status === 'running' ? ' pulse' : ''

  return (
    <article className={`ev ev-${event.kind} ${event.status ?? ''}${pulse}`}>
      <header className="ev-head">
        <span className="ev-time">{fmtTime(event.t)}</span>
        <span className="ev-badge">{meta.badge}</span>
        <span className="ev-title">
          <span className="ev-icon">{meta.icon}</span>
          {event.title}
          {event.tool && <span className="ev-tool">{TOOL_LABEL[event.tool] ?? event.tool}</span>}
        </span>
        {event.status && event.status !== 'running' && (
          <span className={`ev-status ${event.status}`}>{event.status.toUpperCase()}</span>
        )}
      </header>

      <div className="ev-body">
        {event.kind === 'user' && <div className="ev-quote">{p.text}</div>}

        {event.kind === 'system' && (
          <div className="kv-grid">
            {Object.entries(p).map(([k, v]) => (
              <KV key={k} label={k} value={v} />
            ))}
          </div>
        )}

        {event.kind === 'plan' && (
          <div className="kv-grid">
            <KV label="Next Action" value={p['Next Action']} />
            <KV
              label="Reason"
              value={p.Reason}
            />
            <div className="ev-note">⚠️ 仅显示面向用户的执行摘要，模型隐藏 Chain-of-Thought 不展示、不落盘。</div>
          </div>
        )}

        {event.kind === 'tool' && (
          <>
            <div className="kv-grid">
              <KV label="Schema Validation" value={p['Schema Validation']} tone={String(p['Schema Validation']).startsWith('✓') ? 'ok' : 'bad'} />
              <KV label="Timeout" value={p.Timeout} />
              <KV label="Executed By" value={p['Executed By']} />
              {TOOL_COMPUTED_BY_PYTHON[event.tool ?? ''] && (
                <KV
                  label="Computed By"
                  value="Python"
                  tone="ok"
                />
              )}
              <KV label="Status" value={p.Status} tone={p.Status === 'SUCCESS' ? 'ok' : p.Status === 'ERROR' ? 'bad' : undefined} />
              {p.Duration && <KV label="Duration" value={p.Duration} />}
            </div>
            <JsonView label="Arguments" data={p.Arguments} />
            {(p.Output || p.Error) && (
              <JsonView label={p.Error ? 'Error' : 'Output'} data={p.Output ?? p.Error} maxLines={open ? 9999 : 6} />
            )}
          </>
        )}

        {event.kind === 'observation' && (
          <>
            <div className="kv-grid">
              <KV label="Status" value={p.Status} tone={p.Status === 'SUCCESS' ? 'ok' : 'bad'} />
              <KV label="Latency" value={p.Latency} />
            </div>
            <JsonView label="Output" data={p.Output} maxLines={open ? 9999 : 6} />
          </>
        )}

        {event.kind === 'calculation' && (
          <>
            <div className="computed-by">
              <span className="cb-tag">COMPUTED BY</span>
              <strong>{p['Computed By'] ?? 'Python'}</strong>
              <span className="cb-note">确定性指标由 Python 计算，未交给 LLM 心算</span>
            </div>
            <div className="kv-grid">
              <KV label="Risk Level" value={<LevelPill level={p['Risk Level']} />} />
              <KV label="Risk Score" value={p['Risk Score']} />
              <KV label="Period" value={p.Period} />
            </div>
            <div className="metric-grid">
              {(p.Metrics ?? []).map((m: any, i: number) => (
                <div key={i} className="metric-cell">
                  <span className="mc-name">{m.name}</span>
                  <span className="mc-value">
                    {m.value}
                    <em>{m.unit}</em>
                  </span>
                  <span className="mc-comment">{m.comment}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {event.kind === 'rag' && (
          <>
            <div className="kv-grid">
              <KV label="Query" value={`“${p.Query}”`} />
              <KV label="Top-K" value={p['Top-K']} />
              <KV label="Knowledge Base" value={p['Knowledge Base']} />
            </div>
            <ol className="rag-list">
              {(p.Retrieved ?? []).map((d: any, i: number) => (
                <li key={i}>
                  <div className="rag-head">
                    <span className="rag-rank">#{i + 1}</span>
                    <span className="rag-source">{d.source}</span>
                    <span className="rag-score">score {typeof d.score === 'number' ? d.score.toFixed(4) : d.score}</span>
                  </div>
                  <div className="rag-bar">
                    <i style={{ width: `${Math.min(100, Math.max(4, (Number(d.score) || 0) * 100))}%` }} />
                  </div>
                  <p className="rag-text">{d.content_preview}</p>
                </li>
              ))}
            </ol>
            <div className="ev-note">真实相似度：hashing 向量 + 余弦相似度，非演示伪造。</div>
          </>
        )}

        {event.kind === 'guardrail' && (
          <div className="kv-grid">
            <KV label="Type" value={p.Type} />
            <KV label="Status" value={p.Status} tone={p.Status === 'blocked' || p.Status === 'failed' ? 'bad' : 'warn'} />
            <div className="ev-note guard-msg">{p.Message}</div>
          </div>
        )}

        {event.kind === 'context_injection' && (
          <>
            <div className="kv-grid">
              <KV label="Tool" value={p.Tool} />
              <KV label="Injected Fields" value={(p.Injected || []).map((x: any) => `${x.field} ← ${x.source_tool}`).join(' / ')} />
              <KV
                label="Model-Supplied"
                value={Object.keys(p['Model Supplied'] || {}).length ? Object.keys(p['Model Supplied']).join(', ') : '无'}
                tone={Object.keys(p['Model Supplied'] || {}).length ? 'bad' : 'ok'}
              />
            </div>
            <div className="ev-note guard-msg">{p.Note}</div>
          </>
        )}

        {event.kind === 'planning' && (
          <div className="kv-grid">
            <KV label="Step" value={p.Step} />
            <KV label="Executed Tools" value={p['Executed Tools']} />
            <KV label="Loop Phase" value={p['Loop Phase']} />
            <div className="ev-note">正在进行 PLAN，下一步将根据 observation 选择 Action。</div>
          </div>
        )}

        {event.kind === 'aborted' && (
          <div className="ev-note guard-msg">{p.Message}</div>
        )}

        {event.kind === 'stream' && (
          <div className="kv-grid">
            <KV label="Channel" value="SSE (text/event-stream)" />
            <KV label="Steps" value={p.Steps} />
          </div>
        )}

        {event.kind === 'final' && (
          <div className="kv-grid">
            <KV label="Steps" value={p.Steps} />
            <KV label="Tool Calls" value={p['Tool Calls']} />
            <KV label="Errors" value={p.Errors} tone={p.Errors ? 'bad' : 'ok'} />
            <KV label="Total Latency" value={p['Total Latency']} />
            <KV label="Mode" value={p.Mode} />
            <KV label="Model" value={p.Model} />
          </div>
        )}

        {event.kind === 'error' && <div className="ev-note error">{p.Message ?? JSON.stringify(p)}</div>}
      </div>

      {(event.kind === 'tool' || event.kind === 'observation') && (
        <button className="ev-expand" onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : '展开全部输出'}
        </button>
      )}
    </article>
  )
}
