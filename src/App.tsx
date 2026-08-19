import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { applyAppUpdate } from './nativeBoot'
import { useApp } from './state/store'
import { APP_NAME, APP_VERSION } from './version'
import type { WatcherStatus } from './types'

const LAMP: Record<WatcherStatus, { cls: string; text: string }> = {
  online: { cls: 'on', text: 'escuchando' },
  working: { cls: 'working', text: 'laburando' },
  stuck: { cls: 'stuck', text: 'trabado' },
  off: { cls: 'off', text: 'apagado' },
}

function isNewer(remote: string, local: string): boolean {
  const parse = (v: string) => v.replace(/^v/i, '').split('.').map((x) => Number.parseInt(x, 10) || 0)
  const a = parse(remote)
  const b = parse(local)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0
    const y = b[i] || 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

export default function App() {
  const connect = useApp((s) => s.connect)
  const watcher = useApp((s) => s.watcher)
  const sheets = useApp((s) => s.sheets)
  const google = useApp((s) => s.google)
  const chatOpen = useApp((s) => s.chatOpen)
  const setChatOpen = useApp((s) => s.setChatOpen)
  const thread = useApp((s) => s.thread)
  const sendChat = useApp((s) => s.sendChat)
  const refreshSheets = useApp((s) => s.refreshSheets)
  const loadSheet = useApp((s) => s.loadSheet)
  const openSheet = useApp((s) => s.openSheet)
  const tab = useApp((s) => s.tab)
  const saveCell = useApp((s) => s.saveCell)
  const startGoogle = useApp((s) => s.startGoogle)
  const remoteVersion = useApp((s) => s.remoteVersion)
  const toast = useApp((s) => s.toast)
  const [text, setText] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [cell, setCell] = useState({ row: 1, col: 0, value: '' })
  const fileRef = useRef<HTMLInputElement>(null)
  const lamp = LAMP[watcher.status] || LAMP.off
  const folders = groupByPath(sheets)
  const needsUpdate = Boolean(remoteVersion && isNewer(remoteVersion, APP_VERSION))
  const currentTab = openSheet?.tabs[tab]

  useEffect(() => {
    connect()
    const id = window.setInterval(() => connect(), 20_000)
    return () => window.clearInterval(id)
  }, [connect])

  const autoUpdateOnce = useRef(false)
  useEffect(() => {
    if (!needsUpdate || autoUpdateOnce.current) return
    autoUpdateOnce.current = true
    void applyAppUpdate()
  }, [needsUpdate])

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    const next: string[] = []
    for (const file of files.slice(0, 4)) {
      if (!file.type.startsWith('image/')) continue
      next.push(await compressImage(file))
    }
    if (next.length) setPhotos((p) => [...p, ...next].slice(0, 4))
  }

  const onSend = async (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t && !photos.length) return
    await sendChat(t, photos.length ? photos : undefined)
    setText('')
    setPhotos([])
  }

  return (
    <div className="desk">
      <header className="masthead">
        <div className="edition">edición de campo · no es once</div>
        <img className="brand-icon" src={`/icons/icon-192.png?v=${APP_VERSION}`} width={56} height={56} alt="" />
        <button type="button" className="stamp" onClick={() => setChatOpen(true)}>
          {APP_NAME.toUpperCase()}
        </button>
        <div className="lamp-row">
          <span className={`lamp ${lamp.cls}`} />
          <span className="lamp-label">{lamp.text}</span>
          <span className="ver">v{APP_VERSION}</span>
        </div>
      </header>

      <p className="hint">Tocá el sello para hablarle al escuchador.</p>

      {!google.ok && (
        <div className="warn">
          Falta vincular Drive. Tocá el botón: se abre Google en el celu. Autorizá tu cuenta (si sale un aviso, tocá Avanzado y Permitir).
          <div className="bind">
            <button type="button" onClick={() => void startGoogle()}>
              Vincular Drive
            </button>
            <button type="button" onClick={() => void refreshSheets()}>
              Reintentar hojas
            </button>
          </div>
          {google.email ? <div>cuenta: {google.email}</div> : null}
          {google.error && !/PC|compu|Chrome|explorador/i.test(google.error) ? <div>{google.error}</div> : null}
        </div>
      )}

      {toast ? <div className="warn">{toast}</div> : null}

      <div className="dossier">
        {openSheet ? (
          <div className="grid-wrap">
            <button type="button" className="ghost" onClick={() => useApp.setState({ openSheet: null })}>
              ← carpeta
            </button>
            <h2>{openSheet.name}</h2>
            <div className="tabs">
              {openSheet.tabs.map((t, i) => (
                <button
                  key={t.title}
                  type="button"
                  className={i === tab ? 'on' : ''}
                  onClick={() => useApp.setState({ tab: i })}
                >
                  {t.title}
                </button>
              ))}
            </div>
            <div style={{ overflow: 'auto' }}>
              <table>
                <tbody>
                  {(currentTab?.values || []).slice(0, 80).map((row, ri) => (
                    <tr key={ri}>
                      {row.slice(0, 12).map((cellVal, ci) => (
                        <td
                          key={ci}
                          onClick={() => setCell({ row: ri, col: ci, value: cellVal })}
                        >
                          {cellVal}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="cell-edit">
              <input
                value={cell.value}
                onChange={(e) => setCell({ ...cell, value: e.target.value })}
                placeholder="editar celda tocada"
              />
              <button
                type="button"
                onClick={() => {
                  if (!currentTab) return
                  void saveCell(currentTab.title, cell.row, cell.col, cell.value)
                }}
              >
                Guardar
              </button>
            </div>
          </div>
        ) : (
          Object.entries(folders).map(([path, files]) => (
            <section className="folder" key={path}>
              <h2>{path}</h2>
              {files.map((f) => (
                <button key={f.id} type="button" className="sheet-card" onClick={() => void loadSheet(f.id)}>
                  <strong>{f.name}</strong>
                  <span>{f.modified ? new Date(f.modified).toLocaleString('es-AR') : 'hoja'}</span>
                </button>
              ))}
            </section>
          ))
        )}
        {google.ok && sheets.length === 0 ? (
          <p className="hint">No hay hojas todavía en esa carpeta (o están cargando).</p>
        ) : null}
      </div>

      {chatOpen ? (
        <div className="overlay" onClick={() => setChatOpen(false)}>
          <form className="pad" onClick={(e) => e.stopPropagation()} onSubmit={onSend}>
            <header>
              <span>Copia al escuchador</span>
              <button type="button" onClick={() => setChatOpen(false)}>
                cerrar
              </button>
            </header>
            <div className="thread">
              {thread.map((m) => (
                <div key={m.id} className={`bubble ${m.role}`}>
                  {m.text}
                  {m.photos?.length ? (
                    <div className="thumbs">
                      {m.photos.map((p, i) => (
                        <img key={i} src={p} alt="" />
                      ))}
                    </div>
                  ) : null}
                  <time>{new Date(m.at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</time>
                </div>
              ))}
            </div>
            {photos.length ? (
              <div className="thumbs">
                {photos.map((p, i) => (
                  <img key={i} src={p} alt="" />
                ))}
              </div>
            ) : null}
            <div className="composer">
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void onPick(e)} />
              <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
                foto
              </button>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="escribí acá…"
                rows={2}
              />
              <button type="submit" className="send">
                ENVIAR
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {needsUpdate ? (
        <div className="update-ribbon">
          <span>hay v{remoteVersion} — instalando sola…</span>
          <button type="button" onClick={() => void applyAppUpdate()}>
            Instalar
          </button>
        </div>
      ) : null}
    </div>
  )
}

function groupByPath(files: { id: string; name: string; path: string; modified?: string | null }[]) {
  const map: Record<string, typeof files> = {}
  for (const f of files) {
    const key = f.path || '/'
    if (!map[key]) map[key] = []
    map[key].push(f)
  }
  return map
}

async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const max = 1200
    let { width, height } = bitmap
    if (width > max || height > max) {
      const scale = max / Math.max(width, height)
      width = Math.round(width * scale)
      height = Math.round(height * scale)
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Sin canvas')
    ctx.drawImage(bitmap, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', 0.72)
  } finally {
    bitmap.close()
  }
}
