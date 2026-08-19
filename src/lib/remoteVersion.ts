import { normalizeVersion } from './update'

const VERSION_URLS = [
  'https://raw.githubusercontent.com/T-Duva/reportador/master/version.json',
  'https://cdn.jsdelivr.net/gh/T-Duva/reportador@master/version.json',
]

const RELEASE_URL =
  'https://api.github.com/repos/T-Duva/reportador/releases/latest'

async function fetchJson(url: string, ms = 6000): Promise<unknown | null> {
  const ctrl = new AbortController()
  const t = window.setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, {
      cache: 'no-store',
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  } finally {
    window.clearTimeout(t)
  }
}

export async function fetchRemoteVersion(): Promise<string | null> {
  const hits = await Promise.all(
    VERSION_URLS.map(async (base) => {
      const j = (await fetchJson(`${base}?t=${Date.now()}`)) as { version?: string } | null
      return j?.version ? normalizeVersion(j.version) : null
    }),
  )
  const fromFile = hits.find(Boolean)
  if (fromFile) return fromFile

  const rel = (await fetchJson(RELEASE_URL, 8000)) as { tag_name?: string } | null
  if (rel?.tag_name) return normalizeVersion(rel.tag_name)
  return null
}

export function pickNewer(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a && !b) return null
  if (!a) return b || null
  if (!b) return a
  const parse = (v: string) => normalizeVersion(v).split('.').map((x) => Number.parseInt(x, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x > y) return a
    if (x < y) return b
  }
  return a
}
