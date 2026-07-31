'use client'

import { version } from '@/package.json'
import { useState, useCallback, useEffect, useRef } from 'react'
import type { RequestConfig, ResponseData, HistoryEntry, Collection, SocketConfig, SocketTab, SocketMessage, SocketMessageType, SocketProtocol, Sequence, SequenceStep, SequenceStepResult } from '@/lib/db/types'
import { createNewRequest, createNewSocketConfig } from '@/lib/db/types'
import { generateId, uniqueName } from '@/lib/utils'
import {
  useWorkspaceManager,
  useCollections,
  useRequests,
  useSocketConfigs,
  useSequences,
  useHistory,
  useEnvironments,
  useWorkspace,
} from '@/hooks/use-database'
import { parseVariables } from '@/lib/variable-parser'
import { splitUrl, searchToParams } from '@/lib/url-params'
import { buildRequest } from '@/lib/build-request'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sidebar } from './sidebar'
import { TabBar, type TabOrderEntry } from './tab-bar'
import { RequestBuilder } from './request-builder'
import { ResponseViewer } from './response-viewer'
import { UrlBar } from './url-bar'
import { SocketBuilder } from './socket-builder'
import { SequenceBuilder } from './sequence-builder'
import { EnvironmentSelector } from './environment-selector'
import { EnvironmentProvider } from './environment-context'
import { isDefaultEnv } from '@/lib/default-environment'
import { resolveJsonPath } from '@/lib/json-path'
import { TitleBar } from './title-bar'
import { SettingsPanel } from './settings-panel'
import { HelpPanel } from './help-panel'
import { JwtDecoder } from './jwt-decoder-panel'
import { JsonFormatter } from './json-formatter-panel'
import { TextDiff } from './text-diff-panel'
import { WorkspaceDropdown } from './workspace-dropdown'
import { WorkspaceInviteDialog } from './workspace-invite-dialog'
import { WorkspaceQuickInviteDialog } from './workspace-quick-invite-dialog'
import { LoginDialog } from './login-dialog'
import { UpdateBar } from './update-bar'
import { useAuth } from '@/lib/auth/auth-context'
import type { Workspace, Environment, EnvironmentVariable } from '@/lib/db/types'
import { leaveWorkspace } from '@/lib/collaboration/store'
import { PanelBottom, PanelRight, Settings2, ListOrdered, KeyRound, Braces, GitCompare } from 'lucide-react'

function friendlyNetworkError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('fetch failed') || m.includes('econnrefused') || m.includes('failed to fetch')) {
    return 'Connection refused — the server is not reachable. Check the URL and make sure the server is running.'
  }
  if (m.includes('enotfound') || m.includes('getaddrinfo')) {
    return 'Could not resolve host — check the URL and your network connection.'
  }
  if (m.includes('etimedout') || m.includes('timed out') || m.includes('timeout')) {
    return 'Request timed out — the server took too long to respond.'
  }
  if (m.includes('econnreset') || m.includes('connection reset')) {
    return 'Connection was reset by the server.'
  }
  if (m.includes('cert') || m.includes('ssl') || m.includes('tls')) {
    return `SSL/TLS error — ${message}`
  }
  if (m.includes('xhr post error') || m.includes('xhr poll error')) {
    return 'Connection failed — could not reach the server via polling. The server may be down or blocking the connection.'
  }
  if (m.includes('request interrupted by user') || m.includes('interrupted')) {
    return 'Connection interrupted.'
  }
  if (m.includes('websocket error') || m.includes('websocket connection failed')) {
    return 'WebSocket connection failed — check the URL and server.'
  }
  return message
}

function friendlySocketError(message: string): string {
  return friendlyNetworkError(message)
}

// Backfill any missing fields so a partial proxy/IPC result is always a complete
// ResponseData envelope before it reaches the viewer or history.
function normalizeResponse(r: Partial<ResponseData> | null | undefined): ResponseData {
  return {
    status: r?.status ?? 0,
    statusText: r?.statusText ?? '',
    headers: r?.headers ?? {},
    body: r?.body ?? '',
    size: r?.size ?? 0,
    time: r?.time ?? 0,
    contentType: r?.contentType ?? '',
    isBinary: r?.isBinary ?? false,
    url: r?.url,
  }
}

interface PostmanLiteProps {
  updateProgress?: number | null
  updateDownloaded?: boolean
  onInstallUpdate?: () => void
  onDismissUpdate?: () => void
}

export function PostmanLite({ updateProgress = null, updateDownloaded = false, onInstallUpdate, onDismissUpdate }: PostmanLiteProps = {}) {
  const { state: authState } = useAuth()
  const currentUser = authState.status === 'authenticated' ? authState.session.user : null

  // On-demand sign-in. requireAuth runs the action immediately if signed in,
  // otherwise opens the login dialog and defers the action until sign-in succeeds.
  const [loginPrompt, setLoginPrompt] = useState<{ reason: string; onAuthed?: () => void } | null>(null)
  const requireAuth = useCallback((reason: string, onAuthed?: () => void) => {
    if (currentUser) {
      onAuthed?.()
      return true
    }
    setLoginPrompt({ reason, onAuthed })
    return false
  }, [currentUser])

  const [isLoading, setIsLoading] = useState(false)
  const [scrollResetKey, setScrollResetKey] = useState(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const requestGenerationRef = useRef(0)
  const activeElectronRequestIdRef = useRef<string | null>(null)
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false)
  const [isSaveSocketDialogOpen, setIsSaveSocketDialogOpen] = useState(false)
  const [saveSocketName, setSaveSocketName] = useState('')
  const [saveSocketCollectionId, setSaveSocketCollectionId] = useState<string>('')
  const [responseLayout, setResponseLayout] = useState<'side' | 'bottom'>('side')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [saveRequestName, setSaveRequestName] = useState('')
  const [saveCollectionId, setSaveCollectionId] = useState<string>('')
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null)
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false)
  const [pendingCloseSocketTabId, setPendingCloseSocketTabId] = useState<string | null>(null)
  const [isSocketCloseConfirmOpen, setIsSocketCloseConfirmOpen] = useState(false)
  const [inviteDialogWorkspace, setInviteDialogWorkspace] = useState<Workspace | null>(null)
  const [quickInviteWorkspace, setQuickInviteWorkspace] = useState<Workspace | null>(null)
  const [switchingToName, setSwitchingToName] = useState<string | null>(null)
  const [conflictRequest, setConflictRequest] = useState<RequestConfig | null>(null)
  const [conflictSocketConfig, setConflictSocketConfig] = useState<SocketConfig | null>(null)
  const [deletedNotice, setDeletedNotice] = useState<{ type: 'workspace' | 'environment'; name: string } | null>(null)

  // Socket tab state (kept in memory only — not persisted to DB, connections are ephemeral)
  const [socketTabs, setSocketTabs] = useState<SocketTab[]>([])
  const [activeSocketTabId, setActiveSocketTabId] = useState<string | null>(null)
  // Unified tab order — interleaves http and socket tabs in insertion order
  const [tabOrder, setTabOrder] = useState<{ id: string; kind: 'http' | 'socket' }[]>([])
  // Map of tabId → WebSocket instance
  const socketRefs = useRef<Record<string, WebSocket>>({})
  // Last active request tab before switching to a socket — used to restore on socket close
  const lastRequestTabIdRef = useRef<string | null>(null)

  const activeSocketTab = socketTabs.find(t => t.id === activeSocketTabId) ?? null

  const [flashTabId, setFlashTabId] = useState<string | null>(null)
  const flashTab = useCallback((id: string) => {
    setFlashTabId(null)
    requestAnimationFrame(() => setFlashTabId(id))
  }, [])

  // Per-tab active request panel (params/headers/body/auth)
  const [requestTabMap, setRequestTabMap] = useState<Record<string, string>>({})

  // Tool panel state (persisted across tab switches)
  const [jwtToken, setJwtToken] = useState('')
  const [jsonInput, setJsonInput] = useState('')
  const [diffText1, setDiffText1] = useState('')
  const [diffText2, setDiffText2] = useState('')

  // Sequence state
  const [activeView, setActiveView] = useState<'requests' | 'sequences' | 'jwt' | 'json' | 'diff'>('requests')
  const[isOnline, setIsOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const up = () => setIsOnline(true)
    const down = () => setIsOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  const [runningSequenceId, setRunningSequenceId] = useState<string | null>(null)
  const [stepResults, setStepResults] = useState<Record<string, SequenceStepResult>>({})
  const sequenceAbortRef = useRef<boolean>(false)
  const sequenceControllerRef = useRef<AbortController | null>(null)
  const sequenceElectronRequestIdRef = useRef<string | null>(null)

  // Workspace manager
  const {
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    isLoading: workspaceManagerLoading,
    create: createWorkspaceRaw,
    rename: renameWorkspace,
    remove: removeWorkspace,
    switchTo: switchWorkspaceRaw,
    update: updateWorkspace,
    refresh: refreshWorkspaces,
  } = useWorkspaceManager()

  const switchWorkspace = useCallback((id: string) => {
    const target = workspaces.find(w => w.id === id)
    const isCloud = !!target && (target.isSynced || (target.members?.length ?? 0) > 0)
    // Cloud workspaces are served by the REST adapter, which needs an account.
    if (isCloud && !currentUser) {
      requireAuth('Sign in to open this cloud workspace.', () => {
        if (id !== activeWorkspaceId) setSwitchingToName(target.name)
        switchWorkspaceRaw(id)
      })
      return
    }
    if (target && id !== activeWorkspaceId) setSwitchingToName(target.name)
    return switchWorkspaceRaw(id)
  }, [switchWorkspaceRaw, workspaces, activeWorkspaceId, currentUser, requireAuth])

  const createWorkspace = useCallback((name: string) => {
    return createWorkspaceRaw(name, currentUser ?? undefined)
  }, [createWorkspaceRaw, currentUser])

  const handleLeaveWorkspace = useCallback(async (id: string) => {
    await leaveWorkspace(id)
    const db = await import('@/lib/db').then(m => m.getDatabase())
    if ('removeWorkspaceLocally' in db) {
      await (db as any).removeWorkspaceLocally(id)
    }
    const remaining = await refreshWorkspaces()
    if (id === activeWorkspaceId && remaining?.length) {
      const next = remaining.find(w => w.id !== id)
      if (next) switchWorkspaceRaw(next.id)
    }
  }, [refreshWorkspaces, activeWorkspaceId, switchWorkspaceRaw])

  // Permission: owner always has write; members need read-write; no workspace = write (local)
  const isOwner = !activeWorkspace
    || activeWorkspace.ownerId === currentUser?.id
    || activeWorkspace.ownerId === 'local'

  const canWrite = isOwner
    || activeWorkspace?.members.find(m => m.userId === currentUser?.id)?.permission === 'read-write'

  // Data hooks — all scoped to the active workspace
  const safeWorkspaceId = workspaceManagerLoading ? null : activeWorkspaceId
  const { collections, create: createCollection, update: updateCollection, remove: removeCollection, importCollection, reorder: reorderCollections, refresh: refreshCollections } = useCollections(safeWorkspaceId)
  const { requests, create: createRequest, update: updateRequest, remove: removeRequest, refresh: refreshRequests, importRequests, reorderRequests, get: getRequest } = useRequests()
  const { socketConfigs, create: createSocketConfig, update: dbUpdateSocketConfig, remove: removeSocketConfig, importSocketConfigs, refresh: refreshSocketConfigs } = useSocketConfigs()
  const { sequences, create: createSequence, update: updateSequence, remove: removeSequence } = useSequences(safeWorkspaceId)
  const { history, add: addToHistory, remove: removeHistoryEntry, clear: clearHistory } = useHistory(safeWorkspaceId)
  const { environments, activeEnvironment, create: createEnvironment, update: updateEnvironment, remove: removeEnvironment, setActive: setActiveEnvironment, importEnvironment, refresh: refreshEnvironments } = useEnvironments(safeWorkspaceId)

  // Trigger refetch of global resources when workspace changes
  useEffect(() => {
    if (!workspaceManagerLoading) {
      refreshRequests()
      refreshSocketConfigs()
    }
  }, [safeWorkspaceId, refreshRequests, refreshSocketConfigs, workspaceManagerLoading])

  // Called after a workspace refresh — handles active workspace being deleted/removed
  const checkWorkspaceStillExists = useCallback((refreshed: Workspace[]) => {
    if (!activeWorkspaceId) return
    const current = workspaces.find(w => w.id === activeWorkspaceId)
    if (!refreshed.some(w => w.id === activeWorkspaceId)) {
      const next = refreshed[0]
      if (next) switchWorkspaceRaw(next.id)
      setDeletedNotice({ type: 'workspace', name: current?.name ?? 'Unknown' })
    }
  }, [activeWorkspaceId, workspaces, switchWorkspaceRaw])

  // Called after an environment refresh — handles active environment being deleted
  const checkActiveEnvironmentStillExists = useCallback((refreshedEnvs: Environment[]) => {
    // The default "No Environment" always exists (it's local) — never treat it as deleted.
    if (!activeEnvironment || isDefaultEnv(activeEnvironment.id)) return
    if (!refreshedEnvs.some(e => e.id === activeEnvironment.id)) {
      setActiveEnvironment(null)
      setDeletedNotice({ type: 'environment', name: activeEnvironment.name })
    }
  }, [activeEnvironment, setActiveEnvironment])

  const {
    tabs,
    activeTab,
    activeTabId,
    savedSocketTabs,
    savedActiveSocketTabId,
    savedTabOrder,
    isLoading: workspaceLoading,
    createTab,
    closeTab,
    setActiveTab,
    updateActiveRequest,
    updateTab,
    setActiveResponse,
    markTabSaved,
    reorderTabs,
    saveSocketState,
  } = useWorkspace(workspaceManagerLoading ? null : activeWorkspaceId)

  // Restore socket tabs from persisted workspace state once workspace finishes loading.
  const socketRestoredRef = useRef(false)
  const saveSocketStateRef = useRef(saveSocketState)
  useEffect(() => { saveSocketStateRef.current = saveSocketState }, [saveSocketState])

  useEffect(() => {
    if (workspaceLoading) return
    socketRestoredRef.current = false
    setSocketTabs([])
    setActiveSocketTabId(null)
    if (savedSocketTabs && savedSocketTabs.length > 0) {
      const restored = savedSocketTabs.map(t => ({ ...t, connectionStatus: 'disconnected' as const, messages: [] }))
      setSocketTabs(restored)
      if (savedTabOrder && savedTabOrder.length > 0) {
        // Restore exact tab order from DB, but only keep entries that still exist
        const httpIds = new Set(tabs.map(t => t.id))
        const socketIds = new Set(restored.map(t => t.id))
        setTabOrder(savedTabOrder.filter(e => e.kind === 'http' ? httpIds.has(e.id) : socketIds.has(e.id)))
      } else {
        // Fallback: append socket tabs after http tabs
        setTabOrder(prev => [
          ...prev.filter(e => e.kind === 'http'),
          ...restored.map(t => ({ id: t.id, kind: 'socket' as const })),
        ])
      }
      if (savedActiveSocketTabId && restored.some(t => t.id === savedActiveSocketTabId)) {
        setActiveSocketTabId(savedActiveSocketTabId)
        setActiveTab('')
      }
    } else {
      setTabOrder(prev => prev.filter(e => e.kind === 'http'))
    }
    // Mark restored on next tick so the persist effect doesn't fire before state settles
    setTimeout(() => { socketRestoredRef.current = true }, 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceLoading, activeWorkspaceId])

  useEffect(() => {
    if (!workspaceLoading) setSwitchingToName(null)
  }, [workspaceLoading])

  // Persist socket tabs and tab order whenever they change — but only after initial restore is done
  useEffect(() => {
    if (!socketRestoredRef.current) return
    saveSocketStateRef.current(socketTabs, activeSocketTabId, tabOrder)
  }, [socketTabs, activeSocketTabId, tabOrder])

  // Keep tabOrder in sync with http tabs (persisted).
  // Socket tab entries are managed explicitly by createSocketTab / closeSocketTab / restore effect.
  useEffect(() => {
    setTabOrder(prev => {
      const existingHttpIds = new Set(prev.filter(e => e.kind === 'http').map(e => e.id))
      const newEntries = tabs
        .filter(t => !existingHttpIds.has(t.id))
        .map(t => ({ id: t.id, kind: 'http' as const }))
      const httpIds = new Set(tabs.map(t => t.id))
      const pruned = prev.filter(e => e.kind === 'http' ? httpIds.has(e.id) : true)
      // Append any new http tabs at the end
      return [...pruned, ...newEntries]
    })
  }, [tabs])

  // Live polling for cloud workspaces
  const isCloudWorkspace = activeWorkspace?.isSynced || (activeWorkspace?.members?.length ?? 0) > 0
  const checkWorkspaceStillExistsRef = useRef(checkWorkspaceStillExists)
  const checkActiveEnvironmentStillExistsRef = useRef(checkActiveEnvironmentStillExists)
  useEffect(() => { checkWorkspaceStillExistsRef.current = checkWorkspaceStillExists }, [checkWorkspaceStillExists])
  useEffect(() => { checkActiveEnvironmentStillExistsRef.current = checkActiveEnvironmentStillExists }, [checkActiveEnvironmentStillExists])

  useEffect(() => {
    if (!isCloudWorkspace || workspaceLoading) return

    const poll = async () => {
      if (document.visibilityState === 'hidden') return
      const [refreshedWorkspaces, refreshedEnvs] = await Promise.all([
        refreshWorkspaces(),
        refreshEnvironments(),
        refreshCollections(),
        refreshRequests(),
        refreshSocketConfigs(),
      ] as const)
      if (refreshedWorkspaces) checkWorkspaceStillExistsRef.current(refreshedWorkspaces)
      if (refreshedEnvs) checkActiveEnvironmentStillExistsRef.current(refreshedEnvs)
    }

    const id = setInterval(poll, 8000)
    return () => clearInterval(id)
  }, [isCloudWorkspace, workspaceLoading, activeWorkspaceId])

  // Execute request
  const executeRequest = useCallback(async (urlOverride?: string) => {
    if (!activeTab || activeTab.isHistorical) return

    // Cancel any in-flight request before starting a new one
    abortControllerRef.current?.abort()
    if (activeElectronRequestIdRef.current && window.electronAPI?.cancelRequest) {
      window.electronAPI.cancelRequest(activeElectronRequestIdRef.current)
      activeElectronRequestIdRef.current = null
    }

    const generation = ++requestGenerationRef.current
    setIsLoading(true)
    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const request = { ...activeTab.request, ...(urlOverride !== undefined ? { url: urlOverride } : {}) }
      const envVariables = activeEnvironment?.variables || []

      const { url, method, headers, requestBody, formDataEntries } = buildRequest(request, envVariables)

      let responseData: ResponseData;

      if (typeof window !== 'undefined' && window.electronAPI) {
        // Use Electron IPC — pass a requestId so the main process can abort it
        const requestId = generateId()
        activeElectronRequestIdRef.current = requestId
        const result = await window.electronAPI.makeRequest({
          url,
          method,
          headers,
          requestBody,
          formDataEntries,
          requestId,
        })
        activeElectronRequestIdRef.current = null
        if (result?.aborted || generation !== requestGenerationRef.current) return
        responseData = result
      } else {
        // Make request through Next.js proxy
        const response = await fetch('/api/proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url,
            method,
            headers,
            requestBody,
            formDataEntries,
          }),
          signal: controller.signal,
        })
        if (generation !== requestGenerationRef.current) return
        responseData = await response.json()
      }

      if (generation !== requestGenerationRef.current) return

      // Guarantee a complete envelope: the proxy/IPC result can be partial (an
      // empty body, an unexpected error shape, etc.). Fill missing fields so
      // consumers (viewer, history) never see undefined.
      responseData = normalizeResponse(responseData)

      // Scroll to top only if the response body changed
      if (responseData.body !== activeTab.response?.body) {
        setScrollResetKey(k => k + 1)
      }

      // Update tab with response
      await setActiveResponse(responseData)

      // Add to history
      const historyEntry: HistoryEntry = {
        id: generateId(),
        request: { ...request },
        response: responseData,
        timestamp: Date.now(),
        workspaceId: activeWorkspaceId ?? undefined,
      }
      await addToHistory(historyEntry)

    } catch (error) {
      if (generation !== requestGenerationRef.current) return
      if (error instanceof Error && error.name === 'AbortError') {
        setIsLoading(false)
        return
      }
      const raw = error instanceof Error ? error.message : 'Unknown error'
      const errorResponse: ResponseData = {
        status: 0,
        statusText: 'Network Error',
        headers: {},
        body: JSON.stringify({ error: friendlyNetworkError(raw) }, null, 2),
        size: 0,
        time: 0,
        contentType: 'application/json',
        isBinary: false,
      }
      await setActiveResponse(errorResponse)
    } finally {
      if (generation === requestGenerationRef.current) {
        abortControllerRef.current = null
        setIsLoading(false)
      }
    }
  }, [activeTab, activeEnvironment, setActiveResponse, addToHistory])

  const cancelRequest = useCallback(() => {
    requestGenerationRef.current++ // invalidate any in-flight response
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    if (activeElectronRequestIdRef.current && window.electronAPI?.cancelRequest) {
      window.electronAPI.cancelRequest(activeElectronRequestIdRef.current)
      activeElectronRequestIdRef.current = null
    }
    setIsLoading(false)
  }, [])

  // Standalone request runner used by sequences (does not touch tab state)
  const runSingleRequest = useCallback(async (request: RequestConfig, signal?: AbortSignal, envVariablesOverride?: EnvironmentVariable[]): Promise<ResponseData> => {
    const envVariables = envVariablesOverride ?? activeEnvironment?.variables ?? []
    const { url, method, headers, requestBody, formDataEntries } = buildRequest(request, envVariables)
    if (typeof window !== 'undefined' && window.electronAPI) {
      const requestId = generateId()
      sequenceElectronRequestIdRef.current = requestId
      const result = await window.electronAPI.makeRequest({ url, method, headers, requestBody, formDataEntries, requestId })
      sequenceElectronRequestIdRef.current = null
      if (result?.aborted || signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      return normalizeResponse(result)
    }
    const res = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, method, headers, requestBody, formDataEntries }),
      signal,
    })
    // Mirror the Electron path: treat an abort as an AbortError so the sequence
    // runner marks the step skipped rather than recording a bogus result.
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    // The proxy normally returns a ResponseData envelope (even for network errors,
    // as status 0). If the route itself failed and returned non-JSON, surface a
    // structured error instead of throwing an opaque SyntaxError.
    try {
      return normalizeResponse(await res.json())
    } catch {
      return {
        status: res.status || 0,
        statusText: res.statusText || 'Proxy Error',
        headers: {},
        body: JSON.stringify({ error: 'Proxy returned an invalid response.' }, null, 2),
        size: 0,
        time: 0,
        contentType: 'application/json',
        isBinary: false,
      }
    }
  }, [activeEnvironment])

  // Walks the full sequence tree and returns a list of missing request descriptions
  const collectMissingRequests = useCallback((
    seq: Sequence,
    visited = new Set<string>(),
    path = seq.name,
  ): { stepName: string; path: string }[] => {
    if (visited.has(seq.id)) return []
    visited.add(seq.id)
    const missing: { stepName: string; path: string }[] = []
    for (const step of seq.steps) {
      if (step.type === 'request') {
        if (!requests.find(r => r.id === step.requestId)) {
          missing.push({ stepName: step.name, path })
        }
      } else if (step.type === 'sequence' && step.sequenceId) {
        const sub = sequences.find(s => s.id === step.sequenceId)
        if (sub) {
          missing.push(...collectMissingRequests(sub, visited, `${path} → ${sub.name}`))
        }
      }
    }
    return missing
  }, [requests, sequences])

  const [sequenceMissingRequests, setSequenceMissingRequests] = useState<{ stepName: string; path: string }[]>([])

  const executeSequence = useCallback(async (seq: Sequence) => {
    const missing = collectMissingRequests(seq)
    if (missing.length > 0) {
      setSequenceMissingRequests(missing)
      return
    }
    setRunningSequenceId(seq.id)
    sequenceAbortRef.current = false
    const controller = new AbortController()
    sequenceControllerRef.current = controller
    const initialResults: Record<string, SequenceStepResult> = {}
    seq.steps.forEach(s => { initialResults[s.id] = { stepId: s.id, status: 'idle' } })
    setStepResults(initialResults)

    // Snapshot environment variables so extractions are visible to subsequent steps
    const liveVars: EnvironmentVariable[] = activeEnvironment ? [...activeEnvironment.variables] : []

    // Recursive step runner. Top-level steps write into setStepResults directly.
    // Sub-sequence steps collect results into a local record returned to the caller,
    // which stores them in the parent step's subResults — never in the global map.
    const runSteps = async (
      steps: typeof seq.steps,
      lastBody: string | null,
      visited: Set<string>,
      reportResult: (stepId: string, result: SequenceStepResult) => void,
    ): Promise<string | null> => {
      let lastRequestStep: SequenceStep | null = null

      for (const step of steps) {
        if (sequenceAbortRef.current || controller.signal.aborted) {
          reportResult(step.id, { stepId: step.id, status: 'skipped' })
          continue
        }
        reportResult(step.id, { stepId: step.id, status: 'running' })

        // ── Sub-sequence step ───────────────────────────────────────────────
        if (step.type === 'sequence') {
          const sub = sequences.find(s => s.id === step.sequenceId)
          if (!sub) {
            reportResult(step.id, { stepId: step.id, status: 'error', error: 'Sequence not found' })
            continue
          }
          if (visited.has(sub.id)) {
            reportResult(step.id, { stepId: step.id, status: 'error', error: 'Circular sequence reference detected' })
            continue
          }
          const subResults: Record<string, SequenceStepResult> = {}
          // Initialise sub-step results as idle so the detail panel can render them immediately
          sub.steps.forEach(s => { subResults[s.id] = { stepId: s.id, status: 'idle' } })
          reportResult(step.id, { stepId: step.id, status: 'running', subResults: { ...subResults } })
          const subReport = (subStepId: string, result: SequenceStepResult) => {
            subResults[subStepId] = result
            // Re-publish parent step with updated subResults so the UI stays live
            reportResult(step.id, { stepId: step.id, status: 'running', subResults: { ...subResults } })
          }
          lastBody = await runSteps(sub.steps, lastBody, new Set([...visited, sub.id]), subReport)
          // If the run was aborted, surface the parent step as skipped rather than
          // falsely reporting success for sub-steps that never ran.
          if (sequenceAbortRef.current || controller.signal.aborted) {
            reportResult(step.id, { stepId: step.id, status: 'skipped', subResults: { ...subResults } })
            continue
          }
          // Success only if every sub-step actually completed successfully. A step
          // left idle (never ran) or errored/skipped means the sub-sequence failed.
          // An empty sub-sequence is vacuously successful.
          const allOk = sub.steps.every(s => subResults[s.id]?.status === 'success')
          reportResult(step.id, { stepId: step.id, status: allOk ? 'success' : 'error', subResults: { ...subResults } })
          continue
        }

        // ── Action step ─────────────────────────────────────────────────────
        if (step.type === 'action' && step.action) {
          const { type, jsonKey, envVariable } = step.action
          if (type === 'extract-json') {
            if (!lastBody) {
              reportResult(step.id, { stepId: step.id, status: 'error', error: 'No previous response to extract from' })
              continue
            }
            try {
              const parsed = JSON.parse(lastBody)
              const value = resolveJsonPath(parsed, jsonKey!)
              if (value === undefined || value === null) {
                reportResult(step.id, { stepId: step.id, status: 'error', error: `Key "${jsonKey}" not found in response` })
                continue
              }
              const strValue = typeof value === 'string' ? value : JSON.stringify(value)
              // Update liveVars so subsequent steps in this run see the new value
              const existingIdx = liveVars.findIndex(v => v.key === envVariable!)
              if (existingIdx >= 0) {
                liveVars[existingIdx] = { ...liveVars[existingIdx], value: strValue }
              } else {
                liveVars.push({ id: generateId(), key: envVariable!, value: strValue, enabled: true })
              }
              if (activeEnvironment) {
                await updateEnvironment(activeEnvironment.id, { variables: [...liveVars] })
              }
              reportResult(step.id, { stepId: step.id, status: 'success', extractedValue: strValue })
            } catch {
              reportResult(step.id, { stepId: step.id, status: 'error', error: 'Response is not valid JSON' })
            }
          } else if (type === 'repeat') {
            if (!lastRequestStep) {
              reportResult(step.id, { stepId: step.id, status: 'error', error: 'No previous request to repeat' })
              continue
            }
            const count = step.action.repeatCount ?? 1
            const iterations: SequenceStepResult[] = []
            reportResult(step.id, { stepId: step.id, status: 'running', iterations: [] })

            let successCount = 0
            for (let iter = 0; iter < count; iter++) {
              if (sequenceAbortRef.current || controller.signal.aborted) break
              
              const fullRequest = requests.find(r => r.id === lastRequestStep!.requestId)
              if (!fullRequest) {
                iterations.push({ stepId: `iter-${iter}`, status: 'error', error: 'Request not found in collections' })
                reportResult(step.id, { stepId: step.id, status: 'running', iterations: [...iterations] })
                continue
              }

              const start = Date.now()
              try {
                const response = await runSingleRequest(fullRequest, controller.signal, liveVars)
                const duration = Date.now() - start
                if (controller.signal.aborted) break

                lastBody = response.body
                const ok = response.status >= 200 && response.status < 300
                if (ok) successCount++

                iterations.push({
                  stepId: `iter-${iter}`,
                  status: ok ? 'success' : 'error',
                  statusCode: response.status,
                  statusText: response.statusText,
                  duration,
                  response,
                })
                reportResult(step.id, { stepId: step.id, status: 'running', iterations: [...iterations] })
              } catch (err) {
                const duration = Date.now() - start
                if (err instanceof Error && err.name === 'AbortError') break
                
                const msg = err instanceof Error ? err.message : 'Unknown error'
                lastBody = null
                iterations.push({ stepId: `iter-${iter}`, status: 'error', error: friendlyNetworkError(msg), duration })
                reportResult(step.id, { stepId: step.id, status: 'running', iterations: [...iterations] })
              }
            }

            const allOk = successCount === count
            reportResult(step.id, { stepId: step.id, status: allOk ? 'success' : 'error', iterations: [...iterations] })
          }
          continue
        }

        // ── Request step ────────────────────────────────────────────────────
        lastRequestStep = step
        const fullRequest = requests.find(r => r.id === step.requestId)
        if (!fullRequest) {
          reportResult(step.id, { stepId: step.id, status: 'error', error: 'Request not found in collections' })
          continue
        }
        const start = Date.now()
        try {
          const response = await runSingleRequest(fullRequest, controller.signal, liveVars)
          const duration = Date.now() - start
          if (controller.signal.aborted) {
            reportResult(step.id, { stepId: step.id, status: 'skipped' })
            continue
          }
          lastBody = response.body
          const ok = response.status >= 200 && response.status < 300
          reportResult(step.id, { stepId: step.id, status: ok ? 'success' : 'error', statusCode: response.status, statusText: response.statusText, duration, response })
        } catch (err) {
          const duration = Date.now() - start
          if (err instanceof Error && err.name === 'AbortError') {
            reportResult(step.id, { stepId: step.id, status: 'skipped' })
            continue
          }
          const msg = err instanceof Error ? err.message : 'Unknown error'
          lastBody = null
          reportResult(step.id, { stepId: step.id, status: 'error', error: friendlyNetworkError(msg), duration })
        }
      }
      return lastBody
    }

    const topLevelReport = (stepId: string, result: SequenceStepResult) => {
      setStepResults(prev => ({ ...prev, [stepId]: result }))
    }
    await runSteps(seq.steps, null, new Set([seq.id]), topLevelReport)
    sequenceControllerRef.current = null
    setRunningSequenceId(null)
  }, [requests, sequences, runSingleRequest, activeEnvironment, updateEnvironment])

  const stopSequence = useCallback(() => {
    sequenceAbortRef.current = true
    sequenceControllerRef.current?.abort()
    sequenceControllerRef.current = null
    if (sequenceElectronRequestIdRef.current && window.electronAPI?.cancelRequest) {
      window.electronAPI.cancelRequest(sequenceElectronRequestIdRef.current)
      sequenceElectronRequestIdRef.current = null
    }
    setRunningSequenceId(null)
  }, [])

  // ── Socket tab management ──────────────────────────────────────────────────

  const createSocketTab = useCallback((config?: SocketConfig, protocol?: SocketProtocol) => {
    const resolved = config ?? createNewSocketConfig({ protocol: protocol ?? 'ws' })
    const tab: SocketTab = {
      id: generateId(),
      socketId: config?.id,
      config: resolved,
      messages: [],
      isDirty: false,
      connectionStatus: 'disconnected',
      serverUpdatedAt: config?.updatedAt,
    }
    setSocketTabs(prev => [...prev, tab])
    setTabOrder(prev => [...prev, { id: tab.id, kind: 'socket' }])
    setActiveSocketTabId(tab.id)
    // Remember which request tab was active so we can return to it on close
    lastRequestTabIdRef.current = activeTabId || null
    setActiveTab('')
  }, [setActiveTab, activeTabId])

  const closeSocketTab = useCallback((tabId: string) => {
    // Disconnect if connected
    const ws = socketRefs.current[tabId]
    if (ws) { ws.close(); delete socketRefs.current[tabId] }
    setTabOrder(prev => prev.filter(e => e.id !== tabId))
    setSocketTabs(prev => {
      const remaining = prev.filter(t => t.id !== tabId)
      if (activeSocketTabId === tabId) {
        if (remaining.length > 0) {
          setActiveSocketTabId(remaining[remaining.length - 1].id)
        } else {
          // No more socket tabs — return to the last request tab we came from
          setActiveSocketTabId(null)
          const returnTo = lastRequestTabIdRef.current
          lastRequestTabIdRef.current = null
          if (returnTo) setActiveTab(returnTo)
        }
      }
      return remaining
    })
  }, [activeSocketTabId, setActiveTab])

  const updateSocketTab = useCallback((tabId: string, patch: Partial<SocketTab>) => {
    setSocketTabs(prev => prev.map(t => t.id === tabId ? { ...t, ...patch } : t))
  }, [])

  const updateSocketConfig = useCallback((tabId: string, updates: Partial<SocketTab['config']>) => {
    setSocketTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, config: { ...t.config, ...updates }, isDirty: true } : t
    ))
  }, [])

  // Register Electron IPC listeners once on mount, relay to socket tab state
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.wsOnOpen) return

    api.wsOnOpen((socketId) => {
      updateSocketTab(socketId, { connectionStatus: 'connected' })
      setSocketTabs(prev => prev.map(t => {
        if (t.id !== socketId) return t
        const subs = t.config.events.filter(ev => ev.enabled && ev.name)
        if (subs.length === 0) return t
        const infoMsgs: SocketMessage[] = subs.map(ev => ({
          id: generateId(), direction: 'received' as const, type: 'text' as const,
          data: `Listening on "${ev.name}"`, timestamp: Date.now(), size: 0,
        }))
        return { ...t, messages: [...t.messages, ...infoMsgs] }
      }))
    })

    api.wsOnMessage((socketId, raw, isBinary) => {
      let data = raw
      let type: SocketMessageType = isBinary ? 'binary' : 'text'

      if (!isBinary) {
        try { JSON.parse(data); type = 'json' } catch { /* plain text */ }

        let event: string | undefined
        try {
          const parsed = JSON.parse(data)
          if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
            event = parsed[0]
            data = parsed.length === 2
              ? (typeof parsed[1] === 'string' ? parsed[1] : JSON.stringify(parsed[1], null, 2))
              : JSON.stringify(parsed.slice(1), null, 2)
          }
        } catch { /* not Socket.IO */ }

        setSocketTabs(prev => {
          const tab = prev.find(t => t.id === socketId)
          const subscribedEvents = tab?.config.events.filter(ev => ev.enabled && ev.name)
          if (subscribedEvents && subscribedEvents.length > 0 && event && event !== '__ack__' && !subscribedEvents.some(ev => ev.name === event)) {
            return prev // filtered out
          }
          const msg: SocketMessage = {
            id: generateId(), direction: 'received', event, type,
            data, timestamp: Date.now(), size: new TextEncoder().encode(data).length,
          }
          return prev.map(t => t.id === socketId ? { ...t, messages: [...t.messages, msg] } : t)
        })
        return
      }

      const msg: SocketMessage = {
        id: generateId(), direction: 'received', type: 'binary',
        data, timestamp: Date.now(), size: data.length,
      }
      setSocketTabs(prev => prev.map(t => t.id === socketId ? { ...t, messages: [...t.messages, msg] } : t))
    })

    api.wsOnClose((socketId) => {
      updateSocketTab(socketId, { connectionStatus: 'disconnected' })
    })

    api.wsOnError((socketId, message) => {
      updateSocketTab(socketId, { connectionStatus: 'error' })
      const friendly = friendlySocketError(message)
      const msg: SocketMessage = {
        id: generateId(), direction: 'received', type: 'text',
        data: `Error: ${friendly}`, timestamp: Date.now(), size: friendly.length,
      }
      setSocketTabs(prev => prev.map(t => t.id === socketId ? { ...t, messages: [...t.messages, msg] } : t))
    })

    return () => { api.wsRemoveListeners() }
  }, [updateSocketTab])

  const buildSocketUrl = useCallback((tabId: string) => {
    const tab = socketTabs.find(t => t.id === tabId)
    if (!tab) return null
    const envVariables = activeEnvironment?.variables || []
    const protocol = tab.config.protocol ?? 'ws'
    let url = parseVariables(tab.config.url, envVariables)
    // Strip any /socket.io path users may have pasted by mistake
    const sioIdx = url.indexOf('/socket.io')
    if (sioIdx !== -1) url = url.slice(0, sioIdx)
    const enabledParams = tab.config.params.filter(p => p.enabled && p.key)
    if (enabledParams.length > 0) {
      const qs = new URLSearchParams()
      enabledParams.forEach(p => qs.append(parseVariables(p.key, envVariables), parseVariables(p.value, envVariables)))
      url += (url.includes('?') ? '&' : '?') + qs.toString()
    }
    if (protocol === 'socketio') {
      // socket.io-client wants http(s)://
      if (url.startsWith('wss://')) url = 'https://' + url.slice(6)
      else if (url.startsWith('ws://')) url = 'http://' + url.slice(5)
      else if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'http://' + url
    } else {
      // Raw WebSocket wants ws(s)://
      if (url.startsWith('https://')) url = 'wss://' + url.slice(8)
      else if (url.startsWith('http://')) url = 'ws://' + url.slice(7)
      else if (!url.startsWith('ws://') && !url.startsWith('wss://')) url = 'ws://' + url
    }
    return { url, tab, protocol }
  }, [socketTabs, activeEnvironment])

  const connectSocket = useCallback((tabId: string) => {
    const result = buildSocketUrl(tabId)
    if (!result) return
    const { url, tab, protocol } = result

    updateSocketTab(tabId, { connectionStatus: 'connecting', messages: [] })

    const envVariables = activeEnvironment?.variables || []
    const headers: Record<string, string> = {}
    tab.config.headers.filter(h => h.enabled && h.key).forEach(h => {
      headers[parseVariables(h.key, envVariables)] = parseVariables(h.value, envVariables)
    })

    if (window.electronAPI?.wsConnect) {
      // Electron: connect from main process (no browser restrictions)
      window.electronAPI.wsConnect(tabId, url, headers, protocol)
    } else {
      // Browser: route through the local WS proxy server
      try {
        const proxyBase = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws-proxy`
        const proxyUrl = `${proxyBase}?url=${encodeURIComponent(url)}&headers=${encodeURIComponent(JSON.stringify(headers))}&protocol=${protocol}`
        const ws = new WebSocket(proxyUrl)
        socketRefs.current[tabId] = ws

        ws.onmessage = (e) => {
          try {
            const envelope = JSON.parse(e.data)
            if (envelope.type === '__open') {
              updateSocketTab(tabId, { connectionStatus: 'connected' })
              setSocketTabs(prev => prev.map(t => {
                if (t.id !== tabId) return t
                const subs = t.config.events.filter(ev => ev.enabled && ev.name)
                if (subs.length === 0) return t
                const infoMsgs: SocketMessage[] = subs.map(ev => ({
                  id: generateId(), direction: 'received' as const, type: 'text' as const,
                  data: `Listening on "${ev.name}"`, timestamp: Date.now(), size: 0,
                }))
                return { ...t, messages: [...t.messages, ...infoMsgs] }
              }))
            } else if (envelope.type === '__close') {
              updateSocketTab(tabId, { connectionStatus: 'disconnected' })
              delete socketRefs.current[tabId]
            } else if (envelope.type === '__error') {
              updateSocketTab(tabId, { connectionStatus: 'error' })
              const friendly = friendlySocketError(envelope.message)
              const msg: SocketMessage = { id: generateId(), direction: 'received', type: 'text', data: `Error: ${friendly}`, timestamp: Date.now(), size: friendly.length }
              setSocketTabs(prev => prev.map(t => t.id === tabId ? { ...t, messages: [...t.messages, msg] } : t))
            } else if (envelope.type === '__message') {
              let data: string = envelope.data
              let type: SocketMessageType = envelope.isBinary ? 'binary' : 'text'
              let event: string | undefined
              if (!envelope.isBinary) {
                try { JSON.parse(data); type = 'json' } catch { /* */ }
                try {
                  const parsed = JSON.parse(data)
                  if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
                    event = parsed[0]
                    data = parsed.length === 2 ? (typeof parsed[1] === 'string' ? parsed[1] : JSON.stringify(parsed[1], null, 2)) : JSON.stringify(parsed.slice(1), null, 2)
                    if (event === '__ack__') console.log('[socket] ACK received, data=', data)
                  }
                } catch { /* */ }
              }
              setSocketTabs(prev => {
                const t = prev.find(t => t.id === tabId)
                const subs = t?.config.events.filter(ev => ev.enabled && ev.name)
                if (subs && subs.length > 0 && event && event !== '__ack__' && !subs.some(ev => ev.name === event)) return prev
                const msg: SocketMessage = { id: generateId(), direction: 'received', event, type, data, timestamp: Date.now(), size: new TextEncoder().encode(data).length }
                return prev.map(t => t.id === tabId ? { ...t, messages: [...t.messages, msg] } : t)
              })
            }
          } catch { /* ignore malformed envelope */ }
        }
        ws.onerror = () => updateSocketTab(tabId, { connectionStatus: 'error' })
        ws.onclose = () => { updateSocketTab(tabId, { connectionStatus: 'disconnected' }); delete socketRefs.current[tabId] }
      } catch {
        updateSocketTab(tabId, { connectionStatus: 'error' })
      }
    }
  }, [buildSocketUrl, updateSocketTab, activeEnvironment])

  const disconnectSocket = useCallback((tabId: string) => {
    if (window.electronAPI?.wsDisconnect) {
      window.electronAPI.wsDisconnect(tabId)
    } else {
      const ws = socketRefs.current[tabId]
      if (ws) { ws.close(); delete socketRefs.current[tabId] }
    }
    updateSocketTab(tabId, { connectionStatus: 'disconnected' })
  }, [updateSocketTab])

  const sendSocketMessage = useCallback((tabId: string, event: string, data: string, type: SocketMessageType, ack = false) => {
    const envVariables = activeEnvironment?.variables || []
    const resolvedData = parseVariables(data, envVariables)
    // For ACK we send a special envelope so the server bridge knows to call emit with a callback
    const payload = ack
      ? JSON.stringify({ __ack: true, event, data: resolvedData })
      : (event && event !== 'message' ? JSON.stringify([event, resolvedData]) : resolvedData)
    if (ack) console.log('[socket] sending ACK payload', payload)

    if (window.electronAPI?.wsSend) {
      window.electronAPI.wsSend(tabId, payload)
    } else {
      const ws = socketRefs.current[tabId]
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(payload)
    }

    const msg: SocketMessage = {
      id: generateId(), direction: 'sent', event: event || undefined, type,
      data: resolvedData, timestamp: Date.now(), size: new TextEncoder().encode(resolvedData).length,
    }
    setSocketTabs(prev => prev.map(t => t.id === tabId ? { ...t, messages: [...t.messages, msg] } : t))
  }, [activeEnvironment])

  // Unified "select tab" — handles both HTTP and socket tabs
  const handleSelectTab = useCallback((id: string) => {
    const isSocket = socketTabs.some(t => t.id === id)
    if (isSocket) {
      setActiveSocketTabId(id)
      setActiveTab('')
    } else {
      setActiveSocketTabId(null)
      setActiveTab(id)
    }
  }, [socketTabs, setActiveTab])

  // Open saved socket config in a tab
  const openSocketConfig = useCallback((config: SocketConfig) => {
    const existing = socketTabs.find(t => t.socketId === config.id)
    if (existing) {
      // Ensure the tab is in tabOrder (may have been restored but not yet in the order array)
      setTabOrder(prev => prev.some(e => e.id === existing.id) ? prev : [...prev, { id: existing.id, kind: 'socket' as const }])
      setActiveSocketTabId(existing.id)
      setActiveTab('')
    } else {
      createSocketTab(config)
    }
    setActiveView('requests')
  }, [socketTabs, createSocketTab, setActiveTab])

  // Open saved request in new tab, or switch to it if already open
  const openRequest = useCallback(async (request: RequestConfig) => {
    const existing = tabs.find(t => t.requestId === request.id)
    if (existing) {
      setActiveSocketTabId(null)
      if (existing.id === activeTabId && !activeSocketTabId) {
        flashTab(existing.id)
      } else {
        await setActiveTab(existing.id)
      }
    } else {
      setActiveSocketTabId(null)
      await createTab({ ...request }, request.id, { serverUpdatedAt: request.updatedAt })
    }
    setActiveView('requests')
  }, [tabs, activeTabId, activeSocketTabId, flashTab, createTab, setActiveTab])

  // Open history entry as a read-only snapshot tab
  const openHistoryEntry = useCallback(async (entry: HistoryEntry) => {
    const existing = tabs.find(t => t.historyTimestamp === entry.timestamp)
    if (existing) {
      setActiveSocketTabId(null)
      if (existing.id === activeTabId && !activeSocketTabId) {
        flashTab(existing.id)
      } else {
        await setActiveTab(existing.id)
      }
    } else {
      const request = createNewRequest({ ...entry.request, id: generateId() })
      await createTab(request, undefined, { response: entry.response, isHistorical: true, historyTimestamp: entry.timestamp })
    }
    setActiveView('requests')
  }, [tabs, activeTabId, activeSocketTabId, flashTab, createTab, setActiveTab, setActiveView])

  // Save current request to collection, then optionally close the tab
  const saveCurrentRequest = useCallback(async () => {
    const tabToSave = pendingCloseTabId
      ? tabs.find(t => t.id === pendingCloseTabId) ?? activeTab
      : activeTab
    if (!tabToSave || !saveCollectionId || !saveRequestName.trim()) return

    // Names only need to be unique within the target collection — other
    // collections (even in the same workspace) can reuse the same name.
    const siblingNames = requests.filter(r => r.collectionId === saveCollectionId).map(r => r.name)
    const request: RequestConfig = {
      ...tabToSave.request,
      name: uniqueName(saveRequestName.trim(), siblingNames),
      collectionId: saveCollectionId,
    }

    await createRequest(request)
    // Single atomic update: set requestId, savedRequest, and request in one call
    // so openRequest() always finds the tab by requestId without a race condition
    await updateTab(tabToSave.id, { requestId: request.id, request, savedRequest: request, isDirty: false, serverUpdatedAt: request.updatedAt })
    await refreshRequests()

    setSaveRequestName('')
    setSaveCollectionId('')
    setIsSaveDialogOpen(false)

    if (pendingCloseTabId) {
      const remainingHttpTabs = tabs.filter(t => t.id !== pendingCloseTabId)
      await closeTab(pendingCloseTabId)
      setPendingCloseTabId(null)
      setIsCloseConfirmOpen(false)
      if (remainingHttpTabs.length === 0 && socketTabs.length > 0) {
        const lastSocket = tabOrder.filter(e => e.kind === 'socket').at(-1)
        const target = lastSocket ? socketTabs.find(t => t.id === lastSocket.id) : socketTabs[socketTabs.length - 1]
        if (target) setActiveSocketTabId(target.id)
      }
    }
  }, [activeTab, tabs, pendingCloseTabId, saveCollectionId, saveRequestName, requests, createRequest, markTabSaved, updateTab, refreshRequests, closeTab, socketTabs, tabOrder, setActiveSocketTabId])

  // Open save dialog (or save directly if already part of a collection)
  const openSaveDialog = useCallback(async () => {
    if (!activeTab) return
    if (activeTab.requestId) {
      // Conflict check for cloud workspaces
      const isCloud = activeWorkspace?.isSynced || (activeWorkspace?.members?.length ?? 0) > 0
      if (isCloud && activeTab.serverUpdatedAt !== undefined) {
        const serverRequest = await getRequest(activeTab.requestId)
        if (serverRequest && serverRequest.updatedAt !== activeTab.serverUpdatedAt) {
          setConflictRequest(serverRequest)
          return
        }
      }
      const updated = { ...activeTab.request, name: activeTab.request.name || 'New Request', updatedAt: Date.now() }
      await updateRequest(activeTab.requestId, updated)
      await markTabSaved(activeTab.id, activeTab.requestId)
      await updateTab(activeTab.id, { request: updated, savedRequest: updated, isDirty: false, serverUpdatedAt: updated.updatedAt })
      await refreshRequests()
      return
    }
    setSaveRequestName(activeTab.request.name || 'New Request')
    setSaveCollectionId(collections[0]?.id || '')
    setIsSaveDialogOpen(true)
  }, [activeTab, activeWorkspace, collections, getRequest, updateRequest, markTabSaved, updateTab, refreshRequests])

  const saveCurrentSocket = useCallback(async () => {
    const tab = socketTabs.find(t => t.id === activeSocketTabId)
    if (!tab || !saveSocketCollectionId || !saveSocketName.trim()) return
    const config: SocketConfig = { ...tab.config, name: saveSocketName.trim(), collectionId: saveSocketCollectionId, updatedAt: Date.now() }
    try {
      if (tab.socketId) {
        await dbUpdateSocketConfig(tab.socketId, config)
      } else {
        await createSocketConfig(config)
      }
      setSocketTabs(prev => prev.map(t =>
        t.id === tab.id ? { ...t, socketId: config.id, config, isDirty: false } : t
      ))
      await refreshSocketConfigs()
    } catch (e) {
      console.error('[saveCurrentSocket] failed', e)
    }
    setIsSaveSocketDialogOpen(false)
  }, [socketTabs, activeSocketTabId, saveSocketName, saveSocketCollectionId, createSocketConfig, dbUpdateSocketConfig, refreshSocketConfigs])

  const openSaveSocketDialog = useCallback(async () => {
    const tab = socketTabs.find(t => t.id === activeSocketTabId)
    if (!tab) return
    if (tab.socketId) {
      // Conflict check for cloud workspaces
      const isCloud = activeWorkspace?.isSynced || (activeWorkspace?.members?.length ?? 0) > 0
      if (isCloud && tab.serverUpdatedAt !== undefined) {
        const { getDatabase } = await import('@/lib/db')
        const db = await getDatabase()
        const configs = await db.getSocketConfigs(tab.config.collectionId)
        const serverSocket = configs.find(c => c.id === tab.socketId)
        if (serverSocket && serverSocket.updatedAt !== tab.serverUpdatedAt) {
          setConflictSocketConfig(serverSocket)
          return
        }
      }

      const config: SocketConfig = { ...tab.config, updatedAt: Date.now() }
      await dbUpdateSocketConfig(tab.socketId, config)
      await refreshSocketConfigs()
      setSocketTabs(prev => prev.map(t =>
        t.id === tab.id ? { ...t, config, isDirty: false, serverUpdatedAt: config.updatedAt } : t
      ))
      return
    }
    setSaveSocketName(tab.config.name || 'New Socket')
    setSaveSocketCollectionId(collections[0]?.id || '')
    setIsSaveSocketDialogOpen(true)
  }, [socketTabs, activeSocketTabId, collections, dbUpdateSocketConfig, refreshSocketConfigs])

  // Close tab — intercept dirty tabs to confirm
  const handleCloseTab = useCallback((tabId: string) => {
    const tab = tabs.find(t => t.id === tabId)
    if (tab?.isDirty) {
      setPendingCloseTabId(tabId)
      setSaveRequestName(tab.request.name || 'New Request')
      setSaveCollectionId(collections[0]?.id || '')
      setIsCloseConfirmOpen(true)
    } else {
      const remainingHttpTabs = tabs.filter(t => t.id !== tabId)
      const isClosingActive = activeTabId === tabId
      closeTab(tabId)
      // If no HTTP tabs remain and a socket tab exists, focus the most recent socket tab
      if (isClosingActive && remainingHttpTabs.length === 0 && socketTabs.length > 0) {
        const lastSocket = tabOrder.filter(e => e.kind === 'socket').at(-1)
        const target = lastSocket ? socketTabs.find(t => t.id === lastSocket.id) : socketTabs[socketTabs.length - 1]
        if (target) setActiveSocketTabId(target.id)
      }
    }
  }, [tabs, collections, closeTab, activeTabId, socketTabs, tabOrder, setActiveSocketTabId])

  // Unified "close tab" — after handleCloseTab so it's in scope
  const handleUnifiedCloseTab = useCallback((id: string) => {
    const socketTab = socketTabs.find(t => t.id === id)
    if (socketTab) {
      if (socketTab.isDirty) {
        setPendingCloseSocketTabId(id)
        setSaveSocketName(socketTab.config.name || 'New Socket')
        setSaveSocketCollectionId(collections[0]?.id || '')
        setIsSocketCloseConfirmOpen(true)
      } else {
        closeSocketTab(id)
      }
    } else {
      handleCloseTab(id)
    }
  }, [socketTabs, collections, closeSocketTab, handleCloseTab])

  // Stable ref so the keyboard handler always sees current values without
  // changing the useEffect dep array size (avoids rules-of-hooks violations).
  const kbStateRef = useRef({ canWrite, activeTabId, activeSocketTabId, tabs, socketTabs })
  useEffect(() => {
    kbStateRef.current = { canWrite, activeTabId, activeSocketTabId, tabs, socketTabs }
  })

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { canWrite, activeTabId, activeSocketTabId, tabs, socketTabs } = kbStateRef.current

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.key.toLowerCase() === 's') {
          e.preventDefault();
          if (canWrite) { if (activeSocketTabId) openSaveSocketDialog(); else openSaveDialog(); }
        } else if (e.key.toLowerCase() === 't') {
          e.preventDefault();
          if (!window.electronAPI) {
            setActiveSocketTabId(null);
            createTab();
          }
        } else if (e.key.toLowerCase() === 'w') {
          e.preventDefault();
          if (!window.electronAPI) {
            const activeId = activeSocketTabId ?? activeTabId;
            if (activeId) handleUnifiedCloseTab(activeId);
          }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          executeRequest();
        } else if (e.key === 'Tab') {
          e.preventDefault();
          const allTabs = [
            ...tabs.map(t => ({ id: t.id, kind: 'request' as const })),
            ...socketTabs.map(t => ({ id: t.id, kind: 'socket' as const })),
          ];
          if (allTabs.length > 1) {
            const currentId = activeSocketTabId ?? activeTabId;
            const currentIndex = allTabs.findIndex(t => t.id === currentId);
            if (currentIndex !== -1) {
              const newIndex = e.shiftKey
                ? (currentIndex > 0 ? currentIndex - 1 : allTabs.length - 1)
                : (currentIndex < allTabs.length - 1 ? currentIndex + 1 : 0);
              const next = allTabs[newIndex];
              if (next.kind === 'socket') {
                setActiveSocketTabId(next.id);
                setActiveTab('');
              } else {
                setActiveSocketTabId(null);
                setActiveTab(next.id);
              }
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createTab, handleUnifiedCloseTab, setActiveTab, setActiveSocketTabId, openSaveDialog, openSaveSocketDialog, executeRequest]);

  useEffect(() => {
    const handleClose = () => {
      const activeId = activeSocketTabId ?? activeTabId
      if (activeId) {
        handleUnifiedCloseTab(activeId)
      }
    }
    const handleNewTab = () => {
      setActiveSocketTabId(null)
      createTab()
    }
    window.electronAPI?.onCloseActiveTab?.(handleClose)
    window.electronAPI?.onNewQueryTab?.(handleNewTab)
    return () => {
      window.electronAPI?.offCloseActiveTab?.(handleClose)
      window.electronAPI?.offNewQueryTab?.(handleNewTab)
    }
  }, [activeSocketTabId, activeTabId, handleUnifiedCloseTab, createTab, setActiveSocketTabId])

  // Import collection handler (also receives socket configs from Postman imports)
  const handleImportCollection = useCallback(async (collection: Collection, importedRequests: RequestConfig[], socketConfigs?: SocketConfig[]) => {
    await importCollection(collection)
    await importRequests(importedRequests)
    if (socketConfigs && socketConfigs.length > 0) {
      await importSocketConfigs(socketConfigs)
    }
  }, [importCollection, importRequests, importSocketConfigs])

  // Init workspace from project folder — create workspace (auto-switched), import all found specs
  const handleInitFromProject = useCallback(async (name: string, specFiles: { path: string; content: string }[]) => {
    const { parseYaml, parseOpenApiSpec } = await import('@/lib/openapi-parser')
    // createWorkspace already calls refresh + setActiveWorkspaceId internally
    await createWorkspace(name)
    // Wait for React state to settle so collections/requests hooks pick up the new workspaceId
    await new Promise(r => setTimeout(r, 200))
    for (const file of specFiles) {
      try {
        const isYaml = file.path.endsWith('.yaml') || file.path.endsWith('.yml')
        const data = isYaml ? parseYaml(file.content) : JSON.parse(file.content)
        const result = parseOpenApiSpec(data)
        if (result) {
          await importCollection(result.collection)
          await importRequests(result.requests)
        }
      } catch {}
    }
  }, [createWorkspace, importCollection, importRequests])

  // Workspace export
  const handleExportWorkspace = useCallback(async (workspaceId: string) => {
    const ws = workspaces.find(w => w.id === workspaceId)
    if (!ws) return
    const { getDatabase } = await import('@/lib/db')
    const db = await getDatabase()
    const wsCollections = await db.getCollections(workspaceId)
    const wsRequests: RequestConfig[] = []
    for (const col of wsCollections) {
      const reqs = await db.getRequests(col.id)
      wsRequests.push(...reqs)
    }
    const wsEnvironments = await db.getEnvironments(workspaceId)
    const payload = {
      version: 1,
      workspace: ws,
      collections: wsCollections,
      requests: wsRequests,
      environments: wsEnvironments,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${ws.name.replace(/[^a-z0-9]/gi, '_')}_workspace.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [workspaces])

  // Workspace import — triggered by hidden file input
  const workspaceImportRef = useRef<HTMLInputElement>(null)
  const handleImportWorkspaceFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    const failed: string[] = []
    for (const file of files) {
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        if (data.version !== 1 || !data.workspace || !Array.isArray(data.collections)) {
          failed.push(file.name)
          continue
        }
        const { getDatabase } = await import('@/lib/db')
        const db = await getDatabase()
        // Create workspace with a new ID to avoid collisions
        const newWsId = generateId()
        const now = Date.now()
        await db.createWorkspace({ ...data.workspace, id: newWsId, name: `${data.workspace.name} (imported)`, createdAt: now, updatedAt: now })
        const idMap: Record<string, string> = {}
        for (const col of data.collections) {
          const newColId = generateId()
          idMap[col.id] = newColId
          await db.createCollection({ ...col, id: newColId, workspaceId: newWsId })
        }
        for (const req of (data.requests || [])) {
          const newReqId = generateId()
          const newColId = req.collectionId ? (idMap[req.collectionId] ?? req.collectionId) : undefined
          await db.createRequest({ ...req, id: newReqId, collectionId: newColId })
        }
        for (const env of (data.environments || [])) {
          await db.createEnvironment({ ...env, id: generateId(), workspaceId: newWsId, isActive: false })
        }
      } catch {
        failed.push(file.name)
      }
    }
    if (workspaceImportRef.current) workspaceImportRef.current.value = ''
    if (failed.length > 0) {
      alert(`Failed to import: ${failed.join(', ')}\n\nPlease ensure they are valid workspace export files.`)
    }
    // Refresh workspace list — reload page is simplest since hooks need to re-init
    window.location.reload()
  }, [])

  // Export all account data
  const handleExportAll = useCallback(async () => {
    const { getDatabase } = await import('@/lib/db')
    const db = await getDatabase()
    const allWorkspaces = await db.getWorkspaces()
    const allCollections = await db.getCollections()
    const allRequests: RequestConfig[] = []
    for (const col of allCollections) {
      const reqs = await db.getRequests(col.id)
      allRequests.push(...reqs)
    }
    const allEnvironments = await db.getEnvironments()
    const allSocketConfigs = await db.getSocketConfigs()
    const allSequences = await db.getSequences()
    const payload = {
      version: 2,
      exportedAt: Date.now(),
      workspaces: allWorkspaces,
      collections: allCollections,
      requests: allRequests,
      environments: allEnvironments,
      socketConfigs: allSocketConfigs,
      sequences: allSequences,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `quence-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  // Import all account data
  const allDataImportRef = useRef<HTMLInputElement>(null)
  const handleImportAllFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (allDataImportRef.current) allDataImportRef.current.value = ''
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (data.version !== 2 || !Array.isArray(data.workspaces)) {
        alert('Invalid export file. Please use a file created by "Export All Data".')
        return
      }
      const { getDatabase } = await import('@/lib/db')
      const db = await getDatabase()
      // Map old IDs → new IDs to relink everything
      const wsIdMap: Record<string, string> = {}
      const colIdMap: Record<string, string> = {}
      const now = Date.now()
      for (const ws of data.workspaces) {
        const newId = generateId()
        wsIdMap[ws.id] = newId
        await db.createWorkspace({ ...ws, id: newId, name: `${ws.name} (imported)`, createdAt: now, updatedAt: now })
      }
      for (const col of (data.collections ?? [])) {
        const newId = generateId()
        colIdMap[col.id] = newId
        const newWsId = col.workspaceId ? (wsIdMap[col.workspaceId] ?? col.workspaceId) : undefined
        await db.createCollection({ ...col, id: newId, workspaceId: newWsId })
      }
      for (const req of (data.requests ?? [])) {
        const newColId = req.collectionId ? (colIdMap[req.collectionId] ?? req.collectionId) : undefined
        await db.createRequest({ ...req, id: generateId(), collectionId: newColId })
      }
      for (const env of (data.environments ?? [])) {
        const newWsId = env.workspaceId ? (wsIdMap[env.workspaceId] ?? env.workspaceId) : undefined
        await db.createEnvironment({ ...env, id: generateId(), workspaceId: newWsId, isActive: false })
      }
      for (const sc of (data.socketConfigs ?? [])) {
        const newColId = sc.collectionId ? (colIdMap[sc.collectionId] ?? sc.collectionId) : undefined
        await db.createSocketConfig({ ...sc, id: generateId(), collectionId: newColId })
      }
      for (const seq of (data.sequences ?? [])) {
        const newColId = seq.collectionId ? (colIdMap[seq.collectionId] ?? seq.collectionId) : undefined
        const newWsId = seq.workspaceId ? (wsIdMap[seq.workspaceId] ?? seq.workspaceId) : activeWorkspaceId
        await db.createSequence({ ...seq, id: generateId(), collectionId: newColId, workspaceId: newWsId })
      }
      window.location.reload()
    } catch {
      alert('Failed to import data. Please ensure the file is a valid export.')
    }
  }, [])

  const isLoadingWorkspace = workspaceManagerLoading || workspaceLoading

  if (isLoadingWorkspace && !switchingToName) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading workspace…</p>
        </div>
      </div>
    )
  }

  return (
    <EnvironmentProvider
      activeEnvironment={activeEnvironment}
      onUpdateEnvironment={updateEnvironment}
    >
      <div className="h-screen flex flex-col bg-background">
        {/* Workspace switch overlay — fades in/out */}
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background gap-4 transition-opacity duration-300 pointer-events-none"
          style={{ opacity: isLoadingWorkspace ? 1 : 0 }}
        >
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            {switchingToName ? `Switching to ${switchingToName}…` : 'Loading workspace…'}
          </p>
        </div>

        <TitleBar
          workspaceDropdown={(
            <WorkspaceDropdown
              workspaces={workspaces}
              activeWorkspace={activeWorkspace}
              onSelect={switchWorkspace}
              onCreate={createWorkspace}
              onRename={renameWorkspace}
              onDelete={removeWorkspace}
              onExport={handleExportWorkspace}
              onImport={() => workspaceImportRef.current?.click()}
              onExportAll={handleExportAll}
              onImportAll={() => allDataImportRef.current?.click()}
              onUpdateWorkspace={updateWorkspace}
              getWorkspace={(id) => workspaces.find(w => w.id === id)}
              onLeave={handleLeaveWorkspace}
              onInitFromProject={handleInitFromProject}
            />
          )}
          environments={(
            <EnvironmentSelector
              environments={environments}
              activeEnvironment={activeEnvironment}
              onSelect={setActiveEnvironment}
            />
          )}
          activeWorkspace={activeWorkspace}
          isOwner={isOwner}
          onUpdateWorkspace={updateWorkspace}
          onOpenHelp={() => setIsHelpOpen(true)}
          onSave={activeSocketTabId ? openSaveSocketDialog : openSaveDialog}
          canSave={canWrite && (!!activeTab || !!activeSocketTab)}
          onInviteAccepted={(wsId) => switchWorkspace(wsId)}
          onRefreshWorkspaces={refreshWorkspaces}
          onRequireAuth={requireAuth}
        />

        {updateProgress !== null && (
          <UpdateBar
            progress={updateProgress}
            downloaded={updateDownloaded}
            onInstall={() => onInstallUpdate?.()}
            onDismiss={() => onDismissUpdate?.()}
          />
        )}

        <input
          ref={workspaceImportRef}
          type="file"
          accept=".json"
          multiple
          className="hidden"
          onChange={handleImportWorkspaceFile}
        />
        <input
          ref={allDataImportRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleImportAllFile}
        />


      {/* Main content */}
      <div className="flex flex-col flex-1 min-h-0">
      <>
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Sidebar */}
        <ResizablePanel defaultSize={20} minSize={15} maxSize={35}>
          <Sidebar
            collections={collections}
            requests={requests}
            history={history}
            environments={environments}
            activeEnvironment={activeEnvironment}
            canWrite={canWrite}
            onCreateCollection={canWrite ? createCollection : () => {}}
            onDeleteCollection={canWrite ? removeCollection : () => {}}
            onRenameCollection={canWrite ? (id, name) => updateCollection(id, { name }) : () => {}}
            onReorderCollections={canWrite ? reorderCollections : () => {}}
            onReorderRequests={canWrite ? reorderRequests : () => {}}
            onMoveRequest={canWrite ? (requestId, targetCollectionId) => updateRequest(requestId, { collectionId: targetCollectionId }) : () => {}}
            onOpenRequest={openRequest}
            onDeleteRequest={canWrite ? removeRequest : () => {}}
            onRenameRequest={canWrite ? (id, name) => {
              // Uniqueness is scoped to the request's own collection — the
              // same name is fine in a different collection.
              const target = requests.find(r => r.id === id)
              const siblingNames = requests.filter(r => r.collectionId === target?.collectionId && r.id !== id).map(r => r.name)
              const finalName = uniqueName(name, siblingNames)
              updateRequest(id, { name: finalName })
              tabs.forEach(t => { if (t.requestId === id) updateTab(t.id, { request: { ...t.request, name: finalName }, savedRequest: t.savedRequest ? { ...t.savedRequest, name: finalName } : undefined }) })
              sequences.forEach(seq => {
                const hasMatch = seq.steps.some(s => s.requestId === id)
                if (hasMatch) updateSequence(seq.id, { steps: seq.steps.map(s => s.requestId === id ? { ...s, name: finalName } : s) })
              })
            } : () => {}}
            onRenameSocketConfig={canWrite ? (id, name) => {
              dbUpdateSocketConfig(id, { name })
              setSocketTabs(prev => prev.map(t => t.socketId === id ? { ...t, config: { ...t.config, name } } : t))
            } : () => {}}
            onSaveRequest={() => {}}
            onImportCollection={canWrite ? handleImportCollection : () => {}}
            socketConfigs={socketConfigs}
            onOpenSocketConfig={openSocketConfig}
            onDeleteSocketConfig={canWrite ? removeSocketConfig : () => {}}
            sequenceDragMode={activeView === 'sequences'}
            onOpenHistoryEntry={openHistoryEntry}
            onDeleteHistoryEntry={canWrite ? removeHistoryEntry : () => {}}
            onClearHistory={canWrite ? clearHistory : () => {}}
            onCreateEnvironment={canWrite ? createEnvironment : () => {}}
            onImportEnvironment={canWrite ? importEnvironment : () => {}}
            onDeleteEnvironment={canWrite ? removeEnvironment : () => {}}
            onUpdateEnvironment={canWrite ? updateEnvironment : () => {}}
            onSetActiveEnvironment={setActiveEnvironment}
          />
        </ResizablePanel>

        <ResizableHandle className="w-px bg-border" />

        {/* Request/Response area */}
        <ResizablePanel defaultSize={80}>
          <div className="flex flex-col h-full">

            {activeView === 'sequences' ? (
              <SequenceBuilder
                sequences={sequences}
                workspaceId={safeWorkspaceId}
                onCreateSequence={createSequence}
                onUpdateSequence={(id, data) => {
                  updateSequence(id, data)
                  // If the name changed, propagate it to any step in other sequences referencing this one
                  if (data.name !== undefined) {
                    sequences.forEach(seq => {
                      if (seq.id === id) return
                      const hasMatch = seq.steps.some(s => s.type === 'sequence' && s.sequenceId === id)
                      if (hasMatch) updateSequence(seq.id, { steps: seq.steps.map(s => s.type === 'sequence' && s.sequenceId === id ? { ...s, name: data.name! } : s) })
                    })
                  }
                }}
                onDeleteSequence={removeSequence}
                onRunSequence={executeSequence}
                onStopSequence={stopSequence}
                runningSequenceId={runningSequenceId}
                stepResults={stepResults}
              />
            ) : activeView === 'jwt' ? (
              <JwtDecoder token={jwtToken} onTokenChange={setJwtToken} />
            ) : activeView === 'json' ? (
              <JsonFormatter input={jsonInput} onInputChange={setJsonInput} />
            ) : activeView === 'diff' ? (
              <TextDiff text1={diffText1} onText1Change={setDiffText1} text2={diffText2} onText2Change={setDiffText2} />
            ) : (
            <>
            {/* Tab bar */}
            <TabBar
              tabs={tabs}
              socketTabs={socketTabs}
              tabOrder={tabOrder}
              activeTabId={activeSocketTab ? activeSocketTabId : activeTabId}
              flashTabId={flashTabId}
              onSelectTab={handleSelectTab}
              onCloseTab={handleUnifiedCloseTab}
              onNewTab={() => { setActiveSocketTabId(null); createTab() }}
              onNewSocketTab={(protocol) => createSocketTab(undefined, protocol)}
              onReorderTabs={reorderTabs}
              onReorderTabOrder={setTabOrder}
            />

            {/* Socket view (full panel, no split) */}
            {activeSocketTab ? (
              <div className="flex-1 min-h-0">
                <SocketBuilder
                  config={activeSocketTab.config}
                  messages={activeSocketTab.messages}
                  connectionStatus={activeSocketTab.connectionStatus}
                  onUpdate={(updates) => updateSocketConfig(activeSocketTab.id, updates)}
                  onConnect={() => connectSocket(activeSocketTab.id)}
                  onDisconnect={() => disconnectSocket(activeSocketTab.id)}
                  onSendMessage={(event, data, type, ack) => sendSocketMessage(activeSocketTab.id, event, data, type, ack)}
                  onClearMessages={() => updateSocketTab(activeSocketTab.id, { messages: [] })}
                  readOnly={!canWrite}
                />
              </div>
            ) : !activeTab ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-6 text-muted-foreground">
                <p className="text-sm">Open a new tab to get started</p>
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={() => { setActiveSocketTabId(null); createTab() }}>
                    <KeyRound className="h-4 w-4 mr-2" />
                    New Request
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setActiveSocketTabId(null); createSocketTab(undefined, 'ws') }}>
                    <Braces className="h-4 w-4 mr-2" />
                    WebSocket
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setActiveSocketTabId(null); createSocketTab(undefined, 'socketio') }}>
                    <Braces className="h-4 w-4 mr-2" />
                    Socket.IO
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {/* URL bar — spans full width above the split */}
                <UrlBar
                  request={activeTab.request}
                  onMethodChange={(method) => updateActiveRequest({ method })}
                  onUrlChange={(url) => {
                    const { search } = splitUrl(url)
                    const params = searchToParams(search, activeTab.request.params)
                    updateActiveRequest({ url, params })
                  }}
                  onCurlImport={updateActiveRequest}
                  onSend={executeRequest}
                  onCancel={cancelRequest}
                  isLoading={isLoading}
                  readOnly={!canWrite || !!activeTab.isHistorical}
                />

                {/* Request tabs and response viewer split */}
                <ResizablePanelGroup
                  key={responseLayout}
                  direction={responseLayout === 'side' ? 'horizontal' : 'vertical'}
                  className="flex-1"
                >
                  <ResizablePanel defaultSize={50} minSize={30}>
                    <RequestBuilder
                      request={activeTab.request}
                      onUpdate={updateActiveRequest}
                      onSend={executeRequest}
                      isLoading={isLoading}
                      hideUrlBar
                      readOnly={!canWrite || !!activeTab.isHistorical}
                      activeRequestTab={requestTabMap[activeTabId!] ?? 'params'}
                      onRequestTabChange={(tab) => setRequestTabMap(prev => ({ ...prev, [activeTabId!]: tab }))}
                    />
                  </ResizablePanel>

                  <ResizableHandle className={responseLayout === 'side' ? 'w-px bg-border' : 'h-px bg-border'} />

                  <ResizablePanel defaultSize={50} minSize={20}>
                    <ResponseViewer
                      response={activeTab?.response || null}
                      isLoading={isLoading}
                      historyTimestamp={activeTab?.historyTimestamp}
                      scrollResetKey={scrollResetKey}
                    />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </>
            )}
            </>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
      </>
      </div>

      {/* Bottom bar — always visible across all modes */}
      <div className="flex items-center gap-2 px-3 h-7 border-t border-border bg-card shrink-0 overflow-hidden">
        {/* Left: Appearance + version — never shrink */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setIsSettingsOpen(o => !o)}
            title="Appearance settings"
            className={`flex items-center gap-1.5 px-2 h-5 rounded text-xs transition-colors ${
              isSettingsOpen
                ? 'text-foreground bg-accent/20'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/20'
            }`}
          >
            <Settings2 className="h-3.5 w-3.5 shrink-0" />
            <span>Appearance</span>
          </button>
          <span className="text-xs text-muted-foreground/40 select-none">v{version}</span>
        </div>

        {/* Spacer pushes right group to the end */}
        <div className="flex-1" />

        {/* Right: view switcher — shrinks but clips cleanly */}
        <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setActiveView('requests')}
              title="Requests"
              className={`flex items-center gap-1.5 px-2 h-5 rounded text-xs transition-colors ${
                activeView === 'requests'
                  ? 'text-foreground bg-accent/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/20'
              }`}
            >
              <PanelRight className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Requests</span>
            </button>
            <button
              onClick={() => setActiveView('sequences')}
              title="Sequences"
              className={`flex items-center gap-1.5 px-2 h-5 rounded text-xs transition-colors ${
                activeView === 'sequences'
                  ? 'text-foreground bg-accent/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/20'
              }`}
            >
              <ListOrdered className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Sequences</span>
            </button>
            <button
              onClick={() => setActiveView('jwt')}
              title="JWT Decoder"
              className={`flex items-center gap-1.5 px-2 h-5 rounded text-xs transition-colors ${
                activeView === 'jwt'
                  ? 'text-foreground bg-accent/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/20'
              }`}
            >
              <KeyRound className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">JWT</span>
            </button>
            <button
              onClick={() => setActiveView('json')}
              title="JSON Formatter"
              className={`flex items-center gap-1.5 px-2 h-5 rounded text-xs transition-colors ${
                activeView === 'json'
                  ? 'text-foreground bg-accent/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/20'
              }`}
            >
              <Braces className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">JSON</span>
            </button>
            <button
              onClick={() => setActiveView('diff')}
              title="Text Compare"
              className={`flex items-center gap-1.5 px-2 h-5 rounded text-xs transition-colors ${
                activeView === 'diff'
                  ? 'text-foreground bg-accent/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/20'
              }`}
            >
              <GitCompare className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Diff</span>
            </button>
            <button
              onClick={() => setResponseLayout(l => l === 'side' ? 'bottom' : 'side')}
              title={responseLayout === 'side' ? 'Move response to bottom' : 'Move response to side'}
              className="flex items-center gap-1.5 px-2 h-5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors"
            >
              {responseLayout === 'side'
                ? <PanelBottom className="h-3.5 w-3.5 shrink-0" />
                : <PanelRight className="h-3.5 w-3.5 shrink-0" />}
              <span className="hidden md:inline">{responseLayout === 'side' ? 'Response to bottom' : 'Response to side'}</span>
            </button>
          </div>
      </div>

      {/* Workspace / connectivity strip */}
      {!isOnline && (
        <div className="flex items-center justify-center gap-2 px-3 h-6 bg-red-500/15 border-t border-red-500/30 shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
          <span className="text-xs text-red-400">No internet connection — changes may not sync until you reconnect.</span>
        </div>
      )}

      <SettingsPanel open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <HelpPanel open={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
      {inviteDialogWorkspace && (
        <WorkspaceInviteDialog
          open={!!inviteDialogWorkspace}
          onOpenChange={open => { if (!open) setInviteDialogWorkspace(null) }}
          workspace={inviteDialogWorkspace}
          onUpdateWorkspace={updateWorkspace}
        />
      )}

      {quickInviteWorkspace && (
        <WorkspaceQuickInviteDialog
          open={!!quickInviteWorkspace}
          onOpenChange={open => { if (!open) setQuickInviteWorkspace(null) }}
          workspace={quickInviteWorkspace}
          onUpdateWorkspace={updateWorkspace}
        />
      )}

      <LoginDialog
        open={!!loginPrompt}
        onOpenChange={open => { if (!open) setLoginPrompt(null) }}
        reason={loginPrompt?.reason}
        onSuccess={() => { loginPrompt?.onAuthed?.(); setLoginPrompt(null) }}
      />

      {/* Save Request Dialog */}
      <Dialog open={isSaveDialogOpen} onOpenChange={setIsSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Request Name</label>
              <Input
                value={saveRequestName}
                onChange={(e) => setSaveRequestName(e.target.value)}
                placeholder="Enter request name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Collection</label>
              {collections.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No collections yet. Create a collection first.
                </p>
              ) : (
                <Select value={saveCollectionId} onValueChange={setSaveCollectionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a collection" />
                  </SelectTrigger>
                  <SelectContent>
                    {collections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={saveCurrentRequest}
              disabled={!saveCollectionId || !saveRequestName.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save Socket Dialog */}
      <Dialog open={isSaveSocketDialogOpen} onOpenChange={setIsSaveSocketDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Socket Connection</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={saveSocketName}
                onChange={(e) => setSaveSocketName(e.target.value)}
                placeholder="Enter connection name"
                onKeyDown={(e) => e.key === 'Enter' && saveCurrentSocket()}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Collection</label>
              {collections.length === 0 ? (
                <p className="text-sm text-muted-foreground">No collections yet. Create a collection first.</p>
              ) : (
                <Select value={saveSocketCollectionId} onValueChange={setSaveSocketCollectionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a collection" />
                  </SelectTrigger>
                  <SelectContent>
                    {collections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSaveSocketDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveCurrentSocket} disabled={!saveSocketCollectionId || !saveSocketName.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close confirmation dialog for unsaved tabs */}
      <Dialog
        open={isCloseConfirmOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsCloseConfirmOpen(false)
            setPendingCloseTabId(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This request has unsaved changes. Save it to a collection before closing, or discard the changes.
          </p>
          <div className="space-y-3 pt-1">
            <div className="space-y-2">
              <label className="text-sm font-medium">Request Name</label>
              <Input
                value={saveRequestName}
                onChange={(e) => setSaveRequestName(e.target.value)}
                placeholder="Enter request name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Collection</label>
              {collections.length === 0 ? (
                <p className="text-sm text-muted-foreground">No collections yet. Create a collection first.</p>
              ) : (
                <Select value={saveCollectionId} onValueChange={setSaveCollectionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a collection" />
                  </SelectTrigger>
                  <SelectContent>
                    {collections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsCloseConfirmOpen(false)
                setPendingCloseTabId(null)
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (pendingCloseTabId) {
                  const remainingHttpTabs = tabs.filter(t => t.id !== pendingCloseTabId)
                  await closeTab(pendingCloseTabId)
                  setPendingCloseTabId(null)
                  setIsCloseConfirmOpen(false)
                  if (remainingHttpTabs.length === 0 && socketTabs.length > 0) {
                    const lastSocket = tabOrder.filter(e => e.kind === 'socket').at(-1)
                    const target = lastSocket ? socketTabs.find(t => t.id === lastSocket.id) : socketTabs[socketTabs.length - 1]
                    if (target) setActiveSocketTabId(target.id)
                  }
                }
              }}
            >
              Discard
            </Button>
            <Button
              onClick={saveCurrentRequest}
              disabled={!saveCollectionId || !saveRequestName.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close confirmation dialog for unsaved socket tabs */}
      <Dialog
        open={isSocketCloseConfirmOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsSocketCloseConfirmOpen(false)
            setPendingCloseSocketTabId(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This socket has unsaved changes. Save it to a collection before closing, or discard the changes.
          </p>
          <div className="space-y-3 pt-1">
            <div className="space-y-2">
              <label className="text-sm font-medium">Socket Name</label>
              <Input
                value={saveSocketName}
                onChange={(e) => setSaveSocketName(e.target.value)}
                placeholder="Enter socket name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Collection</label>
              {collections.length === 0 ? (
                <p className="text-sm text-muted-foreground">No collections yet. Create a collection first.</p>
              ) : (
                <Select value={saveSocketCollectionId} onValueChange={setSaveSocketCollectionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a collection" />
                  </SelectTrigger>
                  <SelectContent>
                    {collections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsSocketCloseConfirmOpen(false)
                setPendingCloseSocketTabId(null)
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingCloseSocketTabId) {
                  closeSocketTab(pendingCloseSocketTabId)
                  setPendingCloseSocketTabId(null)
                  setIsSocketCloseConfirmOpen(false)
                }
              }}
            >
              Discard
            </Button>
            <Button
              disabled={!saveSocketCollectionId || !saveSocketName.trim()}
              onClick={async () => {
                if (!pendingCloseSocketTabId) return
                const tab = socketTabs.find(t => t.id === pendingCloseSocketTabId)
                if (!tab || !saveSocketCollectionId || !saveSocketName.trim()) return
                const config: SocketConfig = { ...tab.config, name: saveSocketName.trim(), collectionId: saveSocketCollectionId, updatedAt: Date.now() }
                try {
                  if (tab.socketId) {
                    await dbUpdateSocketConfig(tab.socketId, config)
                  } else {
                    await createSocketConfig(config)
                  }
                  await refreshSocketConfigs()
                } catch (e) {
                  console.error('[saveSocketOnClose] failed', e)
                }
                closeSocketTab(pendingCloseSocketTabId)
                setPendingCloseSocketTabId(null)
                setIsSocketCloseConfirmOpen(false)
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sequence missing requests dialog */}
      <Dialog open={sequenceMissingRequests.length > 0} onOpenChange={(o) => { if (!o) setSequenceMissingRequests([]) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sequence has deleted requests</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-3">
            The following steps reference requests that no longer exist. Remove or replace them before running.
          </p>
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {sequenceMissingRequests.map((m, i) => (
              <div key={i} className="rounded-md bg-destructive/10 px-3 py-2">
                <p className="text-sm font-medium text-destructive">{m.stepName}</p>
                <p className="text-xs text-muted-foreground">{m.path}</p>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => setSequenceMissingRequests([])}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deleted workspace / environment notice */}
      <Dialog open={!!deletedNotice} onOpenChange={(o) => { if (!o) setDeletedNotice(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {deletedNotice?.type === 'workspace' ? 'Workspace deleted' : 'Environment deleted'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deletedNotice?.type === 'workspace'
              ? `The workspace "${deletedNotice.name}" was deleted or you were removed from it. You've been switched to another workspace.`
              : `The environment "${deletedNotice?.name}" was deleted and has been deactivated.`}
          </p>
          <DialogFooter>
            <Button onClick={() => setDeletedNotice(null)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save conflict dialog */}
      <Dialog open={!!conflictRequest} onOpenChange={(o) => { if (!o) setConflictRequest(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save conflict</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Someone else saved this request after you opened it. Do you want to overwrite their changes with yours, or discard yours and reload theirs?
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConflictRequest(null)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (!activeTab || !conflictRequest) return
                await updateTab(activeTab.id, {
                  request: conflictRequest,
                  savedRequest: conflictRequest,
                  isDirty: false,
                  serverUpdatedAt: conflictRequest.updatedAt,
                })
                await refreshRequests()
                setConflictRequest(null)
              }}
            >
              Discard mine
            </Button>
            <Button
              onClick={async () => {
                if (!activeTab || !conflictRequest) return
                const updated = { ...activeTab.request, updatedAt: Date.now() }
                await updateRequest(activeTab.requestId!, updated)
                await updateTab(activeTab.id, { request: updated, savedRequest: updated, isDirty: false, serverUpdatedAt: updated.updatedAt })
                await refreshRequests()
                setConflictRequest(null)
              }}
            >
              Overwrite theirs
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Socket config save conflict dialog */}
      <Dialog open={!!conflictSocketConfig} onOpenChange={(o) => { if (!o) setConflictSocketConfig(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save conflict</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Someone else saved this socket config after you opened it. Do you want to overwrite their changes with yours, or discard yours and reload theirs?
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConflictSocketConfig(null)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (!activeSocketTab || !conflictSocketConfig) return
                setSocketTabs(prev => prev.map(t =>
                  t.id === activeSocketTab.id ? {
                    ...t,
                    config: conflictSocketConfig,
                    isDirty: false,
                    serverUpdatedAt: conflictSocketConfig.updatedAt,
                  } : t
                ))
                setConflictSocketConfig(null)
              }}
            >
              Discard mine
            </Button>
            <Button
              onClick={async () => {
                if (!activeSocketTab || !conflictSocketConfig) return
                const updated = { ...activeSocketTab.config, updatedAt: Date.now() }
                await dbUpdateSocketConfig(activeSocketTab.socketId!, updated)
                await refreshSocketConfigs()
                setSocketTabs(prev => prev.map(t =>
                  t.id === activeSocketTab.id ? {
                    ...t,
                    config: updated,
                    isDirty: false,
                    serverUpdatedAt: updated.updatedAt,
                  } : t
                ))
                setConflictSocketConfig(null)
              }}
            >
              Overwrite theirs
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </EnvironmentProvider>
  )
}
