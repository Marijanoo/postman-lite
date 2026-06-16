'use client'

import type { Environment } from '@/lib/db/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Settings, ChevronDown, Check } from 'lucide-react'

interface EnvironmentSelectorProps {
  environments: Environment[]
  activeEnvironment?: Environment
  onSelect: (id: string | null) => void
}

export function EnvironmentSelector({
  environments,
  activeEnvironment,
  onSelect,
}: EnvironmentSelectorProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1.5 px-2 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <Settings className="h-3.5 w-3.5 shrink-0" />
          <span className="text-xs font-medium max-w-32 truncate">
            {activeEnvironment?.name ?? 'Default Environment'}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        {environments.map((env) => (
          <DropdownMenuItem
            key={env.id}
            onClick={() => onSelect(env.id)}
            className="flex items-center gap-2"
          >
            <span className="w-3.5 shrink-0">
              {activeEnvironment?.id === env.id && <Check className="h-3.5 w-3.5 text-primary" />}
            </span>
            {env.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
