/**
 * Crea data/credentials.json (cuenta de servicio) usando Chrome ya logueado.
 * No pide la contraseña de Gmail. Comparte la carpeta de Drive con esa cuenta.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { DRIVE_FOLDER_ID } from '../server/google.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const outCred = path.join(root, 'data', 'credentials.json')
const logPath = path.join(__dirname, '_bootstrap-google.log')
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const userData = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data')
const PORT = 9333

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}`
  console.log(line)
  try {
    fs.appendFileSync(logPath, line + '\n', 'utf8')
  } catch {
    /* ok */
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function getJson(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.id = 0
    this.pending = new Map()
    this.bearers = []
    this.ws.on('error', (err) => {
      for (const { reject } of this.pending.values()) reject(err)
      this.pending.clear()
    })
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw))
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
      if (msg.method === 'Network.requestWillBeSent') {
        const headers = msg.params?.request?.headers || {}
        const auth = String(headers.Authorization || headers.authorization || '')
        const m = auth.match(/^Bearer\s+(ya29\.[A-Za-z0-9._-]+)/)
        if (m) this.bearers.push({ token: m[1], url: String(msg.params.request.url || '') })
      }
    })
  }
  ready() {
    if (this.ws.readyState === 1) return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.ws.once('open', resolve)
      this.ws.once('error', reject)
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.text || res.exceptionDetails.exception?.description || 'eval failed')
    }
    return res.result?.value
  }
  latestBearer(needle) {
    for (let i = this.bearers.length - 1; i >= 0; i--) {
      const b = this.bearers[i]
      if (!needle || b.url.includes(needle)) return b.token
    }
    return this.bearers.at(-1)?.token || ''
  }
  close() {
    try {
      this.ws.close()
    } catch {
      /* ok */
    }
  }
}

async function waitDebug() {
  for (let i = 0; i < 80; i++) {
    try {
      return await getJson(`http://127.0.0.1:${PORT}/json/version`)
    } catch {
      await sleep(250)
    }
  }
  throw new Error('Chrome debug port no respondió')
}

async function openPage(url) {
  log('openPage list')
  const tabs = await getJson(`http://127.0.0.1:${PORT}/json`)
  log('tabs', (tabs || []).length, (tabs || []).map((t) => t.type + ':' + (t.url || '').slice(0, 80)).join(' | '))
  let tab = (tabs || []).find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!tab) {
    log('openPage new')
    tab = await getJson(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`)
  }
  if (!tab?.webSocketDebuggerUrl) throw new Error('Chrome no dio websocket de debug')
  log('cdp', tab.webSocketDebuggerUrl)
  const cdp = new Cdp(tab.webSocketDebuggerUrl)
  await cdp.ready()
  log('cdp ready')
  await cdp.send('Network.enable')
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  log('navigate', url)
  await cdp.send('Page.navigate', { url })
  await sleep(5000)
  log('navigated')
  return cdp
}

function copyFileRetry(from, to) {
  if (!fs.existsSync(from)) return false
  fs.mkdirSync(path.dirname(to), { recursive: true })
  for (let i = 0; i < 8; i++) {
    try {
      fs.copyFileSync(from, to)
      return true
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400)
    }
  }
  return false
}

function cloneSlimProfile(dest) {
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(path.join(dest, 'Default', 'Network'), { recursive: true })
  copyFileRetry(path.join(userData, 'Local State'), path.join(dest, 'Local State'))
  const def = path.join(userData, 'Default')
  for (const name of ['Preferences', 'Secure Preferences', 'Login Data', 'Login Data For Account']) {
    copyFileRetry(path.join(def, name), path.join(dest, 'Default', name))
  }
  const cookieOk =
    copyFileRetry(path.join(def, 'Network', 'Cookies'), path.join(dest, 'Default', 'Network', 'Cookies')) ||
    copyFileRetry(path.join(def, 'Cookies'), path.join(dest, 'Default', 'Cookies'))
  log('clone cookies', cookieOk ? 'ok' : 'fail')
}

function launchChrome(dataDir) {
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${dataDir}`,
    '--profile-directory=Default',
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    'https://console.cloud.google.com/',
  ]
  const child = spawn(chrome, args, { detached: false, stdio: 'ignore', windowsHide: true })
  return child
}

async function clickByText(cdp, re) {
  return cdp.eval(`(() => {
    const re = ${re}
    const nodes = [...document.querySelectorAll('button, [role="button"], span, a, div, material-button')]
    const el = nodes.find((n) => re.test((n.innerText || n.textContent || '').trim()) && n.offsetParent !== null)
    if (!el) return false
    el.click()
    return (el.innerText || '').slice(0, 80)
  })()`)
}

async function snapshot(cdp, label) {
  try {
    const href = await cdp.eval('location.href')
    const title = await cdp.eval('document.title')
    const body = await cdp.eval('document.body ? document.body.innerText.slice(0, 1200) : ""')
    log(label, title, href)
    log(label + '-body', String(body).replace(/\s+/g, ' ').slice(0, 400))
  } catch (err) {
    log(label, 'snapshot fail', err.message || err)
  }
}

async function api(token, method, url, body) {
  const r = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text.slice(0, 2000) }
  }
  return { ok: r.ok, status: r.status, json }
}

async function waitProject(token, projectId) {
  for (let i = 0; i < 20; i++) {
    const r = await api(token, 'GET', `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`)
    const state = r.json?.lifecycleState || r.json?.state
    log('project state', projectId, r.status, state || JSON.stringify(r.json).slice(0, 180))
    if (r.ok && (state === 'ACTIVE' || !state)) return true
    await sleep(3000)
  }
  return false
}

async function enableApi(token, projectId, svc) {
  const name = `projects/${projectId}/services/${svc}`
  const r = await api(token, 'POST', `https://serviceusage.googleapis.com/v1/${name}:enable`, {})
  log('enable', svc, r.status, JSON.stringify(r.json).slice(0, 240))
  if (r.status === 403 && /has not been used|disabled/i.test(JSON.stringify(r.json))) {
    await sleep(2000)
    return api(token, 'POST', `https://serviceusage.googleapis.com/v1/${name}:enable`, {})
  }
  return r
}

async function pageFetch(cdp, url, method, body) {
  return cdp.eval(`(async () => {
    const r = await fetch(${JSON.stringify(url)}, {
      method: ${JSON.stringify(method)},
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'},
    })
    const text = await r.text()
    return { status: r.status, text: text.slice(0, 8000) }
  })()`)
}

async function shareFolder(driveToken, saEmail) {
  const url =
    `https://www.googleapis.com/drive/v3/files/${DRIVE_FOLDER_ID}/permissions` +
    '?sendNotificationEmail=false&supportsAllDrives=true'
  const r = await api(driveToken, 'POST', url, {
    role: 'writer',
    type: 'user',
    emailAddress: saEmail,
  })
  log('share', r.status, JSON.stringify(r.json).slice(0, 400))
  return r.ok || r.status === 409
}

async function main() {
  fs.mkdirSync(path.join(root, 'data'), { recursive: true })
  if (fs.existsSync(outCred)) {
    const raw = JSON.parse(fs.readFileSync(outCred, 'utf8'))
    if (raw?.type === 'service_account' && raw.private_key && raw.client_email) {
      log('Ya hay cuenta de servicio', raw.client_email)
      process.exit(0)
    }
    if (raw?.installed?.client_id || raw?.web?.client_id) {
      log('Ya hay cliente OAuth')
      process.exit(0)
    }
  }

    let child = null
  let cdp = null
  const tmpProfile = path.join(root, 'data', '_chrome-google')
  try {
    spawnSync('taskkill', ['/IM', 'chrome.exe', '/F'], { stdio: 'ignore', windowsHide: true })
    await sleep(1500)
    log('Clono sesión de Chrome para debug')
    cloneSlimProfile(tmpProfile)
    child = launchChrome(tmpProfile)
    await waitDebug()
    log('Chrome debug listo')

    cdp = await openPage('https://console.cloud.google.com/welcome')
    await snapshot(cdp, 'welcome')
    for (const re of [
      '/acepto|agree and continue|accept|aceptar|continuar|i agree/i',
      '/create project|crear proyecto|new project|proyecto nuevo/i',
    ]) {
      const clicked = await clickByText(cdp, re)
      if (clicked) {
        log('click', clicked)
        await sleep(2500)
      }
    }
    await snapshot(cdp, 'after-tos')

    let token = cdp.latestBearer('google.com')
    if (!token) {
      await cdp.send('Page.navigate', { url: 'https://console.cloud.google.com/cloud-resource-manager' })
      await sleep(6000)
      token = cdp.latestBearer('google.com')
      await snapshot(cdp, 'crm')
    }
    if (!token) {
      const fromPage = await cdp.eval(`(() => {
        try {
          if (window.gapi?.auth?.getToken) return window.gapi.auth.getToken()?.access_token || ''
        } catch {}
        try {
          if (window.gapi?.client?.getToken) return window.gapi.client.getToken()?.access_token || ''
        } catch {}
        return ''
      })()`)
      if (fromPage) token = fromPage
    }
    if (!token) throw new Error('No pude sacar el token de Google Cloud (Chrome no entregó Bearer).')
    log('token ok', token.slice(0, 12) + '…')

    const listed = await api(token, 'GET', 'https://cloudresourcemanager.googleapis.com/v1/projects')
    log('projects', listed.status, JSON.stringify(listed.json).slice(0, 500))
    if (!listed.ok) {
      await clickByText(cdp, '/acepto|agree|accept|terms|términos|continuar/i')
      await sleep(4000)
    }
    const existing = (listed.json?.projects || []).find(
      (p) => /reportador/i.test(p.name || '') || /reportador/i.test(p.projectId || ''),
    )
    let projectId = existing?.projectId || `rpt${Date.now().toString(36).slice(-8)}`
    if (!existing) {
      const created = await api(token, 'POST', 'https://cloudresourcemanager.googleapis.com/v1/projects', {
        projectId,
        name: 'Reportador',
      })
      log('create project', created.status, JSON.stringify(created.json).slice(0, 500))
      if (!created.ok) throw new Error(`No pude crear el proyecto GCP (${created.status}).`)
      await waitProject(token, projectId)
    } else {
      log('reuso proyecto', projectId)
    }

    await enableApi(token, projectId, 'iam.googleapis.com')
    await enableApi(token, projectId, 'sheets.googleapis.com')
    await enableApi(token, projectId, 'drive.googleapis.com')
    await sleep(4000)

    const saId = 'reportador'
    let saEmail = `${saId}@${projectId}.iam.gserviceaccount.com`
    const sa = await api(token, 'POST', `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts`, {
      accountId: saId,
      serviceAccount: { displayName: 'Reportador' },
    })
    log('sa', sa.status, JSON.stringify(sa.json).slice(0, 500))
    if (sa.ok) saEmail = sa.json.email || saEmail
    else if (sa.status !== 409) {
      const getSa = await api(
        token,
        'GET',
        `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts/${saEmail}`,
      )
      if (!getSa.ok) throw new Error(`No pude crear la cuenta de servicio (${sa.status}).`)
    }

    const key = await api(
      token,
      'POST',
      `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts/${saEmail}/keys`,
      { privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE', keyAlgorithm: 'KEY_ALG_RSA_2048' },
    )
    log('key', key.status, key.ok ? 'ok' : JSON.stringify(key.json).slice(0, 400))
    if (!key.ok || !key.json.privateKeyData) throw new Error('No pude bajar la clave de la cuenta de servicio.')
    const cred = JSON.parse(Buffer.from(key.json.privateKeyData, 'base64').toString('utf8'))
    fs.writeFileSync(outCred, JSON.stringify(cred, null, 2), 'utf8')
    log('wrote', outCred, cred.client_email)

    await cdp.send('Page.navigate', { url: `https://drive.google.com/drive/folders/${DRIVE_FOLDER_ID}` })
    await sleep(6000)
    await snapshot(cdp, 'drive')
    let driveToken = cdp.latestBearer('googleapis.com') || cdp.latestBearer('drive.google.com') || token
    let shared = await shareFolder(driveToken, cred.client_email)
    if (!shared) {
      driveToken = cdp.latestBearer('') || token
      shared = await shareFolder(driveToken, cred.client_email)
    }
    if (!shared) {
      const pf = await pageFetch(
        cdp,
        `https://content.googleapis.com/drive/v3/files/${DRIVE_FOLDER_ID}/permissions?sendNotificationEmail=false&supportsAllDrives=true`,
        'POST',
        { role: 'writer', type: 'user', emailAddress: cred.client_email },
      )
      log('share-page', JSON.stringify(pf).slice(0, 400))
      shared = pf && (pf.status === 200 || pf.status === 409)
    }
    if (!shared) log('AVISO: carpeta no se compartió sola; hay que compartir Drive con', cred.client_email)
    else log('carpeta compartida con', cred.client_email)
  } finally {
    try {
      cdp?.close()
    } catch {
      /* ok */
    }
    if (child?.pid) {
      try {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      } catch {
        /* ok */
      }
    }
  }
}

process.on('exit', (code) => {
  try {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] process.exit ${code}\n`, 'utf8')
  } catch {
    /* ok */
  }
})

main().catch((err) => {
  log('ERR', err.stack || err.message || err)
  process.exit(1)
})
