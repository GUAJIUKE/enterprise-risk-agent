/** 极简 Markdown 渲染器（够用即可，避免引入额外依赖）。
 *  支持：#~#### 标题、- 列表、| 表格|、引用、**加粗**、`代码`、分割线。
 */

import { Fragment, type ReactNode } from 'react'

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push(<strong key={`b${key++}`}>{token.slice(2, -2)}</strong>)
    } else {
      nodes.push(<code key={`c${key++}`}>{token.slice(1, -1)}</code>)
    }
    last = match.index + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())
}

export function Markdown({ content }: { content: string }) {
  if (!content) return null
  const lines = content.split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // 表格
    if (line.trim().startsWith('|') && lines[i + 1]?.includes('---')) {
      const header = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]))
        i += 1
      }
      blocks.push(
        <div className="md-table-wrap" key={`t${key++}`}>
          <table>
            <thead>
              <tr>
                {header.map((h, idx) => (
                  <th key={idx}>{renderInline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ridx) => (
                <tr key={ridx}>
                  {row.map((cell, cidx) => (
                    <td key={cidx}>{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // 标题
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      const Tag = (`h${Math.min(level + 1, 6)}`) as 'h2'
      blocks.push(
        <Tag className={`md-h md-h${level}`} key={`h${key++}`}>
          {renderInline(heading[2])}
        </Tag>,
      )
      i += 1
      continue
    }

    // 分割线
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push(<hr key={`hr${key++}`} />)
      i += 1
      continue
    }

    // 列表
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i += 1
      }
      blocks.push(
        <ul className="md-list" key={`u${key++}`}>
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>,
      )
      continue
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i += 1
      }
      blocks.push(
        <ol className="md-list" key={`o${key++}`}>
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>,
      )
      continue
    }

    // 空行
    if (!line.trim()) {
      i += 1
      continue
    }

    // 段落（合并连续普通行）
    const paragraph: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith('|')
    ) {
      paragraph.push(lines[i])
      i += 1
    }
    blocks.push(
      <p className="md-p" key={`p${key++}`}>
        <Fragment>{paragraph.map((p, idx) => (
          <Fragment key={idx}>
            {idx > 0 && <br />}
            {renderInline(p)}
          </Fragment>
        ))}</Fragment>
      </p>,
    )
  }

  return <div className="markdown">{blocks}</div>
}
