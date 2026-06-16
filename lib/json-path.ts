// Resolve a simple JSON path against a parsed value, used by sequence
// "extract-json" steps. Supports:
//   - dot notation:        data.token
//   - bracket indices:     items[0].id
//   - dotted indices:      items.0.id
//   - a leading "$":       $.data.token  (optional jq/JSONPath-style root)
//   - whole-key fallback:  if the literal path is itself a key on the object
//                          (e.g. "user.id" stored as one key), return that.
//
// Returns `undefined` when the path can't be resolved.
export function resolveJsonPath(root: unknown, path: string): unknown {
  const trimmed = path.trim().replace(/^\$\.?/, '')
  if (trimmed === '') return root

  // Whole-path fallback: the literal string is a direct key (handles keys with dots).
  if (
    root != null &&
    typeof root === 'object' &&
    !Array.isArray(root) &&
    Object.prototype.hasOwnProperty.call(root, trimmed)
  ) {
    return (root as Record<string, unknown>)[trimmed]
  }

  const tokens = tokenizePath(trimmed)
  let current: unknown = root
  for (const token of tokens) {
    if (current == null) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[token]
  }
  return current
}

// Split "items[0].id" / "items.0.id" into ["items", "0", "id"].
function tokenizePath(path: string): string[] {
  const tokens: string[] = []
  for (const segment of path.split('.')) {
    if (segment === '') continue
    // Pull any [n] / [key] groups out of each dot segment.
    const bracketRe = /([^[\]]+)|\[([^\]]*)\]/g
    let match: RegExpExecArray | null
    while ((match = bracketRe.exec(segment)) !== null) {
      const piece = match[1] ?? match[2]
      if (piece !== undefined && piece !== '') tokens.push(piece)
    }
  }
  return tokens
}
