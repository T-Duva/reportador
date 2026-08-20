import { Capacitor, registerPlugin } from '@capacitor/core'

type PhoneOpenPlugin = {
  openUrl: (opts: { url: string }) => Promise<void>
  installApk: (opts: { url: string }) => Promise<void>
  openAuth: (opts: { url: string }) => Promise<{ code?: string; error?: string; redirectUri?: string }>
  openNativeGoogleAuth: (opts: {
    webClientId: string
    scopes?: string[]
  }) => Promise<{ code?: string; error?: string; redirectUri?: string; email?: string }>
}

const PhoneOpen = registerPlugin<PhoneOpenPlugin>('PhoneOpen')

export async function openOnPhone(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await PhoneOpen.openUrl({ url })
      return
    } catch {
      /* fallback */
    }
  }
  const w = window.open(url, '_blank')
  if (!w) {
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
}

export async function installApkOnPhone(
  url: string,
  opts: { allowBrowserFallback?: boolean } = {},
): Promise<void> {
  const allowBrowser = opts.allowBrowserFallback !== false
  if (Capacitor.isNativePlatform()) {
    try {
      await PhoneOpen.installApk({ url })
      return
    } catch (e) {
      if (!allowBrowser) throw e
      await openOnPhone(url)
    }
    return
  }
  location.assign(url)
}

export async function openNativeGoogleOnPhone(opts: {
  webClientId: string
  scopes?: string[]
}): Promise<{ code: string; redirectUri?: string }> {
  if (Capacitor.isNativePlatform()) {
    const r = await PhoneOpen.openNativeGoogleAuth(opts)
    if (r?.code) return { code: r.code, redirectUri: r.redirectUri || '' }
    throw new Error(r?.error || 'No se autorizó Google')
  }
  throw new Error('Autorizá en el celu y volvé a LIGUX')
}

export async function openGoogleOnPhone(url: string): Promise<{ code: string; redirectUri?: string }> {
  if (Capacitor.isNativePlatform()) {
    const r = await PhoneOpen.openAuth({ url })
    if (r?.code) return { code: r.code, redirectUri: r.redirectUri }
    throw new Error(r?.error || 'No se autorizó Google')
  }
  await openOnPhone(url)
  throw new Error('Autorizá en el celu y volvé a LIGUX')
}
