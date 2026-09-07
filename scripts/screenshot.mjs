/**
 * 轻量截图工具：直接通过 CDP 驱动 headless Chrome，不依赖任何第三方包。
 *
 * 用法：
 *   node scripts/screenshot.mjs <url> <output.png> [waitMs] [clickSelector]
 *
 * 示例：
 *   node scripts/screenshot.mjs "http://127.0.0.1:5173/?q=生成星海科技有限公司风险报告" docs/screenshot-chat.png 15000
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import process from 'node:process'

const [, , url, out, waitArg] = process.argv
if (!url || !out) {
  console.error('用法: node scripts/screenshot.mjs <url> <output.png> [waitMs]')
  process.exit(1)
}
const waitMs = Number(waitArg || 12000)
const PORT = 9223
const CHROME =
  process.env.CHROME_PATH ||
  'C:/Users/18722/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1680,1000',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

async function findPageTarget() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const target = list.find((t) => t.type === 'page')
      if (target) return target
    } catch {
      /* chrome 还没就绪 */
    }
    await sleep(400)
  }
  throw new Error('未找到 Chrome page target')
}

async function main() {
  const target = await findPageTarget()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })

  let msgId = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = ++msgId
      pending.set(id, res)
      ws.send(JSON.stringify({ id, method, params }))
    })

  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url })
  await sleep(waitMs)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (!shot.result?.data) throw new Error('截图失败: ' + JSON.stringify(shot).slice(0, 200))
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
  console.log(`✓ 已保存 ${out} (${waitMs}ms 后截图)`)

  ws.close()
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => chrome.kill())
