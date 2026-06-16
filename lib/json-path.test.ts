import { describe, it, expect } from 'vitest'
import { resolveJsonPath } from './json-path'

describe('resolveJsonPath', () => {
  const data = {
    data: { access_token: 'abc', nested: { id: 7 } },
    items: [{ id: 1 }, { id: 2 }],
    count: 0,
    flag: false,
    'user.id': 99,
  }

  it('resolves simple dot notation', () => {
    expect(resolveJsonPath(data, 'data.access_token')).toBe('abc')
    expect(resolveJsonPath(data, 'data.nested.id')).toBe(7)
  })

  it('resolves bracket array indices', () => {
    expect(resolveJsonPath(data, 'items[0].id')).toBe(1)
    expect(resolveJsonPath(data, 'items[1].id')).toBe(2)
  })

  it('resolves dotted array indices', () => {
    expect(resolveJsonPath(data, 'items.0.id')).toBe(1)
  })

  it('falls back to a literal key that contains dots', () => {
    expect(resolveJsonPath(data, 'user.id')).toBe(99)
  })

  it('returns falsy-but-present values (0, false)', () => {
    expect(resolveJsonPath(data, 'count')).toBe(0)
    expect(resolveJsonPath(data, 'flag')).toBe(false)
  })

  it('supports an optional $ root prefix', () => {
    expect(resolveJsonPath(data, '$.data.access_token')).toBe('abc')
    expect(resolveJsonPath(data, '$')).toBe(data)
  })

  it('returns undefined for missing paths', () => {
    expect(resolveJsonPath(data, 'data.missing')).toBeUndefined()
    expect(resolveJsonPath(data, 'nope.deep.path')).toBeUndefined()
    expect(resolveJsonPath(data, 'items[9].id')).toBeUndefined()
  })

  it('returns undefined when descending into a non-object', () => {
    expect(resolveJsonPath(data, 'count.foo')).toBeUndefined()
  })

  it('returns the root for an empty path', () => {
    expect(resolveJsonPath(data, '')).toBe(data)
  })
})
