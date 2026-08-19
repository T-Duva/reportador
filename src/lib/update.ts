const SKIP_KEY = 'ligux.updateSkip'

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

export function needsAppUpdate(remote: string | null | undefined, local: string): boolean {
  if (!remote) return false
  const r = normalizeVersion(remote)
  const l = normalizeVersion(local)
  if (!isNewerVersion(r, l)) return false
  try {
    if (localStorage.getItem(SKIP_KEY) === r) return false
  } catch {
    /* privado */
  }
  return true
}

export function markUpdateSkipped(remote: string): void {
  try {
    localStorage.setItem(SKIP_KEY, normalizeVersion(remote))
  } catch {
    /* privado */
  }
}

export function clearUpdateSkip(): void {
  try {
    localStorage.removeItem(SKIP_KEY)
  } catch {
    /* privado */
  }
}
