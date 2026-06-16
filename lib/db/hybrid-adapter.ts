import type { DatabaseAdapter } from './index'
import type {
  Workspace, Collection, RequestConfig, SocketConfig,
  HistoryEntry, Environment, WorkspaceState, Sequence, WorkspaceMember,
} from './types'

// Compare two member lists ignoring order. Returns true when both lists contain
// the same members with the same permission (the only fields that affect access).
export function membersEqual(a: WorkspaceMember[] = [], b: WorkspaceMember[] = []): boolean {
  if (a.length !== b.length) return false
  const key = (m: WorkspaceMember) => `${m.userId}:${m.permission}`
  const sa = a.map(key).sort()
  const sb = b.map(key).sort()
  return sa.every((v, i) => v === sb[i])
}

// Routes workspace-scoped calls to REST (shared workspaces with members)
// or SQLite via IPC (personal workspaces with no members).
export class HybridAdapter implements DatabaseAdapter {
  userId: string = ''

  private _sqlite: DatabaseAdapter | null = null
  private _rest: DatabaseAdapter | null = null
  // Cache of workspaceId → isShared so we don't re-fetch on every call
  private _sharedCache = new Map<string, boolean>()
  // Workspaces explicitly deleted by the user — excluded from remote re-seeding
  private _deletedWorkspaceIds = new Set<string>()

  async init(): Promise<void> {
    const [{ PostgresAdapter }, { RestAdapter }] = await Promise.all([
      import('./postgres-adapter'),
      import('./rest-adapter'),
    ])
    this._sqlite = new PostgresAdapter()
    this._rest   = new RestAdapter()
    this._rest.userId   = this.userId
    this._sqlite.userId = this.userId
    await Promise.all([this._sqlite.init(), this._rest.init()])
  }

  private get sqlite(): DatabaseAdapter {
    if (!this._sqlite) throw new Error('HybridAdapter not initialised')
    return this._sqlite
  }
  private get rest(): DatabaseAdapter {
    if (!this._rest) throw new Error('HybridAdapter not initialised')
    return this._rest
  }

  // Determine which adapter to use for a given workspace
  private async adapterFor(workspaceId: string): Promise<DatabaseAdapter> {
    if (this._sharedCache.has(workspaceId)) {
      return this._sharedCache.get(workspaceId) ? this.rest : this.sqlite
    }
    // Look up the workspace in SQLite first (it holds all workspace metadata locally)
    const ws = await this.sqlite.getWorkspaces()
    const found = ws.find(w => w.id === workspaceId)
    const isCloud = found ? (found.isSynced === true || (found.members?.length ?? 0) > 0) : false
    this._sharedCache.set(workspaceId, isCloud)
    return isCloud ? this.rest : this.sqlite
  }

  // Invalidate the cache when workspace membership changes
  invalidateWorkspace(workspaceId: string) {
    this._sharedCache.delete(workspaceId)
  }

  // ── Workspaces ──────────────────────────────────────────────────────────────
  // Workspaces list always comes from both and is merged (local + shared)
  async getWorkspaces(): Promise<Workspace[]> {
    const [local, remote] = await Promise.all([
      this.sqlite.getWorkspaces(),
      this.rest.getWorkspaces().catch(() => [] as Workspace[]),
    ])

    const localIds = new Set(local.map(w => w.id))

    // Seed SQLite with any remote workspace the user joined but doesn't have locally yet.
    // This happens when an invitee accepts an invite — the workspace lives on the server.
    for (const w of remote) {
      if (this._deletedWorkspaceIds.has(w.id)) continue
      if (!localIds.has(w.id)) {
        await this.sqlite.createWorkspace({ ...w, isSynced: true }).catch(() => {})
      } else {
        // Keep local copy in sync with remote membership info. Compare members
        // order-independently — the server may return them in a different order,
        // and an order-sensitive check would trigger a redundant local write on
        // every poll.
        const remoteMembers = w.members
        const localW = local.find(l => l.id === w.id)
        const membersChanged = !!localW && !membersEqual(localW.members, remoteMembers)
        const nameChanged = !!localW && localW.name !== w.name
        if (localW && (membersChanged || nameChanged || !localW.isSynced)) {
          await this.sqlite.updateWorkspace(w.id, { members: remoteMembers, name: w.name, isSynced: true }).catch(() => {})
        }
      }
      // Update shared cache
      this._sharedCache.set(w.id, true)
    }

    // Merge: remote data takes precedence for shared workspaces
    const map = new Map<string, Workspace>()
    for (const w of local)  if (!this._deletedWorkspaceIds.has(w.id)) map.set(w.id, w)
    for (const w of remote) if (!this._deletedWorkspaceIds.has(w.id)) map.set(w.id, { ...w, isSynced: true })
    return [...map.values()].sort((a, b) => a.createdAt - b.createdAt)
  }

  async createWorkspace(ws: Workspace): Promise<void> {
    // New workspace starts as personal — only create locally
    await this.sqlite.createWorkspace(ws)
  }

  async updateWorkspace(id: string, data: Partial<Workspace>): Promise<void> {
    const wasShared = this._sharedCache.get(id) ?? false
    const adapter = await this.adapterFor(id)
    await adapter.updateWorkspace(id, data)

    if (data.members !== undefined) {
      this.invalidateWorkspace(id)
      const nowShared = (data.members?.length ?? 0) > 0
      // Workspace just transitioned from personal → shared: push everything to remote
      if (!wasShared && nowShared) {
        const ws = (await this.sqlite.getWorkspaces()).find(w => w.id === id)
        if (ws) await this._syncLocalToRemote({ ...ws, ...data }).catch(console.error)
      }
    }
  }

  // Push a workspace and all its data from SQLite → REST API (public so callers can trigger on first invite)
  async syncWorkspaceToRemote(workspaceId: string): Promise<void> {
    const ws = (await this.sqlite.getWorkspaces()).find(w => w.id === workspaceId)
    if (ws) {
      await this._syncLocalToRemote(ws)
      await this.sqlite.updateWorkspace(workspaceId, { isSynced: true })
      this._sharedCache.set(workspaceId, true)
    }
  }

  private async _syncLocalToRemote(ws: Workspace): Promise<void> {
    // 1. Upsert the workspace itself
    try {
      await this.rest.createWorkspace(ws)
    } catch {
      // Already exists on the server — update it instead
      await this.rest.updateWorkspace(ws.id, ws).catch(() => {})
    }

    // 2. Collections
    const collections = await this.sqlite.getCollections(ws.id)
    for (const col of collections) {
      try { await this.rest.createCollection(col) } catch { /* already there */ }

      // 3. Requests in each collection
      const requests = await this.sqlite.getRequests(col.id)
      for (const req of requests) {
        try { await this.rest.createRequest(req) } catch { /* already there */ }
      }

      // 4. Socket configs in each collection
      const sockets = await this.sqlite.getSocketConfigs(col.id)
      for (const s of sockets) {
        try { await this.rest.createSocketConfig(s) } catch { /* already there */ }
      }
    }

    // 5. Sequences
    const sequences = await this.sqlite.getSequences(ws.id)
    for (const seq of sequences) {
      try { await this.rest.createSequence(seq) } catch { /* already there */ }
    }

    // 6. Environments
    const envs = await this.sqlite.getEnvironments(ws.id)
    for (const env of envs) {
      try { await this.rest.createEnvironment(env) } catch { /* already there */ }
    }

    // 7. History (best-effort — not critical)
    const history = await this.sqlite.getHistory(ws.id, 100)
    for (const entry of history) {
      try { await this.rest.addToHistory(entry) } catch { /* already there */ }
    }
  }

  async deleteWorkspace(id: string): Promise<void> {
    this._deletedWorkspaceIds.add(id)
    // Delete from both adapters so a stale remote copy can't re-seed SQLite
    await Promise.all([
      this.sqlite.deleteWorkspace(id).catch(() => {}),
      this.rest.deleteWorkspace(id).catch(() => {}),
    ])
    this.invalidateWorkspace(id)
  }

  // Remove a workspace from local SQLite only — used after leaving a shared workspace
  async removeWorkspaceLocally(id: string): Promise<void> {
    await this.sqlite.deleteWorkspace(id).catch(() => {})
    this.invalidateWorkspace(id)
  }

  // ── Collections ─────────────────────────────────────────────────────────────
  async getCollections(workspaceId?: string): Promise<Collection[]> {
    if (!workspaceId) return this.sqlite.getCollections()
    return (await this.adapterFor(workspaceId)).getCollections(workspaceId)
  }
  async getCollection(id: string): Promise<Collection | undefined> {
    // Try SQLite first, fall back to REST
    return await this.sqlite.getCollection(id) ?? this.rest.getCollection(id)
  }
  async createCollection(c: Collection): Promise<void> {
    const adapter = c.workspaceId ? await this.adapterFor(c.workspaceId) : this.sqlite
    await adapter.createCollection(c)
  }
  async updateCollection(id: string, data: Partial<Collection>): Promise<void> {
    const col = await this.getCollection(id)
    const adapter = col?.workspaceId ? await this.adapterFor(col.workspaceId) : this.sqlite
    await adapter.updateCollection(id, data)
  }
  async deleteCollection(id: string): Promise<void> {
    const col = await this.getCollection(id)
    const adapter = col?.workspaceId ? await this.adapterFor(col.workspaceId) : this.sqlite
    await adapter.deleteCollection(id)
  }

  // ── Requests ────────────────────────────────────────────────────────────────
  async getRequests(collectionId?: string): Promise<RequestConfig[]> {
    if (!collectionId) {
      // Merge local + remote, remote takes precedence (same pattern as workspaces)
      const [local, remote] = await Promise.all([
        this.sqlite.getRequests(),
        this.rest.getRequests().catch(() => [] as RequestConfig[]),
      ])
      const map = new Map<string, RequestConfig>()
      for (const r of local)  map.set(r.id, r)
      for (const r of remote) map.set(r.id, r)
      return [...map.values()]
    }
    const col = await this.getCollection(collectionId)
    const adapter = col?.workspaceId ? await this.adapterFor(col.workspaceId) : this.sqlite
    return adapter.getRequests(collectionId)
  }
  async getRequest(id: string): Promise<RequestConfig | undefined> {
    const local = await this.sqlite.getRequest(id)
    if (!local) return this.rest.getRequest(id).catch(() => undefined)
    // For cloud workspaces, always fetch from REST to get the authoritative updatedAt
    const col = local.collectionId ? await this.getCollection(local.collectionId) : undefined
    if (col?.workspaceId) {
      const isCloud = await this.adapterFor(col.workspaceId).then(a => a === this.rest)
      if (isCloud) return this.rest.getRequest(id).catch(() => local)
    }
    return local
  }
  async createRequest(r: RequestConfig): Promise<void> {
    const col = r.collectionId ? await this.getCollection(r.collectionId) : undefined
    const adapter = col?.workspaceId ? await this.adapterFor(col.workspaceId) : this.sqlite
    await adapter.createRequest(r)
  }
  async updateRequest(id: string, data: Partial<RequestConfig>): Promise<void> {
    const req = await this.getRequest(id)
    const col = req?.collectionId ? await this.getCollection(req.collectionId) : undefined
    const adapter = col?.workspaceId ? await this.adapterFor(col.workspaceId) : this.sqlite
    await adapter.updateRequest(id, data)
  }
  async deleteRequest(id: string): Promise<void> {
    const req = await this.getRequest(id)
    const col = req?.collectionId ? await this.getCollection(req.collectionId) : undefined
    const adapter = col?.workspaceId ? await this.adapterFor(col.workspaceId) : this.sqlite
    await adapter.deleteRequest(id)
  }

  // ── Socket configs ───────────────────────────────────────────────────────────
  async getSocketConfigs(collectionId?: string): Promise<SocketConfig[]> {
    if (!collectionId) {
      const [local, remote] = await Promise.all([
        this.sqlite.getSocketConfigs(),
        this.rest.getSocketConfigs().catch(() => [] as SocketConfig[]),
      ])
      const map = new Map<string, SocketConfig>()
      for (const s of local)  map.set(s.id, s)
      for (const s of remote) map.set(s.id, s)
      return [...map.values()]
    }
    const col = await this.getCollection(collectionId)
    const adapter = col?.workspaceId ? await this.adapterFor(col.workspaceId) : this.sqlite
    return adapter.getSocketConfigs(collectionId)
  }
  async createSocketConfig(c: SocketConfig): Promise<void> {
    const col = c.collectionId ? await this.getCollection(c.collectionId) : undefined
    const adapter = col?.workspaceId ? await this.adapterFor(col.workspaceId) : this.sqlite
    await adapter.createSocketConfig(c)
  }
  async updateSocketConfig(id: string, data: Partial<SocketConfig>): Promise<void> {
    const all = await this.getSocketConfigs()
    const sc = all.find(s => s.id === id)
    const collectionId = sc?.collectionId ?? (data as Partial<SocketConfig>).collectionId
    const col = collectionId ? await this.getCollection(collectionId) : undefined
    const adapter = col?.workspaceId ? await this.adapterFor(col.workspaceId) : this.sqlite
    await adapter.updateSocketConfig(id, data)
  }
  async deleteSocketConfig(id: string): Promise<void> {
    const all = await this.getSocketConfigs()
    const sc = all.find(s => s.id === id)
    const col = sc?.collectionId ? await this.getCollection(sc.collectionId) : undefined
    const adapter = col?.workspaceId ? await this.adapterFor(col.workspaceId) : this.sqlite
    await adapter.deleteSocketConfig(id)
  }

  // ── History ──────────────────────────────────────────────────────────────────
  async getHistory(workspaceId?: string, limit?: number): Promise<HistoryEntry[]> {
    if (!workspaceId) return this.sqlite.getHistory(undefined, limit)
    return (await this.adapterFor(workspaceId)).getHistory(workspaceId, limit)
  }
  async addToHistory(entry: HistoryEntry): Promise<void> {
    const adapter = entry.workspaceId ? await this.adapterFor(entry.workspaceId) : this.sqlite
    await adapter.addToHistory(entry)
  }
  async clearHistory(workspaceId?: string): Promise<void> {
    if (!workspaceId) return this.sqlite.clearHistory()
    return (await this.adapterFor(workspaceId)).clearHistory(workspaceId)
  }
  async deleteHistoryEntry(id: string): Promise<void> {
    const all = [...await this.sqlite.getHistory(), ...await this.rest.getHistory().catch(() => [])]
    const entry = all.find(h => h.id === id)
    const adapter = entry?.workspaceId ? await this.adapterFor(entry.workspaceId) : this.sqlite
    await adapter.deleteHistoryEntry(id)
  }

  // ── Environments ─────────────────────────────────────────────────────────────
  async getEnvironments(workspaceId?: string): Promise<Environment[]> {
    if (!workspaceId) return this.sqlite.getEnvironments()
    return (await this.adapterFor(workspaceId)).getEnvironments(workspaceId)
  }
  async getEnvironment(id: string): Promise<Environment | undefined> {
    return await this.sqlite.getEnvironment(id) ?? this.rest.getEnvironment(id)
  }
  async createEnvironment(env: Environment): Promise<void> {
    const adapter = env.workspaceId ? await this.adapterFor(env.workspaceId) : this.sqlite
    await adapter.createEnvironment(env)
  }
  async updateEnvironment(id: string, data: Partial<Environment>): Promise<void> {
    const env = await this.getEnvironment(id)
    const adapter = env?.workspaceId ? await this.adapterFor(env.workspaceId) : this.sqlite
    await adapter.updateEnvironment(id, data)
  }
  async deleteEnvironment(id: string): Promise<void> {
    const env = await this.getEnvironment(id)
    const adapter = env?.workspaceId ? await this.adapterFor(env.workspaceId) : this.sqlite
    await adapter.deleteEnvironment(id)
  }
  async setActiveEnvironment(id: string | null, workspaceId?: string): Promise<void> {
    if (!workspaceId) return this.sqlite.setActiveEnvironment(id)
    return (await this.adapterFor(workspaceId)).setActiveEnvironment(id, workspaceId)
  }

  // ── Sequences ────────────────────────────────────────────────────────────────
  async getSequences(workspaceId?: string): Promise<Sequence[]> {
    if (!workspaceId) {
      const [local, remote] = await Promise.all([
        this.sqlite.getSequences(),
        this.rest.getSequences().catch(() => [] as Sequence[]),
      ])
      const map = new Map<string, Sequence>()
      for (const s of local)  map.set(s.id, s)
      for (const s of remote) map.set(s.id, s)
      return [...map.values()]
    }
    return (await this.adapterFor(workspaceId)).getSequences(workspaceId)
  }
  async createSequence(s: Sequence): Promise<void> {
    const adapter = s.workspaceId ? await this.adapterFor(s.workspaceId) : this.sqlite
    await adapter.createSequence(s)
  }
  async updateSequence(id: string, data: Partial<Sequence>): Promise<void> {
    const all = await this.getSequences()
    const seq = all.find(s => s.id === id)
    const workspaceId = seq?.workspaceId ?? (data as Partial<Sequence>).workspaceId
    const adapter = workspaceId ? await this.adapterFor(workspaceId) : this.sqlite
    await adapter.updateSequence(id, data)
  }
  async deleteSequence(id: string): Promise<void> {
    const all = await this.getSequences()
    const seq = all.find(s => s.id === id)
    const adapter = seq?.workspaceId ? await this.adapterFor(seq.workspaceId) : this.sqlite
    await adapter.deleteSequence(id)
  }

  // ── Workspace state ───────────────────────────────────────────────────────────
  // Tab state is always local (each user has their own tabs)
  async getWorkspaceState(workspaceId: string): Promise<WorkspaceState | undefined> {
    return this.sqlite.getWorkspaceState(workspaceId)
  }
  async saveWorkspaceState(workspaceId: string, state: WorkspaceState): Promise<void> {
    return this.sqlite.saveWorkspaceState(workspaceId, state)
  }
}
