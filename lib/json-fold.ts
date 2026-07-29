// Given formatted JSON lines (from JSON.stringify(_, null, 2).split('\n')),
// compute for each line:
//   - whether it opens a foldable block (ends with { or [)
//   - the matching closing line index
//   - the indent depth
//
// Returns a map from opener line index → closer line index.
export function computeFoldRanges(lines: string[]): Map<number, number> {
  const stack: number[] = []
  const ranges = new Map<number, number>()

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimEnd()

    // Inline empty collection (e.g. `"tags": [],` or `{}`) opens and closes on
    // the same line — it's never pushed onto the stack, so it must not be
    // treated as a closer either, or it pops the wrong (unrelated) opener and
    // corrupts bracket matching for the rest of the document.
    const withoutComma = trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed
    if (withoutComma.endsWith('{}') || withoutComma.endsWith('[]')) continue

    const last = trimmed[trimmed.length - 1]
    const secondLast = trimmed[trimmed.length - 2]

    // Opening bracket at end of line (possibly followed by nothing or a comma on a separate line)
    if (last === '{' || last === '[') {
      stack.push(i)
    } else if (last === '}' || last === ']' || secondLast === '}' || secondLast === ']') {
      // Closing — could be `}` or `},` or `]` or `],`
      const closeChar = (last === '}' || last === ']') ? last : secondLast
      if (closeChar === '}' || closeChar === ']') {
        // Find matching opener
        for (let s = stack.length - 1; s >= 0; s--) {
          const opener = stack[s]
          const openerTrimmed = lines[opener].trimEnd()
          const openerLast = openerTrimmed[openerTrimmed.length - 1]
          const matching = (openerLast === '{' && closeChar === '}') || (openerLast === '[' && closeChar === ']')
          if (matching) {
            // Only record if there's at least one line between opener and closer
            if (i - opener > 1) {
              ranges.set(opener, i)
            }
            stack.splice(s, 1)
            break
          }
        }
      }
    }
  }

  return ranges
}

// Given a set of collapsed opener lines and the ranges map,
// determine which lines are hidden (inside a collapsed block).
// Returns a Set of hidden line indices.
export function computeHiddenLines(
  collapsed: Set<number>,
  ranges: Map<number, number>,
  totalLines: number,
): Set<number> {
  const hidden = new Set<number>()
  for (const opener of collapsed) {
    const closer = ranges.get(opener)
    if (closer === undefined) continue
    // Hide the closer line too — the fold summary already synthesizes a
    // closing bracket, so rendering the real one as well would duplicate it.
    for (let i = opener + 1; i <= closer; i++) {
      hidden.add(i)
    }
  }
  return hidden
}

// Produce the collapsed summary text for a folded block opener line.
// E.g.  `  "key": { … 3 lines }` or `  [ … 5 lines ]`
export function foldSummary(openerLine: string, closer: string, hiddenCount: number): string {
  const trimmedOpener = openerLine.trimEnd()
  const openChar = trimmedOpener[trimmedOpener.length - 1]
  const closeChar = openChar === '{' ? '}' : ']'
  const trailing = closer.trim().endsWith(',') ? ',' : ''
  return `${trimmedOpener} … ${hiddenCount} line${hiddenCount === 1 ? '' : 's'} ${closeChar}${trailing}`
}
