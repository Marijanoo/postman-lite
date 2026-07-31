import { describe, it, expect } from 'vitest'
import { uniqueName } from './utils'

describe('uniqueName', () => {
  it('returns the name unchanged when there is no collision', () => {
    expect(uniqueName('Get User', ['Get Post', 'Delete User'])).toBe('Get User')
  })

  it('appends " (1)" on a single collision', () => {
    expect(uniqueName('Get User', ['Get User'])).toBe('Get User (1)')
  })

  it('increments past existing numbered collisions', () => {
    expect(uniqueName('Get User', ['Get User', 'Get User (1)', 'Get User (2)'])).toBe('Get User (3)')
  })

  it('does not get confused by an unrelated gap in numbering', () => {
    expect(uniqueName('Get User', ['Get User', 'Get User (2)'])).toBe('Get User (1)')
  })
})
