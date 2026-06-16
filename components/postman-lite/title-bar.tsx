'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { Minus, Square, X, LogOut, User, Users, UserPlus, HelpCircle, Save, Trash2, Eye, Shield, Loader2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/lib/auth/auth-context'
import { cn } from '@/lib/utils'
import { useMyInvites, useWorkspaceMembers } from '@/hooks/use-collaboration'
import type { Workspace, WorkspacePermission } from '@/lib/db/types'

interface TitleBarProps {
  workspaceDropdown?: React.ReactNode
  environments?: React.ReactNode
  activeWorkspace?: Workspace | null
  isOwner?: boolean
  onUpdateWorkspace?: (id: string, data: Partial<Workspace>) => Promise<void>
  onOpenHelp?: () => void
  onSave?: () => void
  canSave?: boolean
  onInviteAccepted?: (workspaceId: string) => void
  onRefreshWorkspaces?: () => Promise<unknown>
  // Runs the action if signed in, otherwise opens the sign-in dialog and defers
  // it. Returns true when already authenticated.
  onRequireAuth?: (reason: string, onAuthed?: () => void) => boolean
}

function Sep() {
  return <div className="w-px h-3.5 bg-border mx-1 shrink-0 self-center" />
}

function TitleBtn({
  onClick,
  title,
  disabled,
  children,
  className,
}: {
  onClick?: () => void
  title?: string
  disabled?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1.5 px-2 h-6 self-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:pointer-events-none text-xs',
        className
      )}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {children}
    </button>
  )
}

type WorkspaceMembersHook = ReturnType<typeof useWorkspaceMembers>

function MembersDropdown({ onUpdateWorkspace, hook }: { onUpdateWorkspace: (id: string, data: Partial<Workspace>) => Promise<void>; hook: WorkspaceMembersHook }) {
  const { members, pendingInvites, revoke, updateMemberPermission, removeMember } = hook
  const memberCount = members.length
  const [open, setOpen] = useState(false)
  const [selectOpen, setSelectOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null) // userId
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null) // inviteId
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (selectOpen) return
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setConfirmRemove(null)
        setConfirmRevoke(null)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, selectOpen])

  return (
    <div ref={ref} className="relative" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors text-xs"
      >
        <Users className="h-3.5 w-3.5" />
        <span>Members{memberCount > 0 ? ` (${memberCount})` : ''}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-popover border border-border rounded-lg shadow-xl z-50 py-1">
          <>
            <div className="px-3 pt-2 pb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-foreground">Members</span>
            </div>
            {members.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">No members yet.</div>
            ) : (
              <>
                {members.map(member => (
                    <div key={member.userId} className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent/10">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{member.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                      </div>
                      <Select
                        value={member.permission}
                        onOpenChange={setSelectOpen}
                        onValueChange={v => updateMemberPermission(member.userId, v as WorkspacePermission, onUpdateWorkspace)}
                      >
                        <SelectTrigger className="w-28 h-6 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="read">Read only</SelectItem>
                          <SelectItem value="read-write">Read & write</SelectItem>
                        </SelectContent>
                      </Select>
                      {confirmRemove === member.userId ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => { removeMember(member.userId, onUpdateWorkspace); setConfirmRemove(null) }}
                            className="text-xs px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                          >
                            Remove
                          </button>
                          <button
                            onClick={() => setConfirmRemove(null)}
                            className="text-xs px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmRemove(member.userId)}
                          className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                          title="Remove member"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
              </>
            )}
            {pendingInvites.length > 0 && (
              <>
                <div className="my-1 border-t border-border" />
                <div className="px-3 pt-2 pb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-foreground">Pending invites</span>
                </div>
                {pendingInvites.map(invite => (
                  <div key={invite.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent/10">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{invite.inviteeEmail}</p>
                      <p className="text-xs text-muted-foreground">{invite.permission === 'read' ? 'Read only' : 'Read & write'}</p>
                    </div>
                    {confirmRevoke === invite.id ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => { revoke(invite.id); setConfirmRevoke(null) }}
                          className="text-xs px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                        >
                          Revoke
                        </button>
                        <button
                          onClick={() => setConfirmRevoke(null)}
                          className="text-xs px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmRevoke(invite.id)}
                        className="text-xs text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}
          </>
        </div>
      )}
    </div>
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function InviteDropdown({ hook, onUpdateWorkspace, activeWorkspace, signedIn, onRequireAuth }: { hook: WorkspaceMembersHook, onUpdateWorkspace: (id: string, data: Partial<Workspace>) => Promise<void>, activeWorkspace: Workspace, signedIn: boolean, onRequireAuth?: (reason: string, onAuthed?: () => void) => boolean }) {
  const { invite } = hook
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [permission, setPermission] = useState<WorkspacePermission>('read')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const emailValid = EMAIL_RE.test(email.trim())

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed || !emailValid) return
    setLoading(true)
    setError('')
    try {
      await invite(trimmed, permission)
      if (!activeWorkspace.isSynced) {
        await onUpdateWorkspace(activeWorkspace.id, { isSynced: true })
      }
      setSent(true)
      setTimeout(() => { setSent(false); setEmail(''); setPermission('read') }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invite')
    } finally {
      setLoading(false)
    }
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        // Signed-out users can't invite — prompt sign-in instead of opening.
        if (next && !signedIn) {
          onRequireAuth?.('Sign in to invite people to a workspace.')
          return
        }
        setOpen(next)
        setEmail(''); setPermission('read'); setError(''); setSent(false)
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1.5 px-2 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors text-xs"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <UserPlus className="h-3.5 w-3.5" />
          Invite
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-3" onCloseAutoFocus={e => e.preventDefault()}>
        {sent ? (
          <p className="text-sm text-muted-foreground py-1">Invite sent to {email}.</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-2" onClick={e => e.stopPropagation()}>
            <input
              type="email"
              placeholder="colleague@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={loading}
              autoFocus
              className={`w-full bg-input border rounded px-2 py-1.5 text-sm text-foreground outline-none focus:ring-1 placeholder:text-muted-foreground transition-colors ${
                email && !emailValid
                  ? 'border-destructive focus:ring-destructive'
                  : 'border-border focus:ring-primary'
              }`}
            />
            {email && !emailValid && (
              <p className="text-xs text-destructive">Enter a valid email address.</p>
            )}
            <div className="flex gap-2">
              <Select value={permission} onValueChange={v => setPermission(v as WorkspacePermission)}>
                <SelectTrigger className="flex-1 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="read"><span className="flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" />Read only</span></SelectItem>
                  <SelectItem value="read-write"><span className="flex items-center gap-1.5"><Shield className="h-3.5 w-3.5" />Read & write</span></SelectItem>
                </SelectContent>
              </Select>
              <button
                type="submit"
                disabled={loading || !emailValid}
                className="flex items-center gap-1.5 px-3 h-8 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                Send
              </button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </form>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TitleBar({
  workspaceDropdown,
  environments,
  activeWorkspace,
  isOwner,
  onUpdateWorkspace,
  onOpenHelp,
  onSave,
  canSave,
  onInviteAccepted,
  onRefreshWorkspaces,
  onRequireAuth,
}: TitleBarProps) {
  const [isElectron, setIsElectron] = useState(false)
  const { state, logout } = useAuth()
  const { invites, accept, decline } = useMyInvites()
  const membersHook = useWorkspaceMembers(activeWorkspace ?? null)

  async function handleAccept(inviteId: string, workspaceId: string) {
    await accept(inviteId, async () => {
      if (onRefreshWorkspaces) await onRefreshWorkspaces()
    })
    if (onInviteAccepted) onInviteAccepted(workspaceId)
  }

  useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      setIsElectron(true)
    }
  }, [])

  if (!isElectron) return null

  const user = state.status === 'authenticated' ? state.session.user : null

  return (
    <div
      className="flex items-stretch h-8 bg-card border-b border-border select-none overflow-hidden"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* App logo */}
      <div
        className="flex items-center gap-1.5 px-3 shrink-0 self-center"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Image src="/logo.png" alt="Quence" width={14} height={14} className="shrink-0" />
        <span className="text-xs font-medium text-muted-foreground">Quence</span><span className="text-xs font-semibold text-foreground">API</span>
      </div>

      <Sep />

      {/* Workspace dropdown */}
      {workspaceDropdown && (
        <div className="self-center min-w-0 shrink overflow-hidden" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {workspaceDropdown}
        </div>
      )}

      <Sep />

      {/* Environment selector */}
      {environments && (
        <>
          <div className="self-center min-w-0 shrink overflow-hidden" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {environments}
          </div>
          <Sep />
        </>
      )}

      {/* Draggable spacer — absorbs remaining space */}
      <div className="flex-1 min-w-4 self-stretch" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* Right side actions — fixed, never shrink */}
      <div
        className="flex items-center gap-0.5 self-stretch pl-2 shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Members + Invite dropdowns (owner only) */}
        {isOwner && activeWorkspace && onUpdateWorkspace && (
          <>
            <MembersDropdown onUpdateWorkspace={onUpdateWorkspace} hook={membersHook} />
            <InviteDropdown hook={membersHook} onUpdateWorkspace={onUpdateWorkspace} activeWorkspace={activeWorkspace} signedIn={!!user} onRequireAuth={onRequireAuth} />
            <Sep />
          </>
        )}

        {/* Help */}
        <TitleBtn onClick={onOpenHelp} title="Help">
          <HelpCircle className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Help</span>
        </TitleBtn>

        {/* Save */}
        <TitleBtn onClick={onSave} disabled={!canSave} title="Save (Ctrl+S)">
          <Save className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Save</span>
        </TitleBtn>

        <Sep />

        {/* Account */}
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-1.5 px-2 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors text-xs relative"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                title={user.name}
              >
                <User className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-24 truncate">{user.name}</span>
                {invites.length > 0 && (
                  <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <div className="px-2 py-1.5 space-y-0.5">
                <p className="text-sm font-medium truncate">{user.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
              {invites.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Invites</p>
                  </div>
                  {invites.map(invite => (
                    <div key={invite.id} className="px-2 py-1.5">
                      <p className="text-xs font-medium truncate">{invite.workspaceName}</p>
                      <p className="text-xs text-muted-foreground truncate">from {invite.ownerName}</p>
                      <div className="flex gap-1.5 mt-1.5">
                        <button
                          onClick={() => handleAccept(invite.id, invite.workspaceId)}
                          className="flex-1 text-xs py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => decline(invite.id)}
                          className="flex-1 text-xs py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                <LogOut className="h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <TitleBtn title="Sign in" onClick={() => onRequireAuth?.('Sign in to sync workspaces and collaborate.')}>
            <User className="h-3.5 w-3.5" />
            Sign in
          </TitleBtn>
        )}

      </div>

      {/* Window controls — flush to the right edge */}
      <div className="flex items-stretch self-stretch shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          className="flex items-center justify-center h-full w-9 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          onClick={() => window.electronAPI?.minimize()}
          tabIndex={-1}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          className="flex items-center justify-center h-full w-9 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          onClick={() => window.electronAPI?.maximize()}
          tabIndex={-1}
        >
          <Square className="h-3 w-3" />
        </button>
        <button
          className="flex items-center justify-center h-full w-9 text-muted-foreground hover:bg-[oklch(0.65_0.22_25)] hover:text-white transition-colors"
          onClick={() => window.electronAPI?.close()}
          tabIndex={-1}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
