import { describe, it, expect } from 'vitest'
import { membersEqual } from './hybrid-adapter'
import type { WorkspaceMember } from './types'

const m = (userId: string, permission: WorkspaceMember['permission']): WorkspaceMember => ({
  userId,
  email: `${userId}@x.com`,
  name: userId,
  permission,
  joinedAt: 0,
})

describe('membersEqual', () => {
  it('treats different orderings as equal', () => {
    const a = [m('u1', 'read'), m('u2', 'read-write')]
    const b = [m('u2', 'read-write'), m('u1', 'read')]
    expect(membersEqual(a, b)).toBe(true)
  })

  it('detects a permission change', () => {
    const a = [m('u1', 'read')]
    const b = [m('u1', 'read-write')]
    expect(membersEqual(a, b)).toBe(false)
  })

  it('detects added/removed members', () => {
    expect(membersEqual([m('u1', 'read')], [m('u1', 'read'), m('u2', 'read')])).toBe(false)
    expect(membersEqual([m('u1', 'read')], [m('u2', 'read')])).toBe(false)
  })

  it('ignores volatile fields (name/email/joinedAt) that do not affect access', () => {
    const a = [{ ...m('u1', 'read'), name: 'Old', joinedAt: 1 }]
    const b = [{ ...m('u1', 'read'), name: 'New', joinedAt: 999 }]
    expect(membersEqual(a, b)).toBe(true)
  })

  it('handles empty / undefined lists', () => {
    expect(membersEqual([], [])).toBe(true)
    expect(membersEqual(undefined, undefined)).toBe(true)
    expect(membersEqual([], [m('u1', 'read')])).toBe(false)
  })
})
