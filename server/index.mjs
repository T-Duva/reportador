import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import { finishAuth, googleStatus, listSheets, localRedirect, phoneAuthRedirect, readSheet, startAuth, writeCell } from './google.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const inboxDir = path.join(root, 'inbox')
const dataDir = path.join(root, 'data')
const dist = path.join(root, 'dist')
const PORT = Number(process.env.PORT || 8789)
const threadPath = path.join(dataDir, 'thread.json')

fs.mkdirSync(inboxDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })

function loadJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return fallback
  }
}

function saveJson(p, val) {
  fs.writeFileSync(p, JSON.stringify(val, null, 2), 'utf8')
}

let thread = loadJson(threadPath, [])
let sheetsCache = []
let watcher = { status: 'off', lastSeenAt: 0, pendingCount: 0, error: undefined }
let lastBeatAt = 0
let workingSince = 0
let pendingGoogleRedirect = localRedirect(PORT)

function redirectFromReq(req) {
  const xfHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim()
  const xfProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  const host = xfHost || String(req.headers.host || '').trim() || `127.0.0.1:${PORT}`
  const proto = xfProto || req.protocol || 'http'
  return `${proto}://${host}/api/google/callback`
}

function appVersion() {
  return loadJson(path.join(root, 'package.json'), { version: '0.0.0' }).version || '0.0.0'
}

const app = express()
app.use(cors())
app.use(express.json({ limit: '12mb' }))

app.get('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ ok: true, version: appVersion(), watcher })
})

app.get('/api/boot', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const google = googleStatus(root)
  if (google.ok && sheetsCache.length === 0) {
    try {
      sheetsCache = await listSheets(root, localRedirect(PORT))
    } catch {
      /* se reintenta desde /api/sheets */
    }
  }
  res.json({
    thread,
    sheets: sheetsCache,
    google,
    watcher,
    version: appVersion(),
  })
})

app.get('/api/sheets', async (_req, res) => {
  try {
    const origin = `http://127.0.0.1:${PORT}`
    sheetsCache = await listSheets(root, `${origin}/api/google/callback`)
    broadcast({ type: 'sheets', sheets: sheetsCache })
    res.json({ sheets: sheetsCache, google: googleStatus(root) })
  } catch (err) {
    res.json({ sheets: sheetsCache, google: googleStatus(root), error: String(err.message || err) })
  }
})

app.get('/api/sheets/:id', async (req, res) => {
  try {
    const origin = `http://127.0.0.1:${PORT}`
    const grid = await readSheet(root, `${origin}/api/google/callback`, req.params.id)
    res.json(grid)
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) })
  }
})

app.post('/api/sheets/:id', async (req, res) => {
  try {
    const origin = `http://127.0.0.1:${PORT}`
    await writeCell(root, `${origin}/api/google/callback`, req.params.id, req.body.tab, req.body.row, req.body.col, req.body.value)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) })
  }
})

app.get('/api/google/start', async (_req, res) => {
  try {
    const redirect = phoneAuthRedirect()
    pendingGoogleRedirect = redirect
    const url = await startAuth(root, redirect)
    res.json({ url, intercept: true })
  } catch (err) {
    res.json({ error: String(err.message || err) })
  }
})

async function completeGoogle(code, redirectHint) {
  const redirect = redirectHint || pendingGoogleRedirect || phoneAuthRedirect()
  pendingGoogleRedirect = redirect
  const { email } = await finishAuth(root, redirect, code)
  broadcast({ type: 'google', google: googleStatus(root) })
  try {
    sheetsCache = await listSheets(root, redirect)
    broadcast({ type: 'sheets', sheets: sheetsCache, google: googleStatus(root) })
  } catch {
    /* list later */
  }
  return { email }
}

app.get('/api/google/callback', async (req, res) => {
  try {
    const code = String(req.query.code || '')
    if (!code) return res.status(400).send('Falta code')
    const { email } = await completeGoogle(code, pendingGoogleRedirect || redirectFromReq(req))
    res.type('html').send(`<p style="font-family:serif">Listo${email ? `: ${email}` : ''}. Ya podés volver a LIGUX.</p>`)
  } catch (err) {
    res.status(400).send(String(err.message || err))
  }
})

app.post('/api/google/finish', async (req, res) => {
  try {
    const code = String(req.body?.code || '')
    if (!code) return res.status(400).json({ error: 'Falta code' })
    const redirect = req.body?.redirectUri || pendingGoogleRedirect || phoneAuthRedirect()
    const { email } = await completeGoogle(code, redirect)
    res.json({ ok: true, email, google: googleStatus(root), sheets: sheetsCache })
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) })
  }
})

app.post('/api/report', async (req, res) => {
  const text = String(req.body?.text || '').trim()
  const photos = Array.isArray(req.body?.photos) ? req.body.photos.filter((p) => typeof p === 'string') : []
  if (!text && !photos.length) return res.status(400).json({ ok: false, error: 'Vacío' })
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const msg = {
    id,
    role: 'user',
    text,
    photos,
    at: Date.now(),
    version: req.body?.version || appVersion(),
  }
  thread.push(msg)
  thread = thread.slice(-200)
  saveJson(threadPath, thread)
  const md = [
    '# LIGUX',
    `- fecha: ${new Date(msg.at).toISOString()}`,
    `- version: ${msg.version}`,
    '',
    text || '(foto)',
  ].join('\n')
  fs.writeFileSync(path.join(inboxDir, `${id}.md`), md, 'utf8')
  if (photos.length) {
    fs.writeFileSync(path.join(inboxDir, `${id}.photos.json`), JSON.stringify(photos), 'utf8')
  }
  broadcast({ type: 'thread', thread })
  res.json({ ok: true, thread })
})

app.post('/api/watcher/beat', (req, res) => {
  lastBeatAt = Date.now()
  const want = String(req.body?.status || '')
  const countRaw = req.body?.pendingCount
  const count =
    countRaw === undefined || countRaw === null ? watcher.pendingCount || 0 : Math.max(0, Number(countRaw) || 0)
  if (want === 'done' || want === 'online') {
    workingSince = 0
    setWatcher({ status: 'online', error: undefined, pendingCount: count })
  } else if (want === 'working') {
    if (watcher.status !== 'working') workingSince = Date.now()
    setWatcher({ status: 'working', error: undefined, pendingCount: count })
  } else if (want === 'stuck') {
    setWatcher({ status: 'stuck', error: req.body?.error || watcher.error, pendingCount: count })
  } else if (want === 'off') {
    setWatcher({ status: 'off', pendingCount: count })
  } else {
    setWatcher({ status: watcher.status === 'off' ? 'online' : watcher.status, pendingCount: count })
  }
  res.json({ ok: true, watcher })
})

app.post('/api/agent-note', (req, res) => {
  const body = String(req.body?.body || '').slice(0, 2000)
  if (!body) return res.status(400).json({ ok: false, error: 'Vacío' })
  const msg = {
    id: crypto.randomUUID(),
    role: 'bot',
    text: body,
    at: Date.now(),
  }
  thread.push(msg)
  thread = thread.slice(-200)
  saveJson(threadPath, thread)
  broadcast({ type: 'thread', thread })
  notifyWindows('LIGUX', body)
  res.json({ ok: true })
})

app.get('/reportador.apk', (_req, res) => {
  const apkPath = path.join(root, 'reportador.apk')
  if (!fs.existsSync(apkPath)) return res.status(404).send('APK todavía no está listo')
  res.download(apkPath, 'reportador.apk')
})

if (fs.existsSync(dist)) {
  app.use(
    express.static(dist, {
      setHeaders(res, filePath) {
        if (/\.(html|webmanifest|js)$/i.test(filePath) && /index\.html|sw\.js|manifest\.webmanifest$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache')
        }
      },
    }),
  )
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/api') || req.path === '/reportador.apk') return next()
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(dist, 'index.html'))
  })
}

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })
const clients = new Set()

function broadcast(msg) {
  const raw = JSON.stringify(msg)
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(raw)
  }
}

function setWatcher(partial) {
  watcher = { ...watcher, ...partial, lastSeenAt: Date.now() }
  broadcast({ type: 'watcher', watcher })
}

function notifyWindows(title, message) {
  try {
    const t = String(title).replace(/'/g, "''").slice(0, 80)
    const m = String(message).replace(/'/g, "''").slice(0, 180)
    const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $xml.GetElementsByTagName('text')
$texts.Item(0).AppendChild($xml.CreateTextNode('${t}')) | Out-Null
$texts.Item(1).AppendChild($xml.CreateTextNode('${m}')) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('LIGUX').Show($toast)
`
    spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], {
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    }).unref()
  } catch {
    /* ok */
  }
}

wss.on('connection', (ws) => {
  clients.add(ws)
  ws.send(JSON.stringify({ type: 'hello', watcher, thread, sheets: sheetsCache, google: googleStatus(root), version: appVersion() }))
  ws.on('close', () => clients.delete(ws))
})

setInterval(() => {
  if (watcher.status === 'working' && workingSince && Date.now() - workingSince > 8 * 60 * 1000) {
    setWatcher({ status: 'stuck', error: 'Tardó demasiado' })
  }
  if (lastBeatAt && Date.now() - lastBeatAt > 20000 && watcher.status !== 'off') {
    setWatcher({ status: 'off' })
  }
}, 4000)

function kickGoogleBootstrap() {
  // No abrir Chrome ni Google solo. Si hace falta la cuenta de Sheets, se hace a mano.
  return
}

async function hydrateSheets() {
  try {
    if (!googleStatus(root).ok) return
    sheetsCache = await listSheets(root, localRedirect(PORT))
    broadcast({ type: 'sheets', sheets: sheetsCache, google: googleStatus(root) })
  } catch (err) {
    console.error('hydrateSheets', err.message || err)
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`LIGUX v${appVersion()} → http://127.0.0.1:${PORT}`)
  kickGoogleBootstrap()
  void hydrateSheets()
})
