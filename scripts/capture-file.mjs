/**
 * 把本地 HTML 渲染成 1920×1080 PNG（CDP 直连，零依赖）。
 * 用法: node scripts/capture-file.mjs <file.html|url> <out.png> [width] [height]
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

const [, , target, out, wArg, hArg] = process.argv
if (!target || !out) {
  console.error('用法: node scripts/capture-file.mjs <html|url> <out.png> [width] [height]')
  process.exit(1)
}
const width = Number(wArg || 1920)
const height = Number(hArg || 1080)
const PORT = 9229
const CHROME =
  process.env.CHROME_PATH ||
  'C:/Users/18722/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'
const url = /^https?:\/\//.test(target) ? target : pathToFileURL(target).href
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, 'about:blank'],
  { stdio: 'ignore' },
)

async function findPageTarget() {
  for (let i = 0; i < 25; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const t = list.find((x) => x.type === 'page')
      if (t) return t
    } catch { /* wait */ }
    await sleep(400)
  }
  throw new Error('no chrome page target')
}

async function main() {
  const targetInfo = await findPageTarget()
  const ws = new WebSocket(targetInfo.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

  let msgId = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  }
  const send = (method, params = {}) =>
    new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })) })

  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url })
  await sleep(1800)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (!shot.result?.data) throw new Error('capture failed')
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
  console.log(`✓ saved ${out} (${width}x${height})`)
  ws.close()
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) }).finally(() => chrome.kill())
