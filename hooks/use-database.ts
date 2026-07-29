'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type {
  Workspace,
  Collection,
  RequestConfig,
  SocketConfig,
  SocketTab,
  HistoryEntry,
  Environment,
  WorkspaceState,
  WorkspaceTab,
  ResponseData,
  Sequence,
} from '@/lib/db/types'
import {
  createNewRequest,
  createNewCollection,
  createNewEnvironment,
  createNewWorkspace,
} from '@/lib/db/types'
import { generateId } from '@/lib/utils'
import { useAuth } from '@/lib/auth/auth-context'
import {
  isDefaultEnv,
  makeDefaultEnvironment,
  setDefaultEnvVariables,
} from '@/lib/default-environment'

const ACTIVE_WORKSPACE_KEY = 'quence-active-workspace'

// Compare two requests ignoring volatile fields that change on every edit
function requestsEqual(a: RequestConfig, b: RequestConfig): boolean {
  const strip = (r: RequestConfig) => {
    const { id: _id, updatedAt: _u, createdAt: _c, ...rest } = r
    return rest
  }
  // Use a replacer that sorts keys so key-insertion-order differences don't matter
  const stable = (v: unknown) => JSON.stringify(v, (_, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val
  )
  return stable(strip(a)) === stable(strip(b))
}

// Stable id used for local-only (signed-out) usage. Local workspaces are owned
// by 'local' and never sync to the cloud, so anonymous users get the full app
// without an account; signing in is only required for cloud workspaces/invites.
const LOCAL_USER_ID = 'local'

// Generic database hook (shared singleton)
function useDatabase() {
  const { state } = useAuth()
  // Fall back to the local id while signed out so the local DB still initializes.
  const userId = state.status === 'authenticated' ? state.session.user.id : LOCAL_USER_ID

  const [db, setDb] = useState<import('@/lib/db').DatabaseAdapter | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Don't initialize until auth has resolved — avoids briefly opening the
    // local DB and then re-opening it once a session is restored.
    if (state.status === 'loading') return
    async function initDb() {
      const { getDatabase } = await import('@/lib/db')
      const database = await getDatabase(userId)
      setDb(database)
      setIsLoading(false)
    }
    initDb()
  }, [userId, state.status])

  return { db, isLoading }
}

// Workspace manager — workspace list + active selection
export function useWorkspaceManager() {
  const { db, isLoading: dbLoading } = useDatabase()
  const { state: authState } = useAuth()
  const currentUser = authState.status === 'authenticated' ? authState.session.user : undefined
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(ACTIVE_WORKSPACE_KEY)
    }
    return null
  })
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!db) return []
    const data = await db.getWorkspaces()
    const sorted = data.sort((a, b) => a.createdAt - b.createdAt)
    setWorkspaces(sorted)
    return sorted
  }, [db])

  useEffect(() => {
    if (!db || dbLoading) return
    ;(async () => {
      const data = await refresh()

      if (data.length === 0) {
        // First run: create default workspace. Signed-out users get a local
        // workspace (owner defaults to 'local'); signed-in users own it.
        const ws = createNewWorkspace('My Workspace', currentUser)
        await db.createWorkspace(ws)

        // Create initial collection and request
        const collection = createNewCollection('Initial collection', ws.id)
        await db.createCollection(collection)

        const request = createNewRequest()
        request.name = 'New Request'
        request.collectionId = collection.id
        await db.createRequest(request)

        const newTab: WorkspaceTab = {
          id: generateId(),
          requestId: request.id,
          request: request,
          savedRequest: request,
          response: null,
          isDirty: false,
        }
        await db.saveWorkspaceState(ws.id, { tabs: [newTab], activeTabId: newTab.id })

        setActiveWorkspaceId(ws.id)
        localStorage.setItem(ACTIVE_WORKSPACE_KEY, ws.id)
        await refresh()
      } else {
        const stored = localStorage.getItem(ACTIVE_WORKSPACE_KEY)
        if (!stored || !data.find(w => w.id === stored)) {
          setActiveWorkspaceId(data[0].id)
          localStorage.setItem(ACTIVE_WORKSPACE_KEY, data[0].id)
        }
      }
      setIsLoading(false)
    })()
  }, [db, dbLoading, currentUser, refresh])

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) ?? null

  const create = useCallback(async (name: string, owner?: { id: string; name: string; email: string }) => {
    if (!db) return
    const ws = createNewWorkspace(name, owner)
    await db.createWorkspace(ws)
    
    const collection = createNewCollection('Initial collection', ws.id)
    await db.createCollection(collection)

    const request = createNewRequest()
    request.name = 'New Request'
    request.collectionId = collection.id
    await db.createRequest(request)

    const newTab: WorkspaceTab = {
      id: generateId(),
      requestId: request.id,
      request: request,
      savedRequest: request,
      response: null,
      isDirty: false,
    }
    await db.saveWorkspaceState(ws.id, { tabs: [newTab], activeTabId: newTab.id })

    await refresh()
    setActiveWorkspaceId(ws.id)
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, ws.id)
    return ws
  }, [db, refresh])

  const rename = useCallback(async (id: string, name: string) => {
    if (!db) return
    await db.updateWorkspace(id, { name })
    await refresh()
  }, [db, refresh])

  const update = useCallback(async (id: string, data: Partial<Workspace>) => {
    if (!db) return
    await db.updateWorkspace(id, data)
    await refresh()
  }, [db, refresh])

  const remove = useCallback(async (id: string) => {
    if (!db) return
    await db.deleteWorkspace(id)
    const remaining = await refresh()
    if (id === activeWorkspaceId) {
      const next = remaining.find(w => w.id !== id) ?? remaining[0]
      if (next) {
        setActiveWorkspaceId(next.id)
        localStorage.setItem(ACTIVE_WORKSPACE_KEY, next.id)
      }
    }
  }, [db, refresh, activeWorkspaceId])

  const switchTo = useCallback((id: string) => {
    setActiveWorkspaceId(id)
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, id)
  }, [])

  return {
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    isLoading: isLoading || dbLoading,
    create,
    rename,
    update,
    remove,
    switchTo,
    refresh,
  }
}

// Collections hook
export function useCollections(workspaceId?: string | null) {
  const { db, isLoading: dbLoading } = useDatabase()
  const [collections, setCollections] = useState<Collection[]>([])
  const [isLoading, setIsLoading] = useState(true)
  // Discards a fetch response if a newer one has started since — otherwise a
  // slow-resolving fetch for a previously active workspace can land after a
  // faster one for the newly switched-to workspace, overwriting it with the
  // wrong workspace's data. See useSequences for the fuller explanation.
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!db || !workspaceId) return
    const requestId = ++requestIdRef.current
    const data = await db.getCollections(workspaceId)
    if (requestId !== requestIdRef.current) return
    setCollections(data.sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt)))
  }, [db, workspaceId])

  useEffect(() => {
    if (db && !dbLoading && workspaceId) {
      setIsLoading(true)
      refresh().then(() => setIsLoading(false))
    }
  }, [db, dbLoading, refresh, workspaceId])

  const create = useCallback(async (name: string) => {
    if (!db || !workspaceId) return
    const collection = createNewCollection(name, workspaceId)
    await db.createCollection(collection)
    await refresh()
    return collection
  }, [db, refresh, workspaceId])

  const update = useCallback(async (id: string, data: Partial<Collection>) => {
    if (!db) return
    await db.updateCollection(id, data)
    await refresh()
  }, [db, refresh])

  const remove = useCallback(async (id: string) => {
    if (!db) return
    await db.deleteCollection(id)
    await refresh()
  }, [db, refresh])

  const importCollection = useCallback(async (collection: Collection) => {
    if (!db || !workspaceId) return
    await db.createCollection({ ...collection, workspaceId })
    await refresh()
  }, [db, refresh, workspaceId])

  const reorder = useCallback(async (ordered: Collection[]) => {
    if (!db) return
    for (let i = 0; i < ordered.length; i++) {
      await db.updateCollection(ordered[i].id, { order: i })
    }
    setCollections(ordered.map((c, i) => ({ ...c, order: i })))
  }, [db])

  return {
    collections,
    isLoading: isLoading || dbLoading,
    create,
    update,
    remove,
    importCollection,
    reorder,
    refresh,
  }
}

// Requests hook
export function useRequests(collectionId?: string) {
  const { db, isLoading: dbLoading } = useDatabase()
  const [requests, setRequests] = useState<RequestConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  // See useSequences for why a request-generation guard is needed here.
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!db) return
    const requestId = ++requestIdRef.current
    const data = await db.getRequests(collectionId)
    if (requestId !== requestIdRef.current) return
    setRequests(data.sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt)))
  }, [db, collectionId])

  useEffect(() => {
    if (db && !dbLoading) {
      refresh().then(() => setIsLoading(false))
    }
  }, [db, dbLoading, refresh])

  const create = useCallback(async (request: RequestConfig) => {
    if (!db) return
    await db.createRequest(request)
    await refresh()
  }, [db, refresh])

  const update = useCallback(async (id: string, data: Partial<RequestConfig>) => {
    if (!db) return
    await db.updateRequest(id, data)
    await refresh()
  }, [db, refresh])

  const remove = useCallback(async (id: string) => {
    if (!db) return
    await db.deleteRequest(id)
    await refresh()
  }, [db, refresh])

  const importRequests = useCallback(async (reqs: RequestConfig[]) => {
    if (!db) return
    for (const r of reqs) {
      await db.createRequest(r)
    }
    await refresh()
  }, [db, refresh])

  const reorderRequests = useCallback(async (ordered: RequestConfig[]) => {
    if (!db) return
    for (let i = 0; i < ordered.length; i++) {
      await db.updateRequest(ordered[i].id, { order: i })
    }
    await refresh()
  }, [db, refresh])

  const get = useCallback(async (id: string): Promise<RequestConfig | undefined> => {
    if (!db) return undefined
    return db.getRequest(id)
  }, [db])

  return { requests, isLoading: isLoading || dbLoading, create, update, remove, importRequests, reorderRequests, refresh, get }
}

// Socket configs hook
export function useSocketConfigs() {
  const { db, isLoading: dbLoading } = useDatabase()
  const [socketConfigs, setSocketConfigs] = useState<SocketConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  // See useSequences for why a request-generation guard is needed here.
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!db) return
    const requestId = ++requestIdRef.current
    const data = await db.getSocketConfigs()
    if (requestId !== requestIdRef.current) return
    setSocketConfigs(data.sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt)))
  }, [db])

  useEffect(() => {
    if (db && !dbLoading) {
      refresh().then(() => setIsLoading(false))
    }
  }, [db, dbLoading, refresh])

  const create = useCallback(async (config: SocketConfig) => {
    if (!db) return
    await db.createSocketConfig(config)
    await refresh()
  }, [db, refresh])

  const update = useCallback(async (id: string, data: Partial<SocketConfig>) => {
    if (!db) return
    await db.updateSocketConfig(id, data)
    await refresh()
  }, [db, refresh])

  const remove = useCallback(async (id: string) => {
    if (!db) return
    await db.deleteSocketConfig(id)
    await refresh()
  }, [db, refresh])

  const importSocketConfigs = useCallback(async (configs: SocketConfig[]) => {
    if (!db) return
    for (const c of configs) await db.createSocketConfig(c)
    await refresh()
  }, [db, refresh])

  return { socketConfigs, isLoading: isLoading || dbLoading, create, update, remove, importSocketConfigs, refresh }
}

// Sequences hook
export function useSequences(workspaceId?: string | null) {
  const { db, isLoading: dbLoading } = useDatabase()
  const [sequences, setSequences] = useState<Sequence[]>([])
  const [isLoading, setIsLoading] = useState(true)
  // A cloud workspace's getSequences() goes over the network (RestAdapter)
  // while a personal one resolves fast over local IPC/SQLite. Switching from
  // a slow workspace to a fast one can let the old fetch resolve *after* the
  // new one already populated `sequences` — silently overwriting it with the
  // previous workspace's data. This counter discards any response that isn't
  // from the most recently started fetch.
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!db) return
    const requestId = ++requestIdRef.current
    const data = await db.getSequences(workspaceId ?? undefined)
    if (requestId !== requestIdRef.current) return
    setSequences(data.sort((a, b) => a.createdAt - b.createdAt))
  }, [db, workspaceId])

  useEffect(() => {
    if (db && !dbLoading) {
      refresh().then(() => setIsLoading(false))
    }
  }, [db, dbLoading, refresh])

  const create = useCallback(async (seq: Sequence) => {
    if (!db) return
    await db.createSequence(seq)
    await refresh()
  }, [db, refresh])

  const update = useCallback(async (id: string, data: Partial<Sequence>) => {
    if (!db) return
    await db.updateSequence(id, data)
    await refresh()
  }, [db, refresh])

  const remove = useCallback(async (id: string) => {
    if (!db) return
    await db.deleteSequence(id)
    await refresh()
  }, [db, refresh])

  return { sequences, isLoading: isLoading || dbLoading, create, update, remove, refresh }
}

// History hook
export function useHistory(workspaceId?: string | null, limit = 50) {
  const { db, isLoading: dbLoading } = useDatabase()
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  // See useSequences for why a request-generation guard is needed here.
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!db) return
    const requestId = ++requestIdRef.current
    const data = await db.getHistory(workspaceId ?? undefined, limit)
    if (requestId !== requestIdRef.current) return
    setHistory(data)
  }, [db, workspaceId, limit])

  useEffect(() => {
    if (db && !dbLoading) {
      setIsLoading(true)
      refresh().then(() => setIsLoading(false))
    }
  }, [db, dbLoading, refresh])

  const add = useCallback(async (entry: HistoryEntry) => {
    if (!db) return
    await db.addToHistory(entry)
    await refresh()
  }, [db, refresh])

  const clear = useCallback(async () => {
    if (!db) return
    await db.clearHistory(workspaceId ?? undefined)
    await refresh()
  }, [db, refresh, workspaceId])

  const remove = useCallback(async (id: string) => {
    if (!db) return
    await db.deleteHistoryEntry(id)
    await refresh()
  }, [db, refresh])

  return { history, isLoading: isLoading || dbLoading, add, clear, remove, refresh }
}

// Environments hook
export function useEnvironments(workspaceId?: string | null) {
  const { db, isLoading: dbLoading } = useDatabase()
  // Real (DB-backed) environments.
  const [environments, setEnvironments] = useState<Environment[]>([])
  // Bumped whenever the local "No Environment" variables change, to re-synthesize.
  const [defaultEnvVersion, setDefaultEnvVersion] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  // See useSequences for why a request-generation guard is needed here.
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!db) return
    const requestId = ++requestIdRef.current
    const data = await db.getEnvironments(workspaceId ?? undefined)
    if (requestId !== requestIdRef.current) return
    const sorted = data.sort((a, b) => a.name.localeCompare(b.name))
    setEnvironments(sorted)
    return sorted
  }, [db, workspaceId])

  useEffect(() => {
    if (db && !dbLoading) {
      setIsLoading(true)
      refresh().then(() => setIsLoading(false))
    }
  }, [db, dbLoading, refresh])

  // The "No Environment" default is active whenever no real environment is.
  const activeRealEnv = environments.find(e => e.isActive)
  const defaultEnv = useMemo(
    () => makeDefaultEnvironment(workspaceId, !activeRealEnv),
    // defaultEnvVersion forces a re-read of the local variables after edits.
    [workspaceId, activeRealEnv, defaultEnvVersion],
  )

  // Surface the default first, followed by user-created environments.
  const allEnvironments = useMemo(() => [defaultEnv, ...environments], [defaultEnv, environments])
  const activeEnvironment = activeRealEnv ?? defaultEnv

  const create = useCallback(async (name: string) => {
    if (!db) return
    const env = createNewEnvironment(name, workspaceId ?? undefined)
    await db.createEnvironment(env)
    await refresh()
    return env
  }, [db, refresh, workspaceId])

  const update = useCallback(async (id: string, data: Partial<Environment>) => {
    // Edits to the default env are persisted locally, not in the DB.
    if (isDefaultEnv(id)) {
      if (data.variables) {
        setDefaultEnvVariables(workspaceId, data.variables)
        setDefaultEnvVersion(v => v + 1)
      }
      return
    }
    if (!db) return
    await db.updateEnvironment(id, data)
    await refresh()
  }, [db, refresh, workspaceId])

  const remove = useCallback(async (id: string) => {
    if (!db || isDefaultEnv(id)) return // the default env can't be deleted
    await db.deleteEnvironment(id)
    await refresh()
  }, [db, refresh])

  const setActive = useCallback(async (id: string | null) => {
    if (!db) return
    // Selecting the default (or "none") just clears the active real environment.
    await db.setActiveEnvironment(isDefaultEnv(id) ? null : id, workspaceId ?? undefined)
    await refresh()
  }, [db, refresh, workspaceId])

  const importEnvironment = useCallback(async (env: Environment) => {
    if (!db) return
    await db.createEnvironment({ ...env, workspaceId: workspaceId ?? undefined })
    await refresh()
  }, [db, refresh, workspaceId])

  return {
    environments: allEnvironments,
    activeEnvironment,
    isLoading: isLoading || dbLoading,
    create,
    update,
    remove,
    setActive,
    importEnvironment,
    refresh,
  }
}

// Tab-state hook scoped to a workspace
export function useWorkspace(workspaceId?: string | null) {
  const { db, isLoading: dbLoading } = useDatabase()
  const [state, setState] = useState<WorkspaceState>({ tabs: [], activeTabId: null })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!db || dbLoading || !workspaceId) return
    ;(async () => {
      setIsLoading(true)
      const saved = await db.getWorkspaceState(workspaceId)
      if (saved) {
        // Re-hydrate saved tabs: fetch fresh saved version from DB as the baseline,
        // but restore any local edits that were persisted (isDirty tabs keep their request).
        const hydratedTabs = await Promise.all(
          saved.tabs.map(async (tab) => {
            if (!tab.requestId) return tab
            const fresh = await db.getRequest(tab.requestId).catch(() => undefined)
            if (!fresh) return tab
            // If the tab had unsaved local edits, restore them with the fresh DB version as savedRequest
            if (tab.isDirty && tab.request && tab.request.id) {
              return { ...tab, savedRequest: fresh, isDirty: true }
            }
            return { ...tab, request: fresh, savedRequest: fresh, isDirty: false }
          })
        )
        setState({ ...saved, tabs: hydratedTabs })
      } else {
        const newTab: WorkspaceTab = {
          id: generateId(),
          request: createNewRequest(),
          response: null,
          isDirty: false,
        }
        const initialState = { tabs: [newTab], activeTabId: newTab.id }
        setState(initialState)
        await db.saveWorkspaceState(workspaceId, initialState)
      }
      setIsLoading(false)
    })()
  }, [db, dbLoading, workspaceId])

  const saveState = useCallback(async (newState: WorkspaceState) => {
    if (!db || !workspaceId) return
    setState(newState)
    const persistState = newState
    await db.saveWorkspaceState(workspaceId, persistState)
  }, [db, workspaceId])

  const activeTab = state.tabs.find(t => t.id === state.activeTabId)

  const createTab = useCallback(async (request?: RequestConfig, requestId?: string, extra?: Partial<WorkspaceTab>) => {
    const resolvedRequest = request || createNewRequest()
    const newTab: WorkspaceTab = {
      id: generateId(),
      requestId,
      request: resolvedRequest,
      savedRequest: requestId ? resolvedRequest : undefined,
      response: null,
      isDirty: false,
      ...extra,
    }
    await saveState({ tabs: [...state.tabs, newTab], activeTabId: newTab.id })
    return newTab
  }, [state.tabs, saveState])

  const closeTab = useCallback(async (tabId: string) => {
    const tabIndex = state.tabs.findIndex(t => t.id === tabId)
    const newTabs = state.tabs.filter(t => t.id !== tabId)
    let newActiveId: string | null = state.activeTabId
    if (state.activeTabId === tabId) {
      newActiveId = newTabs.length > 0
        ? newTabs[Math.min(tabIndex, newTabs.length - 1)].id
        : null
    }
    await saveState({ tabs: newTabs, activeTabId: newActiveId })
  }, [state, saveState])

  const setActiveTab = useCallback(async (tabId: string) => {
    await saveState({ ...state, activeTabId: tabId })
  }, [state, saveState])

  const updateTab = useCallback(async (tabId: string, updates: Partial<WorkspaceTab>) => {
    const newTabs = state.tabs.map(t => t.id === tabId ? { ...t, ...updates } : t)
    await saveState({ ...state, tabs: newTabs })
  }, [state, saveState])

  const updateActiveRequest = useCallback(async (updates: Partial<RequestConfig>) => {
    if (!activeTab) return
    const updatedRequest = { ...activeTab.request, ...updates, updatedAt: Date.now() }
    const isDirty = !activeTab.savedRequest || !requestsEqual(updatedRequest, activeTab.savedRequest)
    await updateTab(activeTab.id, { request: updatedRequest, isDirty })
  }, [activeTab, updateTab])

  const setActiveResponse = useCallback(async (response: ResponseData | null) => {
    if (!activeTab) return
    await updateTab(activeTab.id, { response })
  }, [activeTab, updateTab])

  const markTabSaved = useCallback(async (tabId: string, requestId: string) => {
    const tab = state.tabs.find(t => t.id === tabId)
    await updateTab(tabId, { requestId, savedRequest: tab?.request, isDirty: false })
  }, [state.tabs, updateTab])

  const reorderTabs = useCallback(async (reordered: WorkspaceTab[]) => {
    await saveState({ ...state, tabs: reordered })
  }, [state, saveState])

  const saveSocketState = useCallback(async (socketTabs: SocketTab[], activeSocketTabId: string | null, tabOrder: { id: string; kind: 'http' | 'socket' }[]) => {
    if (!db || !workspaceId) return
    // Read the current persisted state directly from DB rather than merging with
    // in-memory `state` — avoids adding `state` as a dependency which would cause
    // an infinite loop (setState → new saveSocketState ref → effect re-fires).
    const current = await db.getWorkspaceState(workspaceId)
    if (!current) return
    await db.saveWorkspaceState(workspaceId, { ...current, socketTabs, activeSocketTabId, tabOrder })
  }, [db, workspaceId])

  return {
    tabs: state.tabs,
    activeTab,
    activeTabId: state.activeTabId,
    savedSocketTabs: state.socketTabs ?? [],
    savedActiveSocketTabId: state.activeSocketTabId ?? null,
    savedTabOrder: state.tabOrder ?? null,
    isLoading: isLoading || dbLoading,
    createTab,
    closeTab,
    setActiveTab,
    updateTab,
    updateActiveRequest,
    setActiveResponse,
    markTabSaved,
    reorderTabs,
    saveSocketState,
  }
}
