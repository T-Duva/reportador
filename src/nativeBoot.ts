import { Capacitor } from '@capacitor/core'
import { APK_DOWNLOAD } from './lib/apkUrl'
import { installApkOnPhone } from './lib/phoneOpen'

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
    await installApkOnPhone(APK_DOWNLOAD)
    return
  }

  location.reload()
}
