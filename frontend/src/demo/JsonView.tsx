/** 可折叠 JSON 视图：默认折叠 + 长内容截断，点击展开看全部。 */

import { useState } from 'react'

interface Props {
  data: unknown
  label?: string
  defaultOpen?: boolean
  /** 折叠状态下预览的最大行数 */
  maxLines?: number
}

function toLines(data: unknown): string[] {
  try {
    return JSON.stringify(data, null, 2).split('\n')
  } catch {
    return [String(data)]
  }
}

export function JsonView({ data, label, defaultOpen = false, maxLines = 8 }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const lines = toLines(data)
  const truncated = !open && lines.length > maxLines
  const shown = truncated ? lines.slice(0, maxLines) : lines

  return (
    <div className={`json-view ${open ? 'open' : ''}`}>
      <button className="json-head" onClick={() => setOpen((v) => !v)}>
        <span className="json-caret">{open ? '▾' : '▸'}</span>
        {label && <span className="json-label">{label}</span>}
        <span className="json-hint">
          {label ? '' : 'JSON · '}
          {lines.length} lines
        </span>
      </button>
      <pre className="json-body">
        {shown.join('\n')}
        {truncated && '\n…'}
      </pre>
    </div>
  )
}
