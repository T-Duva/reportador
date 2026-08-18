import { Capacitor } from '@capacitor/core'
import { resolveServerOrigin } from './lib/server'

export async function applyAppUpdate(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    /* seguir */
  }

  if (Capacitor.isNativePlatform()) {
    try {
      const origin = await resolveServerOrigin()
      window.location.replace(`${origin.replace(/\/$/, '')}/?fromApp=1&_v=${Date.now()}`)
      return
    } catch {
      /* fallback */
    }
    const url = new URL(location.href)
    url.searchParams.set('_v', String(Date.now()))
    window.location.replace(url.toString())
    return
  }

  try {
    const origin = await resolveServerOrigin()
    window.location.replace(`${origin.replace(/\/$/, '')}/?_v=${Date.now()}`)
  } catch {
    location.reload()
  }
}
