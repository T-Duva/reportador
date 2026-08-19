import fs from 'node:fs'
import path from 'node:path'
import { google } from 'googleapis'

export const DRIVE_FOLDER_ID = '1Z8IMco9DIN3pREbzaffgaIMpEV9iAOV-'

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
]

function readEnvFile(root) {
  for (const name of ['.env.local', '.env']) {
    const p = path.join(root, name)
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      const key = m[1]
      const val = m[2].replace(/^["']|["']$/g, '')
      if (!process.env[key]) process.env[key] = val
    }
  }
}

function credCandidates(root) {
  const extra = []
  const dataDir = path.join(root, 'data')
  try {
    for (const name of fs.readdirSync(dataDir)) {
      if (/^(credentials|client_secret).*\.json$/i.test(name)) extra.push(path.join(dataDir, name))
    }
  } catch {
    /* ok */
  }
  return [
    path.join(root, 'data', 'credentials.json'),
    path.join(root, 'credentials.json'),
    process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
    ...extra,
  ].filter(Boolean)
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function loadCredFile(root) {
  readEnvFile(root)
  const seen = new Set()
  for (const p of credCandidates(root)) {
    const full = path.resolve(p)
    if (seen.has(full) || !fs.existsSync(full)) continue
    seen.add(full)
    const raw = readJson(full)
    if (raw && typeof raw === 'object') return { path: full, raw }
  }
  return null
}

function oauthFromCred(raw) {
  const installed = raw.installed || raw.web || (raw.client_id ? raw : null)
  if (!installed) return { clientId: '', clientSecret: '' }
  return {
    clientId: installed.client_id || '',
    clientSecret: installed.client_secret || '',
  }
}

function isServiceAccount(raw) {
  return Boolean(raw && raw.type === 'service_account' && raw.private_key && raw.client_email)
}

export function googleStatus(root) {
  readEnvFile(root)
  const tokenPath = path.join(root, 'data', 'google-token.json')
  const cred = loadCredFile(root)
  const raw = cred?.raw
  const svc = isServiceAccount(raw)
  const oauth = raw ? oauthFromCred(raw) : { clientId: '', clientSecret: '' }
  const hasOAuthCreds =
    Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) ||
    Boolean(oauth.clientId && oauth.clientSecret) ||
    true
  const hasToken = fs.existsSync(tokenPath)
  let email = ''
  if (svc) email = raw.client_email || ''
  if (hasToken) {
    const t = readJson(tokenPath) || {}
    email = t.email || email
  }
  const ok = svc || hasToken
  let error
  if (!ok) {
    error = 'Falta autorizar la cuenta. Tocá Vincular Drive.'
  }
  return {
    ok,
    email,
    hasCredentials: svc || hasOAuthCreds,
    error,
  }
}

function oauth2Ids(root) {
  readEnvFile(root)
  const cred = loadCredFile(root)
  const raw = cred?.raw
  let clientId = process.env.GOOGLE_CLIENT_ID || ''
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET || ''
  if (raw && !isServiceAccount(raw)) {
    const o = oauthFromCred(raw)
    clientId = o.clientId || clientId
    clientSecret = o.clientSecret || clientSecret
  }
  if (!clientId || !clientSecret) {
    clientId = PHONE_OAUTH.clientId
    clientSecret = PHONE_OAUTH.clientSecret
  }
  return { clientId, clientSecret }
}

function getOAuth2Client(root, redirectUri) {
  const { clientId, clientSecret } = oauth2Ids(root)
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
  const tokenPath = path.join(root, 'data', 'google-token.json')
  if (fs.existsSync(tokenPath)) {
    const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'))
    client.setCredentials(tokens)
    client.on('tokens', (t) => {
      const prev = fs.existsSync(tokenPath) ? JSON.parse(fs.readFileSync(tokenPath, 'utf8')) : {}
      fs.writeFileSync(tokenPath, JSON.stringify({ ...prev, ...t }, null, 2), 'utf8')
    })
  }
  return client
}

async function getAuthClient(root, redirectUri) {
  readEnvFile(root)
  const cred = loadCredFile(root)
  const raw = cred?.raw
  const tokenPath = path.join(root, 'data', 'google-token.json')
  if (fs.existsSync(tokenPath)) return getOAuth2Client(root, redirectUri)
  if (isServiceAccount(raw)) {
    const jwt = new google.auth.JWT({
      email: raw.client_email,
      key: raw.private_key,
      scopes: SCOPES.filter((s) => !s.includes('userinfo')),
    })
    await jwt.authorize()
    return jwt
  }
  return getOAuth2Client(root, redirectUri)
}

const PHONE_OAUTH = {
  clientId: '764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com',
  clientSecret: 'd-FL95Q19q7MQmFpd7hHD0Ty',
  redirect: 'http://127.0.0.1',
}

export function localRedirect(port) {
  return `http://127.0.0.1:${Number(port) || 8789}/api/google/callback`
}

export function phoneAuthRedirect() {
  return PHONE_OAUTH.redirect
}

export function openOnPc(_url) {
  // Prohibido: Tomás no da permiso para tocar el navegador de la PC.
}

function oauthRedirect(root, fallback) {
  const cred = loadCredFile(root)
  const raw = cred?.raw
  if (isServiceAccount(raw)) return fallback
  const o = raw ? oauthFromCred(raw) : { clientId: '', clientSecret: '' }
  const hasOwn = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) || Boolean(o.clientId && o.clientSecret)
  return hasOwn ? fallback : PHONE_OAUTH.redirect
}

export async function startAuth(root, _redirectUri) {
  const redirect = PHONE_OAUTH.redirect
  const client = getOAuth2Client(root, redirect)
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: false,
    scope: SCOPES,
  })
}

export async function finishAuth(root, redirectUri, code) {
  const redirect = redirectUri || PHONE_OAUTH.redirect
  const client = getOAuth2Client(root, redirect)
  const { tokens } = await client.getToken(code)
  client.setCredentials(tokens)
  let email = ''
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: client })
    const me = await oauth2.userinfo.get()
    email = me.data.email || ''
  } catch {
    /* ok */
  }
  fs.mkdirSync(path.join(root, 'data'), { recursive: true })
  fs.writeFileSync(path.join(root, 'data', 'google-token.json'), JSON.stringify({ ...tokens, email }, null, 2), 'utf8')
  return { email }
}

export async function listSheets(root, redirectUri) {
  const client = await getAuthClient(root, redirectUri)
  const drive = google.drive({ version: 'v3', auth: client })
  const out = []
  async function walk(folderId, pathLabel) {
    let pageToken
    do {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
        pageSize: 100,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })
      for (const f of res.data.files || []) {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          await walk(f.id, `${pathLabel}/${f.name}`)
        } else if (f.mimeType === 'application/vnd.google-apps.spreadsheet') {
          out.push({
            id: f.id,
            name: f.name,
            path: pathLabel,
            modified: f.modifiedTime || null,
          })
        }
      }
      pageToken = res.data.nextPageToken || undefined
    } while (pageToken)
  }
  await walk(DRIVE_FOLDER_ID, '/')
  out.sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name))
  return out
}

export async function readSheet(root, redirectUri, id) {
  const client = await getAuthClient(root, redirectUri)
  const sheets = google.sheets({ version: 'v4', auth: client })
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id })
  const name = meta.data.properties?.title || 'Hoja'
  const tabs = []
  for (const tab of meta.data.sheets || []) {
    const title = tab.properties?.title || 'Hoja'
    const vals = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range: `'${title.replace(/'/g, "''")}'`,
    })
    tabs.push({ title, values: vals.data.values || [] })
  }
  return { id, name, tabs }
}

export async function writeCell(root, redirectUri, id, tab, row, col, value) {
  const client = await getAuthClient(root, redirectUri)
  const sheetsApi = google.sheets({ version: 'v4', auth: client })
  const a1 = `${colToA1(col)}${Number(row) + 1}`
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: id,
    range: `'${String(tab).replace(/'/g, "''")}'!${a1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] },
  })
}

function colToA1(col) {
  let n = Number(col) + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}
