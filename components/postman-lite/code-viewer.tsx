'use client'

import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { SearchBar } from './search-bar'
import { computeFoldRanges, computeHiddenLines, foldSummary } from '@/lib/json-fold'
import { openExternalUrl } from '@/lib/utils'

const LINE_HEIGHT = 20  // px — base estimate, replaced by measured values
const CHARS_PER_LINE = 80 // estimate for initial height calculation
const OVERSCAN = 15  // extra lines rendered above/below viewport
// Deliberately excludes trailing quotes/brackets so a URL embedded in JSON
// string quotes or HTML markup doesn't swallow its own delimiter.
const URL_REGEX = /https?:\/\/[^\s"'<>\\]+/g

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

// Splits text around any embedded URLs, e.g. for rendering the non-URL parts
// of a JSON string value plainly and the URL part as a clickable link.
function splitOnUrls(text: string): { text: string; isUrl: boolean }[] {
  const parts: { text: string; isUrl: boolean }[] = []
  let lastIndex = 0
  for (const match of text.matchAll(URL_REGEX)) {
    const start = match.index ?? 0
    if (start > lastIndex) parts.push({ text: text.slice(lastIndex, start), isUrl: false })
    parts.push({ text: match[0], isUrl: true })
    lastIndex = start + match[0].length
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex), isUrl: false })
  return parts
}

function LinkSpan({ url }: { url: string }) {
  return (
    <a
      href={url}
      title="Ctrl+Click to open in your browser"
      className="underline decoration-dotted underline-offset-2"
      // Plain click behaves like clicking anywhere else in this read-only
      // view (places the keyboard caret, doesn't navigate); only a
      // Ctrl/Cmd+click opens the link, and it opens externally rather than
      // navigating this Electron window away from the app.
      onClick={(e) => {
        e.preventDefault()
        if (!(e.ctrlKey || e.metaKey)) return
        e.stopPropagation()
        openExternalUrl(url)
      }}
    >
      {url}
    </a>
  )
}

function TokenSpan({ token }: { token: Token }) {
  const style: React.CSSProperties = {}
  if (token.type === 'key') style.color = 'var(--json-key)'
  else if (token.type === 'string') style.color = 'var(--json-string)'
  else if (token.type === 'number') style.color = 'var(--json-number)'
  else if (token.type === 'boolean') style.color = 'var(--json-boolean)'
  else if (token.type === 'null' || token.type === 'punctuation') style.color = 'var(--muted-foreground)'

  // Cheap pre-check avoids splitOnUrls' matchAll for the common non-URL case.
  // (Avoiding URL_REGEX.test() here deliberately: it's a shared /g-flagged
  // regex, and .test() mutates its lastIndex — reusing that same object
  // across many TokenSpan renders would risk one token's leftover lastIndex
  // position silently starting the next one's search partway through.)
  if (token.type === 'string' && (token.text.includes('http://') || token.text.includes('https://'))) {
    const parts = splitOnUrls(token.text)
    return (
      <span style={style}>
        {parts.map((part, i) => part.isUrl ? <LinkSpan key={i} url={part.text} /> : <span key={i}>{part.text}</span>)}
      </span>
    )
  }

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

  // highlightHtml turns URLs into real <a> tags (see below); since this is
  // raw dangerouslySetInnerHTML, there's no per-element onClick to attach —
  // handle it via delegation on the container instead, same open/plain-click
  // rules as the JSON viewer's LinkSpan.
  const handleClick = useCallback((e: React.MouseEvent) => {
    const link = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null
    if (!link) return
    e.preventDefault()
    if (!(e.ctrlKey || e.metaKey)) return
    openExternalUrl(link.href)
  }, [])

  return (
    <pre className="code-editor whitespace-pre-wrap break-all" onClick={handleClick}>
      <code dangerouslySetInnerHTML={{ __html: highlighted }} />
    </pre>
  )
}

// ── JSON viewer with folding + virtual scrolling ─────────────────────────────

function estimateHeight(line: string): number {
  const wrappedLines = Math.max(1, Math.ceil(line.length / CHARS_PER_LINE))
  return wrappedLines * LINE_HEIGHT
}

function JsonViewer({
  data, lines, collapsed, onToggleFold, query, activeMatch, scrollRef,
  caretLine, selectionAnchorLine, onSetCaret,
}: {
  data: string
  lines: string[]
  collapsed: Set<number>
  onToggleFold: (i: number) => void
  query: string
  activeMatch: number
  scrollRef: React.RefObject<HTMLDivElement | null>
  caretLine: number | null
  selectionAnchorLine: number | null
  onSetCaret: (line: number) => void
}) {
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  // height cache: index = position in visibleLineIndices, value = measured/estimated px height
  const heightCache = useRef<number[]>([])
  // cumulative offsets: cumulativeOffsets[i] = sum of heights[0..i-1]
  const cumulativeOffsets = useRef<number[]>([])
  const [, forceUpdate] = useState(0)
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map())

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

  // Keep the keyboard caret in view as it moves via arrow keys — same
  // technique as the search-match scroll above, since the caret's row may not
  // currently be rendered. Instant, not smooth: holding an arrow key repeats
  // much faster than a smooth scroll animation can finish, so each keystroke
  // would cancel the previous animation before it caught up — the caret would
  // race ahead and the viewport would only catch up once you released the key.
  useEffect(() => {
    if (caretLine === null) return
    const el = scrollRef.current
    if (!el) return
    const vi = visibleLineIndices.indexOf(caretLine)
    if (vi === -1) return
    const offsets = cumulativeOffsets.current
    const top = offsets[vi] ?? 0
    const bottom = offsets[vi + 1] ?? top + LINE_HEIGHT
    const viewTop = el.scrollTop
    const viewBottom = viewTop + el.clientHeight
    if (top < viewTop) {
      el.scrollTo({ top, behavior: 'instant' })
    } else if (bottom > viewBottom) {
      el.scrollTo({ top: bottom - el.clientHeight, behavior: 'instant' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caretLine, visibleLineIndices, scrollRef])

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
        const isCaret = caretLine === i
        const isInSelection = selectionAnchorLine !== null && caretLine !== null &&
          i >= Math.min(selectionAnchorLine, caretLine) && i <= Math.max(selectionAnchorLine, caretLine)
        const isHighlighted = isCaret || isInSelection
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
            data-line-index={i}
            // Marks a currently-collapsed fold opener with the real line index its
            // block closes on — the copy handler uses this to expand the rendered
            // "{ … N lines }" summary back into the actual hidden content.
            data-fold-closer={isCollapsed && closer !== undefined ? closer : undefined}
            className={`flex items-start rounded-[2px] ${isInSelection ? 'bg-primary/10' : 'hover:bg-muted/40'} ${isCaret ? 'ring-1 ring-inset ring-primary/60' : ''}`}
            onClick={() => onSetCaret(i)}
          >
            <span
              className={`shrink-0 select-none text-right mr-3 tabular-nums ${isHighlighted ? 'text-primary/70' : 'text-muted-foreground/40'}`}
              style={{ width: `${lineNumWidth}ch` }}
            >
              {i + 1}
            </span>
            <span
              className={`inline-block w-4 shrink-0 text-center select-none mr-1 ${isFoldable ? 'text-muted-foreground hover:text-foreground cursor-pointer' : 'cursor-default'}`}
              onClick={isFoldable ? (e) => { e.stopPropagation(); onToggleFold(i) } : undefined}
            >
              {isFoldable ? (isCollapsed ? '▶' : '▼') : ''}
            </span>
            <span
              className={isCollapsed ? 'flex-1 cursor-pointer min-w-0' : 'flex-1 min-w-0'}
              style={{ paddingLeft: hangIndent, textIndent: `-${hangIndent}` }}
              onClick={isCollapsed ? (e) => { e.stopPropagation(); onToggleFold(i) } : undefined}
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
  // True from a Ctrl/Cmd+A in this viewer until the user starts a new manual
  // selection. The copy handler uses it to bypass the (virtualized, possibly
  // partially-rendered) DOM selection entirely and copy the full logical text.
  const selectAllRef = useRef(false)
  // Track a mouse-drag selection by line index ourselves, independent of the
  // browser's native Selection object. Virtualization only keeps rows near the
  // viewport mounted, so once a drag scrolls far enough, the native
  // selection's boundaries get silently clamped to whatever's still mounted —
  // copy then only grabs "the current parts." Instead we track the union of
  // every line that gets rendered at any point while the drag is active: as
  // the user scrolls through the document (however they do it — wheel,
  // trackpad, edge auto-scroll, scrollbar), virtualization necessarily mounts
  // every line in between along the way, so by mouseup this span covers the
  // true full range regardless of scroll method or event-ordering races.
  const isDraggingRef = useRef(false)
  const dragMinLineRef = useRef<number | null>(null)
  const dragMaxLineRef = useRef<number | null>(null)
  const scrolledDuringDragRef = useRef(false)

  const expandDragBounds = useCallback((line: number) => {
    if (dragMinLineRef.current === null || line < dragMinLineRef.current) dragMinLineRef.current = line
    if (dragMaxLineRef.current === null || line > dragMaxLineRef.current) dragMaxLineRef.current = line
  }, [])

  // Accepts anything a DOM selection/event might hand us — an EventTarget from
  // a mouse event (always an Element) or a Selection's focusNode (often a Text
  // node, since selection boundaries usually land inside text).
  const resolveLineFromNode = useCallback((node: EventTarget | Node | null): number | null => {
    if (!(node instanceof Node)) return null
    const el = node instanceof Element ? node : node.parentElement
    const row = el?.closest('[data-line-index]')
    if (!row) return null
    const n = parseInt(row.getAttribute('data-line-index') || '', 10)
    return Number.isNaN(n) ? null : n
  }, [])

  useEffect(() => {
    if (scrollResetKey !== undefined && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
    }
  }, [scrollResetKey])

  // Follow the drag anywhere on the page (the cursor commonly leaves the
  // container while auto-scrolling near an edge).
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      const line = resolveLineFromNode(e.target)
      if (line !== null) expandDragBounds(line)
    }
    const onMouseUp = () => { isDraggingRef.current = false }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [resolveLineFromNode, expandDragBounds])

  const isJson = useMemo(() => {
    if (language === 'json') return true
    if (language === 'html') return false
    const trimmed = data.trimStart()
    return trimmed.startsWith('{') || trimmed.startsWith('[')
  }, [data, language])

  // Lifted out of JsonViewer so the copy handler below (which lives at this
  // level, where keyboard focus actually is) can map a selection back to real
  // line indices and read their true, unfolded text.
  const lines = useMemo(() => {
    if (!isJson) return []
    try { return JSON.stringify(JSON.parse(data), null, 2).split('\n') }
    catch { return data.split('\n') }
  }, [data, isJson])

  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  useEffect(() => { setCollapsed(new Set()) }, [data])
  const toggleFold = useCallback((i: number) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }, [])

  // Keyboard-navigable "cursor" over the read-only response. This is a
  // per-line caret (not character-level — the text isn't editable, and
  // character precision would need pixel-accurate placement inside
  // syntax-highlighted, wrapped, virtualized, foldable text). Arrow keys move
  // it; Shift+arrow extends a line-range selection from selectionAnchorLine.
  const [caretLine, setCaretLineState] = useState<number | null>(null)
  const [selectionAnchorLine, setSelectionAnchorLine] = useState<number | null>(null)
  useEffect(() => { setCaretLineState(null); setSelectionAnchorLine(null) }, [data])

  const foldRanges = useMemo(() => computeFoldRanges(lines), [lines])
  const hiddenLines = useMemo(() => computeHiddenLines(collapsed, foldRanges, lines.length), [collapsed, foldRanges, lines.length])

  // Next non-hidden line in the given direction, clamped to the document bounds.
  const stepCaret = useCallback((from: number, dir: 1 | -1): number => {
    let n = from + dir
    while (n > 0 && n < lines.length - 1 && hiddenLines.has(n)) n += dir
    return Math.max(0, Math.min(lines.length - 1, n))
  }, [lines, hiddenLines])

  // Moves the caret to `next`. With extend=true (Shift+arrow), keeps or starts
  // a selection anchored at wherever the caret was before this move; without
  // it (a plain click or arrow key), collapses any existing selection.
  const moveCaret = useCallback((next: number, extend: boolean) => {
    setSelectionAnchorLine(anchor => extend ? (anchor ?? caretLine ?? next) : null)
    setCaretLineState(next)
  }, [caretLine])

  const matchCount = useMemo(() => {
    if (!query || !isJson) return 0
    return countMatches(lines.join('\n'), query)
  }, [lines, query, isJson])

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

  // Select all text within this viewer only — not the rest of the app — and
  // remember that the next copy should use the full logical content rather
  // than whatever happens to be in the (virtualized) DOM.
  const handleSelectAll = useCallback(() => {
    selectAllRef.current = true
    setSelectionAnchorLine(null)
    const el = scrollContainerRef.current
    const sel = window.getSelection()
    if (el && sel) {
      const range = document.createRange()
      range.selectNodeContents(el)
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }, [])

  // A fresh manual selection supersedes a prior select-all or keyboard
  // selection, and starts a new drag-tracking session (see the refs declared
  // above). The caret itself is set separately, by the row's onClick.
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    selectAllRef.current = false
    setSelectionAnchorLine(null)
    isDraggingRef.current = true
    scrolledDuringDragRef.current = false
    dragMinLineRef.current = null
    dragMaxLineRef.current = null
    const line = resolveLineFromNode(e.target)
    if (line !== null) expandDragBounds(line)
  }, [resolveLineFromNode, expandDragBounds])

  // Note when the container scrolls while a drag is in progress — that's the
  // signal virtualization may have unmounted part of the selection. Don't try
  // to pinpoint "the row under the cursor" after a scroll: the native scroll
  // is applied by the browser immediately, before React has re-rendered the
  // newly-visible rows, so a same-tick DOM/position query races React's
  // commit and can read stale rows. Instead just scan whatever rows ARE
  // currently mounted and fold them into the tracked range (see the comment
  // above the refs for why that's guaranteed to converge on the true range).
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const onScroll = () => {
      if (!isDraggingRef.current) return
      scrolledDuringDragRef.current = true
      el.querySelectorAll('[data-line-index]').forEach((row) => {
        const n = parseInt(row.getAttribute('data-line-index') || '', 10)
        if (!Number.isNaN(n)) expandDragBounds(n)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isJson, expandDragBounds])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); openSearch() }
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); handleSelectAll() }

    if (selectAllRef.current) {
      // After select-all, Left/Up collapses onto a cursor on the first line
      // and Right/Down onto the last line — an actual selection change (like
      // collapsing a text selection to one end with an arrow key), not just a
      // scroll with the "select everything" state left dangling underneath.
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && isJson && lines.length > 0) {
        e.preventDefault()
        selectAllRef.current = false
        window.getSelection()?.removeAllRanges()
        moveCaret(0, false)
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && isJson && lines.length > 0) {
        e.preventDefault()
        selectAllRef.current = false
        window.getSelection()?.removeAllRanges()
        moveCaret(lines.length - 1, false)
      }
      return
    }

    // Line-level keyboard cursor: Up/Down move it (skipping hidden/folded
    // lines), Home/End jump to the first/last line, and Shift+ any of these
    // extends a selection from wherever the caret last was.
    if (!isJson || lines.length === 0) return
    const current = caretLine ?? 0
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveCaret(stepCaret(current, 1), e.shiftKey)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveCaret(stepCaret(current, -1), e.shiftKey)
    } else if (e.key === 'Home') {
      e.preventDefault()
      moveCaret(0, e.shiftKey)
    } else if (e.key === 'End') {
      e.preventDefault()
      moveCaret(lines.length - 1, e.shiftKey)
    }
  }, [openSearch, handleSelectAll, isJson, lines, caretLine, stepCaret, moveCaret])

  // Rewrites the clipboard payload so folded rows copy their real (hidden)
  // content instead of the "{ … N lines }" summary text rendered in the DOM.
  const handleCopy = useCallback((e: React.ClipboardEvent) => {
    if (!isJson) return

    if (selectAllRef.current) {
      e.preventDefault()
      e.clipboardData.setData('text/plain', lines.join('\n'))
      return
    }

    // An explicit Shift+arrow keyboard selection is in effect — copy that
    // line range directly rather than looking at the native DOM selection
    // (there may not even be one, since this selection is ours, not the
    // browser's). A lone caret with no shift-extension doesn't reach here —
    // it's just a position marker and shouldn't hijack a mouse-drag copy.
    if (selectionAnchorLine !== null && caretLine !== null) {
      e.preventDefault()
      const startLine = Math.min(selectionAnchorLine, caretLine)
      const endLine = Math.max(selectionAnchorLine, caretLine)
      e.clipboardData.setData('text/plain', lines.slice(startLine, endLine + 1).join('\n'))
      return
    }

    // The container scrolled while this selection was being dragged — the
    // native selection's boundaries may have been clamped to whatever
    // survived virtualization. Trust the min/max line range tracked directly
    // from the drag instead (whole-line granularity only, but correct, versus
    // a native selection that's silently wrong).
    if (scrolledDuringDragRef.current && dragMinLineRef.current !== null && dragMaxLineRef.current !== null) {
      e.preventDefault()
      e.clipboardData.setData('text/plain', lines.slice(dragMinLineRef.current, dragMaxLineRef.current + 1).join('\n'))
      return
    }

    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
    const range = sel.getRangeAt(0)

    const resolveRow = (node: Node): HTMLElement | null => {
      const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement
      return el?.closest('[data-line-index]') ?? null
    }
    const startEl = resolveRow(range.startContainer)
    const endEl = resolveRow(range.endContainer)
    // Selection isn't scoped to our rows (e.g. spans into the search bar) — leave it to the browser.
    if (!startEl || !endEl) return

    // A collapsed row's boundary expands to the block it summarizes: its own
    // line index when it's the start of the selection, or the real closing
    // line's index when it's the end.
    const resolveBoundary = (el: HTMLElement, atEnd: boolean): number => {
      const lineIndex = parseInt(el.getAttribute('data-line-index') || '0', 10)
      const closerAttr = el.getAttribute('data-fold-closer')
      return closerAttr != null && atEnd ? parseInt(closerAttr, 10) : lineIndex
    }
    const startLine = resolveBoundary(startEl, false)
    const endLine = resolveBoundary(endEl, true)

    // A same-line, non-folded selection is an ordinary partial-text copy — let the browser handle it as-is.
    if (startLine === endLine && startEl.getAttribute('data-fold-closer') == null) return

    e.preventDefault()
    e.clipboardData.setData('text/plain', lines.slice(startLine, endLine + 1).join('\n'))
  }, [isJson, lines, selectionAnchorLine, caretLine])

  return (
    <div
      ref={containerRef}
      className={`relative outline-none flex flex-col h-full ${className || ''}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onCopy={handleCopy}
      onMouseDown={handleMouseDown}
    >
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
          <JsonViewer
            data={data}
            lines={lines}
            collapsed={collapsed}
            onToggleFold={toggleFold}
            query={searchOpen ? query : ''}
            activeMatch={currentMatch}
            scrollRef={scrollContainerRef}
            caretLine={caretLine}
            selectionAnchorLine={selectionAnchorLine}
            onSetCaret={(i) => moveCaret(i, false)}
          />
        </div>
      ) : (
        <div ref={scrollContainerRef} className="flex-1 overflow-auto min-w-0">
          <HtmlViewer data={data} />
        </div>
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
    // Linkify URLs last, after escaping — so href carries entity-escaped text
    // (e.g. "&amp;" for a literal "&" in a query string, which is correct
    // HTML attribute syntax and decodes back to the real URL via .href).
    // Stops at the entities marking a real delimiter (a closing quote/bracket
    // or whitespace) but keeps consuming "&amp;" since that's part of the URL.
    .replace(/https?:\/\/(?:(?!&lt;|&gt;|&quot;|&#039;|\s)[\s\S])+/g, (url) =>
      `<a href="${url}" class="underline decoration-dotted underline-offset-2" title="Ctrl+Click to open in your browser">${url}</a>`
    )
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
