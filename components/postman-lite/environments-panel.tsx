'use client'

import { useState, useRef, useEffect } from 'react'
import { generateId } from '@/lib/utils'
import type { Environment, EnvironmentVariable } from '@/lib/db/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Settings,
  Plus,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Trash2,
  Check,
  FileUp,
  Download,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { isDefaultEnv } from '@/lib/default-environment'

interface EnvironmentsPanelProps {
  environments: Environment[]
  activeEnvironment?: Environment
  canWrite?: boolean
  onCreateEnvironment: (name: string) => void
  onImportEnvironment: (env: Environment) => void
  onDeleteEnvironment: (id: string) => void
  onUpdateEnvironment: (id: string, data: Partial<Environment>) => void
  onSetActive: (id: string | null) => void
}

export function EnvironmentsPanel({
  environments,
  activeEnvironment,
  canWrite = true,
  onCreateEnvironment,
  onImportEnvironment,
  onDeleteEnvironment,
  onUpdateEnvironment,
  onSetActive,
}: EnvironmentsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [expandedEnvs, setExpandedEnvs] = useState<Set<string>>(new Set())
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false)
  const [selectedEnv, setSelectedEnv] = useState<Environment | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  // Local variable state for debouncing key/value edits
  const [localVars, setLocalVars] = useState<Record<string, EnvironmentVariable[]>>({})
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // Evict localVars entries when the canonical variable list changes from outside
  // (e.g. a variable was deleted by another component or a re-fetch arrived).
  // We compare IDs only — if the set changed, our local copy is stale.
  useEffect(() => {
    setLocalVars(prev => {
      const next = { ...prev }
      let changed = false
      for (const env of environments) {
        const local = next[env.id]
        if (!local) continue
        const canonicalIds = env.variables.map(v => v.id).join(',')
        const localIds = local.map(v => v.id).join(',')
        if (canonicalIds !== localIds) {
          delete next[env.id]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [environments])

  const toggleEnv = (id: string) => {
    const newExpanded = new Set(expandedEnvs)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedEnvs(newExpanded)
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    for (const file of files) {
      await new Promise<void>((resolve) => {
        const reader = new FileReader()
        reader.onload = (event) => {
          try {
            const content = JSON.parse(event.target?.result as string)
            let name = file.name.replace(/\.json$/i, '')
            let variables: EnvironmentVariable[] = []

            if (Array.isArray(content)) {
              content.forEach((env: any) => {
                if (env.name && Array.isArray(env.values)) {
                  onImportEnvironment({
                    id: generateId(),
                    name: env.name,
                    variables: env.values.map((v: any) => ({
                      id: generateId(),
                      key: v.key || '',
                      value: v.value || '',
                      enabled: v.enabled !== false,
                    })),
                    isActive: false,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                  })
                }
              })
              resolve()
              return
            }

            if (content.name && Array.isArray(content.values)) {
              name = content.name
              variables = content.values.map((v: any) => ({
                id: generateId(),
                key: v.key || '',
                value: v.value || '',
                enabled: v.enabled !== false,
              }))
            } else if (typeof content === 'object' && !Array.isArray(content)) {
              variables = Object.entries(content).map(([key, value]) => ({
                id: generateId(),
                key,
                value: String(value),
                enabled: true,
              }))
            }

            if (variables.length > 0) {
              onImportEnvironment({
                id: generateId(),
                name,
                variables,
                isActive: false,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              })
            }
          } catch {
            console.error('Failed to import environment:', file.name)
          }
          resolve()
        }
        reader.readAsText(file)
      })
    }

    e.target.value = ''
  }

  const handleCreate = () => {
    if (inputValue.trim()) {
      onCreateEnvironment(inputValue.trim())
      setInputValue('')
      setIsCreateDialogOpen(false)
    }
  }

  const handleRename = () => {
    if (inputValue.trim() && selectedEnv) {
      onUpdateEnvironment(selectedEnv.id, { name: inputValue.trim() })
      setInputValue('')
      setSelectedEnv(null)
      setIsRenameDialogOpen(false)
    }
  }

  const handleExport = (env: Environment) => {
    const data = {
      name: env.name,
      values: env.variables.map(v => ({ key: v.key, value: v.value, enabled: v.enabled }))
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${env.name.replace(/\s+/g, '-').toLowerCase()}-environment.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleExportAllEnvironments = () => {
    // The default "No Environment" is local-only and never exported.
    const exportable = environments.filter(env => !isDefaultEnv(env.id))
    if (exportable.length === 0) return
    const data = exportable.map(env => ({
      name: env.name,
      values: env.variables.map(v => ({ key: v.key, value: v.value, enabled: v.enabled }))
    }))
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `all_environments_export.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const openRenameDialog = (env: Environment) => {
    setSelectedEnv(env)
    setInputValue(env.name)
    setIsRenameDialogOpen(true)
  }

  const addVariable = (envId: string, variables: EnvironmentVariable[]) => {
    const newVar: EnvironmentVariable = { id: generateId(), key: '', value: '', enabled: true }
    const updated = [...variables, newVar]
    clearTimeout(debounceTimers.current[envId])
    setLocalVars(prev => ({ ...prev, [envId]: updated }))
    onUpdateEnvironment(envId, { variables: updated })
  }

  const updateVariable = (
    envId: string,
    variables: EnvironmentVariable[],
    varId: string,
    field: keyof EnvironmentVariable,
    value: string | boolean,
    debounce = false
  ) => {
    const updated = variables.map((v) =>
      v.id === varId ? { ...v, [field]: value } : v
    )
    if (debounce) {
      setLocalVars(prev => ({ ...prev, [envId]: updated }))
      clearTimeout(debounceTimers.current[envId])
      debounceTimers.current[envId] = setTimeout(() => {
        onUpdateEnvironment(envId, { variables: updated })
        setLocalVars(prev => {
          const next = { ...prev }
          delete next[envId]
          return next
        })
      }, 400)
    } else {
      setLocalVars(prev => ({ ...prev, [envId]: updated }))
      onUpdateEnvironment(envId, { variables: updated })
    }
  }

  const deleteVariable = (envId: string, variables: EnvironmentVariable[], varId: string) => {
    const updated = variables.filter((v) => v.id !== varId)
    clearTimeout(debounceTimers.current[envId])
    setLocalVars(prev => ({ ...prev, [envId]: updated }))
    onUpdateEnvironment(envId, { variables: updated })
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <h3 className="text-sm font-medium text-foreground">Environments</h3>
        {canWrite && (
          <div className="flex items-center gap-1">
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".json"
              multiple
              onChange={handleImport}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleExportAllEnvironments}
              title="Export all environments"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => fileInputRef.current?.click()}
              title="Import environment"
            >
              <FileUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsCreateDialogOpen(true)}
              title="New environment"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {environments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <Settings className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-xs">No environments yet</p>
          </div>
        ) : (
          <div className="py-1">
            {environments.map((env) => {
              const isExpanded = expandedEnvs.has(env.id)
              const isActive = activeEnvironment?.id === env.id
              const isDefault = isDefaultEnv(env.id)

              return (
                <Collapsible
                  key={env.id}
                  open={isExpanded}
                  onOpenChange={() => toggleEnv(env.id)}
                >
                  <div className="group flex items-center hover:bg-secondary/50" onContextMenu={(e) => { e.preventDefault(); setOpenMenuId(env.id) }}>
                    <CollapsibleTrigger className="flex items-center flex-1 px-3 py-1.5 text-sm">
                      <ChevronRight
                        className={cn(
                          'h-4 w-4 mr-1 transition-transform text-muted-foreground',
                          isExpanded && 'rotate-90'
                        )}
                      />
                      <Settings className={cn('h-4 w-4 mr-2', isActive ? 'text-primary' : 'text-muted-foreground')} />
                      <span className={cn('truncate', isActive && 'text-primary font-medium')}>
                        {env.name}
                      </span>
                      {isActive && (
                        <Check className="h-3 w-3 ml-2 text-primary" />
                      )}
                    </CollapsibleTrigger>
                    <DropdownMenu open={openMenuId === env.id} onOpenChange={(o) => setOpenMenuId(o ? env.id : null)}>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 mr-1"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {/* The default env can't be deactivated (it's the fallback),
                            renamed, exported, or deleted. */}
                        {!(isDefault && isActive) && (
                          <DropdownMenuItem onClick={() => onSetActive(isActive ? null : env.id)}>
                            <Check className="h-4 w-4 mr-2" />
                            {isActive ? 'Deactivate' : 'Set Active'}
                          </DropdownMenuItem>
                        )}
                        {canWrite && !isDefault && (
                          <DropdownMenuItem onClick={() => openRenameDialog(env)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Rename
                          </DropdownMenuItem>
                        )}
                        {!isDefault && (
                          <DropdownMenuItem onClick={() => handleExport(env)}>
                            <Download className="h-4 w-4 mr-2" />
                            Export
                          </DropdownMenuItem>
                        )}
                        {canWrite && !isDefault && (
                          <DropdownMenuItem
                            onClick={() => onDeleteEnvironment(env.id)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <CollapsibleContent>
                    <div className="pl-8 pr-2 py-2 space-y-2">
                      {(localVars[env.id] ?? env.variables).map((variable) => (
                        <div key={variable.id} className="flex items-center gap-2">
                          <Checkbox
                            checked={variable.enabled}
                            onCheckedChange={canWrite ? (checked) =>
                              updateVariable(env.id, localVars[env.id] ?? env.variables, variable.id, 'enabled', !!checked)
                            : undefined}
                            disabled={!canWrite}
                          />
                          <Input
                            value={variable.key}
                            onChange={(e) =>
                              updateVariable(env.id, localVars[env.id] ?? env.variables, variable.id, 'key', e.target.value, true)
                            }
                            placeholder="Variable"
                            className="h-7 text-xs bg-secondary font-mono"
                            readOnly={!canWrite}
                          />
                          <Input
                            value={variable.value}
                            onChange={(e) =>
                              updateVariable(env.id, localVars[env.id] ?? env.variables, variable.id, 'value', e.target.value, true)
                            }
                            placeholder="Value"
                            className="h-7 text-xs bg-secondary font-mono"
                            readOnly={!canWrite}
                          />
                          {canWrite && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0"
                              onClick={() => deleteVariable(env.id, localVars[env.id] ?? env.variables, variable.id)}
                            >
                              <Trash2 className="h-3 w-3 text-muted-foreground" />
                            </Button>
                          )}
                        </div>
                      ))}
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-muted-foreground"
                          onClick={() => addVariable(env.id, localVars[env.id] ?? env.variables)}
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Add Variable
                        </Button>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )
            })}
          </div>
        )}
      </div>

      {/* Create Environment Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Environment</DialogTitle>
          </DialogHeader>
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Environment name"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Environment Dialog */}
      <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Environment</DialogTitle>
          </DialogHeader>
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Environment name"
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRename}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
