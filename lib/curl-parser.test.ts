import { describe, it, expect } from 'vitest'
import { isCurlCommand, parseCurl, buildCurl } from './curl-parser'
import type { RequestConfig } from './db/types'

describe('isCurlCommand', () => {
  it('detects a curl command', () => {
    expect(isCurlCommand('curl https://x.com')).toBe(true)
    expect(isCurlCommand('  CURL -X POST https://x.com')).toBe(true)
  })
  it('rejects non-curl text', () => {
    expect(isCurlCommand('https://x.com')).toBe(false)
  })
})

describe('parseCurl', () => {
  it('parses a bare GET url', () => {
    const r = parseCurl('curl https://x.com/a')!
    expect(r.method).toBe('GET')
    expect(r.url).toBe('https://x.com/a')
  })

  it('extracts query params into the params tab and cleans the URL', () => {
    const r = parseCurl('curl "https://x.com/a?q=hello%20world&n=2"')!
    expect(r.url).toBe('https://x.com/a')
    expect(r.params).toEqual([
      expect.objectContaining({ key: 'q', value: 'hello world', enabled: true }),
      expect.objectContaining({ key: 'n', value: '2', enabled: true }),
    ])
  })

  it('parses method and headers', () => {
    const r = parseCurl('curl -X POST https://x.com -H "Content-Type: application/json"')!
    expect(r.method).toBe('POST')
    expect(r.headers).toEqual([
      expect.objectContaining({ key: 'Content-Type', value: 'application/json' }),
    ])
  })

  it('infers POST and json body from -d with json content-type', () => {
    const r = parseCurl(`curl https://x.com -H "Content-Type: application/json" -d '{"a":1}'`)!
    expect(r.method).toBe('POST')
    expect(r.body?.type).toBe('json')
  })

  it('extracts a bearer token into auth', () => {
    const r = parseCurl('curl https://x.com -H "Authorization: Bearer abc123"')!
    expect(r.auth).toEqual({ type: 'bearer', bearer: { token: 'abc123' } })
    expect(r.headers?.find(h => h.key.toLowerCase() === 'authorization')).toBeUndefined()
  })

  it('parses basic auth from -u', () => {
    const r = parseCurl('curl https://x.com -u user:pass')!
    expect(r.auth).toEqual({ type: 'basic', basic: { username: 'user', password: 'pass' } })
  })

  it('returns null for non-curl input', () => {
    expect(parseCurl('not a curl command')).toBeNull()
  })
})

describe('buildCurl', () => {
  function req(overrides: Partial<RequestConfig> = {}): RequestConfig {
    return {
      id: 'r', name: 't', method: 'GET', url: 'https://x.com', params: [], headers: [],
      body: { type: 'none', content: '', formData: [] }, auth: { type: 'none' },
      createdAt: 0, updatedAt: 0, ...overrides,
    }
  }

  it('omits -X GET and emits the url', () => {
    expect(buildCurl(req())).toContain('https://x.com')
    expect(buildCurl(req())).not.toContain('-X GET')
  })

  it('encodes params in the query string', () => {
    const c = buildCurl(req({ params: [{ id: '1', key: 'q', value: 'a b', enabled: true }] }))
    expect(c).toContain('q=a%20b')
  })

  it('round-trips method, header, and json body', () => {
    const original = `curl -X POST https://x.com/a -H 'Content-Type: application/json' -d '{"a":1}'`
    const parsed = parseCurl(original)!
    const rebuilt = buildCurl({
      id: 'r', name: 't', method: parsed.method!, url: parsed.url!, params: parsed.params ?? [],
      headers: parsed.headers ?? [], body: parsed.body!, auth: parsed.auth!, createdAt: 0, updatedAt: 0,
    })
    const reparsed = parseCurl(rebuilt)!
    expect(reparsed.method).toBe('POST')
    expect(reparsed.url).toBe('https://x.com/a')
    expect(reparsed.body?.type).toBe('json')
  })
})
