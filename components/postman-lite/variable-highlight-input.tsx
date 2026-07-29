'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useDebouncedCallback } from '@/hooks/use-debounce'
import type { EnvironmentVariable } from '@/lib/db/types'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Check, X } from 'lucide-react'

interface VariableHighlightInputProps {
  value: string
  resetKey?: string | number  // change to force a full reset (tab switch, request open)
  onChange: (value: string) => void
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void
  onEnter?: (currentValue: string) => void
  placeholder?: string
  className?: string
  variables: EnvironmentVariable[]
  onUpdateVariable?: (key: string, value: string) => void
  disabled?: boolean
  readOnly?: boolean
  bare?: boolean // strip all Input chrome — no border, no background, no padding
}

interface VariableMatch {
  fullMatch: string
  variableName: string
  start: number
  end: number
}

function extractVariableMatches(text: string): VariableMatch[] {
  const pattern = /\{\{([^}]+)\}\}/g
  const matches: VariableMatch[] = []
  let match
  while ((match = pattern.exec(text)) !== null) {
    matches.push({
      fullMatch: match[0],
      variableName: match[1].trim(),
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return matches
}

export function VariableHighlightInput({
  value,
  resetKey,
  onChange,
  onPaste,
  onEnter,
  placeholder,
  className,
  variables,
  onUpdateVariable,
  disabled,
  readOnly,
  bare,
}: VariableHighlightInputProps) {
  const [isFocused, setIsFocused] = useState(false)
  const [popoverMatch, setPopoverMatch] = useState<VariableMatch | null>(null)
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null)
  const [localValue, setLocalValue] = useState(value)
  const [editValue, setEditValue] = useState('')
  const [computedFontSize, setComputedFontSize] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null)
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const editInputFocusedRef = useRef(false)
  const undoStackRef = useRef<{ value: string; selStart: number; selEnd: number }[]>([{ value, selStart: 0, selEnd: 0 }])
  const undoIndexRef = useRef(0)
  const skipUndoPushRef = useRef(false)
  const lastEmittedValueRef = useRef(value)

  // Reset when the parent signals a genuine external change (tab switch, request open)
  // by changing resetKey. This avoids false resets from stale re-renders during async DB writes.
  useEffect(() => {
    setLocalValue(value)
    undoStackRef.current = [{ value, selStart: 0, selEnd: 0 }]
    undoIndexRef.current = 0
    lastEmittedValueRef.current = value
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  // Also sync when `value` changes for a reason other than this input's own
  // edits echoing back — e.g. a param row's value gets rewritten because the
  // URL bar's query string changed. lastEmittedValueRef holds whatever this
  // input itself last sent upstream, so comparing against it (rather than
  // resetting on every prop change) tells an external update apart from our
  // own committed keystroke bouncing back, which would otherwise revert the
  // field mid-edit.
  useEffect(() => {
    if (value !== lastEmittedValueRef.current) {
      setLocalValue(value)
      lastEmittedValueRef.current = value
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // Capture the input's computed font size so the overlay can match it exactly
  useEffect(() => {
    if (bare && inputRef.current) {
      setComputedFontSize(getComputedStyle(inputRef.current).fontSize)
    }
  }, [bare, className])

  const [debouncedOnChange, cancelDebouncedOnChange] = useDebouncedCallback(onChange, 300)

  const pushUndo = useCallback((val: string, selStart: number, selEnd: number) => {
    if (skipUndoPushRef.current) return
    const stack = undoStackRef.current
    const idx = undoIndexRef.current
    // Truncate forward history
    const newStack = stack.slice(0, idx + 1)
    // Avoid duplicate consecutive entries
    if (newStack.length > 0 && newStack[newStack.length - 1].value === val) return
    newStack.push({ value: val, selStart, selEnd })
    if (newStack.length > 200) newStack.shift()
    undoStackRef.current = newStack
    undoIndexRef.current = newStack.length - 1
  }, [])

  const handleChange = (newValue: string, immediate = false) => {
    const input = inputRef.current
    const selStart = input?.selectionStart ?? newValue.length
    const selEnd = input?.selectionEnd ?? newValue.length
    pushUndo(newValue, selStart, selEnd)
    setLocalValue(newValue)
    lastEmittedValueRef.current = newValue
    if (immediate) {
      // Cancel any pending debounced call rather than rescheduling it — firing
      // now makes a later duplicate redundant, and if left armed it would
      // replay this same (increasingly stale) value 300ms from now, clobbering
      // whatever changed in the meantime.
      cancelDebouncedOnChange()
      onChange(newValue)
    } else {
      debouncedOnChange(newValue)
    }
  }

  const syncScroll = useCallback(() => {
    if (inputRef.current && overlayRef.current) {
      overlayRef.current.scrollLeft = inputRef.current.scrollLeft
    }
  }, [])

  useEffect(() => {
    const input = inputRef.current
    if (input) {
      input.addEventListener('scroll', syncScroll)
      return () => input.removeEventListener('scroll', syncScroll)
    }
  }, [syncScroll])

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  const scheduleClose = useCallback(() => {
    if (editInputFocusedRef.current) return
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => {
      if (editInputFocusedRef.current) return
      setPopoverMatch(null)
      setPopoverPos(null)
    }, 150)
  }, [])

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (popoverMatch) {
      const variable = variables.find(v => v.key === popoverMatch.variableName && v.enabled)
      setEditValue(variable?.value || '')
    }
  }, [popoverMatch])

  // Close popover on outside click
  useEffect(() => {
    if (!popoverMatch) return
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverMatch(null)
        setPopoverPos(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [popoverMatch])

  const variableMatches = extractVariableMatches(localValue)

  const getMatchAtClientX = useCallback((clientX: number): VariableMatch | null => {
    const overlay = overlayRef.current
    if (!overlay) return null
    const spans = overlay.querySelectorAll<HTMLSpanElement>('span[data-var-idx]')
    for (const span of spans) {
      const rect = span.getBoundingClientRect()
      if (clientX >= rect.left && clientX <= rect.right) {
        const idx = parseInt(span.dataset.varIdx || '-1', 10)
        return variableMatches[idx] ?? null
      }
    }
    return null
  }, [variableMatches])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
    const match = getMatchAtClientX(e.clientX)

    if (popoverMatch) {
      // Popover is open — cancel close if hovering over the same tag
      if (match?.variableName === popoverMatch.variableName) {
        cancelClose()
      } else {
        scheduleClose()
      }
      return
    }

    const currentTimer = hoverTimerRef.current
    if (match) {
      cancelClose()
      if (!currentTimer) {
        const capturedX = e.clientX
        const capturedY = e.clientY
        hoverTimerRef.current = setTimeout(() => {
          hoverTimerRef.current = null
          setPopoverPos({ x: capturedX, y: capturedY })
          setPopoverMatch(match)
        }, 500)
      }
    } else {
      if (currentTimer) {
        clearTimeout(currentTimer)
        hoverTimerRef.current = null
      }
    }
  }, [popoverMatch, getMatchAtClientX, cancelClose, scheduleClose])

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    if (popoverMatch) scheduleClose()
  }, [popoverMatch, scheduleClose])

  const handleSave = () => {
    if (onUpdateVariable && popoverMatch) {
      onUpdateVariable(popoverMatch.variableName, editValue)
    }
    setPopoverMatch(null)
    setPopoverPos(null)
  }

  const handlePopoverKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave()
    else if (e.key === 'Escape') { setPopoverMatch(null); setPopoverPos(null) }
  }

  const renderHighlightedContent = () => {
    if (variableMatches.length === 0) return null

    const segments: React.ReactNode[] = []
    let lastIndex = 0

    variableMatches.forEach((match, idx) => {
      if (match.start > lastIndex) {
        segments.push(
          <span key={`text-${idx}`} className="whitespace-pre text-foreground select-none">
            {localValue.slice(lastIndex, match.start)}
          </span>
        )
      }

      const isResolved = variables.some(v => v.key === match.variableName && v.enabled)
      segments.push(
        <span
          key={`var-${idx}`}
          data-var-idx={idx}
          className={cn(
            'font-mono text-sm select-none',
            isResolved
              ? 'bg-[oklch(0.35_0.12_160)] text-[oklch(0.85_0.15_160)]'
              : 'bg-[oklch(0.35_0.15_30)] text-[oklch(0.85_0.12_30)]'
          )}
        >
          {match.fullMatch}
        </span>
      )

      lastIndex = match.end
    })

    if (lastIndex < localValue.length) {
      segments.push(
        <span key="text-end" className="whitespace-pre text-foreground select-none">
          {localValue.slice(lastIndex)}
        </span>
      )
    }

    return segments
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = inputRef.current
    if (!input) return

    // Undo / Redo
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'y') && !e.shiftKey) {
      e.preventDefault()
      cancelDebouncedOnChange() // prevent a pending debounced call from overwriting the undo
      const stack = undoStackRef.current
      let idx = undoIndexRef.current
      if (e.key === 'z') {
        if (idx <= 0) return
        idx -= 1
      } else {
        if (idx >= stack.length - 1) return
        idx += 1
      }
      undoIndexRef.current = idx
      const entry = stack[idx]
      skipUndoPushRef.current = true
      lastEmittedValueRef.current = entry.value
      setLocalValue(entry.value)
      onChange(entry.value)
      debouncedOnChange(entry.value)
      setTimeout(() => {
        input.selectionStart = entry.selStart
        input.selectionEnd = entry.selEnd
        skipUndoPushRef.current = false
      }, 0)
      return
    }

    const { selectionStart, selectionEnd } = input
    const char = e.key
    const pairs: Record<string, string> = { '{': '}', '[': ']', '(': ')', '"': '"', "'": "'" }

    if (pairs[char] && selectionStart !== null && selectionEnd !== null) {
      e.preventDefault()
      const newValue = localValue.slice(0, selectionStart) + char + pairs[char] + localValue.slice(selectionEnd)
      handleChange(newValue, true)
      setTimeout(() => { input.selectionStart = input.selectionEnd = selectionStart + 1 }, 0)
      return
    }

    const closingChars = Object.values(pairs)
    if (closingChars.includes(char) && selectionStart === selectionEnd && selectionStart !== null && localValue[selectionStart] === char) {
      e.preventDefault()
      input.selectionStart = input.selectionEnd = selectionStart + 1
      return
    }

    if (e.key === 'Backspace' && selectionStart !== null && selectionStart > 0) {
      if (e.ctrlKey && selectionStart === selectionEnd) {
        e.preventDefault()
        // Delete back to the start of the previous word (mirrors browser Ctrl+Backspace)
        let i = selectionStart
        while (i > 0 && /\W/.test(localValue[i - 1])) i--
        while (i > 0 && /\w/.test(localValue[i - 1])) i--
        const newValue = localValue.slice(0, i) + localValue.slice(selectionStart)
        handleChange(newValue, true)
        setTimeout(() => { input.selectionStart = input.selectionEnd = i }, 0)
        return
      }

      if (selectionStart === selectionEnd) {
        const charBefore = localValue[selectionStart - 1]
        const charAfter = localValue[selectionStart]
        if (pairs[charBefore] === charAfter) {
          e.preventDefault()
          const newValue = localValue.slice(0, selectionStart - 1) + localValue.slice(selectionStart + 1)
          handleChange(newValue, true)
          setTimeout(() => { input.selectionStart = input.selectionEnd = selectionStart - 1 }, 0)
          return
        }
      }
    }

    if (e.key === 'Enter') {
      cancelDebouncedOnChange()
      lastEmittedValueRef.current = localValue
      onChange(localValue)
      onEnter?.(localValue)
    }
  }

  const activeVariable = popoverMatch ? variables.find(v => v.key === popoverMatch.variableName && v.enabled) : null
  const isResolved = !!activeVariable

  return (
    <div className="relative">
      {/* Highlight overlay — on top visually, but pointer-events-none so input handles all events */}
      {variableMatches.length > 0 && (
        <div
          ref={overlayRef}
          className={cn(
            'absolute inset-px flex items-center overflow-hidden pointer-events-none',
            bare ? 'px-0' : 'px-3',
          )}
          style={{ zIndex: 3 }}
        >
          <div
            className="flex items-center whitespace-nowrap font-mono"
            style={{ fontSize: bare ? (computedFontSize ?? 'inherit') : '0.875rem' }}
          >
            {renderHighlightedContent()}
          </div>
        </div>
      )}

      {/* Actual input — transparent text so overlay shows through */}
      <Input
        ref={inputRef}
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onMouseMove={variableMatches.length > 0 ? handleMouseMove : undefined}
        onMouseLeave={variableMatches.length > 0 ? handleMouseLeave : undefined}
        placeholder={placeholder}
        className={cn(
          'font-mono',
          bare ? 'border-none bg-transparent shadow-none outline-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-0 rounded-none' : 'text-sm',
          variableMatches.length > 0 && 'text-transparent caret-foreground selection:bg-primary/30 selection:text-transparent bg-transparent',
          className
        )}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        disabled={disabled}
        readOnly={readOnly}
        style={variableMatches.length > 0 ? { caretColor: 'var(--foreground)', position: 'relative', zIndex: 4, background: 'transparent' } : undefined}
        onFocus={() => {
          setIsFocused(true)
          // Seed undo stack with current value so Ctrl+Z can always revert to it
          if (undoStackRef.current.length === 0) {
            undoStackRef.current = [{ value: localValue, selStart: 0, selEnd: 0 }]
            undoIndexRef.current = 0
          }
        }}
        onBlur={() => {
          setIsFocused(false)
          if (localValue !== value) handleChange(localValue, true)
        }}
        onPaste={onPaste}
      />

      {/* Hover popover */}
      {popoverMatch && popoverPos && (
        <div
          ref={popoverRef}
          className="fixed z-50 w-72 rounded-md border border-border bg-popover p-3 shadow-md"
          style={{ left: popoverPos.x, top: popoverPos.y + 24 }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{popoverMatch.variableName}</span>
              <span className={cn('text-xs px-1.5 py-0.5 rounded', isResolved ? 'bg-[oklch(0.35_0.12_160)] text-[oklch(0.85_0.1_160)]' : 'bg-[oklch(0.35_0.15_30)] text-[oklch(0.85_0.1_30)]')}>
                {isResolved ? 'Resolved' : 'Unresolved'}
              </span>
            </div>
            {isResolved && (
              <div className="text-xs text-muted-foreground">
                Current: <span className="font-mono text-foreground truncate max-w-[180px] inline-block align-bottom" title={activeVariable.value}>{activeVariable.value}</span>
              </div>
            )}
            {onUpdateVariable && (
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{isResolved ? 'Update value:' : 'Set value:'}</label>
                <div className="flex items-center gap-2">
                  <Input
                    ref={editInputRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handlePopoverKeyDown}
                    onFocus={() => { editInputFocusedRef.current = true }}
                    onBlur={() => { editInputFocusedRef.current = false }}
                    placeholder="Enter value"
                    className="h-8 text-sm font-mono flex-1"
                  />
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-[oklch(0.7_0.15_160)] hover:text-[oklch(0.8_0.15_160)]" onClick={handleSave}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => { setPopoverMatch(null); setPopoverPos(null) }}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
            {!onUpdateVariable && !isResolved && (
              <div className="text-xs text-muted-foreground">Add this variable to an environment to resolve it.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
