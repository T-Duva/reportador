import fs from 'node:fs'
import path from 'node:path'
import { google } from 'googleapis'

export const DRIVE_FOLDER_ID = '1Z8IMco9DIN3pREbzaffgaIMpEV9iAOV-'

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

export function googleStatus(root) {
  readEnvFile(root)
  const tokenPath = path.join(root, 'data', 'google-token.json')
  const credPath = path.join(root, 'data', 'credentials.json')
  const hasToken = fs.existsSync(tokenPath)
  let email = ''
  try {
    const t = JSON.parse(fs.readFileSync(tokenPath, 'utf8'))
    email = t.email || ''
  } catch {
    /* ok */
  }
  return {
    ok: hasToken,
    email,
    hasCredentials: Boolean(process.env.GOOGLE_CLIENT_ID) || fs.existsSync(credPath),
    error: hasToken
      ? undefined
      : fs.existsSync(credPath) || process.env.GOOGLE_CLIENT_ID
        ? 'Falta autorizar la cuenta (Vincular Drive).'
        : 'Falta data/credentials.json de Google (tipo Escritorio). No uses la contraseña de Gmail.',
  }
}

async function getOAuthClient(root, redirectUri) {
  readEnvFile(root)
  const credPath = path.join(root, 'data', 'credentials.json')
  let clientId = process.env.GOOGLE_CLIENT_ID || ''
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET || ''
  if (fs.existsSync(credPath)) {
    const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'))
    const installed = raw.installed || raw.web || raw
    clientId = installed.client_id || clientId
    clientSecret = installed.client_secret || clientSecret
  }
  if (!clientId || !clientSecret) {
    throw new Error('Falta credentials.json (OAuth de escritorio). No pongas la contraseña de Gmail.')
  }
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

export async function startAuth(root, redirectUri) {
  const client = await getOAuthClient(root, redirectUri)
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  })
}

export async function finishAuth(root, redirectUri, code) {
  const client = await getOAuthClient(root, redirectUri)
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
  const client = await getOAuthClient(root, redirectUri)
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
  const client = await getOAuthClient(root, redirectUri)
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
  const client = await getOAuthClient(root, redirectUri)
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
