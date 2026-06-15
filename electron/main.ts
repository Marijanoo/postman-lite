import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import serve from 'electron-serve'
import WebSocket from 'ws'
import { io as ioClient } from 'socket.io-client'
import { autoUpdater } from 'electron-updater'
import {
  dbLogin, dbRegister, dbUserExists,
  dbGetWorkspace, dbGetWorkspaces, dbCreateWorkspace, dbUpdateWorkspace, dbDeleteWorkspace,
  dbGetCollections, dbGetCollection, dbCreateCollection, dbUpdateCollection, dbDeleteCollection,
  dbGetRequests, dbGetRequest, dbCreateRequest, dbUpdateRequest, dbDeleteRequest,
  dbGetSocketConfigs, dbCreateSocketConfig, dbUpdateSocketConfig, dbDeleteSocketConfig,
  dbGetSequences, dbCreateSequence, dbUpdateSequence, dbDeleteSequence,
  dbGetHistory, dbAddToHistory, dbClearHistory, dbDeleteHistoryEntry,
  dbGetEnvironments, dbGetEnvironment, dbCreateEnvironment, dbUpdateEnvironment, dbDeleteEnvironment, dbSetActiveEnvironment,
  dbGetWorkspaceState, dbSaveWorkspaceState,
  dbGetInvitesForEmail, dbGetInvitesForWorkspace, dbSendInvite, dbDeleteInvite,
} from './sqlite-db'

process.on('uncaughtException', (err: any) => {
  if (err?.code === 'EPIPE') return
  throw err
})

const isProd = app.isPackaged || process.env.NODE_ENV === 'production'

if (isProd) {
  serve({ directory: 'out' })
} else {
  app.setPath('userData', `${app.getPath('userData')} (development)`)
}

let mainWindow: BrowserWindow | null = null

function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState(): { width: number; height: number; x?: number; y?: number; isMaximized?: boolean } {
  try {
    const raw = fs.readFileSync(getWindowStatePath(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { width: 1200, height: 800 }
  }
}

function saveWindowState() {
  if (!mainWindow) return
  try {
    const isMaximized = mainWindow.isMaximized()
    let bounds: { width: number; height: number; x?: number; y?: number; isMaximized?: boolean } = { width: 1200, height: 800 }
    try {
      const raw = fs.readFileSync(getWindowStatePath(), 'utf-8')
      bounds = JSON.parse(raw)
    } catch {}

    if (!isMaximized) {
      const currentBounds = mainWindow.getBounds()
      bounds.x = currentBounds.x
      bounds.y = currentBounds.y
      bounds.width = currentBounds.width
      bounds.height = currentBounds.height
    }
    bounds.isMaximized = isMaximized
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(bounds))
  } catch {}
}

async function createWindow() {
  const windowState = loadWindowState()
  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 600,
    minHeight: 400,
    frame: false,
    show: false,
    icon: path.join(__dirname, '..', 'public', process.platform === 'win32' ? 'logo.ico' : 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (windowState.isMaximized) {
    mainWindow.maximize()
  }
  mainWindow.show()

  if (isProd) {
    await mainWindow.loadURL('app://-')
  } else {
    const port = process.argv[2] || 3000

    // Next.js HMR builds a relative WebSocket URL that Chrome parses as having
    // "_next" as the hostname. Intercept those requests and redirect them to
    // the actual dev server before they hit the network.
    mainWindow.webContents.session.webRequest.onBeforeRequest(
      { urls: ['ws://_next/*', 'wss://_next/*'] },
      (details, callback) => {
        callback({
          redirectURL: details.url.replace(
            /^wss?:\/\/_next\//,
            `ws://localhost:${port}/_next/`
          ),
        })
      }
    )

    await mainWindow.loadURL(`http://localhost:${port}`)
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F12') {
      if (!isProd) mainWindow!.webContents.toggleDevTools()
      event.preventDefault()
    } else if ((input.control || input.meta) && (input.key === 'r' || input.key === 'R')) {
      // Block Ctrl/Cmd+R page reload — renderer handles it as "run query"
      event.preventDefault()
      mainWindow!.webContents.send('run-query')
    } else if ((input.control || input.meta) && (input.key === 'w' || input.key === 'W')) {
      event.preventDefault()
      mainWindow!.webContents.send('close-active-tab')
    } else if ((input.control || input.meta) && (input.key === 't' || input.key === 'T')) {
      event.preventDefault()
      mainWindow!.webContents.send('new-query-tab')
    } else if ((input.control || input.meta) && (input.key === '=' || input.key === '+')) {
      const currentZoom = mainWindow!.webContents.getZoomLevel()
      mainWindow!.webContents.setZoomLevel(currentZoom + 0.5)
      event.preventDefault()
    } else if ((input.control || input.meta) && input.key === '-') {
      const currentZoom = mainWindow!.webContents.getZoomLevel()
      mainWindow!.webContents.setZoomLevel(currentZoom - 0.5)
      event.preventDefault()
    } else if ((input.control || input.meta) && input.key === '0') {
      mainWindow!.webContents.setZoomLevel(0)
      event.preventDefault()
    }
  })

  // Block all renderer-initiated reloads (Ctrl+R, Ctrl+Shift+R, F5)
  mainWindow.webContents.on('will-reload' as any, (event: Electron.Event) => {
    event.preventDefault()
  })

  mainWindow.on('resize', saveWindowState)
  mainWindow.on('move', saveWindowState)
  mainWindow.on('closed', () => {
    saveWindowState()
    mainWindow = null
  })
}

app.on('ready', () => {
  createWindow()

  ipcMain.on('window-minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on('window-maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })
  ipcMain.on('window-close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.on('window-zoom-in', () => {
    if (!mainWindow) return
    mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() + 0.5)
  })
  ipcMain.on('window-zoom-out', () => {
    if (!mainWindow) return
    mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() - 0.5)
  })

  // ── WebSocket proxy ─────────────────────────────────────────────────────────
  type SocketHandle = { send: (data: string) => void; close: () => void }
  const sockets = new Map<string, SocketHandle>()

  ipcMain.on('ws-connect', (event, { socketId, url, headers, protocol }: { socketId: string; url: string; headers?: Record<string, string>; protocol?: string }) => {
    if (sockets.has(socketId)) return
    // Capture sender once — event.sender can go stale after the handler returns
    const sender = event.sender

    if (protocol === 'socketio') {
      // Socket.IO: use socket.io-client so the EIO handshake and polling→ws upgrade work correctly
      const socket = ioClient(url, {
        transports: ['polling', 'websocket'],
        extraHeaders: headers ?? {},
        reconnection: false,
        ackTimeout: 30000,
      })
      sockets.set(socketId, {
        send: (data: string) => {
          try {
            const parsed = JSON.parse(data)
            if (parsed?.__ack === true) {
              socket.emit(parsed.event, parsed.data, (...ackArgs: any[]) => {
                const ackData = ackArgs.length === 1 ? ackArgs[0] : ackArgs
                const payload = typeof ackData === 'string' ? ackData : JSON.stringify(ackData)
                sender.send('ws-message', { socketId, data: JSON.stringify(['__ack__', payload]), isBinary: false })
              })
              return
            }
            if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
              const [eventName, ...args] = parsed
              socket.emit(eventName, ...args)
              return
            }
          } catch { /* */ }
          socket.emit('message', data)
        },
        close: () => socket.disconnect(),
      })

      socket.on('connect', () => sender.send('ws-open', { socketId }))

      socket.onAny((eventName: string, ...args: any[]) => {
        const data = JSON.stringify([eventName, ...args])
        sender.send('ws-message', { socketId, data, isBinary: false })
      })

      socket.on('disconnect', (reason: string) => {
        sockets.delete(socketId)
        sender.send('ws-close', { socketId, code: 1000, reason })
      })

      socket.on('connect_error', (err: Error) => {
        sockets.delete(socketId)
        sender.send('ws-error', { socketId, message: err.message })
        socket.disconnect()
      })
    } else {
      // Raw WebSocket
      let origin = ''
      let host = ''
      try {
        const u = new URL(url.replace(/^wss?:\/\//, 'https://'))
        origin = u.origin
        host = u.host
      } catch { /* */ }
      const mergedHeaders = { Host: host, Origin: origin, ...headers }
      const ws = new WebSocket(url, { headers: mergedHeaders, perMessageDeflate: false })
      sockets.set(socketId, { send: (data) => ws.send(data), close: () => ws.close() })

      ws.on('open', () => sender.send('ws-open', { socketId }))
      ws.on('message', (data) => {
        const text = Buffer.isBuffer(data) ? data.toString('base64') : data.toString()
        const isBinary = Buffer.isBuffer(data)
        sender.send('ws-message', { socketId, data: text, isBinary })
      })
      ws.on('close', (code, reason) => {
        sockets.delete(socketId)
        sender.send('ws-close', { socketId, code, reason: reason.toString() })
      })
      ws.on('unexpected-response', (_req, res) => {
        let body = ''
        res.on('data', (chunk: Buffer) => { body += chunk.toString() })
        res.on('end', () => {
          const msg = `Unexpected server response: ${res.statusCode} ${res.statusMessage}\nHeaders: ${JSON.stringify(res.headers, null, 2)}\nBody: ${body}`
          console.error('[ws-connect unexpected-response]', msg)
          sender.send('ws-error', { socketId, message: msg })
        })
      })
      ws.on('error', (err) => {
        console.error('[ws-connect error]', err)
        sender.send('ws-error', { socketId, message: err.message })
      })
    }
  })

  ipcMain.on('ws-send', (_event, { socketId, data }: { socketId: string; data: string }) => {
    sockets.get(socketId)?.send(data)
  })

  ipcMain.on('ws-disconnect', (_event, { socketId }: { socketId: string }) => {
    sockets.get(socketId)?.close()
    sockets.delete(socketId)
  })

  // ── Database IPC ────────────────────────────────────────────────────────────
  const handle = (ch: string, fn: (...args: any[]) => Promise<any>) =>
    ipcMain.handle(ch, async (_e, ...args) => {
      try { return { ok: true, data: await fn(...args) } }
      catch (err: any) { return { ok: false, error: err.message ?? String(err) } }
    })

  handle('db:auth:login',       (email, password) => dbLogin(email, password))
  handle('db:auth:register',    (email, name, password) => dbRegister(email, name, password))
  handle('db:auth:userExists',  (id) => dbUserExists(id))

  handle('db:workspaces:get',    (userId) => dbGetWorkspaces(userId))
  handle('db:workspaces:getOne', (id) => dbGetWorkspace(id))
  handle('db:workspaces:create', (ws) => dbCreateWorkspace(ws))
  handle('db:workspaces:update', (id, data) => dbUpdateWorkspace(id, data))
  handle('db:workspaces:delete', (id) => dbDeleteWorkspace(id))

  handle('db:collections:get',    (workspaceId) => dbGetCollections(workspaceId))
  handle('db:collections:getOne', (id) => dbGetCollection(id))
  handle('db:collections:create', (c) => dbCreateCollection(c))
  handle('db:collections:update', (id, data) => dbUpdateCollection(id, data))
  handle('db:collections:delete', (id) => dbDeleteCollection(id))

  handle('db:requests:get',    (collectionId) => dbGetRequests(collectionId))
  handle('db:requests:getOne', (id) => dbGetRequest(id))
  handle('db:requests:create', (r) => dbCreateRequest(r))
  handle('db:requests:update', (id, data) => dbUpdateRequest(id, data))
  handle('db:requests:delete', (id) => dbDeleteRequest(id))

  handle('db:socketConfigs:get',    (collectionId) => dbGetSocketConfigs(collectionId))
  handle('db:socketConfigs:create', (c) => dbCreateSocketConfig(c))
  handle('db:socketConfigs:update', (id, data) => dbUpdateSocketConfig(id, data))
  handle('db:socketConfigs:delete', (id) => dbDeleteSocketConfig(id))

  handle('db:sequences:get',    (collectionId) => dbGetSequences(collectionId))
  handle('db:sequences:create', (s) => dbCreateSequence(s))
  handle('db:sequences:update', (id, data) => dbUpdateSequence(id, data))
  handle('db:sequences:delete', (id) => dbDeleteSequence(id))

  handle('db:history:get',         (workspaceId, limit) => dbGetHistory(workspaceId, limit))
  handle('db:history:add',         (entry) => dbAddToHistory(entry))
  handle('db:history:clear',       (workspaceId) => dbClearHistory(workspaceId))
  handle('db:history:delete',      (id) => dbDeleteHistoryEntry(id))

  handle('db:environments:get',       (workspaceId) => dbGetEnvironments(workspaceId))
  handle('db:environments:getOne',    (id) => dbGetEnvironment(id))
  handle('db:environments:create',    (env) => dbCreateEnvironment(env))
  handle('db:environments:update',    (id, data) => dbUpdateEnvironment(id, data))
  handle('db:environments:delete',    (id) => dbDeleteEnvironment(id))
  handle('db:environments:setActive', (id, workspaceId) => dbSetActiveEnvironment(id, workspaceId))

  handle('db:workspaceState:get',  (workspaceId) => dbGetWorkspaceState(workspaceId))
  handle('db:workspaceState:save', (workspaceId, state) => dbSaveWorkspaceState(workspaceId, state))

  handle('db:invites:forEmail',     (email) => dbGetInvitesForEmail(email))
  handle('db:invites:forWorkspace', (workspaceId) => dbGetInvitesForWorkspace(workspaceId))
  handle('db:invites:send',         (invite) => dbSendInvite(invite))
  handle('db:invites:delete',       (id) => dbDeleteInvite(id))

  const activeRequests = new Map<string, AbortController>()

  ipcMain.on('cancel-request', (_event, { requestId }: { requestId: string }) => {
    activeRequests.get(requestId)?.abort()
    activeRequests.delete(requestId)
  })

  ipcMain.handle('make-request', async (_event, options) => {
    try {
      const { url, method, headers, requestBody, formDataEntries, requestId } = options
      const controller = new AbortController()
      if (requestId) activeRequests.set(requestId, controller)

      if (!url) {
        return { error: 'URL is required' }
      }

      if (url.includes('{{') && url.includes('}}')) {
        return { error: `Unresolved environment variable in URL: ${url}. Please check if the environment is active and variables are enabled.` }
      }

      // Build headers object, filtering out certain headers
      const fetchHeaders: Record<string, string> = {}
      const skipHeaders = ['host', 'connection', 'content-length', 'transfer-encoding']

      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          if (!skipHeaders.includes(key.toLowerCase()) && typeof value === 'string') {
            fetchHeaders[key] = value
          }
        }
      }

      const startTime = Date.now()

      const fetchOptions: RequestInit = {
        method: method || 'GET',
        headers: fetchHeaders,
        signal: controller.signal,
      }

      // Add body for methods that support it
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        if (formDataEntries && formDataEntries.length > 0) {
          // Node's native fetch doesn't reliably serialize FormData in Electron,
          // so we manually build the multipart body.
          const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`
          const parts: Buffer[] = []
          for (const entry of formDataEntries) {
            if (entry.fileData) {
              const bytes = Buffer.from(entry.fileData.base64, 'base64')
              parts.push(Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="${entry.key}"; filename="${entry.fileData.name}"\r\nContent-Type: ${entry.fileData.mimeType}\r\n\r\n`
              ))
              parts.push(bytes)
              parts.push(Buffer.from('\r\n'))
            } else {
              parts.push(Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="${entry.key}"\r\n\r\n${entry.value}\r\n`
              ))
            }
          }
          parts.push(Buffer.from(`--${boundary}--\r\n`))
          const body = Buffer.concat(parts)
          fetchOptions.body = body as unknown as BodyInit
          fetchHeaders['Content-Type'] = `multipart/form-data; boundary=${boundary}`
          fetchHeaders['Content-Length'] = String(body.length)
        } else if (requestBody) {
          fetchOptions.body = requestBody
        }
      }

      // Ensure URL has a protocol. The renderer normalizes this too; this is a
      // safety net. A scheme-less host (with or without a dot) gets http://,
      // matching curl's behavior.
      const finalUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`

      const response = await fetch(finalUrl, fetchOptions)

      const endTime = Date.now()
      const responseTime = endTime - startTime

      // Get response body
      const contentType = response.headers.get('content-type') || 'text/plain'
      const isBinary = contentType.includes('image/') ||
        contentType.includes('application/pdf') ||
        contentType.includes('audio/') ||
        contentType.includes('video/') ||
        contentType.includes('application/octet-stream')

      let responseBody: string
      let size: number

      if (isBinary) {
        const buffer = await response.arrayBuffer()
        responseBody = Buffer.from(buffer).toString('base64')
        size = buffer.byteLength
      } else {
        responseBody = await response.text()

        // Prettify JSON if needed
        if (contentType.includes('application/json')) {
          try {
            const json = JSON.parse(responseBody)
            responseBody = JSON.stringify(json, null, 2)
          } catch (e) {
            // Keep original text if JSON parse fails
          }
        }

        size = new TextEncoder().encode(responseBody).length
      }

      // Convert headers to plain object
      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })

      if (requestId) activeRequests.delete(requestId)
      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseBody,
        size: size,
        time: responseTime,
        contentType: contentType,
        isBinary: isBinary,
        url: finalUrl,
      }
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError'
      if (options.requestId) activeRequests.delete(options.requestId)
      if (isAbort) return { aborted: true }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

      return {
        status: 0,
        statusText: 'Network Error',
        headers: {},
        body: JSON.stringify({ error: errorMessage }, null, 2),
        size: 0,
        time: 0,
        contentType: 'application/json',
        isBinary: false,
      }
    }
  })

})

  // ── Project folder scanning ─────────────────────────────────────────────────
  ipcMain.handle('dialog:openDirectory', async () => {
    if (!mainWindow) return { ok: true, data: null }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Project Folder',
    })
    return { ok: true, data: result.canceled ? null : result.filePaths[0] }
  })

  ipcMain.handle('fs:scanSwagger', async (_e, { dirPath }: { dirPath: string }) => {
    const SWAGGER_FILENAMES = ['swagger.json', 'swagger.yaml', 'swagger.yml', 'openapi.json', 'openapi.yaml', 'openapi.yml']
    const MAX_DEPTH = 6
    const MAX_FILES = 50
    const found: { path: string; content: string }[] = []

    function walk(dir: string, depth: number) {
      if (depth > MAX_DEPTH || found.length >= MAX_FILES) return
      let entries: fs.Dirent[]
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (found.length >= MAX_FILES) break
        // Skip hidden dirs and common non-project dirs
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'vendor' || entry.name === 'dist' || entry.name === 'build' || entry.name === '.git') continue
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1)
        } else if (entry.isFile()) {
          const lower = entry.name.toLowerCase()
          // Match known filenames or files containing "swagger"/"openapi" in their name
          if (SWAGGER_FILENAMES.includes(lower) || (lower.endsWith('.json') || lower.endsWith('.yaml') || lower.endsWith('.yml')) && (lower.includes('swagger') || lower.includes('openapi'))) {
            try {
              const content = fs.readFileSync(fullPath, 'utf-8')
              // Quick sanity check: must mention "swagger" or "openapi" in content
              if (content.includes('"swagger"') || content.includes('"openapi"') || content.includes('swagger:') || content.includes('openapi:')) {
                found.push({ path: fullPath, content })
              }
            } catch {}
          }
        }
      }
    }

    try { walk(dirPath, 0) } catch {}
    return { ok: true, data: found }
  })

app.on('window-all-closed', () => {
  // On non-mac, only quit if there are no popout terminal windows still open
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Auto-updater — only runs in production builds
if (isProd) {
  const logFile = fs.createWriteStream(path.join(app.getPath('userData'), 'updater.log'), { flags: 'a' })
  const log = {
    info:  (...a: unknown[]) => { const msg = `[${new Date().toISOString()}] INFO  ${a.join(' ')}\n`; logFile.write(msg); console.log(msg.trimEnd()) },
    warn:  (...a: unknown[]) => { const msg = `[${new Date().toISOString()}] WARN  ${a.join(' ')}\n`; logFile.write(msg); console.warn(msg.trimEnd()) },
    error: (...a: unknown[]) => { const msg = `[${new Date().toISOString()}] ERROR ${a.join(' ')}\n`; logFile.write(msg); console.error(msg.trimEnd()) },
  }
  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  // macOS: use zip for updates (works without code signing / notarisation)
  if (process.platform === 'darwin') {
    autoUpdater.channel = 'latest'
  }

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'Marijanoo',
    repo: 'quence',
  })

  autoUpdater.on('checking-for-update', () => {
    log.info('[updater] Checking for update…')
  })

  autoUpdater.on('update-available', (info) => {
    log.info('[updater] Update available:', info.version)
    mainWindow?.webContents.send('update-available')
  })

  autoUpdater.on('update-not-available', (info) => {
    log.info('[updater] Already up to date:', info.version)
  })

  autoUpdater.on('download-progress', (info) => {
    log.info(`[updater] Downloading… ${info.percent.toFixed(1)}% (${(info.transferred / 1024 / 1024).toFixed(1)} / ${(info.total / 1024 / 1024).toFixed(1)} MB)`)
    mainWindow?.webContents.send('update-progress', info.percent)
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info('[updater] Update downloaded, ready to install:', info.version)
    mainWindow?.webContents.send('update-downloaded')
  })

  autoUpdater.on('error', (err) => {
    log.error('[updater] Error:', err?.message ?? err)
  })

  // Swallow unhandled rejections from electron-updater (e.g. 404 before release is published)
  process.on('unhandledRejection', () => {})

  ipcMain.on('install-update', () => {
    log.info('[updater] install-update requested, calling quitAndInstall')
    // isSilent=true, isForceRunAfter=false — let the user reopen manually.
    // forceRunAfter=true is unreliable on macOS without notarisation (open -a gets blocked).
    autoUpdater.quitAndInstall(true, false)
  })

  // Check once the first window finishes loading, then every 4 hours
  app.on('browser-window-created', (_, win) => {
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 3000)
      setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000)
    })
  })
}

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})
