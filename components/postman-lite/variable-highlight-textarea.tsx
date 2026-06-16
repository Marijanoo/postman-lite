'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'

import type { EnvironmentVariable } from '@/lib/db/types'
import { cn } from '@/lib/utils'
import { computeFoldRanges, computeHiddenLines, foldSummary } from '@/lib/json-fold'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Check, X } from 'lucide-react'
import { SearchBar } from './search-bar'

// ─── Constants ───────────────────────────────────────────────────────────────

const FONT_SIZE = 13
const LINE_HEIGHT = 20 // px — must match CSS

// ─── JSON syntax highlighting ─────────────────────────────────────────────────

function tokenizeLine(line: string): React.ReactNode {
  // Split on JSON tokens while keeping delimiters
  const parts = line.split(/("(?:[^"\\]|\\.)*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[:,{}\[\]])/g)

  const nodes: React.ReactNode[] = []
  for (let i = 0; i < parts.length; i++) {
    const token = parts[i]
    if (!token) continue

    if (token.startsWith('"')) {
      // Key if the next non-empty token is ':'
      let j = i + 1
      while (j < parts.length && parts[j].trim() === '') j++
      const nextToken = parts[j] ?? ''
      if (nextToken === ':') {
        nodes.push(<span key={i} style={{ color: 'var(--json-key)' }}>{token}</span>)
      } else {
        nodes.push(<span key={i} style={{ color: 'var(--json-string)' }}>{token}</span>)
      }
    } else if (/^-?\d/.test(token)) {
      nodes.push(<span key={i} style={{ color: 'var(--json-number)' }}>{token}</span>)
    } else if (token === 'true' || token === 'false') {
      nodes.push(<span key={i} style={{ color: 'var(--json-boolean)' }}>{token}</span>)
    } else if (token === 'null') {
      nodes.push(<span key={i} style={{ color: 'var(--muted-foreground)' }}>{token}</span>)
    } else if (/^[:,{}\[\]]$/.test(token)) {
      nodes.push(<span key={i} style={{ color: 'var(--muted-foreground)' }}>{token}</span>)
    } else {
      nodes.push(<span key={i}>{token}</span>)
    }
  }
  return <>{nodes}</>
}

// ─── Variable tag ─────────────────────────────────────────────────────────────

const VARIABLE_RE = /\{\{([^}]+)\}\}/g

interface VariableMatch {
  fullMatch: string
  variableName: string
  start: number
  end: number
}

function extractVars(text: string): VariableMatch[] {
  const out: VariableMatch[] = []
  VARIABLE_RE.lastIndex = 0
  let m
  while ((m = VARIABLE_RE.exec(text)) !== null) {
    out.push({ fullMatch: m[0], variableName: m[1].trim(), start: m.index, end: m.index + m[0].length })
  }
  return out
}

interface VariableTagProps {
  variableName: string
  fullMatch: string
  variables: EnvironmentVariable[]
  onUpdateVariable?: (key: string, value: string) => void
}

function VariableTag({ variableName, fullMatch, variables, onUpdateVariable }: VariableTagProps) {
  const [open, setOpen] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const variable = variables.find((v) => v.key === variableName && v.enabled)
  const resolved = !!variable
  const currentValue = variable?.value ?? ''

  useEffect(() => {
    if (open) { setEditValue(currentValue) }
  }, [open, currentValue])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const save = () => { onUpdateVariable?.(variableName, editValue); setOpen(false) }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          onMouseEnter={() => { timerRef.current = setTimeout(() => setOpen(true), 500) }}
          onMouseLeave={() => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null } }}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'inline-block px-1 rounded cursor-pointer transition-colors',
            resolved
              ? 'bg-[oklch(0.35_0.12_160)] text-[oklch(0.85_0.15_160)] hover:bg-[oklch(0.4_0.12_160)]'
              : 'bg-[oklch(0.35_0.15_30)] text-[oklch(0.85_0.12_30)] hover:bg-[oklch(0.4_0.15_30)]',
          )}
          title={resolved ? `${variableName} = ${currentValue}` : `${variableName} (unresolved)`}
        >
          {fullMatch}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{variableName}</span>
            <span className={cn('text-xs px-1.5 py-0.5 rounded', resolved ? 'bg-[oklch(0.35_0.12_160)] text-[oklch(0.85_0.1_160)]' : 'bg-[oklch(0.35_0.15_30)] text-[oklch(0.85_0.1_30)]')}>
              {resolved ? 'Resolved' : 'Unresolved'}
            </span>
          </div>
          {resolved && <div className="text-xs text-muted-foreground">Current: <span className="font-mono text-foreground truncate max-w-[180px] inline-block align-bottom" title={currentValue}>{currentValue}</span></div>}
          {onUpdateVariable && (
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">{resolved ? 'Update value:' : 'Set value:'}</label>
              <div className="flex items-center gap-2">
                <Input ref={inputRef} value={editValue} onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') save(); else if (e.key === 'Escape') setOpen(false) }}
                  placeholder="Enter value" className="h-8 text-sm font-mono flex-1" />
                <Button size="icon" variant="ghost" className="h-8 w-8 text-[oklch(0.7_0.15_160)]" onClick={save}><Check className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── Line renderer ────────────────────────────────────────────────────────────

interface LineProps {
  text: string
  language: 'json' | 'text'
  variables: EnvironmentVariable[]
  onUpdateVariable?: (key: string, value: string) => void
}

function renderLineContent({ text, language, variables, onUpdateVariable }: LineProps): React.ReactNode {
  const varMatches = extractVars(text)
  if (varMatches.length === 0) {
    return language === 'json' ? tokenizeLine(text) : <>{text}</>
  }

  const nodes: React.ReactNode[] = []
  let cursor = 0
  varMatches.forEach((m, i) => {
    if (m.start > cursor) {
      const seg = text.slice(cursor, m.start)
      nodes.push(<span key={`t${i}`}>{language === 'json' ? tokenizeLine(seg) : seg}</span>)
    }
    nodes.push(
      <VariableTag key={`v${i}`} variableName={m.variableName} fullMatch={m.fullMatch}
        variables={variables} onUpdateVariable={onUpdateVariable} />
    )
    cursor = m.end
  })
  if (cursor < text.length) {
    const seg = text.slice(cursor)
    nodes.push(<span key="te">{language === 'json' ? tokenizeLine(seg) : seg}</span>)
  }
  return <>{nodes}</>
}

// ─── Search highlight renderer ───────────────────────────────────────────────

function renderSearchHighlights(lines: string[], query: string, activeMatch: number): React.ReactNode {
  const q = query.toLowerCase()
  const nodes: React.ReactNode[] = []
  let globalMatchIndex = 0

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]
    const lower = line.toLowerCase()
    const parts: React.ReactNode[] = []
    let pos = 0

    while (pos <= line.length) {
      const idx = lower.indexOf(q, pos)
      if (idx === -1) {
        parts.push(<span key={`t${pos}`}>{line.slice(pos)}</span>)
        break
      }
      if (idx > pos) parts.push(<span key={`t${pos}`}>{line.slice(pos, idx)}</span>)
      const cls = globalMatchIndex === activeMatch ? 'search-match-active' : 'search-match'
      parts.push(
        <mark key={`m${idx}`} className={cls}>{line.slice(idx, idx + q.length)}</mark>
      )
      globalMatchIndex++
      pos = idx + q.length
    }

    nodes.push(
      <div key={lineIdx} style={{ lineHeight: `${LINE_HEIGHT}px`, minHeight: `${LINE_HEIGHT}px`, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {parts}
      </div>
    )
  }

  return <>{nodes}</>
}

// ─── Main component ───────────────────────────────────────────────────────────

interface VariableHighlightTextareaProps {
  value: string
  onChange: (value: string) => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  placeholder?: string
  className?: string
  variables: EnvironmentVariable[]
  onUpdateVariable?: (key: string, value: string) => void
  language?: 'json' | 'text'
  readOnly?: boolean
}

interface HistoryEntry { value: string; ss: number; se: number }

export function VariableHighlightTextarea({
  value,
  onChange,
  onKeyDown: onKeyDownProp,
  placeholder,
  className,
  variables,
  onUpdateVariable,
  language = 'text',
  readOnly,
}: VariableHighlightTextareaProps) {
  const [localValue, setLocalValue] = useState(value)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)   // the scrolling container
  const gutterRef = useRef<HTMLDivElement>(null)
  const [activeLine, setActiveLine] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)

  const isComposingRef = useRef(false)
  const onChangeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync with prop value only when it changes externally (not from our own edits)
  useEffect(() => {
    if (!isComposingRef.current) {
      setLocalValue(value)
    }
  }, [value])

  const handleChange = (val: string, immediate = false) => {
    setLocalValue(val)
    if (onChangeDebounceRef.current) clearTimeout(onChangeDebounceRef.current)
    if (immediate) {
      onChange(val)
    } else {
      onChangeDebounceRef.current = setTimeout(() => { onChange(val) }, 150)
    }
  }

  // ── Custom undo/redo stack ────────────────────────────────────────────────
  const historyRef = useRef<HistoryEntry[]>([{ value, ss: 0, se: 0 }])
  const historyIndexRef = useRef(0)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Save a checkpoint immediately (for structural edits like Enter/Tab/pair)
  const saveCheckpoint = useCallback((val: string, ss: number, se: number) => {
    if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null }
    const history = historyRef.current
    const idx = historyIndexRef.current
    const last = history[idx]
    if (last?.value === val) return
    const next = history.slice(0, idx + 1)
    next.push({ value: val, ss, se })
    if (next.length > 200) next.shift()
    historyRef.current = next
    historyIndexRef.current = next.length - 1
  }, [])

  // Debounced checkpoint for regular typing — fires 500ms after last keystroke
  const scheduleCheckpoint = useCallback((val: string, ss: number, se: number) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      saveCheckpoint(val, ss, se)
    }, 500)
  }, [saveCheckpoint])

  const applyHistory = useCallback((entry: HistoryEntry) => {
    handleChange(entry.value, true)
    setTimeout(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.selectionStart = entry.ss
      ta.selectionEnd = entry.se
      setActiveLine(ta.value.slice(0, entry.ss).split('\n').length - 1)
    }, 0)
  }, [handleChange])

  const undo = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
      const ta = textareaRef.current
      saveCheckpoint(localValue, ta?.selectionStart ?? 0, ta?.selectionEnd ?? 0)
    }
    const idx = historyIndexRef.current
    if (idx <= 0) return
    historyIndexRef.current = idx - 1
    applyHistory(historyRef.current[idx - 1])
  }, [localValue, saveCheckpoint, applyHistory])

  const redo = useCallback(() => {
    const history = historyRef.current
    const idx = historyIndexRef.current
    if (idx >= history.length - 1) return
    historyIndexRef.current = idx + 1
    applyHistory(history[idx + 1])
  }, [applyHistory])

  // Keep history in sync when value changes externally (e.g. beautify)
  const prevValueRef = useRef(value)
  useEffect(() => {
    if (value !== prevValueRef.current) {
      prevValueRef.current = value
      const inHistory = historyRef.current[historyIndexRef.current]?.value === value
      if (!inHistory) saveCheckpoint(value, 0, 0)
    }
  }, [value, saveCheckpoint])


  // ── Search state ──────────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMatch, setSearchMatch] = useState(0)

  const searchMatchCount = useMemo(() => {
    if (!searchQuery) return 0
    const lower = value.toLowerCase()
    const q = searchQuery.toLowerCase()
    let count = 0
    let idx = 0
    while ((idx = lower.indexOf(q, idx)) !== -1) { count++; idx += q.length }
    return count
  }, [value, searchQuery])

  useEffect(() => {
    if (searchMatchCount === 0) setSearchMatch(0)
    else setSearchMatch(prev => Math.min(prev, searchMatchCount - 1))
  }, [searchMatchCount])

  // Scroll textarea to show current match
  useEffect(() => {
    if (!searchOpen || !searchQuery || searchMatchCount === 0) return
    const ta = textareaRef.current
    if (!ta) return
    const lower = value.toLowerCase()
    const q = searchQuery.toLowerCase()
    let idx = -1
    let count = 0
    let search = 0
    while ((idx = lower.indexOf(q, search)) !== -1) {
      if (count === searchMatch) break
      count++
      search = idx + q.length
    }
    if (idx === -1) return
    // Scroll the overlay div to show the match line without stealing focus
    const matchLine = value.slice(0, idx).split('\n').length - 1
    const scrollTarget = matchLine * LINE_HEIGHT
    const scrollDiv = scrollRef.current
    if (scrollDiv) {
      const visibleHeight = scrollDiv.clientHeight
      const currentTop = ta.scrollTop
      if (scrollTarget < currentTop || scrollTarget + LINE_HEIGHT > currentTop + visibleHeight) {
        const newTop = scrollTarget - visibleHeight / 2 + LINE_HEIGHT / 2
        ta.scrollTop = Math.max(0, newTop)
        syncScroll()
      }
    }
  }, [searchMatch, searchQuery, searchMatchCount, searchOpen, value])

  const lines = localValue.split('\n')
  const lineCount = lines.length

  // ── JSON folding (only when language === 'json') ──────────────────────────
  const foldRanges = useMemo(() => language === 'json' ? computeFoldRanges(lines) : new Map<number, number>(), [localValue, language])
  const hiddenLines = useMemo(() => computeHiddenLines(collapsed, foldRanges, lineCount), [collapsed, foldRanges, lineCount])
  const toggleFold = useCallback((i: number) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }, [])

  // ── Line position tracking for wrapped lines ─────────────────────────────
  // Each entry: { top: offsetTop relative to overlay content, height: offsetHeight }
  const [linePositions, setLinePositions] = useState<{ top: number; height: number }[]>([])
  const lineRefs = useRef<(HTMLDivElement | null)[]>([])
  const roRef = useRef<ResizeObserver | null>(null)

  const measureLines = useCallback(() => {
    const overlay = scrollRef.current
    if (!overlay) return
    setLinePositions(lineRefs.current.map(el => {
      if (!el) return { top: 0, height: LINE_HEIGHT }
      return { top: el.offsetTop, height: el.offsetHeight }
    }))
  }, [])

  useEffect(() => {
    lineRefs.current = lineRefs.current.slice(0, lineCount)
    roRef.current?.disconnect()
    const ro = new ResizeObserver(measureLines)
    lineRefs.current.forEach(el => { if (el) ro.observe(el) })
    if (scrollRef.current) ro.observe(scrollRef.current)
    roRef.current = ro
    measureLines()
    return () => ro.disconnect()
  }, [lineCount, localValue, measureLines])

  // ── Scroll sync: textarea drives everything ──────────────────────────────
  const syncScroll = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    if (scrollRef.current) {
      scrollRef.current.scrollTop = ta.scrollTop
      scrollRef.current.scrollLeft = ta.scrollLeft
    }
    setScrollTop(ta.scrollTop)
  }, [])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.addEventListener('scroll', syncScroll)
    return () => ta.removeEventListener('scroll', syncScroll)
  }, [syncScroll])

  // ── Active line tracking ─────────────────────────────────────────────────
  const updateActiveLine = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    setActiveLine(ta.value.slice(0, ta.selectionStart).split('\n').length - 1)
  }, [])

  // ── Keyboard handling ────────────────────────────────────────────────────
  const pairs: Record<string, string> = { '{': '}', '[': ']', '(': ')', '"': '"', "'": "'" }
  const closers = new Set(Object.values(pairs))

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = textareaRef.current
    if (!ta) return

    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault()
      setSearchOpen(true)
      return
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault()
      undo()
      return
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
      e.preventDefault()
      redo()
      return
    }

    const { selectionStart: ss, selectionEnd: se } = ta

    // Ctrl/Cmd+Enter sends the request (handled by the global shortcut) — don't
    // insert a newline; let the event through.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      const lineStart = localValue.lastIndexOf('\n', ss - 1) + 1
      const currentLine = localValue.slice(lineStart, ss)
      const indent = currentLine.match(/^\s*/)?.[0] ?? ''
      const extra = (currentLine.trimEnd().endsWith('{') || currentLine.trimEnd().endsWith('[')) ? '  ' : ''
      const inserted = '\n' + indent + extra
      const next = localValue.slice(0, ss) + inserted + localValue.slice(se)
      const pos = ss + inserted.length
      saveCheckpoint(localValue, ss, se)
      handleChange(next, true)
      setTimeout(() => { ta.selectionStart = ta.selectionEnd = pos; updateActiveLine(); saveCheckpoint(next, pos, pos) }, 0)
      return
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      const next = localValue.slice(0, ss) + '  ' + localValue.slice(se)
      const pos = ss + 2
      saveCheckpoint(localValue, ss, se)
      handleChange(next, true)
      setTimeout(() => { ta.selectionStart = ta.selectionEnd = pos; saveCheckpoint(next, pos, pos) }, 0)
      return
    }

    // Skip over existing closer
    if (closers.has(e.key) && ss === se && localValue[ss] === e.key) {
      e.preventDefault()
      ta.selectionStart = ta.selectionEnd = ss + 1
      return
    }

    if (pairs[e.key]) {
      e.preventDefault()
      const next = localValue.slice(0, ss) + e.key + pairs[e.key] + localValue.slice(se)
      const pos = ss + 1
      saveCheckpoint(localValue, ss, se)
      handleChange(next, true)
      setTimeout(() => { ta.selectionStart = ta.selectionEnd = pos; saveCheckpoint(next, pos, pos) }, 0)
      return
    }

    if (e.key === 'Backspace' && ss === se && ss > 0 && pairs[localValue[ss - 1]] === localValue[ss]) {
      e.preventDefault()
      const next = localValue.slice(0, ss - 1) + localValue.slice(ss + 1)
      const pos = ss - 1
      saveCheckpoint(localValue, ss, se)
      handleChange(next, true)
      setTimeout(() => { ta.selectionStart = ta.selectionEnd = pos; saveCheckpoint(next, pos, pos) }, 0)
      return
    }
  }

  // ── Gutter width ─────────────────────────────────────────────────────────
  const gutterWidth = Math.max(String(lineCount).length, 2) * 9 + (language === 'json' ? 38 : 28)

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      className={cn(
        'relative flex flex-col rounded-md border border-border overflow-hidden bg-card',
        className,
      )}
      style={{ fontFamily: 'var(--font-mono)', fontSize: FONT_SIZE, lineHeight: `${LINE_HEIGHT}px` }}
    >
      {searchOpen && (
        <SearchBar
          query={searchQuery}
          onQueryChange={(q) => { setSearchQuery(q); setSearchMatch(0) }}
          matchCount={searchMatchCount}
          currentMatch={searchMatch}
          onNext={() => setSearchMatch(prev => (prev + 1) % (searchMatchCount || 1))}
          onPrev={() => setSearchMatch(prev => (prev - 1 + (searchMatchCount || 1)) % (searchMatchCount || 1))}
          onClose={() => { setSearchOpen(false); setSearchQuery(''); setSearchMatch(0); textareaRef.current?.focus() }}
        />
      )}
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* ── Editor pane (gutter + content share the same scroll container) ── */}
      <div className="relative flex-1 min-w-0">

        {/* Highlighted overlay — scrolls with textarea */}
        <div
          ref={scrollRef}
          className="code-editor absolute inset-0 overflow-hidden pointer-events-none"
          style={{ padding: `12px 12px 12px ${gutterWidth + 12}px` }}
        >
          {/* Active line stripe */}
          <div
            style={{
              position: 'absolute',
              top: linePositions[activeLine]?.top ?? (activeLine * LINE_HEIGHT + 12),
              left: 0,
              right: 0,
              height: linePositions[activeLine]?.height ?? LINE_HEIGHT,
              background: 'var(--secondary)',
              pointerEvents: 'none',
            }}
          />

          {/* Per-line highlighted content */}
          {lines.map((line, i) => {
            if (hiddenLines.has(i)) return null
            const isCollapsed = collapsed.has(i)
            const closer = foldRanges.get(i)
            const displayLine = isCollapsed && closer !== undefined
              ? foldSummary(line, lines[closer], closer - i - 1)
              : line
            return (
              <div
                key={i}
                ref={el => { lineRefs.current[i] = el }}
                style={{ lineHeight: `${LINE_HEIGHT}px`, minHeight: `${LINE_HEIGHT}px`, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', position: 'relative', zIndex: 1 }}
                onClick={isCollapsed ? () => toggleFold(i) : undefined}
              >
                {localValue === '' && i === 0
                  ? <span style={{ color: 'var(--muted-foreground)' }}>{placeholder}</span>
                  : renderLineContent({ text: displayLine, language, variables, onUpdateVariable })}
              </div>
            )
          })}

          {/* Search match highlight layer */}
          {searchOpen && searchQuery && (
            <div style={{ position: 'absolute', top: 12, left: gutterWidth + 12, right: 0, pointerEvents: 'none', color: 'transparent', zIndex: 2 }}>
              {renderSearchHighlights(lines, searchQuery, searchMatch)}
            </div>
          )}
        </div>

        {/* Gutter — absolutely positioned left column, numbers pinned to overlay line tops */}
        <div
          ref={gutterRef}
          className="absolute top-0 bottom-0 left-0 select-none pointer-events-none border-r border-border overflow-hidden"
          style={{ width: gutterWidth, background: 'var(--background)', zIndex: 3 }}
        >
          {lines.map((_, i) => {
            if (hiddenLines.has(i)) return null
            const pos = linePositions[i]
            const top = (pos ? pos.top : i * LINE_HEIGHT + 12) - scrollTop
            const height = pos?.height ?? LINE_HEIGHT
            const isFoldable = foldRanges.has(i)
            const isCollapsed = collapsed.has(i)
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  top,
                  left: 0,
                  width: '100%',
                  height,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  paddingRight: 4,
                  paddingLeft: 6,
                  color: i === activeLine ? 'var(--foreground)' : 'var(--muted-foreground)',
                  background: i === activeLine ? 'var(--secondary)' : 'transparent',
                  transition: 'background 0.05s',
                  gap: 2,
                  pointerEvents: isFoldable ? 'auto' : 'none',
                  cursor: isFoldable ? 'pointer' : 'default',
                }}
                onClick={isFoldable ? () => toggleFold(i) : undefined}
              >
                <span style={{ fontSize: 9, lineHeight: 1, opacity: isFoldable ? 1 : 0 }}>
                  {isCollapsed ? '▶' : '▼'}
                </span>
                <span style={{ minWidth: 18, textAlign: 'right' }}>{i + 1}</span>
              </div>
            )
          })}
        </div>

        {/* Actual textarea — transparent text, visible caret */}
        <textarea
          ref={textareaRef}
          value={localValue}
          onChange={readOnly ? undefined : (e) => {
            const val = e.target.value
            const ss = e.target.selectionStart ?? 0
            const se = e.target.selectionEnd ?? 0
            isComposingRef.current = true
            handleChange(val)
            updateActiveLine()
            scheduleCheckpoint(val, ss, se)
          }}
          onBlur={() => { isComposingRef.current = false }}
          onKeyDown={readOnly ? undefined : (e) => { handleKeyDown(e); onKeyDownProp?.(e) }}
          onClick={updateActiveLine}
          onKeyUp={updateActiveLine}
          onFocus={updateActiveLine}
          onScroll={syncScroll}
          readOnly={readOnly}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          className="absolute inset-0 w-full h-full resize-none bg-transparent outline-none border-none overflow-auto"
          style={{
            color: 'transparent',
            caretColor: readOnly ? 'transparent' : 'var(--primary)',
            paddingTop: 12,
            paddingBottom: 12,
            paddingLeft: gutterWidth + 12,
            paddingRight: 12,
            fontFamily: 'var(--font-mono)',
            fontSize: FONT_SIZE,
            lineHeight: `${LINE_HEIGHT}px`,
            WebkitTextFillColor: 'transparent',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        />
      </div>
      </div>
    </div>
  )
}
