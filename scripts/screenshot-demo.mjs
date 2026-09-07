/**
 * 自动触发 Demo Studio 运行并截图。
 *
 * 用法：
 *   node scripts/screenshot-demo.mjs <url> <output.png>
 *
 * 示例：
 *   node scripts/screenshot-demo.mjs "http://127.0.0.1:5173/demo" docs/screenshot-demo-run.png
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import process from 'node:process'

const [, , url, out] = process.argv
if (!url || !out) {
  console.error('用法: node scripts/screenshot-demo.mjs <url> <output.png>')
  process.exit(1)
}

const PORT = 9226
const CHROME =
  process.env.CHROME_PATH ||
  'C:/Users/18722/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'
const DEMO_QUESTION = '请分析星海科技有限公司的综合风险，并生成风险报告'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1920,1080',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

async function findPageTarget() {
  for (let i = 0; i < 25; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const target = list.find((t) => t.type === 'page')
      if (target) return target
    } catch {
      /* not ready */
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
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await send('Page.navigate', { url })

  // 等待 React mount（轮询直到 LOAD DEMO 按钮出现）
  const loadDemoBtnExists = async () => {
    const expr = `
      (function() {
        const btns = Array.from(document.querySelectorAll('button'));
        return btns.some(b => b.textContent.toUpperCase().includes('LOAD DEMO'));
      })()
    `
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
    return res.result?.result?.value
  }
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    if (await loadDemoBtnExists()) break
  }

  const loadDemo = async () => {
    const expr = `
      (function() {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.textContent.toUpperCase().includes('LOAD DEMO')) ||
                   document.querySelector('.dbtn.primary');
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
    return res.result?.result?.value
  }

  const sendChat = async () => {
    const expr = `
      (function() {
        const ta = document.querySelector('.pp-chat textarea') ||
                   document.querySelector('.chat-panel textarea') ||
                   document.querySelector('textarea[placeholder*="风险"]') ||
                   document.querySelector('textarea');
        if (!ta) return 'no textarea';
        ta.focus();
        if (!ta.value) ta.value = ${JSON.stringify(DEMO_QUESTION)};
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        const btn = document.querySelector('.composer .send-btn') ||
                    document.querySelector('.chat-panel .send-btn') ||
                    document.querySelector('.send-btn');
        if (!btn) return 'no send btn';
        btn.click();
        return 'sent';
      })()
    `
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
    return res.result?.result?.value
  }

  const waitForText = async (text, timeoutMs = 60000) => {
    const expr = `
      (function() {
        return document.body.innerText.includes(${JSON.stringify(text)});
      })()
    `
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
      if (res.result?.result?.value) return true
      await sleep(500)
    }
    // 失败时截图 + 打印页面文本头，便于诊断
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    if (shot.result?.data) {
      writeFileSync('docs/screenshot-debug.png', Buffer.from(shot.result.data, 'base64'))
      console.log('✓ 已保存诊断截图 docs/screenshot-debug.png')
    }
    const dbg = await send('Runtime.evaluate', {
      expression: `document.body.innerText.slice(0, 1200)`,
      returnByValue: true,
    })
    console.log('页面文本头:', dbg.result?.result?.value)
    throw new Error('页面未出现: ' + text)
  }

  if (!(await loadDemo())) {
    const dbgExpr = `
      (function() {
        return JSON.stringify({
          url: location.href,
          buttons: Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()),
          bodyLen: document.body ? document.body.innerText.length : 0,
          bodyHead: document.body ? document.body.innerText.slice(0, 500) : '',
        });
      })()
    `
    const dbg = await send('Runtime.evaluate', { expression: dbgExpr, returnByValue: true })
    console.log('DEBUG before failing:', dbg.result?.value)
    throw new Error('未找到 LOAD DEMO 按钮')
  }
  await sleep(800)
  console.log('sendChat:', await sendChat())

  console.log('等待 Agent 完成…')
  await waitForText('AGENT COMPLETED')
  await sleep(1200)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (!shot.result?.data) throw new Error('截图失败')
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
  console.log(`✓ 已保存 ${out}`)

  ws.close()
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => chrome.kill())
