import { Capacitor } from '@capacitor/core'
import { apkDownloadUrl } from './lib/apkUrl'
import { markUpdateSkipped } from './lib/update'
import { installApkOnPhone } from './lib/phoneOpen'

export async function applyAppUpdate(remoteVersion: string): Promise<void> {
  markUpdateSkipped(remoteVersion)
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
    await installApkOnPhone(apkDownloadUrl(remoteVersion))
    return
  }

  location.reload()
}
