'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { WorkspaceInvite, WorkspaceMember, WorkspacePermission, Workspace } from '@/lib/db/types'
import {
  sendInvite,
  getInvitesForEmail,
  getInvitesForWorkspace,
  acceptInvite,
  declineInvite,
  revokeInvite,
  buildMemberFromInvite,
} from '@/lib/collaboration/store'
import { useAuth } from '@/lib/auth/auth-context'

export function useMyInvites() {
  const { state } = useAuth()
  const [invites, setInvites] = useState<WorkspaceInvite[]>([])

  const refresh = useCallback(async () => {
    if (state.status !== 'authenticated') return
    const data = await getInvitesForEmail(state.session.user.email)
    setInvites(data)
  }, [state])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 10000)
    return () => clearInterval(interval)
  }, [refresh])

  const accept = useCallback(
    async (inviteId: string, onAccepted: (invite: WorkspaceInvite) => Promise<void>) => {
      const invite = await acceptInvite(inviteId, invites)
      await onAccepted(invite)
      await refresh()
    },
    [invites, refresh]
  )

  const decline = useCallback(
    async (inviteId: string) => {
      await declineInvite(inviteId)
      await refresh()
    },
    [refresh]
  )

  return { invites, refresh, accept, decline }
}

export function useWorkspaceMembers(workspace: Workspace | null) {
  const { state } = useAuth()
  const [pendingInvites, setPendingInvites] = useState<WorkspaceInvite[]>([])
  const workspaceRef = useRef(workspace)
  useEffect(() => { workspaceRef.current = workspace }, [workspace])

  const refresh = useCallback(async () => {
    const ws = workspaceRef.current
    if (!ws || state.status !== 'authenticated') {
      setPendingInvites([])
      return
    }
    // Only cloud workspaces have server-side invites; skip the REST call (and the
    // 401/404 it would throw) for purely local ones.
    const isCloud = ws.isSynced || (ws.members?.length ?? 0) > 0
    if (!isCloud) {
      setPendingInvites([])
      return
    }
    try {
      const data = await getInvitesForWorkspace(ws.id)
      setPendingInvites(data)
    } catch {
      setPendingInvites([])
    }
  }, [state.status])

  useEffect(() => { refresh() }, [refresh, workspace])

  const invite = useCallback(
    async (inviteeEmail: string, permission: WorkspacePermission) => {
      const ws = workspaceRef.current
      if (!ws || state.status !== 'authenticated') return
      const { user } = state.session
      await sendInvite({
        workspaceId: ws.id,
        workspaceName: ws.name,
        ownerEmail: user.email,
        ownerName: user.name,
        inviteeEmail,
        permission,
      }, ws)
      await refresh()
    },
    [state, refresh]
  )

  const revoke = useCallback(
    async (inviteId: string) => {
      await revokeInvite(inviteId)
      await refresh()
    },
    [refresh]
  )

  const updateMemberPermission = useCallback(
    async (
      memberId: string,
      permission: WorkspacePermission,
      updateWorkspace: (id: string, data: Partial<Workspace>) => Promise<void>
    ) => {
      const ws = workspaceRef.current
      if (!ws) return
      const updated = ws.members.map(m =>
        m.userId === memberId ? { ...m, permission } : m
      )
      await updateWorkspace(ws.id, { members: updated })
    },
    []
  )

  const removeMember = useCallback(
    async (
      memberId: string,
      updateWorkspace: (id: string, data: Partial<Workspace>) => Promise<void>
    ) => {
      const ws = workspaceRef.current
      if (!ws) return
      const updated = ws.members.filter(m => m.userId !== memberId)
      await updateWorkspace(ws.id, { members: updated })
    },
    []
  )

  const isOwner = state.status === 'authenticated' && workspace?.ownerId === state.session.user.id

  return {
    members: workspace?.members ?? [],
    pendingInvites,
    isOwner,
    invite,
    revoke,
    updateMemberPermission,
    removeMember,
    refresh,
  }
}

export { buildMemberFromInvite }
