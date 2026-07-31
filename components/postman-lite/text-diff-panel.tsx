'use client'

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react'
import { useDebouncedValue } from '@/hooks/use-debounce'

// ── LCS diff (generic) ────────────────────────────────────────────────────────

function lcsDiff<T>(
  a: T[],
  b: T[],
  eq: (x: T, y: T) => boolean = (x, y) => x === y,
): Array<{ type: 'equal' | 'remove' | 'add'; value: T }> {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])

  const ops: Array<{ type: 'equal' | 'remove' | 'add'; value: T }> = []
  let i = 0, j = 0
  while (i < m || j < n) {
    if (i < m && j < n && eq(a[i], b[j])) {
      ops.push({ type: 'equal', value: a[i] }); i++; j++
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      ops.push({ type: 'add', value: b[j] }); j++
    } else {
      ops.push({ type: 'remove', value: a[i] }); i++
    }
  }
  return ops
}

// ── Line-level diff ───────────────────────────────────────────────────────────

type LineDiff =
  | { type: 'equal'; text: string }
  | { type: 'remove'; text: string }
  | { type: 'add'; text: string }
  | { type: 'changed'; removed: string; added: string }

function diffLines(a: string[], b: string[]): LineDiff[] {
  const ops = lcsDiff(a, b)
  const out: LineDiff[] = []
  let i = 0
  while (i < ops.length) {
    const op = ops[i]
    if (op.type === 'equal') {
      out.push({ type: 'equal', text: op.value }); i++
    } else if (op.type === 'remove' && i + 1 < ops.length && ops[i + 1].type === 'add') {
      out.push({ type: 'changed', removed: op.value, added: ops[i + 1].value }); i += 2
    } else {
      out.push({ type: op.type, text: op.value } as LineDiff); i++
    }
  }
  return out
}

// ── Character-level inline diff ───────────────────────────────────────────────

type CharSeg = { type: 'equal' | 'remove' | 'add'; text: string }

function diffChars(a: string, b: string): CharSeg[] {
  const ops = lcsDiff(a.split(''), b.split(''))
  const segs: CharSeg[] = []
  for (const op of ops) {
    const last = segs[segs.length - 1]
    if (last && last.type === op.type) last.text += op.value
    else segs.push({ type: op.type, text: op.value })
  }
  return segs
}

// ── Search highlight helpers ──────────────────────────────────────────────────

function highlightText(
  text: string,
  query: string,
  globalOffset: number,
  activeMatch: number,
  textClassName: string,
) {
  if (!query) return <span className={textClassName}>{text}</span>
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const nodes: React.ReactNode[] = []
  let pos = 0, idx = globalOffset
  while (pos < text.length) {
    const found = lower.indexOf(q, pos)
    if (found === -1) { nodes.push(<span key={pos} className={textClassName}>{text.slice(pos)}</span>); break }
    if (found > pos) nodes.push(<span key={pos} className={textClassName}>{text.slice(pos, found)}</span>)
    const isActive = idx === activeMatch
    nodes.push(
      <mark key={found} className={isActive
        ? 'bg-primary text-primary-foreground rounded-[2px]'
        : 'bg-primary/30 text-foreground rounded-[2px]'
      }>{text.slice(found, found + q.length)}</mark>
    )
    idx++
    pos = found + q.length
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

// ── Line renderers ────────────────────────────────────────────────────────────

function InlineLine({
  removed, added, query, matchOffset, activeMatch, activeRef,
}: {
  removed: string; added: string
  query: string; matchOffset: number; activeMatch: number
  activeRef: React.RefObject<HTMLDivElement | null>
}) {
  const segs = useMemo(() => diffChars(removed, added), [removed, added])

  // Build full visible text for search (only added chars are shown)
  const fullText = segs.map(s => s.type !== 'remove' ? s.text : '').join('')
  const hasActive = query ? (() => {
    const mc = countMatches(fullText, query)
    const localActive = activeMatch - matchOffset
    return localActive >= 0 && localActive < mc
  })() : false

  // Render segs with search highlights on non-remove parts
  let searchOff = matchOffset
  const rendered = segs.map((seg, i) => {
    if (seg.type === 'remove') {
      return <span key={i} className="bg-[oklch(0.35_0.1_25)] text-[oklch(0.9_0.15_25)] rounded-[2px]">{seg.text}</span>
    }
    const cls = seg.type === 'add'
      ? 'bg-[oklch(0.28_0.1_160)] text-[oklch(0.88_0.15_160)] rounded-[2px]'
      : 'text-foreground'
    const node = highlightText(seg.text, query, searchOff, activeMatch, cls)
    searchOff += countMatches(seg.text, query)
    return <span key={i}>{node}</span>
  })

  return (
    <div
      ref={hasActive ? activeRef : undefined}
      className="px-4 leading-[20px]"
      style={{ minHeight: 20 }}
    >
      <span className="text-muted-foreground select-none mr-2">~</span>
      {rendered}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function TextDiff({
  text1, onText1Change, text2, onText2Change,
}: {
  text1: string; onText1Change: (v: string) => void
  text2: string; onText2Change: (v: string) => void
}) {
  const setText1 = onText1Change
  const setText2 = onText2Change
  const [query, setQuery] = useState('')
  const [activeMatch, setActiveMatch] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const activeMatchRef = useRef<HTMLDivElement | null>(null)
  const diffRef = useRef<HTMLDivElement>(null)

  // The diff (line-level LCS, plus a character-level LCS per changed line) is
  // O(n*m) and gets expensive on large pasted text — debounce the inputs it
  // runs on so it recomputes once typing pauses, rather than on every
  // keystroke. The textareas themselves stay on the undebounced text1/text2,
  // so typing itself is never throttled.
  const debouncedText1 = useDebouncedValue(text1, 300)
  const debouncedText2 = useDebouncedValue(text2, 300)
  const lines = useMemo(() => diffLines(debouncedText1.split('\n'), debouncedText2.split('\n')), [debouncedText1, debouncedText2])

  const { adds, removes } = useMemo(() => {
    let adds = 0, removes = 0
    for (const l of lines) {
      if (l.type === 'add') adds++
      else if (l.type === 'remove') removes++
      else if (l.type === 'changed') { adds++; removes++ }
    }
    return { adds, removes }
  }, [lines])

  // Indices into `lines` that are non-equal (for prev/next diff navigation)
  const diffIndices = useMemo(() => lines.reduce<number[]>((acc, l, i) => {
    if (l.type !== 'equal') acc.push(i)
    return acc
  }, []), [lines])

  const [activeDiff, setActiveDiff] = useState(0)
  const lineRefs = useRef<(HTMLDivElement | null)[]>([])

  // Navigate between diffs
  const goToNextDiff = useCallback(() => {
    if (!diffIndices.length) return
    const next = (activeDiff + 1) % diffIndices.length
    setActiveDiff(next)
    lineRefs.current[diffIndices[next]]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeDiff, diffIndices])

  const goToPrevDiff = useCallback(() => {
    if (!diffIndices.length) return
    const prev = (activeDiff - 1 + diffIndices.length) % diffIndices.length
    setActiveDiff(prev)
    lineRefs.current[diffIndices[prev]]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeDiff, diffIndices])

  // Per-line visible text for search
  const lineTexts = useMemo(() => lines.map(l => {
    if (l.type === 'equal') return l.text
    if (l.type === 'remove') return l.text
    if (l.type === 'add') return l.text
    // changed: search the added (visible) text
    return l.added
  }), [lines])

  // Per-line match counts and cumulative offsets
  const { lineOffsets, totalMatches } = useMemo(() => {
    if (!query) return { lineOffsets: lines.map(() => 0), totalMatches: 0 }
    const offsets: number[] = []
    let cum = 0
    for (const t of lineTexts) { offsets.push(cum); cum += countMatches(t, query) }
    return { lineOffsets: offsets, totalMatches: cum }
  }, [lineTexts, query, lines])

  useEffect(() => {
    if (totalMatches === 0) setActiveMatch(0)
    else setActiveMatch(prev => Math.min(prev, totalMatches - 1))
  }, [totalMatches])

  useEffect(() => {
    activeMatchRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeMatch, query])

  // Reset activeDiff when lines change
  useEffect(() => { setActiveDiff(0) }, [lines])

  const prevSearch = useCallback(() => setActiveMatch(m => (m - 1 + totalMatches) % totalMatches), [totalMatches])
  const nextSearch = useCallback(() => setActiveMatch(m => (m + 1) % totalMatches), [totalMatches])

  const handleSearchKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.shiftKey ? prevSearch() : nextSearch() }
    if (e.key === 'Escape') { setQuery(''); searchRef.current?.blur() }
  }, [prevSearch, nextSearch])

  const hasContent = text1 || text2

  return (
    <div className="flex h-full min-h-0">

      {/* Left: two stacked textareas */}
      <div className="w-1/2 flex flex-col border-r border-border min-h-0">
        <div className="flex flex-col flex-1 min-h-0 border-b border-border">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
            <span className="text-sm font-medium text-foreground">Text 1</span>
            {text1 && <button onClick={() => setText1('')} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Clear</button>}
          </div>
          <textarea
            value={text1}
            onChange={e => setText1(e.target.value)}
            placeholder="Paste text here…"
            spellCheck={false}
            className="flex-1 min-h-0 w-full bg-background p-4 font-mono text-xs resize-none focus:outline-none text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
            <span className="text-sm font-medium text-foreground">Text 2</span>
            {text2 && <button onClick={() => setText2('')} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Clear</button>}
          </div>
          <textarea
            value={text2}
            onChange={e => setText2(e.target.value)}
            placeholder="Paste text here…"
            spellCheck={false}
            className="flex-1 min-h-0 w-full bg-background p-4 font-mono text-xs resize-none focus:outline-none text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Right: diff output */}
      <div className="w-1/2 flex flex-col min-h-0">

        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
          <span className="text-sm font-medium text-foreground shrink-0">Differences</span>

          {hasContent && (
            <>
              {/* Diff counters + navigation */}
              <div className="flex items-center gap-1.5 text-xs shrink-0">
                {removes === 0 && adds === 0 ? (
                  <span className="text-muted-foreground">Identical</span>
                ) : (
                  <>
                    {removes > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-[oklch(0.22_0.06_25)] text-[oklch(0.8_0.15_25)] border border-[oklch(0.45_0.12_25)/0.5]">
                        -{removes}
                      </span>
                    )}
                    {adds > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-[oklch(0.2_0.06_160)] text-[oklch(0.72_0.19_160)] border border-[oklch(0.45_0.12_160)/0.5]">
                        +{adds}
                      </span>
                    )}
                    {diffIndices.length > 0 && (
                      <>
                        <span className="text-muted-foreground tabular-nums">{activeDiff + 1}/{diffIndices.length}</span>
                        <button onClick={goToPrevDiff} className="text-muted-foreground hover:text-foreground p-0.5">
                          <ChevronUp className="h-3 w-3" />
                        </button>
                        <button onClick={goToNextDiff} className="text-muted-foreground hover:text-foreground p-0.5">
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>

              {/* Search bar */}
              <div className="flex items-center flex-1 gap-1 bg-background border border-border rounded px-2 h-6 min-w-0">
                <Search className="h-3 w-3 text-muted-foreground shrink-0" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={e => { setQuery(e.target.value); setActiveMatch(0) }}
                  onKeyDown={handleSearchKey}
                  placeholder="Search…"
                  className="flex-1 bg-transparent text-xs focus:outline-none text-foreground placeholder:text-muted-foreground min-w-0"
                />
                {query && (
                  <>
                    <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                      {totalMatches === 0 ? '0/0' : `${activeMatch + 1}/${totalMatches}`}
                    </span>
                    <button onClick={prevSearch} disabled={totalMatches === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-0.5">
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button onClick={nextSearch} disabled={totalMatches === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-0.5">
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    <button onClick={() => setQuery('')} className="text-muted-foreground hover:text-foreground p-0.5">
                      <X className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <div ref={diffRef} className="flex-1 min-h-0 overflow-auto">
          {!hasContent ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Paste text on the left to compare
            </div>
          ) : (
            <pre className="font-mono text-xs min-w-max p-0">
              {lines.map((line, i) => {
                const offset = lineOffsets[i] ?? 0
                const count = countMatches(lineTexts[i], query)
                const localActive = activeMatch - offset
                const hasActive = !!query && localActive >= 0 && localActive < count
                const isActiveDiff = diffIndices[activeDiff] === i

                const setRef = (el: HTMLDivElement | null) => {
                  lineRefs.current[i] = el
                  if (hasActive) activeMatchRef.current = el
                }

                if (line.type === 'equal') return (
                  <div key={i} ref={el => { lineRefs.current[i] = el }} className="px-4 text-muted-foreground leading-[20px]" style={{ minHeight: 20 }}>
                    {'  '}{highlightText(line.text, query, offset, activeMatch, 'text-muted-foreground')}
                  </div>
                )
                if (line.type === 'remove') return (
                  <div
                    key={i} ref={setRef}
                    className={`px-4 border-l-2 leading-[20px] ${isActiveDiff ? 'bg-[oklch(0.28_0.08_25)] border-[oklch(0.65_0.2_25)]' : 'bg-[oklch(0.22_0.06_25)] border-[oklch(0.55_0.18_25)]'}`}
                    style={{ minHeight: 20 }}
                  >
                    <span className="text-[oklch(0.6_0.08_25)] select-none mr-2">-</span>
                    {highlightText(line.text, query, offset, activeMatch, 'text-[oklch(0.85_0.12_25)]')}
                  </div>
                )
                if (line.type === 'add') return (
                  <div
                    key={i} ref={setRef}
                    className={`px-4 border-l-2 leading-[20px] ${isActiveDiff ? 'bg-[oklch(0.25_0.08_160)] border-[oklch(0.6_0.2_160)]' : 'bg-[oklch(0.2_0.06_160)] border-[oklch(0.5_0.18_160)]'}`}
                    style={{ minHeight: 20 }}
                  >
                    <span className="text-[oklch(0.55_0.1_160)] select-none mr-2">+</span>
                    {highlightText(line.text, query, offset, activeMatch, 'text-[oklch(0.85_0.12_160)]')}
                  </div>
                )
                // changed
                return (
                  <div key={i} ref={setRef} className={isActiveDiff ? 'outline outline-1 outline-primary/40 rounded-sm' : ''}>
                    <InlineLine
                      removed={line.removed}
                      added={line.added}
                      query={query}
                      matchOffset={offset}
                      activeMatch={activeMatch}
                      activeRef={activeMatchRef}
                    />
                  </div>
                )
              })}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
