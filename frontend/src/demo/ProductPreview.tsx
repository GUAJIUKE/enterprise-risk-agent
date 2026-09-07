/** 右侧 Product Preview：复用现有组件；左侧已替代原 Execution，
 *  右侧聚焦 Chat + Dashboard + Report；report 未到达前显示 LIVE EVIDENCE。 */

import { useEffect, useState } from 'react'
import { ChatPanel } from '../components/ChatPanel'
import { EvalPanel } from '../components/EvalPanel'
import { Markdown } from '../components/Markdown'
import { RiskDashboard } from '../components/RiskDashboard'
import { TracePanel } from '../components/TracePanel'
import type { Message } from '../types'
import { TOOL_LABEL, type DemoState } from './types'

type Tab = 'dashboard' | 'report' | 'trace' | 'eval'

interface Props {
  state: DemoState
  input: string
  onInputChange: (v: string) => void
  onSend: (text: string) => void
  onAbort: () => void
  presentation: boolean
  sampleQuestions: string[]
  onLoadSample: (q: string) => void
}

/** 从已收集的工具结果中得到一个 LIVE EVIDENCE 摘要。 */
function liveEvidenceSummary(state: DemoState) {
  const ran = state.events.filter((e) => e.kind === 'tool' || e.kind === 'observation')
  const uniqueTools = Array.from(new Set(ran.map((e) => e.tool).filter(Boolean)))
  return {
    toolsRun: uniqueTools.map((t) => ({ tool: t!, label: TOOL_LABEL[t!] ?? t! })),
    hasReport: !!state.report,
    streaming: state.status === 'streaming' || state.status === 'connecting',
  }
}

export function ProductPreview({
  state,
  input,
  onInputChange,
  onSend,
  onAbort,
  presentation,
  sampleQuestions,
  onLoadSample,
}: Props) {
  const [tab, setTab] = useState<Tab>('dashboard')

  // report 到达后切到 Dashboard
  useEffect(() => {
    if (state.report) setTab('dashboard')
  }, [state.report])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'dashboard', label: '📊 Dashboard' },
    { key: 'report', label: '📄 Report' },
    ...(presentation ? [] : [{ key: 'trace' as Tab, label: '🛰️ Execution' }]),
    ...(presentation ? [] : [{ key: 'eval' as Tab, label: '🧪 Eval' }]),
  ]

  const live = liveEvidenceSummary(state)

  return (
    <div className="product-preview">
      <div className="pp-chat">
        <ChatPanel
          messages={state.messages as Message[]}
          running={state.status === 'streaming' || state.status === 'connecting'}
          onSend={onSend}
          onAbort={onAbort}
          inputValue={input}
          onInputChange={onInputChange}
        />
        {state.status === 'streaming' || state.status === 'connecting' ? (
          <div className="live-evidence">
            <div className="le-title">LIVE EVIDENCE</div>
            <ul>
              <li className={live.toolsRun.find((t) => t.tool === 'company_info_tool') ? 'ok' : 'pending'}>
                Company Info {live.toolsRun.find((t) => t.tool === 'company_info_tool') ? '✓' : '…'}
              </li>
              <li className={live.toolsRun.find((t) => t.tool === 'risk_search_tool') ? 'ok' : ''}>
                Risk Events {live.toolsRun.find((t) => t.tool === 'risk_search_tool') ? '✓ 4 found' : '·'}
              </li>
              <li className={live.toolsRun.find((t) => t.tool === 'financial_analysis_tool') ? 'ok' : ''}>
                Financial Metrics {live.toolsRun.find((t) => t.tool === 'financial_analysis_tool') ? '✓' : '·'}
              </li>
              <li className={live.toolsRun.find((t) => t.tool === 'knowledge_search_tool') ? 'ok' : ''}>
                Knowledge Chunks {live.toolsRun.find((t) => t.tool === 'knowledge_search_tool') ? '✓ 3 chunks' : '·'}
              </li>
              <li className={live.hasReport ? 'ok' : 'pending'}>
                Report {live.hasReport ? '✓ ready' : 'Running…'}
              </li>
            </ul>
          </div>
        ) : null}
        {state.status === 'idle' && sampleQuestions.length > 0 && (
          <div className="live-evidence">
            <div className="le-title">SAMPLE QUESTIONS</div>
            <div className="le-samples">
              {sampleQuestions.map((q) => (
                <button key={q} className="le-sample" onClick={() => onLoadSample(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="pp-bottom">
        <div className="tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? 'active' : ''}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="tab-content">
          {tab === 'dashboard' &&
            (state.report ? (
              <RiskDashboard report={state.report} />
            ) : (
              <div className="trace-empty">
                等待 Agent 生成结构化风险报告…
                <div style={{ marginTop: 8, opacity: 0.7, fontSize: 12 }}>
                  数据从同一条 SSE 流过来，逐步累积
                </div>
              </div>
            ))}
          {tab === 'report' &&
            (state.answer ? (
              <div className="pp-report">
                <Markdown content={state.answer} />
              </div>
            ) : (
              <div className="trace-empty">还没有最终答复</div>
            ))}
          {tab === 'trace' && <TracePanel steps={state.steps} running={state.status === 'streaming'} />}
          {tab === 'eval' && <EvalPanel />}
        </div>
      </div>
    </div>
  )
}
