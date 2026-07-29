import { describe, it, expect } from 'vitest'
import { splitUrl, paramsToSearch, searchToParams, ensureProtocol } from './url-params'
import type { KeyValuePair } from './db/types'

function kv(key: string, value: string, enabled = true): KeyValuePair {
  return { id: `${key}-${value}`, key, value, enabled }
}

describe('splitUrl', () => {
  it('splits a plain query string', () => {
    expect(splitUrl('https://x.com/a?b=1&c=2')).toEqual({ base: 'https://x.com/a', search: 'b=1&c=2' })
  })

  it('returns empty search when there is no query string', () => {
    expect(splitUrl('https://x.com/a')).toEqual({ base: 'https://x.com/a', search: '' })
  })

  it('ignores a ? that lives inside a {{variable}}', () => {
    // The '?' here is inside the variable braces and must not be treated as the
    // query separator.
    expect(splitUrl('https://x.com/{{q?}}/a?b=1')).toEqual({
      base: 'https://x.com/{{q?}}/a',
      search: 'b=1',
    })
  })
})

describe('paramsToSearch', () => {
  it('encodes keys and values', () => {
    expect(paramsToSearch([kv('q', 'hello world')])).toBe('q=hello%20world')
  })

  it('encodes & in a value so it does not split into another param', () => {
    expect(paramsToSearch([kv('q', 'a&b')])).toBe('q=a%26b')
  })

  it('keeps a literal + distinct from a space', () => {
    expect(paramsToSearch([kv('q', 'a+b')])).toBe('q=a%2Bb')
    expect(paramsToSearch([kv('q', 'a b')])).toBe('q=a%20b')
  })

  it('preserves an empty value with a trailing =', () => {
    expect(paramsToSearch([kv('flag', '')])).toBe('flag=')
  })

  it('skips disabled and keyless params', () => {
    expect(paramsToSearch([kv('a', '1', false), kv('', '2')])).toBe('')
  })
})

describe('searchToParams', () => {
  it('decodes percent-encoded keys and values', () => {
    const [p] = searchToParams('q=hello%20world', [])
    expect(p.key).toBe('q')
    expect(p.value).toBe('hello world')
    expect(p.enabled).toBe(true)
  })

  it('decodes + as a space (external paste convention)', () => {
    const [p] = searchToParams('q=hello+world', [])
    expect(p.value).toBe('hello world')
  })

  it('round-trips through paramsToSearch without corruption', () => {
    const original = [kv('q', 'a b'), kv('x', 'a&b=c'), kv('plus', 'a+b')]
    const search = paramsToSearch(original)
    const back = searchToParams(search, [])
    expect(back.map(p => [p.key, p.value])).toEqual([
      ['q', 'a b'],
      ['x', 'a&b=c'],
      ['plus', 'a+b'],
    ])
  })

  it('returns [] for an empty search', () => {
    expect(searchToParams('', [kv('a', '1')])).toEqual([])
  })

  it('tolerates a malformed percent-sequence', () => {
    const [p] = searchToParams('q=%E0%A4%A', [])
    expect(p.value).toBe('%E0%A4%A')
  })

  it('preserves disabled existing params and re-enables matched ones', () => {
    const existing = [kv('a', 'old', false), kv('z', 'keepdisabled', false)]
    const result = searchToParams('a=new', existing)
    const a = result.find(p => p.key === 'a')!
    const z = result.find(p => p.key === 'z')!
    expect(a.value).toBe('new')
    expect(a.enabled).toBe(true)
    expect(z.enabled).toBe(false)
  })

  it('does not duplicate a param that was matched from a disabled entry', () => {
    // Regression: matching a disabled existing param and then also keeping it
    // in the "preserve disabled" pass produced the same key twice.
    const existing = [kv('a', 'old', false)]
    const result = searchToParams('a=new', existing)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ key: 'a', value: 'new', enabled: true })
  })

  it('gives repeated keys distinct ids instead of colliding on one existing entry', () => {
    // Regression: "tag=a&tag=b" both matched the single existing "tag" param,
    // producing two rows with the same id — editing/deleting one affected both.
    const existing = [kv('tag', 'old')]
    const result = searchToParams('tag=a&tag=b', existing)
    expect(result).toHaveLength(2)
    expect(result[0].value).toBe('a')
    expect(result[1].value).toBe('b')
    expect(result[0].id).not.toBe(result[1].id)
  })
})

describe('ensureProtocol', () => {
  it('leaves an http(s) URL untouched', () => {
    expect(ensureProtocol('https://x.com')).toBe('https://x.com')
    expect(ensureProtocol('http://x.com')).toBe('http://x.com')
  })

  it('leaves other schemes untouched', () => {
    expect(ensureProtocol('ws://x.com')).toBe('ws://x.com')
    expect(ensureProtocol('wss://x.com')).toBe('wss://x.com')
  })

  it('prepends http:// to a bare host with a dot', () => {
    expect(ensureProtocol('x.com/path')).toBe('http://x.com/path')
  })

  it('prepends http:// to a bare host WITHOUT a dot (the old heuristic bug)', () => {
    expect(ensureProtocol('myhost/path')).toBe('http://myhost/path')
    expect(ensureProtocol('localhost:3000')).toBe('http://localhost:3000')
  })

  it('leaves an unresolved variable-only URL alone', () => {
    expect(ensureProtocol('{{baseUrl}}/users')).toBe('{{baseUrl}}/users')
  })

  it('trims and ignores empty input', () => {
    expect(ensureProtocol('   ')).toBe('')
  })
})
