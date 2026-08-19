import { create } from 'zustand'
import { APP_VERSION } from '../version'
import { apiUrl, clearServerCache, resolveServerOrigin, serverFetch } from '../lib/server'
import { fetchRemoteVersion, pickNewer } from '../lib/remoteVersion'
import { openGoogleOnPhone, openNativeGoogleOnPhone } from '../lib/phoneOpen'
import type { AppMenu, ChatMsg, Comparison, SheetFile, SheetGrid, WatcherState } from '../types'
import { deleteComparison, sendPostChat as apiPostChat, sendPreChat as apiPreChat } from '../lib/analysis'

type GoogleState = { ok: boolean; email?: string; error?: string }

type Store = {
  connected: boolean
  watcher: WatcherState
  thread: ChatMsg[]
  preThread: ChatMsg[]
  postThread: ChatMsg[]
  comparisons: Comparison[]
  menu: AppMenu
  sheets: SheetFile[]
  google: GoogleState
  remoteVersion: string | null
  chatOpen: boolean
  openSheet: SheetGrid | null
  tab: number
  toast: string | null
  setChatOpen: (v: boolean) => void
  setMenu: (m: AppMenu) => void
  connect: () => void
  sendChat: (text: string, photos?: string[]) => Promise<void>
  sendPreChat: (text: string) => Promise<void>
  sendPostChat: (text: string) => Promise<void>
  removeComparison: (id: string) => Promise<void>
  refreshSheets: () => Promise<void>
  loadSheet: (id: string) => Promise<void>
  saveCell: (tabTitle: string, row: number, col: number, value: string) => Promise<void>
  startGoogle: () => Promise<void>
}

let ws: WebSocket | null = null
let connecting = false

function mergeThread(local: ChatMsg[], incoming?: ChatMsg[] | null): ChatMsg[] {
  const map = new Map<string, ChatMsg>()
  for (const m of local) map.set(m.id, m)
  for (const m of incoming || []) {
    if (m?.id) map.set(m.id, m)
  }
  return [...map.values()].sort((a, b) => a.at - b.at)
}

function applyPayload(set: (p: Partial<Store>) => void, get: () => Store, b: Record<string, unknown>) {
  const next: Partial<Store> = {}
  if (Array.isArray(b.thread)) next.thread = mergeThread(get().thread, b.thread as ChatMsg[])
  if (Array.isArray(b.preThread)) next.preThread = mergeThread(get().preThread, b.preThread as ChatMsg[])
  if (Array.isArray(b.postThread)) next.postThread = mergeThread(get().postThread, b.postThread as ChatMsg[])
  if (Array.isArray(b.comparisons)) next.comparisons = b.comparisons as Comparison[]
  if (Array.isArray(b.sheets)) next.sheets = b.sheets as SheetFile[]
  if (b.google) {
    next.google = b.google as GoogleState
    if ((b.google as GoogleState).ok) next.toast = null
  }
  if (b.watcher) next.watcher = b.watcher as WatcherState
  if (typeof b.version === 'string') next.remoteVersion = b.version
  if (Object.keys(next).length) set(next)
}

export const useApp = create<Store>((set, get) => ({
  connected: false,
  watcher: { status: 'off', lastSeenAt: 0, pendingCount: 0 },
  thread: [],
  preThread: [],
  postThread: [],
  comparisons: [],
  menu: 'general',
  sheets: [],
  google: { ok: false },
  remoteVersion: null,
  chatOpen: false,
  openSheet: null,
  tab: 0,
  toast: null,
  setChatOpen: (v) => set({ chatOpen: v }),
  setMenu: (m) => set({ menu: m, openSheet: m === 'general' ? get().openSheet : null }),

  connect: () => {
    if (connecting) return
    connecting = true
    void (async () => {
      let serverVersion: string | null = null
      try {
        const origin = await resolveServerOrigin()
        const boot = await serverFetch(`${origin}/api/boot?t=${Date.now()}`, { cache: 'no-store' })
        const b = (await boot.json()) as Record<string, unknown>
        applyPayload(set, get, b)
        serverVersion = typeof b.version === 'string' ? b.version : null
        set({ connected: true, remoteVersion: serverVersion || get().remoteVersion })

        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
          /* seguir abajo por version remota */
        } else {
          const wsUrl = origin.replace(/^http/, 'ws') + '/ws'
          ws = new WebSocket(wsUrl)
          ws.onmessage = (ev) => {
            try {
              const msg = JSON.parse(String(ev.data)) as Record<string, unknown>
              applyPayload(set, get, msg)
            } catch {
              /* ignore */
            }
          }
          ws.onopen = () => set({ connected: true })
          ws.onclose = () => {
            set({ connected: false })
            ws = null
          }
        }
      } catch {
        clearServerCache()
        set({ connected: false })
      } finally {
        connecting = false
        const gh = await fetchRemoteVersion()
        const best = pickNewer(pickNewer(serverVersion, gh), get().remoteVersion)
        if (best) set({ remoteVersion: best })
      }
    })()
  },

  sendChat: async (text, photos) => {
    const tempId = `local-${Date.now()}`
    const local: ChatMsg = {
      id: tempId,
      role: 'user',
      text,
      photos,
      at: Date.now(),
      version: APP_VERSION,
    }
    set({ thread: mergeThread(get().thread, [local]) })
    const url = await apiUrl('/api/report')
    const r = await serverFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, photos, version: APP_VERSION }),
    })
    const j = (await r.json()) as { ok?: boolean; thread?: ChatMsg[]; error?: string }
    if (!r.ok) {
      set({ toast: j.error || 'No se pudo enviar' })
      return
    }
    const withoutTemp = get().thread.filter((m) => m.id !== tempId)
    set({ thread: mergeThread(withoutTemp, j.thread) })
  },

  sendPreChat: async (text) => {
    const tempId = `local-pre-${Date.now()}`
    const local: ChatMsg = { id: tempId, role: 'user', text, at: Date.now() }
    set({ preThread: mergeThread(get().preThread, [local]) })
    const j = await apiPreChat(text)
    const withoutTemp = get().preThread.filter((m) => m.id !== tempId)
    set({
      preThread: mergeThread(withoutTemp, j.preThread),
      comparisons: j.comparisons ?? get().comparisons,
      toast: j.error && !j.ok ? j.error : get().toast,
    })
  },

  sendPostChat: async (text) => {
    const tempId = `local-post-${Date.now()}`
    const local: ChatMsg = { id: tempId, role: 'user', text, at: Date.now() }
    set({ postThread: mergeThread(get().postThread, [local]) })
    const j = await apiPostChat(text)
    const withoutTemp = get().postThread.filter((m) => m.id !== tempId)
    set({
      postThread: mergeThread(withoutTemp, j.postThread),
      toast: j.error && !j.ok ? j.error : get().toast,
    })
  },

  removeComparison: async (id) => {
    const list = await deleteComparison(id)
    set({ comparisons: list })
  },

  refreshSheets: async () => {
    const url = await apiUrl('/api/sheets')
    const r = await serverFetch(url, { cache: 'no-store' })
    const j = (await r.json()) as { sheets?: SheetFile[]; google?: GoogleState; error?: string }
    set({
      sheets: j.sheets || [],
      google: j.google || get().google,
      toast: j.error || null,
    })
  },

  loadSheet: async (id) => {
    const url = await apiUrl(`/api/sheets/${encodeURIComponent(id)}`)
    const r = await serverFetch(url, { cache: 'no-store' })
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
    await serverFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tab: tabTitle, row, col, value }),
    })
    await get().loadSheet(sheet.id)
  },

  startGoogle: async () => {
    if (get().google.ok) {
      set({ toast: null })
      await get().refreshSheets()
      return
    }
    set({ toast: 'Elegí tu cuenta de Google…' })
    try {
      const url = await apiUrl('/api/google/start')
      const r = await serverFetch(url, { cache: 'no-store' })
      const raw = await r.text()
      let j: {
        url?: string
        native?: boolean
        webClientId?: string
        scopes?: string[]
        error?: string
      }
      try {
        j = JSON.parse(raw) as {
          url?: string
          native?: boolean
          webClientId?: string
          scopes?: string[]
          error?: string
        }
      } catch {
        set({ toast: 'No llegué al servidor. Tocá Vincular de nuevo.' })
        return
      }
      let auth: { code: string; redirectUri?: string } | null = null
      if (j.native && j.webClientId) {
        try {
          auth = await openNativeGoogleOnPhone({ webClientId: j.webClientId, scopes: j.scopes })
        } catch (err) {
          const msg = String((err as Error).message || err)
          if (/Error 10|DEVELOPER_ERROR|\b10\b/.test(msg) && j.url) {
            set({ toast: 'Selector nativo no configurado, abriendo cuenta de Google…' })
            auth = await openGoogleOnPhone(j.url)
          } else {
            throw err
          }
        }
      } else if (j.url) {
        set({ toast: 'Abriendo Google en el celu…' })
        auth = await openGoogleOnPhone(j.url)
      }
      if (auth) {
        const finish = await apiUrl('/api/google/finish')
        const fr = await serverFetch(finish, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code: auth.code,
            redirectUri: auth.redirectUri ?? '',
            native: Boolean(j.native),
          }),
        })
        const finishRaw = await fr.text()
        let fj: { ok?: boolean; error?: string; google?: GoogleState; sheets?: SheetFile[] }
        try {
          fj = JSON.parse(finishRaw) as {
            ok?: boolean
            error?: string
            google?: GoogleState
            sheets?: SheetFile[]
          }
        } catch {
          set({ toast: 'Google contestó mal. Tocá Vincular de nuevo.' })
          return
        }
        if (!fr.ok || fj.error) {
          set({ toast: fj.error || 'Google no autorizó Drive' })
          return
        }
        set({
          google: fj.google || { ok: true },
          sheets: fj.sheets || get().sheets,
          toast: null,
        })
        await get().refreshSheets()
        return
      }
      set({ toast: j.error || 'No se pudo vincular Drive' })
    } catch (err) {
      set({ toast: String((err as Error).message || err) })
    }
  },
}))
