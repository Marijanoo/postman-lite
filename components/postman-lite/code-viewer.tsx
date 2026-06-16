'use client'

import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { SearchBar } from './search-bar'
import { computeFoldRanges, computeHiddenLines, foldSummary } from '@/lib/json-fold'

const LINE_HEIGHT = 20  // px — base estimate, replaced by measured values
const CHARS_PER_LINE = 80 // estimate for initial height calculation
const OVERSCAN = 15  // extra lines rendered above/below viewport

interface CodeViewerProps {
  data: string
  language?: 'json' | 'html' | 'auto'
  className?: string
  scrollResetKey?: number
}

// ── JSON token types ──────────────────────────────────────────────────────────

type Token = { type: 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation' | 'plain'; text: string }

function tokenizeLine(line: string): Token[] {
  // Split on JSON tokens, keeping delimiters
  const parts = line.split(/("(?:[^"\\]|\\.)*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[:,{}\[\]])/g)
  const tokens: Token[] = []
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i]
    if (!t) continue
    if (t.startsWith('"')) {
      let j = i + 1
      while (j < parts.length && parts[j].trim() === '') j++
      const nextToken = parts[j] ?? ''
      tokens.push({ type: nextToken === ':' ? 'key' : 'string', text: t })
    } else if (/^-?\d/.test(t)) {
      tokens.push({ type: 'number', text: t })
    } else if (t === 'true' || t === 'false') {
      tokens.push({ type: 'boolean', text: t })
    } else if (t === 'null') {
      tokens.push({ type: 'null', text: t })
    } else if (/^[:,{}\[\]]$/.test(t)) {
      tokens.push({ type: 'punctuation', text: t })
    } else {
      tokens.push({ type: 'plain', text: t })
    }
  }
  return tokens
}

function TokenSpan({ token }: { token: Token }) {
  const style: React.CSSProperties = {}
  if (token.type === 'key') style.color = 'var(--json-key)'
  else if (token.type === 'string') style.color = 'var(--json-string)'
  else if (token.type === 'number') style.color = 'var(--json-number)'
  else if (token.type === 'boolean') style.color = 'var(--json-boolean)'
  else if (token.type === 'null' || token.type === 'punctuation') style.color = 'var(--muted-foreground)'
  return <span style={style}>{token.text}</span>
}

function highlightLineWithSearch(line: string, query: string, matchOffset: number, activeMatch: number): React.ReactNode {
  if (!query) {
    const tokens = tokenizeLine(line)
    return <>{tokens.map((t, i) => <TokenSpan key={i} token={t} />)}</>
  }
  // With search: highlight matches on top of syntax coloring
  const q = query.toLowerCase()
  const lower = line.toLowerCase()
  const nodes: React.ReactNode[] = []
  let pos = 0
  let idx = matchOffset
  while (pos < line.length) {
    const found = lower.indexOf(q, pos)
    if (found === -1) {
      const seg = line.slice(pos)
      const tokens = tokenizeLine(seg)
      tokens.forEach((t, i) => nodes.push(<TokenSpan key={`${pos}-${i}`} token={t} />))
      break
    }
    if (found > pos) {
      const seg = line.slice(pos, found)
      const tokens = tokenizeLine(seg)
      tokens.forEach((t, i) => nodes.push(<TokenSpan key={`${pos}-${i}`} token={t} />))
    }
    const isActive = idx === activeMatch
    nodes.push(
      <mark key={found} className={isActive ? 'bg-primary text-primary-foreground rounded-[2px]' : 'bg-primary/30 text-foreground rounded-[2px]'}>
        {line.slice(found, found + query.length)}
      </mark>
    )
    idx++
    pos = found + query.length
  }
  return <>{nodes}</>
}

function countMatches(text: string, query: string): number {
  if (!query) return 0
  let count = 0, pos = 0
  const lower = text.toLowerCase(), q = query.toLowerCase()
  while ((pos = lower.indexOf(q, pos)) !== -1) { count++; pos += q.length }
  return count
}

// ── HTML viewer (unchanged dangerouslySetInnerHTML) ───────────────────────────

function HtmlViewer({ data }: { data: string }) {
  const highlighted = useMemo(() => highlightHtml(data), [data])
  return (
    <pre className="code-editor whitespace-pre-wrap break-all">
      <code dangerouslySetInnerHTML={{ __html: highlighted }} />
    </pre>
  )
}

// ── JSON viewer with folding + virtual scrolling ─────────────────────────────

function estimateHeight(line: string): number {
  const wrappedLines = Math.max(1, Math.ceil(line.length / CHARS_PER_LINE))
  return wrappedLines * LINE_HEIGHT
}

function JsonViewer({ data, query, activeMatch, scrollRef }: {
  data: string
  query: string
  activeMatch: number
  scrollRef: React.RefObject<HTMLDivElement | null>
}) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [selectedLine, setSelectedLine] = useState<number | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  // height cache: index = position in visibleLineIndices, value = measured/estimated px height
  const heightCache = useRef<number[]>([])
  // cumulative offsets: cumulativeOffsets[i] = sum of heights[0..i-1]
  const cumulativeOffsets = useRef<number[]>([])
  const [, forceUpdate] = useState(0)
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  const lines = useMemo(() => {
    try { return JSON.stringify(JSON.parse(data), null, 2).split('\n') }
    catch { return data.split('\n') }
  }, [data])

  useEffect(() => { setCollapsed(new Set()); setSelectedLine(null) }, [data])

  const foldRanges = useMemo(() => computeFoldRanges(lines), [lines])
  const hiddenLines = useMemo(() => computeHiddenLines(collapsed, foldRanges, lines.length), [collapsed, foldRanges, lines.length])

  const visibleLineIndices = useMemo(() => {
    const out: number[] = []
    for (let i = 0; i < lines.length; i++) {
      if (!hiddenLines.has(i)) out.push(i)
    }
    return out
  }, [lines, hiddenLines])

  // Rebuild height cache whenever visible lines change
  useMemo(() => {
    const cache = new Array(visibleLineIndices.length)
    for (let vi = 0; vi < visibleLineIndices.length; vi++) {
      const li = visibleLineIndices[vi]
      cache[vi] = heightCache.current[vi] ?? estimateHeight(lines[li])
    }
    heightCache.current = cache

    const offsets = new Array(visibleLineIndices.length + 1)
    offsets[0] = 0
    for (let vi = 0; vi < visibleLineIndices.length; vi++) {
      offsets[vi + 1] = offsets[vi] + cache[vi]
    }
    cumulativeOffsets.current = offsets
  }, [visibleLineIndices, lines])

  const lineOffsets = useMemo(() => {
    const offsets: number[] = []
    let cum = 0
    for (let i = 0; i < lines.length; i++) {
      offsets.push(cum)
      if (!hiddenLines.has(i)) cum += countMatches(lines[i], query)
    }
    return offsets
  }, [lines, hiddenLines, query])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => setScrollTop(el.scrollTop)
    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight))
    el.addEventListener('scroll', onScroll, { passive: true })
    ro.observe(el)
    setScrollTop(el.scrollTop)
    setViewportHeight(el.clientHeight)
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect() }
  }, [scrollRef])

  const totalHeight = cumulativeOffsets.current[visibleLineIndices.length] ?? 0

  // Scroll the active search match into view. In a virtualized list the target
  // row is usually not in the DOM, so we can't rely on scrollIntoView on a ref —
  // instead we locate the line holding the active match and scroll the container
  // to that line's known pixel offset.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !query) return

    // Find the line index whose match range contains activeMatch.
    let targetLine = -1
    for (let i = 0; i < lines.length; i++) {
      if (hiddenLines.has(i)) continue
      const before = lineOffsets[i] ?? 0
      const count = countMatches(lines[i], query)
      if (count > 0 && activeMatch >= before && activeMatch < before + count) {
        targetLine = i
        break
      }
    }
    if (targetLine === -1) return

    // Map the line to its position in the virtualized (visible) list, then to px.
    const vi = visibleLineIndices.indexOf(targetLine)
    if (vi === -1) return
    const offsets = cumulativeOffsets.current
    const top = offsets[vi] ?? 0
    const bottom = offsets[vi + 1] ?? top + LINE_HEIGHT

    // Only scroll when the line is outside the current viewport (block: 'nearest').
    const viewTop = el.scrollTop
    const viewBottom = viewTop + el.clientHeight
    if (top < viewTop) {
      el.scrollTo({ top, behavior: 'smooth' })
    } else if (bottom > viewBottom) {
      el.scrollTo({ top: bottom - el.clientHeight, behavior: 'smooth' })
    }
    // cumulativeOffsets/lineOffsets are refs/memo recomputed on the same inputs;
    // activeMatch is the trigger for navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatch, query, lines, hiddenLines, lineOffsets, visibleLineIndices, scrollRef])

  // Binary search: find first visible index whose bottom edge > scrollTop
  const findStartIdx = (top: number): number => {
    const offsets = cumulativeOffsets.current
    let lo = 0, hi = visibleLineIndices.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (offsets[mid + 1] <= top) lo = mid + 1
      else hi = mid
    }
    return Math.max(0, lo - OVERSCAN)
  }

  const findEndIdx = (bottom: number): number => {
    const offsets = cumulativeOffsets.current
    let lo = 0, hi = visibleLineIndices.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (offsets[mid] >= bottom) hi = mid - 1
      else lo = mid
    }
    return Math.min(visibleLineIndices.length - 1, lo + OVERSCAN)
  }

  const startVisibleIdx = findStartIdx(scrollTop)
  const endVisibleIdx = findEndIdx(scrollTop + viewportHeight)

  const paddingTop = cumulativeOffsets.current[startVisibleIdx] ?? 0
  const paddingBottom = Math.max(0, totalHeight - (cumulativeOffsets.current[endVisibleIdx + 1] ?? totalHeight))

  // After render: measure rows and update cache if heights changed
  useEffect(() => {
    let changed = false
    rowRefs.current.forEach((el, vi) => {
      const actual = el.offsetHeight
      if (actual > 0 && actual !== heightCache.current[vi]) {
        heightCache.current[vi] = actual
        changed = true
      }
    })
    if (changed) {
      const offsets = new Array(visibleLineIndices.length + 1)
      offsets[0] = 0
      for (let vi = 0; vi < visibleLineIndices.length; vi++) {
        offsets[vi + 1] = offsets[vi] + heightCache.current[vi]
      }
      cumulativeOffsets.current = offsets
      forceUpdate(n => n + 1)
    }
  })

  const toggleFold = useCallback((i: number) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }, [])

  const lineNumWidth = String(lines.length).length

  return (
    <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-words cursor-text" style={{ minHeight: totalHeight }}>
      {paddingTop > 0 && <div style={{ height: paddingTop }} aria-hidden />}
      {visibleLineIndices.slice(startVisibleIdx, endVisibleIdx + 1).map((i, idx) => {
        const vi = startVisibleIdx + idx
        const offset = lineOffsets[i] ?? 0
        const isFoldable = foldRanges.has(i)
        const isCollapsed = collapsed.has(i)
        const closer = foldRanges.get(i)
        const isSelected = selectedLine === i
        const displayLine = isCollapsed && closer !== undefined
          ? foldSummary(lines[i], lines[closer], closer - i - 1)
          : lines[i]

        const leadingSpaces = displayLine.length - displayLine.trimStart().length
        const hangIndent = `${leadingSpaces}ch`

        return (
          <div
            key={i}
            ref={el => {
              if (el) rowRefs.current.set(vi, el)
              else rowRefs.current.delete(vi)
            }}
            className={`flex items-start rounded-[2px] ${isSelected ? 'bg-primary/10' : 'hover:bg-muted/40'}`}
            onClick={() => setSelectedLine(i === selectedLine ? null : i)}
          >
            <span
              className={`shrink-0 select-none text-right mr-3 tabular-nums ${isSelected ? 'text-primary/70' : 'text-muted-foreground/40'}`}
              style={{ width: `${lineNumWidth}ch` }}
            >
              {i + 1}
            </span>
            <span
              className={`inline-block w-4 shrink-0 text-center select-none mr-1 ${isFoldable ? 'text-muted-foreground hover:text-foreground cursor-pointer' : 'cursor-default'}`}
              onClick={isFoldable ? (e) => { e.stopPropagation(); toggleFold(i) } : undefined}
            >
              {isFoldable ? (isCollapsed ? '▶' : '▼') : ''}
            </span>
            <span
              className={isCollapsed ? 'flex-1 cursor-pointer min-w-0' : 'flex-1 min-w-0'}
              style={{ paddingLeft: hangIndent, textIndent: `-${hangIndent}` }}
              onClick={isCollapsed ? (e) => { e.stopPropagation(); toggleFold(i) } : undefined}
            >
              {highlightLineWithSearch(displayLine, query, offset, activeMatch)}
            </span>
          </div>
        )
      })}
      {paddingBottom > 0 && <div style={{ height: paddingBottom }} aria-hidden />}
    </pre>
  )
}

// ── Main CodeViewer ───────────────────────────────────────────────────────────

export function CodeViewer({ data, language = 'auto', className, scrollResetKey }: CodeViewerProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [currentMatch, setCurrentMatch] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollResetKey !== undefined && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
    }
  }, [scrollResetKey])

  const isJson = useMemo(() => {
    if (language === 'json') return true
    if (language === 'html') return false
    const trimmed = data.trimStart()
    return trimmed.startsWith('{') || trimmed.startsWith('[')
  }, [data, language])

  const matchCount = useMemo(() => {
    if (!query || !isJson) return 0
    try {
      const formatted = JSON.stringify(JSON.parse(data), null, 2)
      return countMatches(formatted, query)
    } catch {
      return countMatches(data, query)
    }
  }, [data, query, isJson])

  useEffect(() => {
    if (matchCount === 0) setCurrentMatch(0)
    else setCurrentMatch(prev => Math.min(prev, matchCount - 1))
  }, [matchCount])

  // Scrolling to the active match is handled inside JsonViewer, which knows the
  // virtualized layout offsets (a DOM ref can't work when the row isn't rendered).

  const openSearch = useCallback(() => setSearchOpen(true), [])
  const closeSearch = useCallback(() => { setSearchOpen(false); setQuery(''); setCurrentMatch(0) }, [])
  const handleNext = useCallback(() => setCurrentMatch(prev => (prev + 1) % (matchCount || 1)), [matchCount])
  const handlePrev = useCallback(() => setCurrentMatch(prev => (prev - 1 + (matchCount || 1)) % (matchCount || 1)), [matchCount])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); openSearch() }
  }, [openSearch])

  return (
    <div ref={containerRef} className={`relative outline-none flex flex-col h-full ${className || ''}`} tabIndex={0} onKeyDown={handleKeyDown}>
      {searchOpen && (
        <div className="sticky top-0 z-10">
          <SearchBar
            query={query}
            onQueryChange={(q) => { setQuery(q); setCurrentMatch(0) }}
            matchCount={matchCount}
            currentMatch={currentMatch}
            onNext={handleNext}
            onPrev={handlePrev}
            onClose={closeSearch}
          />
        </div>
      )}
      {isJson ? (
        <div ref={scrollContainerRef} className="flex-1 overflow-auto p-4 min-w-0">
          <JsonViewer data={data} query={searchOpen ? query : ''} activeMatch={currentMatch} scrollRef={scrollContainerRef} />
        </div>
      ) : (
        <HtmlViewer data={data} />
      )}
    </div>
  )
}

// ── HTML highlighting ─────────────────────────────────────────────────────────

function highlightHtml(html: string): string {
  return escapeHtml(html)
    .replace(/&lt;!--[\s\S]*?--&gt;/g, '<span class="null">$0</span>')
    .replace(/&lt;(\/?[a-zA-Z0-9]+)(\s?)/g, '&lt;<span class="key">$1</span>$2')
    .replace(/(\s)([a-zA-Z0-9-]+)(=)/g, '$1<span class="number">$2</span>$3')
    .replace(/(&quot;.*?&quot;)/g, '<span class="string">$1</span>')
    .replace(/(\/?)(&gt;)/g, '<span class="punctuation">$1$2</span>')
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
