const SKIP_KEY = 'ligux.updateSkip'
const BUSY_KEY = 'ligux.updateBusy'

export function normalizeVersion(v: string): string {
  return v.replace(/^v/i, '').trim()
}

export function isNewerVersion(remote: string, local: string): boolean {
  const parse = (v: string) => normalizeVersion(v).split('.').map((x) => Number.parseInt(x, 10) || 0)
  const a = parse(remote)
  const b = parse(local)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0
    const y = b[i] || 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeKey(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* privado */
  }
}

function clearKey(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* privado */
  }
}

/** Cinta solo si hay versión más nueva y el usuario aún no tocó Instalar para esa. */
export function needsAppUpdate(remote: string | null | undefined, local: string): boolean {
  if (!remote) return false
  const r = normalizeVersion(remote)
  const l = normalizeVersion(local)
  if (!isNewerVersion(r, l)) return false
  if (readKey(SKIP_KEY) === r) return false
  if (readKey(BUSY_KEY) === r) return false
  return true
}

/** Al tocar Instalar: no volver a mostrar ni a bajar esa versión sola. */
export function markUpdateSkipped(remote: string): void {
  writeKey(SKIP_KEY, normalizeVersion(remote))
}

export function markUpdateBusy(remote: string): void {
  writeKey(BUSY_KEY, normalizeVersion(remote))
}

export function clearUpdateBusy(): void {
  clearKey(BUSY_KEY)
}

/** Solo limpiar skip cuando el APK local ya alcanzó o pasó el remoto. */
export function clearUpdateSkipIfCaughtUp(remote: string | null | undefined, local: string): void {
  if (!remote) return
  const r = normalizeVersion(remote)
  const l = normalizeVersion(local)
  if (!isNewerVersion(r, l)) {
    clearKey(SKIP_KEY)
    clearKey(BUSY_KEY)
  }
}

export function clearUpdateSkip(): void {
  clearKey(SKIP_KEY)
  clearKey(BUSY_KEY)
}
