/** RAW EVENT STREAM：默认折叠，展示后端 → SSE → React 的原始事件（token 已聚合）。 */

import { useState } from 'react'
import { JsonView } from './JsonView'
import type { RawEvent } from './types'

export function RawEventStream({ events }: { events: RawEvent[] }) {
  const [open, setOpen] = useState(false)

  return (
    <section className={`raw-stream ${open ? 'open' : ''}`}>
      <button className="raw-head" onClick={() => setOpen((v) => !v)}>
        <span>{open ? '▾' : '▸'}</span>
        <strong>RAW EVENT STREAM</strong>
        <span className="raw-count">{events.length} events（token 已聚合）</span>
      </button>
      {open && (
        <div className="raw-body">
          {events.length === 0 && <div className="raw-empty">暂无事件</div>}
          {events.map((e) => (
            <div className="raw-item" key={e.id}>
              <div className="raw-item-head">
                <span className="raw-name">event: {e.name}</span>
                <span className="raw-summary">{e.summary}</span>
                <span className="raw-t">+{e.t}ms</span>
              </div>
              <JsonView label="data" data={e.data} maxLines={4} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
