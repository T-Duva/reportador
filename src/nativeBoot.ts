import { Capacitor } from '@capacitor/core'
import { APK_DOWNLOAD } from './lib/apkUrl'

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

  // Nunca saltar a una página web. En el celular se baja el APK nuevo.
  if (Capacitor.isNativePlatform()) {
    window.open(APK_DOWNLOAD, '_system')
    return
  }

  location.reload()
}
