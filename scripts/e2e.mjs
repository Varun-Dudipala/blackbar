// End-to-end check with Chrome's real on-device model, headless.
//
//   npm run e2e               both phases
//   npm run e2e -- device     phase A only (production build, on-device, offline)
//   npm run e2e -- cloud      phase B only (dev server, real Gemini via App Check debug token)
//
// Phase A builds the app, serves it with `vite preview` on 127.0.0.1:4174 and,
// for each sample letter, checks that every fake identifier is barred, the
// deadline is right and readable, every model call answered on-device, and no
// request left 127.0.0.1. It then cuts the network, reloads (service worker),
// and repeats. It also reads a rendered image of a letter on-device.
// Phase B runs the dev server on 127.0.0.1:5183, sends a few small cloud
// requests (sealed text only), checks that no request body contains an
// identifier, and saves screenshots to docs/screens/.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './chrome.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCREENS = path.join(root, 'docs', 'screens')
const RESULTS = path.join(root, 'docs', 'e2e-results.json')
const phase = process.argv[2] ?? 'all'
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

// Mirrors src/letters/samples.ts.
const SAMPLES = {
  rfe: { title: 'USCIS request for evidence', days: 27, ids: ['IOE0912345678', 'Jordan Sample', 'A123456789', 'N0012345678', '01/02/1999', '123 Example Street, Apt 4B', '95112', 'jordan.sample@example.com', 'Riley Sample'], names: ['Jordan Sample'] },
  rent: { title: 'Past-due rent notice', days: 5, ids: ['Priya Example', '456 Sample Avenue, Unit 12C', '78701', 'TEN-48213', 'MC2026-0417-12C', '(512) 555-0187', 'priya.example@example.com'], names: ['Priya Example'] },
  bursar: { title: 'University health-insurance hold', days: 12, ids: ['Wei Example', '900123456', 'N0098765432', '03/14/2001', 'HX-55501234'], names: ['Wei Example'] },
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
function plusDays(n) {
  const t = new Date()
  const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n)
  return { iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, long: `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` }
}

// ---------- servers ----------
const children = []
function run(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(' ')} failed:\n${out}`))))
  })
}
async function serve(args, url, env = {}) {
  const p = spawn('npx', ['vite', ...args], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: false })
  children.push(p)
  let log = ''
  p.stdout.on('data', (d) => (log += d))
  p.stderr.on('data', (d) => (log += d))
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(url)
      if (r.ok) return p
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`server did not start at ${url}\n${log}`)
}
function stopAll() {
  for (const p of children) if (p.exitCode === null) p.kill('SIGTERM')
}
process.on('exit', stopAll)
process.on('SIGINT', () => {
  stopAll()
  process.exit(130)
})

// ---------- page helpers ----------
const isLocal = (u) => {
  try {
    const h = new URL(u).hostname
    return h === '127.0.0.1' || h === 'localhost' || !/^https?:/.test(new URL(u).protocol)
  } catch {
    return true
  }
}

function watchRequests(ctx) {
  const external = []
  ctx.on('request', (r) => {
    if (isLocal(r.url())) return
    const u = new URL(r.url())
    external.push({ host: u.host, path: u.pathname, method: r.method(), body: r.postData() ?? '' })
  })
  return external
}

async function waitReady(page) {
  await page.waitForSelector('.device-chip', { timeout: 30000 })
  await page.waitForFunction(() => !/Checking/.test(document.querySelector('.device-chip')?.textContent ?? ''), null, { timeout: 30000 })
  return page.$eval('.device-chip', (e) => e.textContent?.trim())
}

async function openSample(page, id) {
  await page.click('#tab-samples')
  const t0 = Date.now()
  await page.click(`[data-sample="${id}"]`)
  // Wait for this letter, so a finished state left from the previous letter is never read.
  await page.waitForSelector(`.paper[aria-label="${SAMPLES[id].title}, sealed"]`)
  const times = await page.evaluate(async () => {
    const start = performance.now()
    const done = (sel) =>
      new Promise((resolve) => {
        const tick = () => {
          const el = document.querySelector(sel)
          const v = el?.getAttribute(sel.includes('scan') ? 'data-scan' : 'data-status')
          if (v === 'done' || v === 'error') return resolve({ status: v, ms: Math.round(performance.now() - start) })
          setTimeout(tick, 100)
        }
        tick()
      })
    const [scan, glance] = await Promise.all([done('[data-scan]'), done('.glance[data-status]')])
    return { scan, glance }
  })
  times.wallMs = Date.now() - t0
  return times
}

async function inspect(page, id) {
  const s = SAMPLES[id]
  const deadline = plusDays(s.days)
  const data = await page.evaluate(() => {
    const doc = document.querySelector('.doc-text')
    // Bars carry their value in data-text (drawn by CSS), so rebuild the letter from the parts.
    const text = [...doc.children].map((c) => c.dataset.text ?? c.textContent).join('')
    const bars = [...doc.querySelectorAll('.bar')].map((b) => ({ start: +b.dataset.o, end: +b.dataset.e, source: b.className.match(/src-(\w+)/)?.[1] }))
    const deadlines = [...document.querySelectorAll('.glance [data-deadline]')].map((e) => e.getAttribute('data-deadline'))
    const calls = [...document.querySelectorAll('.receipt-calls tbody tr')].map((tr) => ({ side: tr.dataset.side, label: tr.children[0].textContent, time: tr.children[2].textContent }))
    const glanceType = document.querySelector('.glance-type')?.textContent
    const glanceError = document.querySelector('.glance.is-error')?.textContent ?? null
    return { text, bars, deadlines, calls, glanceType, glanceError }
  })
  const covered = (start, end) => {
    for (let i = start; i < end; i++) if (/\S/.test(data.text[i]) && !data.bars.some((b) => b.start <= i && i < b.end)) return false
    return true
  }
  const occurrences = (needle) => {
    const out = []
    let at = data.text.indexOf(needle)
    while (at !== -1) {
      out.push(at)
      at = data.text.indexOf(needle, at + 1)
    }
    return out
  }
  const missed = []
  for (const v of s.ids) {
    const occ = occurrences(v)
    if (!occ.length) missed.push(`${v} (not in text)`)
    else if (!occ.every((at) => covered(at, at + v.length))) missed.push(v)
  }
  const deadlineOcc = occurrences(deadline.long)
  const deadlineBarred = deadlineOcc.some((at) => data.bars.some((b) => b.start < at + deadline.long.length && at < b.end))
  return {
    found: `${s.ids.length - missed.length}/${s.ids.length}`,
    missed,
    bars: data.bars.length,
    modelBars: data.bars.filter((b) => b.source === 'model').map((b) => data.text.slice(b.start, b.end)),
    glanceType: data.glanceType,
    glanceError: data.glanceError,
    expectedDeadline: deadline.iso,
    glanceDeadlines: data.deadlines,
    deadlineCorrect: data.deadlines[0] === deadline.iso,
    deadlineInLetter: deadlineOcc.length > 0,
    deadlineBarred,
    calls: data.calls,
  }
}

const results = fs.existsSync(RESULTS) ? JSON.parse(fs.readFileSync(RESULTS, 'utf8')) : {}
const save = () => fs.writeFileSync(RESULTS, JSON.stringify(results, null, 2) + '\n')

// ---------- phase A ----------
async function phaseDevice() {
  say('building')
  await run('npx', ['vite', 'build'])
  const base = 'http://127.0.0.1:4174/'
  await serve(['preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], base)
  const ctx = await launch()
  const external = watchRequests(ctx)
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(base)
  const chip = await waitReady(page)
  say('device chip:', chip)
  const out = { when: new Date().toISOString(), chip, samples: {}, offline: null, image: null }

  for (const id of Object.keys(SAMPLES)) {
    const times = await openSample(page, id)
    const r = await inspect(page, id)
    out.samples[id] = { ...times, ...r, calls: undefined }
    say(id, JSON.stringify({ found: r.found, missed: r.missed, deadline: r.glanceDeadlines[0], ok: r.deadlineCorrect, barred: r.deadlineBarred, scan: times.scan, glance: times.glance }))
  }
  const calls = (await inspect(page, 'rfe')).calls
  out.onlineCalls = calls
  out.allOnDevice = calls.every((c) => c.side === 'on_device')

  // Service worker must control the page before going offline.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 })
  out.externalRequestsOnline = external.map((e) => `${e.method} ${e.host}${e.path}`)

  say('going offline')
  await ctx.setOffline(true)
  await page.reload()
  const chipOffline = await waitReady(page)
  const onLine = await page.evaluate(() => navigator.onLine)
  const off = {}
  for (const id of Object.keys(SAMPLES)) {
    const times = await openSample(page, id)
    const r = await inspect(page, id)
    off[id] = { ...times, found: r.found, missed: r.missed, glanceDeadlines: r.glanceDeadlines, deadlineCorrect: r.deadlineCorrect, deadlineBarred: r.deadlineBarred }
    say('offline', id, JSON.stringify(off[id]))
  }
  const offlineNotice = await page.$eval('.asker', (e) => e.textContent.includes('offline')).catch(() => false)
  out.offline = { chip: chipOffline, navigatorOnLine: onLine, samples: off, offlineNoticeShown: offlineNotice, calls: (await inspect(page, 'rfe')).calls }
  await ctx.setOffline(false)

  // Image path: render the RFE letter to a PNG in the page, then upload it.
  say('image')
  await page.reload()
  await waitReady(page)
  const letterText = await (async () => {
    await page.click('[data-sample="rfe"]')
    await page.waitForSelector('.doc-text')
    return page.$eval('.doc-text', (e) => [...e.children].map((c) => c.dataset.text ?? c.textContent).join(''))
  })()
  const b64 = await page.evaluate((LETTER) => {
    const width = 900, font = 18, lh = 26
    const c = document.createElement('canvas')
    const g = c.getContext('2d')
    g.font = `${font}px Georgia, serif`
    const lines = []
    for (const para of LETTER.split('\n')) {
      if (!para) { lines.push(''); continue }
      let cur = ''
      for (const w of para.split(' ')) {
        const t = cur ? cur + ' ' + w : w
        if (g.measureText(t).width > width - 80) { lines.push(cur); cur = w } else cur = t
      }
      lines.push(cur)
    }
    c.width = width
    c.height = 80 + lines.length * lh
    const g2 = c.getContext('2d')
    g2.fillStyle = '#fff'; g2.fillRect(0, 0, c.width, c.height)
    g2.fillStyle = '#111'; g2.font = `${font}px Georgia, serif`; g2.textBaseline = 'top'
    lines.forEach((l, i) => g2.fillText(l, 40, 40 + i * lh))
    return c.toDataURL('image/png').split(',')[1]
  }, letterText)
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
  await page.click('#tab-photo')
  const t0 = Date.now()
  await page.setInputFiles('[data-testid="file-input"]', { name: 'synthetic-rfe.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') })
  await page.waitForSelector('#ocr-text, .photo .notice-error', { timeout: 60000 })
  const transcript = await page.$eval('#ocr-text', (e) => e.value).catch(() => null)
  const transcribeMs = Date.now() - t0
  const idsInTranscript = SAMPLES.rfe.ids.filter((v) => transcript?.includes(v))
  const fixes = await page.$$eval('.fixes li', (l) => l.map((x) => x.textContent)).catch(() => [])
  let imageSeal = null
  if (transcript) {
    await page.click('text=Seal this text')
    await page.waitForFunction(() => ['done', 'error'].includes(document.querySelector('[data-scan]')?.getAttribute('data-scan')), null, { timeout: 90000 })
    await page.waitForFunction(() => ['done', 'error'].includes(document.querySelector('.glance[data-status]')?.getAttribute('data-status')), null, { timeout: 90000 })
    const r = await inspect(page, 'rfe')
    imageSeal = { found: r.found, missed: r.missed, glanceDeadlines: r.glanceDeadlines, deadlineCorrect: r.deadlineCorrect }
  }
  out.image = { transcribeMs, idsVerbatimInTranscript: `${idsInTranscript.length}/${SAMPLES.rfe.ids.length}`, missingFromTranscript: SAMPLES.rfe.ids.filter((v) => !transcript?.includes(v)), fixes, afterSeal: imageSeal }
  say('image', JSON.stringify(out.image))
  out.externalRequests = external.map((e) => `${e.method} ${e.host}${e.path}`)
  out.pageErrors = errors
  results.device = out
  save()
  await ctx.close()
}

// ---------- phase B ----------
async function shoot(page, name) {
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(150)
      const file = path.join(SCREENS, `${name}-${scheme}-${width}.png`)
      await page.screenshot({ path: file, fullPage: true })
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
}

async function waitAnswer(page, n) {
  await page.waitForFunction((n) => {
    const a = document.querySelectorAll('[data-testid="answer"]')
    return a.length >= n && a[n - 1].getAttribute('data-status') !== 'streaming'
  }, n, { timeout: 120000 })
  return page.evaluate((n) => {
    const a = document.querySelectorAll('[data-testid="answer"]')[n - 1]
    return {
      status: a.dataset.status,
      inferenceSource: a.dataset.source,
      ms: a.dataset.ms ? +a.dataset.ms : null,
      firstTokenMs: a.dataset.ttft ? +a.dataset.ttft : null,
      chars: a.querySelector('.answer-body')?.textContent.length ?? 0,
      placeholders: a.querySelectorAll('.answer-body .chip').length,
      error: a.querySelector('.notice')?.textContent ?? null,
      text: a.querySelector('.answer-body')?.textContent ?? '',
    }
  }, n)
}

async function fullShot(page, file) {
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(100)
  await page.screenshot({ path: path.join(SCREENS, file), fullPage: true })
}

const AXE = path.join(root, 'node_modules', 'axe-core', 'axe.min.js')

async function axe(page, label, out) {
  const res = {}
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
    await page.waitForTimeout(100)
    if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: AXE })
    res[scheme] = await page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }))
    })
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  out[label] = res
  const serious = [...res.light, ...res.dark].filter((v) => v.impact === 'serious' || v.impact === 'critical')
  say('axe', label, serious.length ? JSON.stringify(serious) : 'no serious or critical violations', `(${res.light.length + res.dark.length} findings in all)`)
}

const REFERRAL = /international student office|attorney|lawyer|tenant rights|legal advi[cs]e/i
// Sentences that point the reader to a professional or add a disclaimer.
const referrals = (text) => text.split(/(?<=[.!?])\s+/).filter((s) => REFERRAL.test(s)).length

// Test double for Chrome's model availability and download progress. Installed
// only in this test, only on the dev server; production builds ignore it.
//   notDownloaded: the model is not downloaded and nothing should start a download
//   downloads:     the Download button runs a download to 100%, then the model is ready
//   stalls:        the download stays at 0% (Chrome declines to start it, e.g. low disk)
function installDeviceSeam(mode) {
  let state = { state: 'downloadable' }
  window.__seamPrepareCalls = 0
  window.__blackbarDeviceSeam = {
    check: async () => state,
    prepare: async (onProgress) => {
      window.__seamPrepareCalls++
      if (mode === 'stalls') {
        state = { state: 'downloading', progress: null }
        onProgress(0)
        return
      }
      state = { state: 'downloading', progress: null }
      for (let i = 0; i <= 10; i++) {
        onProgress(i / 10)
        await new Promise((r) => setTimeout(r, 120))
      }
      state = { state: 'ready', images: true }
    },
  }
}

async function seamPage(ctx, mode) {
  const p = await ctx.newPage()
  await p.addInitScript(installDeviceSeam, mode)
  await p.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await p.goto('http://127.0.0.1:5183/')
  await p.waitForSelector('.device-chip.is-action')
  return p
}

const chipText = (p) => p.$eval('.device-chip', (e) => e.textContent.trim())

// Waits for the on-device check of the nth answer and reads what it found.
// `external` is the request log: the check must make no request at all.
async function readCheck(page, n, external) {
  const before = external.length
  const t0 = Date.now()
  await page.waitForFunction((n) => {
    const line = document.querySelectorAll('[data-testid="answer"]')[n - 1]?.querySelector('.check-line')
    return line && ['done', 'error', 'cancelled'].includes(line.dataset.check)
  }, n, { timeout: 120000 })
  const waitedMs = Date.now() - t0
  const requestsDuringCheck = external.length - before
  const card = (await page.$$('[data-testid="answer"]'))[n - 1]
  const line = await card.$eval('.check-line', (e) => ({ state: e.dataset.check, text: e.textContent, supported: +e.dataset.supported, notFound: +e.dataset.notFound, conflicts: +e.dataset.conflicts, total: +e.dataset.total }))
  const flagged = []
  for (const mark of await card.$$('.check-mark:not(.is-supported)')) {
    await mark.click()
    const items = await mark.evaluate((m) => [...m.parentElement.querySelectorAll('.check-detail .check-item')].map((i) => ({
      verdict: i.dataset.verdict,
      statement: i.querySelector('.check-statement')?.textContent,
      quote: i.querySelector('.check-quote q')?.textContent ?? null,
      note: i.querySelector('.fine')?.textContent ?? null,
    })))
    flagged.push(...items.filter((x) => x.verdict !== 'supported'))
    await mark.click()
  }
  return { ...line, waitedMs, requestsDuringCheck, flagged }
}

async function phaseCloud() {
  fs.mkdirSync(SCREENS, { recursive: true })
  const base = 'http://127.0.0.1:5183/'
  // E2E_MOCK=1 uses the labelled dev stand-in instead of Gemini (for iterating on the UI without quota).
  await serve(['--host', '127.0.0.1', '--port', '5183', '--strictPort'], base, process.env.E2E_MOCK === '1' ? { VITE_MOCK_CLOUD: 'true' } : {})
  const ctx = await launch()
  const external = watchRequests(ctx)
  const out = { mockCloud: process.env.E2E_MOCK === '1', when: new Date().toISOString(), answers: {}, axe: {} }
  const allIds = Object.values(SAMPLES).flatMap((s) => s.ids)

  // (c) Model states through the test double.
  {
    // Not downloaded: sealing a letter runs pattern checks at once and starts no download; sending works.
    const p = await seamPage(ctx, 'notDownloaded')
    const nd = { chip: await chipText(p) }
    await p.click('[data-sample="bursar"]')
    await p.waitForSelector(`.paper[aria-label="${SAMPLES.bursar.title}, sealed"]`)
    await p.waitForTimeout(500)
    nd.scan = await p.$eval('[data-scan]', (e) => e.getAttribute('data-scan'))
    nd.scanLine = await p.$eval('.scanline', (e) => e.textContent.trim())
    nd.inlineOffer = !!(await p.$('[data-testid="inline-download"]'))
    nd.downloadsStarted = await p.evaluate(() => window.__seamPrepareCalls)
    nd.sendEnabled = await p.$eval('[data-task="explain"]', (e) => !e.disabled)
    await fullShot(p, '06-not-downloaded-light-1440.png')
    await p.click('[data-task="explain"]')
    nd.answer = await waitAnswer(p, 1)
    nd.answerNotesPatternsOnly = await p.$eval('[data-testid="answer"] .answer-foot', (e) => e.textContent.includes('pattern checks only')).catch(() => false)
    nd.downloadsStartedAfterSend = await p.evaluate(() => window.__seamPrepareCalls)
    nd.pass = nd.scan === 'idle' && nd.inlineOffer && nd.downloadsStarted === 0 && nd.sendEnabled && nd.answer.status === 'done' && nd.answer.inferenceSource === 'in_cloud' && nd.answerNotesPatternsOnly && nd.downloadsStartedAfterSend === 0
    nd.answer = { ...nd.answer, text: nd.answer.text.slice(0, 300) }
    out.notDownloaded = nd
    say('not downloaded', JSON.stringify({ ...nd, answer: { status: nd.answer.status, inferenceSource: nd.answer.inferenceSource } }))
    await p.close()
  }
  {
    // Download started by the button: progress, ready, then the scan runs on the letter and adds bars.
    const p = await seamPage(ctx, 'downloads')
    await p.click('[data-sample="rfe"]')
    await p.waitForSelector(`.paper[aria-label="${SAMPLES.rfe.title}, sealed"]`)
    const dl = { before: await p.$eval('[data-scan]', (e) => e.getAttribute('data-scan')), states: [await chipText(p)] }
    const riley = () => p.evaluate(() => [...document.querySelectorAll('.doc-text .bar')].some((b) => b.dataset.text === 'Riley Sample'))
    dl.rileyBarredBefore = await riley()
    await p.click('[data-testid="inline-download"]')
    const seen = new Set(dl.states)
    for (let i = 0; i < 100; i++) {
      const t = await chipText(p)
      if (!seen.has(t)) {
        seen.add(t)
        dl.states.push(t)
        if (/Downloading model, 50%/.test(t)) await fullShot(p, '00-downloading-light-1440.png')
      }
      if (/ready/.test(t)) break
      await p.waitForTimeout(40)
    }
    await p.waitForFunction(() => document.querySelector('[data-scan]')?.getAttribute('data-scan') === 'done', null, { timeout: 90000 })
    dl.rileyBarredAfter = await riley()
    dl.summary = await p.$eval('[data-testid="hidden-summary"]', (e) => e.textContent)
    dl.downloadsStarted = await p.evaluate(() => window.__seamPrepareCalls)
    dl.pass = dl.before === 'idle' && !dl.rileyBarredBefore && dl.states.some((t) => /Downloading model, \d+%/.test(t)) && /ready/.test(dl.states.at(-1)) && dl.rileyBarredAfter && dl.downloadsStarted === 1
    out.download = dl
    say('download then scan', JSON.stringify(dl))
    await p.close()
  }
  {
    // Stalled download: a calm message after about 20 s, and sending still possible.
    const p = await seamPage(ctx, 'stalls')
    await p.click('[data-sample="bursar"]')
    await p.waitForSelector(`.paper[aria-label="${SAMPLES.bursar.title}, sealed"]`)
    await p.click('[data-testid="inline-download"]')
    const t0 = Date.now()
    await p.waitForFunction(() => /has not started the model download/.test(document.querySelector('.scanline')?.textContent ?? ''), null, { timeout: 40000 })
    const st = { stalledAfterMs: Date.now() - t0, chip: await chipText(p), scanLine: await p.$eval('.scanline', (e) => e.textContent.trim()) }
    st.sendEnabled = await p.$eval('[data-task="explain"]', (e) => !e.disabled)
    st.retryOffered = !!(await p.$('[data-testid="inline-download"]'))
    st.pass = st.sendEnabled && st.retryOffered && /Try again/.test(st.chip) && st.stalledAfterMs >= 19000
    await fullShot(p, '07-stalled-light-1440.png')
    out.stalled = st
    say('stalled', JSON.stringify(st))
    await p.close()
  }

  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 300)))
  await page.goto(base)
  await waitReady(page)
  await shoot(page, '01-bring')
  await axe(page, '01-bring', out.axe)

  await openSample(page, 'rfe')
  await page.mouse.move(0, 0)
  await shoot(page, '02-seal')
  await axe(page, '02-seal', out.axe)

  // (b) Keyboard only.
  {
    const k = { steps: [] }
    await page.focus('#tab-samples')
    let start = null
    for (let i = 0; i < 80 && start === null; i++) {
      await page.keyboard.press('Tab')
      start = await page.evaluate(() => (document.activeElement?.classList.contains('bar') ? document.activeElement.dataset.o : null))
    }
    k.reachedBarByTab = start !== null
    const active = () => page.evaluate(() => ({ o: document.activeElement?.dataset?.o ?? null, cls: document.activeElement?.className ?? '', text: document.activeElement?.textContent?.trim() ?? '' }))
    await page.keyboard.press('Enter')
    await page.waitForSelector('.pop[role="dialog"]')
    k.enterOpens = true
    k.focusInPopover = (await active()).text === 'Peek'
    await page.keyboard.press('Enter')
    k.peekShowsValue = (await page.$eval('.pop-peek', (e) => e.textContent.trim().length).catch(() => 0)) > 0
    await page.keyboard.press('Tab')
    k.tabToKeepVisible = (await active()).text === 'Keep visible'
    await page.keyboard.press('Enter')
    await page.waitForTimeout(100)
    let a = await active()
    k.keepVisibleWorks = a.o === start && /kept/.test(a.cls)
    await page.keyboard.press('Enter')
    await page.waitForSelector('.pop[role="dialog"]')
    k.focusOnBlackItOut = (await active()).text === 'Black it out again'
    await page.keyboard.press('Enter')
    await page.waitForTimeout(100)
    a = await active()
    k.blackOutAgainWorks = a.o === start && /\bbar\b/.test(a.cls)
    await page.keyboard.press(' ')
    await page.waitForSelector('.pop[role="dialog"]')
    k.spaceOpens = true
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    k.escapeCloses = !(await page.$('.pop[role="dialog"]'))
    k.focusReturned = (await active()).o === start
    k.pass = Object.entries(k).every(([key, v]) => key === 'steps' || v === true)
    delete k.steps
    out.keyboard = k
    say('keyboard', JSON.stringify(k))
  }

  let n = 0
  await page.click('[data-task="explain"]')
  out.answers.rfeExplain = await waitAnswer(page, ++n)
  out.checks = {}
  out.checks.rfeExplain = await readCheck(page, n, external)
  say('check rfe explain', JSON.stringify({ ...out.checks.rfeExplain, flagged: out.checks.rfeExplain.flagged.length }))
  say('rfe explain', JSON.stringify({ ...out.answers.rfeExplain, text: undefined }))
  if (out.answers.rfeExplain.status === 'done') {
    await page.fill('#followup', 'Does Jordan Sample have to mail the two passport photos, or can they be uploaded?')
    await page.click('.followup button[type="submit"]')
    out.answers.rfeFollowUp = await waitAnswer(page, ++n)
    out.checks.rfeFollowUp = await readCheck(page, n, external)
    out.answers.rfeFollowUp.questionSent = await page.$$eval('.asked-q', (e) => e.at(-1)?.textContent)
    say('rfe follow-up', JSON.stringify({ ...out.answers.rfeFollowUp, text: undefined }))

    // (a) Select text in the letter and black it out.
    const sel = { value: 'Potomac Service Center' }
    sel.detailsBefore = await page.$eval('[data-testid="stat-sealed"]', (e) => parseInt(e.textContent))
    sel.summaryBefore = await page.$eval('[data-testid="hidden-summary"]', (e) => e.textContent)
    sel.selected = await page.evaluate((value) => {
      const doc = document.querySelector('.doc-text')
      const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        const i = node.data.indexOf(value)
        if (i === -1 || node.parentElement.closest('.bar')) continue
        const range = document.createRange()
        range.setStart(node, i)
        range.setEnd(node, i + value.length)
        const s = getSelection()
        s.removeAllRanges()
        s.addRange(range)
        node.parentElement.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
        return true
      }
      return false
    }, sel.value)
    await page.click('text=Black this out')
    await page.waitForTimeout(150)
    const after = await page.evaluate((value) => {
      const doc = document.querySelector('.doc-text')
      const text = [...doc.children].map((c) => c.dataset.text ?? c.textContent).join('')
      const bars = [...doc.querySelectorAll('.bar')].map((b) => [+b.dataset.o, +b.dataset.e])
      const occ = []
      for (let at = text.indexOf(value); at !== -1; at = text.indexOf(value, at + 1)) occ.push(at)
      return {
        occurrences: occ.length,
        allBarred: occ.every((at) => bars.some(([s, e]) => s <= at && at + value.length <= e)),
        inOutbound: document.querySelector('[data-testid="outbound-text"]').textContent.includes(value),
        details: parseInt(document.querySelector('[data-testid="stat-sealed"]').textContent),
        summary: document.querySelector('[data-testid="hidden-summary"]').textContent,
      }
    }, sel.value)
    Object.assign(sel, after)
    await page.fill('#followup', 'What is the Potomac Service Center?')
    sel.previewHidesValue = await page.$eval('.sent-preview', (e, v) => !e.textContent.includes(v) && e.querySelectorAll('.chip').length > 0, sel.value)
    const before = external.length
    await page.fill('#followup', 'Is PotomacServiceCenter the right office to write to?')
    await page.click('.followup button[type="submit"]')
    const blocked = await waitAnswer(page, ++n)
    sel.reformattedBlocked = blocked.status === 'blocked'
    sel.requestsMade = external.length - before
    sel.pass = sel.selected && sel.allBarred && sel.occurrences >= 2 && !sel.inOutbound && sel.details === sel.detailsBefore + 1 && sel.previewHidesValue && sel.reformattedBlocked && sel.requestsMade === 0
    out.selection = sel
    say('selection', JSON.stringify(sel))
  }
  await shoot(page, '03-ask')
  {
    const mark = (await page.$('[data-testid="answer"] .check-mark:not(.is-supported)')) ?? (await page.$('[data-testid="answer"] .check-mark'))
    if (mark) {
      await mark.click()
      await page.waitForTimeout(200)
      await mark.evaluate((m) => m.scrollIntoView({ block: 'center' }))
      await page.screenshot({ path: path.join(SCREENS, '08-check-detail-light-1440.png') })
      await mark.click()
    }
    // A mark with a line in the letter: "Show in the letter" scrolls the sealed letter to it.
    const found = await page.$('[data-testid="answer"] .check-mark.is-supported')
    if (found) {
      await found.click()
      await found.evaluate((m) => m.scrollIntoView({ block: 'center' }))
      await page.waitForTimeout(200)
      await page.screenshot({ path: path.join(SCREENS, '08-check-found-detail-light-1440.png') })
      const show = await page.$('.check-detail .link')
      if (show) {
        await show.click()
        await page.waitForTimeout(1200)
        out.quoteShown = await page.$eval('.doc-text .in-quote', (e) => e.getBoundingClientRect().top > 0 && e.getBoundingClientRect().bottom < 900).catch(() => false)
        await page.screenshot({ path: path.join(SCREENS, '08-check-quote-in-letter-light-1440.png') })
      }
      await found.click()
    }
  }
  await axe(page, '03-ask', out.axe)

  // Sticky "What leaves this device" panel beside long answers.
  {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sticky = await page.evaluate(async () => {
      const answers = document.querySelectorAll('[data-testid="answer"]')
      answers[answers.length - 1].scrollIntoView({ block: 'end' })
      await new Promise((r) => setTimeout(r, 100))
      const o = document.querySelector('.outbound').getBoundingClientRect()
      const receipt = document.querySelector('#receipt').getBoundingClientRect()
      const scrolled = window.scrollY
      return { outboundTop: Math.round(o.top), outboundBottom: Math.round(o.bottom), receiptTop: Math.round(receipt.top), scrolled, position: getComputedStyle(document.querySelector('.outbound')).position }
    })
    sticky.inView = sticky.outboundTop >= 0 && sticky.outboundBottom <= 900
    sticky.clearOfReceipt = sticky.outboundBottom <= sticky.receiptTop
    await page.screenshot({ path: path.join(SCREENS, '03-ask-scrolled-light-1440.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    sticky.phonePosition = await page.$eval('.outbound', (e) => getComputedStyle(e).position)
    await page.setViewportSize({ width: 1440, height: 900 })
    out.sticky = sticky
    say('sticky', JSON.stringify(sticky))
  }

  await page.check('[data-testid="show-details"]')
  await fullShot(page, '03-ask-show-details-light-1440.png')
  await page.uncheck('[data-testid="show-details"]')

  await page.evaluate(() => window.scrollTo(0, 0))
  await openSample(page, 'rent')
  await page.selectOption('#lang', 'es')
  await page.click('[data-task="checklist"]')
  out.answers.rentChecklistEs = await waitAnswer(page, 1)
  out.checks.rentChecklistEs = await readCheck(page, 1, external)
  say('rent checklist es', JSON.stringify({ ...out.answers.rentChecklistEs, text: undefined }))
  await fullShot(page, '03-ask-rent-checklist-es-light-1440.png')

  await openSample(page, 'bursar')
  await page.selectOption('#lang', 'en')
  await page.click('[data-task="draft"]')
  out.answers.bursarDraft = await waitAnswer(page, 1)
  out.checks.bursarDraft = await readCheck(page, 1, external)
  say('bursar draft', JSON.stringify({ ...out.answers.bursarDraft, text: undefined }))
  await fullShot(page, '03-ask-bursar-draft-light-1440.png')

  out.referrals = Object.fromEntries(['rfeExplain', 'rfeFollowUp', 'rentChecklistEs', 'bursarDraft'].map((k) => [k, referrals(out.answers[k]?.text ?? '')]))
  say('referral sentences per answer', JSON.stringify(out.referrals))

  await ctx.setOffline(true)
  await page.waitForTimeout(300)
  await page.click('.asker .notice-calm button')
  out.answers.offlineOnDevice = await waitAnswer(page, 2)
  say('offline on-device answer', JSON.stringify({ ...out.answers.offlineOnDevice, text: undefined }))
  await fullShot(page, '04-offline-light-1440.png')
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await fullShot(page, '04-offline-dark-390.png')
  await page.setViewportSize({ width: 1440, height: 900 })
  await axe(page, '04-offline', out.axe)
  await ctx.setOffline(false)

  // (e) The visible test answer: a fixed answer with three planted mistakes
  // (a deadline moved by a week, an invented fee, an invented requirement),
  // loaded from the button anyone can press. No request is made; the network
  // is cut while the check runs.
  {
    const realDeadline = plusDays(SAMPLES.rfe.days).long
    const wrongDeadline = plusDays(SAMPLES.rfe.days + 7).long
    const p3 = await ctx.newPage()
    await p3.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
    await p3.goto(base)
    await waitReady(p3)
    await p3.click('[data-sample="rfe"]')
    await p3.waitForSelector(`.paper[aria-label="${SAMPLES.rfe.title}, sealed"]`)
    await p3.waitForFunction(() => document.querySelector('[data-scan]')?.dataset.scan === 'done', null, { timeout: 90000 })
    const before = external.length
    await p3.click('[data-testid="test-answer"]')
    await ctx.setOffline(true)
    const inj = await readCheck(p3, 1, external)
    inj.requestsForTestAnswer = external.length - before
    inj.badge = await p3.$eval('[data-testid="answer"] .tag', (e) => e.textContent)
    inj.receiptRow = await p3.$eval('.receipt-calls tr[data-side="test"]', (e) => e.textContent).catch(() => null)
    inj.offlineDuringCheck = await p3.evaluate(() => !navigator.onLine)
    await ctx.setOffline(false)
    const flaggedText = inj.flagged.map((f) => f.statement).join(' | ')
    inj.caught = {
      changedDeadline: flaggedText.includes(wrongDeadline),
      inventedFee: flaggedText.includes('$85.00'),
      inventedRequirement: /employer/.test(flaggedText),
    }
    inj.correctOnesFlagged = inj.flagged.filter((f) => /Form I-20|passport-style|Form I-765/.test(f.statement)).map((f) => f.statement)
    inj.realDeadline = realDeadline
    inj.pass = Object.values(inj.caught).every(Boolean) && inj.requestsDuringCheck === 0 && inj.requestsForTestAnswer === 0 && inj.state === 'done' && /Test answer/.test(inj.badge) && !!inj.receiptRow
    await p3.evaluate(() => document.querySelector('[data-testid="answer"] .check-mark.is-conflicts, [data-testid="answer"] .check-mark.is-not_found')?.scrollIntoView({ block: 'center' }))
    await p3.screenshot({ path: path.join(SCREENS, '09-test-answer-planted-mistakes-light-1440.png') })
    out.testAnswer = inj
    say('test answer with planted mistakes', JSON.stringify({ caught: inj.caught, pass: inj.pass, requests: inj.requestsDuringCheck, offline: inj.offlineDuringCheck, correctFlagged: inj.correctOnesFlagged.length, waitedMs: inj.waitedMs }))
    await p3.close()
  }

  const p2 = await ctx.newPage()
  await p2.addInitScript(() => {
    delete globalThis.LanguageModel
  })
  await p2.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await p2.goto(base)
  await waitReady(p2)
  await p2.click('[data-sample="rfe"]')
  await p2.waitForSelector('.doc-text')
  out.unsupported = { chip: await p2.$eval('.device-chip', (e) => e.textContent), bars: await p2.$$eval('.doc-text .bar', (b) => b.length), note: await p2.$eval('.scanline', (e) => e.textContent) }
  await fullShot(p2, '05-unsupported-light-1440.png')
  await p2.setViewportSize({ width: 390, height: 844 })
  await fullShot(p2, '05-unsupported-light-390.png')
  await axe(p2, '05-unsupported', out.axe)
  await p2.close()

  for (const a of Object.values(out.answers)) if (a.text) a.text = a.text.slice(0, 1500)
  const cloud = external.filter((e) => e.method === 'POST' && /streamGenerateContent|generateContent/.test(e.path))
  out.cloudRequests = cloud.map((e) => ({ host: e.host, path: e.path.replace(/apps\/[^/:]+/, 'apps/…'), bytes: e.body.length, identifiersInBody: allIds.filter((v) => e.body.toLowerCase().includes(v.toLowerCase())) }))
  out.leakedIdentifiers = out.cloudRequests.flatMap((r) => r.identifiersInBody)
  out.consoleErrors = consoleErrors
  results.cloud = out
  save()
  say('cloud requests', out.cloudRequests.length, 'leaked', JSON.stringify(out.leakedIdentifiers))
  await ctx.close()
}

try {
  if (phase === 'all' || phase === 'device') await phaseDevice()
  if (phase === 'all' || phase === 'cloud') await phaseCloud()
  say('results in', path.relative(root, RESULTS))
} finally {
  stopAll()
}
