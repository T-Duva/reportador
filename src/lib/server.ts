import { Capacitor } from '@capacitor/core'

const DISCOVERY_URLS = [
  'https://raw.githubusercontent.com/T-Duva/reportador/master/server.json',
  'https://cdn.jsdelivr.net/gh/T-Duva/reportador@master/server.json',
  'https://raw.githubusercontent.com/T-Duva/reportador/main/server.json',
]
const FALLBACKS = [
  'https://silly-peas-strive.loca.lt',
]

let cached: string | null = null

function needsTunnelBypass(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.loca.lt')
  } catch {
    return false
  }
}

export function tunnelHeaders(url: string): Record<string, string> {
  return needsTunnelBypass(url) ? { 'Bypass-Tunnel-Reminder': 'true' } : {}
}

export async function serverFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = { ...tunnelHeaders(url), ...(init?.headers as Record<string, string> | undefined) }
  return fetch(url, { ...init, headers })
}

export function isNativeApp(): boolean {
  if (Capacitor.isNativePlatform()) return true
  try {
    if (sessionStorage.getItem('reportador.fromApp') === '1') return true
  } catch {
    /* privado */
  }
  return new URLSearchParams(location.search).has('fromApp')
}

function hereOrigin(): string {
  return `${location.protocol}//${location.host}`
}

function isBundledHost(): boolean {
  const h = location.hostname
  return (
    location.protocol === 'capacitor:' ||
    /^localhost$|^127\.0\.0\.1$/i.test(h) ||
    h.endsWith('.localhost')
  )
}

async function healthy(origin: string): Promise<boolean> {
  const ctrl = new AbortController()
  const t = window.setTimeout(() => ctrl.abort(), 3500)
  try {
    const healthUrl = `${origin.replace(/\/$/, '')}/api/health?t=${Date.now()}`
    const r = await serverFetch(healthUrl, {
      cache: 'no-store',
      signal: ctrl.signal,
    })
    if (!r.ok) return false
    const j = (await r.json()) as { ok?: boolean }
    return Boolean(j && j.ok)
  } catch {
    return false
  } finally {
    window.clearTimeout(t)
  }
}

async function readDiscovery(): Promise<string | null> {
  const urls = DISCOVERY_URLS.map((u) => `${u}?t=${Date.now()}`)
  const hits = await Promise.all(
    urls.map(async (url) => {
      const ctrl = new AbortController()
      const t = window.setTimeout(() => ctrl.abort(), 5000)
      try {
        const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal })
        if (!r.ok) return null
        const j = (await r.json()) as { url?: string }
        return j.url ? j.url.replace(/\/$/, '') : null
      } catch {
        return null
      } finally {
        window.clearTimeout(t)
      }
    }),
  )
  return hits.find(Boolean) ?? null
}

async function tryHealthyOrigin(origin: string | null | undefined, tried: Set<string>): Promise<string | null> {
  if (!origin) return null
  const url = origin.replace(/\/$/, '')
  if (tried.has(url)) return null
  tried.add(url)
  if (await healthy(url)) {
    setServerOrigin(url)
    return url
  }
  return null
}

export async function resolveServerOrigin(): Promise<string> {
  const here = hereOrigin()
  const tried = new Set<string>()
  const tryOne = (origin: string | null | undefined) => tryHealthyOrigin(origin, tried)

  if (!isBundledHost()) {
    const ok = await tryOne(here)
    if (ok) return ok
  } else {
    const discovered = await readDiscovery()
    const fromDisc = await tryOne(discovered)
    if (fromDisc) return fromDisc
    for (const fb of FALLBACKS) {
      const ok = await tryOne(fb)
      if (ok) return ok
    }
  }

  const saved = localStorage.getItem('reportador.server')
  const fromSaved = await tryOne(saved)
  if (fromSaved) return fromSaved
  if (saved) localStorage.removeItem('reportador.server')

  const fromMem = await tryOne(cached)
  if (fromMem) return fromMem

  const discovered = await readDiscovery()
  const fromDisc = await tryOne(discovered)
  if (fromDisc) return fromDisc
  for (const fb of FALLBACKS) {
    const ok = await tryOne(fb)
    if (ok) return ok
  }

  cached = here
  return cached
}

export function setServerOrigin(url: string) {
  cached = url.replace(/\/$/, '')
  localStorage.setItem('reportador.server', cached)
}

export async function apiUrl(path: string): Promise<string> {
  const origin = await resolveServerOrigin()
  return `${origin.replace(/\/$/, '')}${path}`
}









