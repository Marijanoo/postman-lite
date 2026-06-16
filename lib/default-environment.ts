import type { Environment, EnvironmentVariable } from './db/types'

// The "No Environment" default. It behaves like a real environment — selectable,
// with editable variables that persist — but it is NOT a database row: it never
// syncs to the cloud and is excluded from export. Its variables live in
// localStorage, keyed per workspace.
export const DEFAULT_ENV_ID = '__default__'
export const DEFAULT_ENV_NAME = 'Default Environment'

const STORE_KEY = 'quence-default-env-vars'
// Key used for the workspace-less (no active workspace) case.
const NO_WORKSPACE = '__none__'

type Store = Record<string, EnvironmentVariable[]>

function readStore(): Store {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as Store) : {}
  } catch {
    return {}
  }
}

function writeStore(store: Store): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {
    /* ignore quota / serialization errors */
  }
}

export function isDefaultEnv(id: string | null | undefined): boolean {
  return id === DEFAULT_ENV_ID
}

export function getDefaultEnvVariables(workspaceId?: string | null): EnvironmentVariable[] {
  return readStore()[workspaceId ?? NO_WORKSPACE] ?? []
}

export function setDefaultEnvVariables(
  workspaceId: string | null | undefined,
  variables: EnvironmentVariable[],
): void {
  const store = readStore()
  store[workspaceId ?? NO_WORKSPACE] = variables
  writeStore(store)
}

// Build the synthetic Environment object the rest of the app consumes.
export function makeDefaultEnvironment(
  workspaceId: string | null | undefined,
  isActive: boolean,
): Environment {
  return {
    id: DEFAULT_ENV_ID,
    name: DEFAULT_ENV_NAME,
    variables: getDefaultEnvVariables(workspaceId),
    isActive,
    workspaceId: workspaceId ?? undefined,
    createdAt: 0,
    updatedAt: 0,
  }
}
