import { describe, it, expect } from 'vitest'
import { buildRequest } from './build-request'
import type { RequestConfig, KeyValuePair, EnvironmentVariable } from './db/types'

function kv(key: string, value: string, enabled = true, extra: Partial<KeyValuePair> = {}): KeyValuePair {
  return { id: `${key}-${value}`, key, value, enabled, ...extra }
}

function req(overrides: Partial<RequestConfig> = {}): RequestConfig {
  return {
    id: 'r1',
    name: 'test',
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    body: { type: 'none', content: '', formData: [] },
    auth: { type: 'none' },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

const noVars: EnvironmentVariable[] = []

describe('buildRequest — query params', () => {
  it('does NOT double params that are already in the URL query string', () => {
    // The URL bar keeps url and params in sync, so request.url carries the query
    // string AND request.params mirror it. The builder must strip the query
    // string before re-appending params.
    const r = req({ url: 'https://x.com/a?foo=bar', params: [kv('foo', 'bar')] })
    const { url } = buildRequest(r, noVars)
    expect(url).toBe('https://x.com/a?foo=bar')
  })

  it('appends params when the base URL has no query string', () => {
    const r = req({ url: 'https://x.com/a', params: [kv('foo', 'bar')] })
    expect(buildRequest(r, noVars).url).toBe('https://x.com/a?foo=bar')
  })

  it('encodes param values via URLSearchParams', () => {
    const r = req({ url: 'https://x.com', params: [kv('q', 'a b&c')] })
    expect(buildRequest(r, noVars).url).toBe('https://x.com?q=a+b%26c')
  })

  it('skips disabled params', () => {
    const r = req({ url: 'https://x.com', params: [kv('a', '1', false)] })
    expect(buildRequest(r, noVars).url).toBe('https://x.com')
  })
})

describe('buildRequest — protocol normalization', () => {
  it('prepends http:// to a scheme-less host without a dot', () => {
    expect(buildRequest(req({ url: 'myhost/path' }), noVars).url).toBe('http://myhost/path')
  })

  it('leaves https URLs untouched', () => {
    expect(buildRequest(req({ url: 'https://x.com' }), noVars).url).toBe('https://x.com')
  })
})

describe('buildRequest — variables', () => {
  it('resolves variables in the URL base and params', () => {
    const vars: EnvironmentVariable[] = [{ id: '1', key: 'host', value: 'api.x.com', enabled: true }]
    const r = req({ url: 'https://{{host}}/a', params: [kv('x', '1')] })
    expect(buildRequest(r, vars).url).toBe('https://api.x.com/a?x=1')
  })
})

describe('buildRequest — auth', () => {
  it('sets a bearer header', () => {
    const r = req({ url: 'https://x.com', auth: { type: 'bearer', bearer: { token: 't' } } })
    expect(buildRequest(r, noVars).headers['Authorization']).toBe('Bearer t')
  })

  it('sets a basic header', () => {
    const r = req({ url: 'https://x.com', auth: { type: 'basic', basic: { username: 'u', password: 'p' } } })
    expect(buildRequest(r, noVars).headers['Authorization']).toBe(`Basic ${btoa('u:p')}`)
  })

  it('resolves variables in the api-key HEADER NAME (not just the value)', () => {
    const vars: EnvironmentVariable[] = [{ id: '1', key: 'hname', value: 'X-Api-Key', enabled: true }]
    const r = req({
      url: 'https://x.com',
      auth: { type: 'api-key', apiKey: { key: '{{hname}}', value: 'secret', addTo: 'header' } },
    })
    expect(buildRequest(r, vars).headers['X-Api-Key']).toBe('secret')
  })

  it('appends an api-key to the query when addTo is query', () => {
    const r = req({
      url: 'https://x.com',
      auth: { type: 'api-key', apiKey: { key: 'token', value: 'a b', addTo: 'query' } },
    })
    expect(buildRequest(r, noVars).url).toBe('https://x.com?token=a%20b')
  })
})

describe('buildRequest — body', () => {
  it('sends a JSON body and default content-type for POST', () => {
    const r = req({ method: 'POST', url: 'https://x.com', body: { type: 'json', content: '{"a":1}' } })
    const built = buildRequest(r, noVars)
    expect(built.requestBody).toBe('{"a":1}')
    expect(built.headers['Content-Type']).toBe('application/json')
  })

  it('does NOT send a body for GET', () => {
    const r = req({ method: 'GET', url: 'https://x.com', body: { type: 'json', content: '{"a":1}' } })
    expect(buildRequest(r, noVars).requestBody).toBeUndefined()
  })

  it('builds form-data entries (the field dropped on the sequence path)', () => {
    const r = req({
      method: 'POST',
      url: 'https://x.com',
      body: { type: 'form-data', content: '', formData: [kv('file', 'v', true, { type: 'file' })] },
    })
    const built = buildRequest(r, noVars)
    expect(built.formDataEntries).toEqual([{ key: 'file', value: 'v', fileData: undefined }])
  })

  it('encodes x-www-form-urlencoded bodies', () => {
    const r = req({
      method: 'POST',
      url: 'https://x.com',
      body: { type: 'x-www-form-urlencoded', content: '', formData: [kv('a', 'b c')] },
    })
    const built = buildRequest(r, noVars)
    expect(built.requestBody).toBe('a=b+c')
    expect(built.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  })
})
