import { create } from 'zustand'
import { APP_VERSION } from '../version'
import { apiUrl, resolveServerOrigin } from '../lib/server'
import type { ChatMsg, SheetFile, SheetGrid, WatcherState } from '../types'

type GoogleState = { ok: boolean; email?: string; error?: string }

type Store = {
  connected: boolean
  watcher: WatcherState
  thread: ChatMsg[]
  sheets: SheetFile[]
  google: GoogleState
  remoteVersion: string | null
  chatOpen: boolean
  openSheet: SheetGrid | null
  tab: number
  toast: string | null
  setChatOpen: (v: boolean) => void
  connect: () => void
  sendChat: (text: string, photos?: string[]) => Promise<void>
  refreshSheets: () => Promise<void>
  loadSheet: (id: string) => Promise<void>
  saveCell: (tabTitle: string, row: number, col: number, value: string) => Promise<void>
  startGoogle: () => Promise<void>
}

let ws: WebSocket | null = null

export const useApp = create<Store>((set, get) => ({
  connected: false,
  watcher: { status: 'off', lastSeenAt: 0, pendingCount: 0 },
  thread: [],
  sheets: [],
  google: { ok: false },
  remoteVersion: null,
  chatOpen: false,
  openSheet: null,
  tab: 0,
  toast: null,
  setChatOpen: (v) => set({ chatOpen: v }),

  connect: () => {
    void (async () => {
      const origin = await resolveServerOrigin()
      const health = await fetch(`${origin}/api/health?t=${Date.now()}`, { cache: 'no-store' })
      const h = (await health.json()) as { version?: string; watcher?: WatcherState }
      set({
        remoteVersion: h.version || null,
        watcher: h.watcher || get().watcher,
        connected: true,
      })
      const boot = await fetch(`${origin}/api/boot?t=${Date.now()}`, { cache: 'no-store' })
      const b = (await boot.json()) as {
        thread?: ChatMsg[]
        sheets?: SheetFile[]
        google?: GoogleState
        watcher?: WatcherState
      }
      set({
        thread: b.thread || [],
        sheets: b.sheets || [],
        google: b.google || { ok: false },
        watcher: b.watcher || get().watcher,
      })
      const wsUrl = origin.replace(/^http/, 'ws') + '/ws'
      try {
        ws?.close()
      } catch {
        /* ok */
      }
      ws = new WebSocket(wsUrl)
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as Record<string, unknown>
          if (msg.type === 'watcher' && msg.watcher) set({ watcher: msg.watcher as WatcherState })
          if (msg.type === 'thread' && Array.isArray(msg.thread)) set({ thread: msg.thread as ChatMsg[] })
          if (msg.type === 'sheets' && Array.isArray(msg.sheets)) set({ sheets: msg.sheets as SheetFile[] })
          if (msg.type === 'google' && msg.google) set({ google: msg.google as GoogleState })
        } catch {
          /* ignore */
        }
      }
      ws.onclose = () => set({ connected: false })
    })().catch(() => set({ connected: false }))
  },

  sendChat: async (text, photos) => {
    const url = await apiUrl('/api/report')
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, photos, version: APP_VERSION }),
    })
  },

  refreshSheets: async () => {
    const url = await apiUrl('/api/sheets')
    const r = await fetch(url, { cache: 'no-store' })
    const j = (await r.json()) as { sheets?: SheetFile[]; google?: GoogleState; error?: string }
    set({
      sheets: j.sheets || [],
      google: j.google || get().google,
      toast: j.error || null,
    })
  },

  loadSheet: async (id) => {
    const url = await apiUrl(`/api/sheets/${encodeURIComponent(id)}`)
    const r = await fetch(url, { cache: 'no-store' })
    const j = (await r.json()) as SheetGrid & { error?: string }
    if (j.error) {
      set({ toast: j.error })
      return
    }
    set({ openSheet: j, tab: 0, chatOpen: false })
  },

  saveCell: async (tabTitle, row, col, value) => {
    const sheet = get().openSheet
    if (!sheet) return
    const url = await apiUrl(`/api/sheets/${encodeURIComponent(sheet.id)}`)
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tab: tabTitle, row, col, value }),
    })
    await get().loadSheet(sheet.id)
  },

  startGoogle: async () => {
    const url = await apiUrl('/api/google/start')
    const r = await fetch(url)
    const j = (await r.json()) as { url?: string; error?: string }
    if (j.url) window.open(j.url, '_blank')
    else set({ toast: j.error || 'No se pudo abrir Google' })
  },
}))
