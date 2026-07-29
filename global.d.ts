export {}

declare global {
  interface Window {
    electronAPI?: {
      makeRequest: (options: any) => Promise<any>
      cancelRequest: (requestId: string) => void
      onRunQuery?: (cb: () => void) => void
      offRunQuery?: (cb?: () => void) => void
      onCloseActiveTab?: (cb: () => void) => void
      offCloseActiveTab?: (cb?: () => void) => void
      onNewQueryTab?: (cb: () => void) => void
      offNewQueryTab?: (cb?: () => void) => void
      onUpdateAvailable?: (cb: () => void) => void
      onUpdateProgress?: (cb: (percent: number) => void) => void
      onUpdateDownloaded: (cb: () => void) => void
      installUpdate?: () => void
      minimize: () => void
      maximize: () => void
      close: () => void
      wsConnect: (socketId: string, url: string, headers?: Record<string, string>, protocol?: string) => void
      wsSend: (socketId: string, data: string) => void
      wsDisconnect: (socketId: string) => void
      wsOnOpen: (cb: (socketId: string) => void) => void
      wsOnMessage: (cb: (socketId: string, data: string, isBinary: boolean) => void) => void
      wsOnClose: (cb: (socketId: string, code: number, reason: string) => void) => void
      wsOnError: (cb: (socketId: string, message: string) => void) => void
      wsRemoveListeners: () => void
      openDirectory?: () => Promise<string | null>
      scanSwagger?: (dirPath: string) => Promise<{ path: string; content: string }[]>
      openExternal?: (url: string) => void
      db: {
        auth: {
          login: (email: string, password: string) => Promise<{ id: string; email: string; name: string }>
          register: (email: string, name: string, password: string) => Promise<{ id: string; email: string; name: string }>
          userExists: (id: string) => Promise<boolean>
        }
        workspaces: {
          get: (userId: string) => Promise<any[]>
          getOne: (id: string) => Promise<any>
          create: (ws: any) => Promise<void>
          update: (id: string, data: any) => Promise<void>
          delete: (id: string) => Promise<void>
        }
        collections: {
          get: (workspaceId?: string) => Promise<any[]>
          getOne: (id: string) => Promise<any>
          create: (c: any) => Promise<void>
          update: (id: string, data: any) => Promise<void>
          delete: (id: string) => Promise<void>
        }
        requests: {
          get: (collectionId?: string) => Promise<any[]>
          getOne: (id: string) => Promise<any>
          create: (r: any) => Promise<void>
          update: (id: string, data: any) => Promise<void>
          delete: (id: string) => Promise<void>
        }
        socketConfigs: {
          get: (collectionId?: string) => Promise<any[]>
          create: (c: any) => Promise<void>
          update: (id: string, data: any) => Promise<void>
          delete: (id: string) => Promise<void>
        }
        sequences: {
          get: (collectionId?: string) => Promise<any[]>
          create: (s: any) => Promise<void>
          update: (id: string, data: any) => Promise<void>
          delete: (id: string) => Promise<void>
        }
        history: {
          get: (workspaceId?: string, limit?: number) => Promise<any[]>
          add: (entry: any) => Promise<void>
          clear: (workspaceId?: string) => Promise<void>
          delete: (id: string) => Promise<void>
        }
        environments: {
          get: (workspaceId?: string) => Promise<any[]>
          getOne: (id: string) => Promise<any>
          create: (env: any) => Promise<void>
          update: (id: string, data: any) => Promise<void>
          delete: (id: string) => Promise<void>
          setActive: (id: string | null, workspaceId?: string) => Promise<void>
        }
        workspaceState: {
          get: (workspaceId: string) => Promise<any>
          save: (workspaceId: string, state: any) => Promise<void>
        }
        invites: {
          forEmail: (email: string) => Promise<any[]>
          forWorkspace: (workspaceId: string) => Promise<any[]>
          send: (invite: any) => Promise<void>
          delete: (id: string) => Promise<void>
        }
      }
    }
  }
}
