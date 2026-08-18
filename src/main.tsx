import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

function paint() {
  const el = document.getElementById('root')
  if (!el) return
  createRoot(el).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}

async function start() {
  paint()
  const native = Capacitor.isNativePlatform()
  const fromApp = new URLSearchParams(location.search).has('fromApp')
  if (native) {
    try {
      void StatusBar.setOverlaysWebView({ overlay: false })
      void StatusBar.setBackgroundColor({ color: '#efe6d4' })
      void StatusBar.setStyle({ style: Style.Light })
    } catch {
      /* sin plugin */
    }
  }
  if (native || fromApp) {
    try {
      sessionStorage.setItem('reportador.fromApp', '1')
    } catch {
      /* privado */
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
  } else {
    registerSW({ immediate: true })
  }
}

void start()
