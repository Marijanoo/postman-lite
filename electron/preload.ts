import { contextBridge, ipcRenderer } from 'electron'

async function invoke(channel: string, ...args: any[]) {
  const result = await ipcRenderer.invoke(channel, ...args)
  if (result && !result.ok) throw new Error(result.error)
  return result?.data
}

contextBridge.exposeInMainWorld('electronAPI', {
  makeRequest: (options: any) => ipcRenderer.invoke('make-request', options),
  cancelRequest: (requestId: string) => ipcRenderer.send('cancel-request', { requestId }),
  onRunQuery: (cb: () => void) => {
    ipcRenderer.removeAllListeners('run-query')
    ipcRenderer.on('run-query', cb)
  },
  offRunQuery: () => ipcRenderer.removeAllListeners('run-query'),
  onCloseActiveTab: (cb: () => void) => {
    ipcRenderer.removeAllListeners('close-active-tab')
    ipcRenderer.on('close-active-tab', cb)
  },
  offCloseActiveTab: () => ipcRenderer.removeAllListeners('close-active-tab'),
  onNewQueryTab: (cb: () => void) => {
    ipcRenderer.removeAllListeners('new-query-tab')
    ipcRenderer.on('new-query-tab', cb)
  },
  offNewQueryTab: () => ipcRenderer.removeAllListeners('new-query-tab'),
  onUpdateAvailable: (cb: () => void) => ipcRenderer.on('update-available', cb),
  onUpdateProgress: (cb: (percent: number) => void) => ipcRenderer.on('update-progress', (_e, percent) => cb(percent)),
  onUpdateDownloaded: (cb: () => void) => ipcRenderer.on('update-downloaded', cb),
  installUpdate: () => ipcRenderer.send('install-update'),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  zoomIn: () => ipcRenderer.send('window-zoom-in'),
  zoomOut: () => ipcRenderer.send('window-zoom-out'),
  wsConnect: (socketId: string, url: string, headers?: Record<string, string>, protocol?: string) =>
    ipcRenderer.send('ws-connect', { socketId, url, headers, protocol }),
  wsSend: (socketId: string, data: string) =>
    ipcRenderer.send('ws-send', { socketId, data }),
  wsDisconnect: (socketId: string) =>
    ipcRenderer.send('ws-disconnect', { socketId }),
  wsOnOpen: (cb: (socketId: string) => void) =>
    ipcRenderer.on('ws-open', (_e, { socketId }) => cb(socketId)),
  wsOnMessage: (cb: (socketId: string, data: string, isBinary: boolean) => void) =>
    ipcRenderer.on('ws-message', (_e, { socketId, data, isBinary }) => cb(socketId, data, isBinary)),
  wsOnClose: (cb: (socketId: string, code: number, reason: string) => void) =>
    ipcRenderer.on('ws-close', (_e, { socketId, code, reason }) => cb(socketId, code, reason)),
  wsOnError: (cb: (socketId: string, message: string) => void) =>
    ipcRenderer.on('ws-error', (_e, { socketId, message }) => cb(socketId, message)),
  wsRemoveListeners: () => {
    ipcRenderer.removeAllListeners('ws-open')
    ipcRenderer.removeAllListeners('ws-message')
    ipcRenderer.removeAllListeners('ws-close')
    ipcRenderer.removeAllListeners('ws-error')
  },

  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  scanSwagger: (dirPath: string) => ipcRenderer.invoke('fs:scanSwagger', { dirPath }),
  openExternal: (url: string) => ipcRenderer.send('open-external', url),

  db: {
    auth: {
      login:      (email: string, password: string) => invoke('db:auth:login', email, password),
      register:   (email: string, name: string, password: string) => invoke('db:auth:register', email, name, password),
      userExists: (id: string) => invoke('db:auth:userExists', id),
    },
    workspaces: {
      get:    (userId: string) => invoke('db:workspaces:get', userId),
      getOne: (id: string) => invoke('db:workspaces:getOne', id),
      create: (ws: any) => invoke('db:workspaces:create', ws),
      update: (id: string, data: any) => invoke('db:workspaces:update', id, data),
      delete: (id: string) => invoke('db:workspaces:delete', id),
    },
    collections: {
      get:    (workspaceId?: string) => invoke('db:collections:get', workspaceId),
      getOne: (id: string) => invoke('db:collections:getOne', id),
      create: (c: any) => invoke('db:collections:create', c),
      update: (id: string, data: any) => invoke('db:collections:update', id, data),
      delete: (id: string) => invoke('db:collections:delete', id),
    },
    requests: {
      get:    (collectionId?: string) => invoke('db:requests:get', collectionId),
      getOne: (id: string) => invoke('db:requests:getOne', id),
      create: (r: any) => invoke('db:requests:create', r),
      update: (id: string, data: any) => invoke('db:requests:update', id, data),
      delete: (id: string) => invoke('db:requests:delete', id),
    },
    socketConfigs: {
      get:    (collectionId?: string) => invoke('db:socketConfigs:get', collectionId),
      create: (c: any) => invoke('db:socketConfigs:create', c),
      update: (id: string, data: any) => invoke('db:socketConfigs:update', id, data),
      delete: (id: string) => invoke('db:socketConfigs:delete', id),
    },
    sequences: {
      get:    (workspaceId?: string) => invoke('db:sequences:get', workspaceId),
      create: (s: any) => invoke('db:sequences:create', s),
      update: (id: string, data: any) => invoke('db:sequences:update', id, data),
      delete: (id: string) => invoke('db:sequences:delete', id),
    },
    history: {
      get:    (workspaceId?: string, limit?: number) => invoke('db:history:get', workspaceId, limit),
      add:    (entry: any) => invoke('db:history:add', entry),
      clear:  (workspaceId?: string) => invoke('db:history:clear', workspaceId),
      delete: (id: string) => invoke('db:history:delete', id),
    },
    environments: {
      get:       (workspaceId?: string) => invoke('db:environments:get', workspaceId),
      getOne:    (id: string) => invoke('db:environments:getOne', id),
      create:    (env: any) => invoke('db:environments:create', env),
      update:    (id: string, data: any) => invoke('db:environments:update', id, data),
      delete:    (id: string) => invoke('db:environments:delete', id),
      setActive: (id: string | null, workspaceId?: string) => invoke('db:environments:setActive', id, workspaceId),
    },
    workspaceState: {
      get:  (workspaceId: string) => invoke('db:workspaceState:get', workspaceId),
      save: (workspaceId: string, state: any) => invoke('db:workspaceState:save', workspaceId, state),
    },
    invites: {
      forEmail:     (email: string) => invoke('db:invites:forEmail', email),
      forWorkspace: (workspaceId: string) => invoke('db:invites:forWorkspace', workspaceId),
      send:         (invite: any) => invoke('db:invites:send', invite),
      delete:       (id: string) => invoke('db:invites:delete', id),
    },
  },
})
