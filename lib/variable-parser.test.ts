import { describe, it, expect } from 'vitest'
import { parseVariables, extractVariables, highlightVariables } from './variable-parser'
import type { EnvironmentVariable } from './db/types'

function v(key: string, value: string, enabled = true): EnvironmentVariable {
  return { id: key, key, value, enabled }
}

describe('parseVariables', () => {
  it('substitutes a known variable', () => {
    expect(parseVariables('{{host}}/users', [v('host', 'api.x.com')])).toBe('api.x.com/users')
  })

  it('tolerates whitespace inside the braces', () => {
    expect(parseVariables('{{ host }}', [v('host', 'x')])).toBe('x')
  })

  it('leaves unknown variables untouched', () => {
    expect(parseVariables('{{missing}}', [v('host', 'x')])).toBe('{{missing}}')
  })

  it('ignores disabled variables', () => {
    expect(parseVariables('{{host}}', [v('host', 'x', false)])).toBe('{{host}}')
  })

  it('is case-sensitive (Token and token are distinct)', () => {
    const vars = [v('Token', 'AAA'), v('token', 'bbb')]
    expect(parseVariables('{{Token}}', vars)).toBe('AAA')
    expect(parseVariables('{{token}}', vars)).toBe('bbb')
  })

  it('does not resolve a mismatched-case reference', () => {
    expect(parseVariables('{{baseURL}}', [v('baseUrl', 'x')])).toBe('{{baseURL}}')
  })
})

describe('extractVariables', () => {
  it('returns unique trimmed names', () => {
    expect(extractVariables('{{a}}/{{ b }}/{{a}}')).toEqual(['a', 'b'])
  })
})

describe('highlightVariables', () => {
  it('splits text into literal and variable segments', () => {
    expect(highlightVariables('x/{{a}}/y')).toEqual([
      { text: 'x/', isVariable: false },
      { text: '{{a}}', isVariable: true },
      { text: '/y', isVariable: false },
    ])
  })
})
