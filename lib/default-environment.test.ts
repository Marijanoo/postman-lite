import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DEFAULT_ENV_ID,
  DEFAULT_ENV_NAME,
  isDefaultEnv,
  getDefaultEnvVariables,
  setDefaultEnvVariables,
  makeDefaultEnvironment,
} from './default-environment'
import type { EnvironmentVariable } from './db/types'

// Minimal localStorage stub for the node test environment.
function installLocalStorage() {
  const store = new Map<string, string>()
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
  vi.stubGlobal('window', { localStorage: ls })
  vi.stubGlobal('localStorage', ls)
}

const v = (key: string, value: string): EnvironmentVariable => ({ id: key, key, value, enabled: true })

describe('default-environment', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    installLocalStorage()
  })

  it('identifies the default env id', () => {
    expect(isDefaultEnv(DEFAULT_ENV_ID)).toBe(true)
    expect(isDefaultEnv('something-else')).toBe(false)
    expect(isDefaultEnv(null)).toBe(false)
  })

  it('returns [] when nothing is stored', () => {
    expect(getDefaultEnvVariables('ws1')).toEqual([])
  })

  it('persists and reads variables per workspace', () => {
    setDefaultEnvVariables('ws1', [v('host', 'a.com')])
    setDefaultEnvVariables('ws2', [v('host', 'b.com')])
    expect(getDefaultEnvVariables('ws1')).toEqual([v('host', 'a.com')])
    expect(getDefaultEnvVariables('ws2')).toEqual([v('host', 'b.com')])
  })

  it('keeps the workspace-less bucket separate from a workspace', () => {
    setDefaultEnvVariables(null, [v('x', '1')])
    setDefaultEnvVariables('ws1', [v('x', '2')])
    expect(getDefaultEnvVariables(null)).toEqual([v('x', '1')])
    expect(getDefaultEnvVariables('ws1')).toEqual([v('x', '2')])
  })

  it('builds a synthetic environment named "Default Environment"', () => {
    setDefaultEnvVariables('ws1', [v('token', 'abc')])
    const env = makeDefaultEnvironment('ws1', true)
    expect(env.id).toBe(DEFAULT_ENV_ID)
    expect(env.name).toBe(DEFAULT_ENV_NAME)
    expect(env.isActive).toBe(true)
    expect(env.workspaceId).toBe('ws1')
    expect(env.variables).toEqual([v('token', 'abc')])
  })
})
