import { Capacitor } from '@capacitor/core'
import { apkDownloadUrl } from './lib/apkUrl'
import { clearUpdateBusy, markUpdateBusy, markUpdateSkipped } from './lib/update'
import { installApkOnPhone } from './lib/phoneOpen'

let installing = false

export async function applyAppUpdate(remoteVersion: string): Promise<void> {
  if (installing) return
  installing = true
  markUpdateSkipped(remoteVersion)
  markUpdateBusy(remoteVersion)
  try {
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
      // Una sola bajada: plugin nativo. Sin abrir el navegador de respaldo.
      await installApkOnPhone(apkDownloadUrl(remoteVersion), { allowBrowserFallback: false })
      return
    }

    location.reload()
  } finally {
    clearUpdateBusy()
    installing = false
  }
}
