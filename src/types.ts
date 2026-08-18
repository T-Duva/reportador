export type WatcherStatus = 'online' | 'working' | 'stuck' | 'off'

export type WatcherState = {
  status: WatcherStatus
  lastSeenAt: number
  error?: string
  pendingCount: number
}

export type ChatRole = 'user' | 'bot'

export type ChatMsg = {
  id: string
  role: ChatRole
  text: string
  photos?: string[]
  at: number
  version?: string
}

export type SheetFile = {
  id: string
  name: string
  path: string
  modified: string | null
}

export type SheetGrid = {
  id: string
  name: string
  tabs: { title: string; values: string[][] }[]
}
