import type { KeyValuePair } from '@/lib/db/types'
import { createKeyValuePair } from '@/lib/db/types'

// Ensure a URL has a scheme. A bare host (with or without a dot, e.g. "myhost/path"
// or "localhost:3000") gets "http://" prepended, matching how curl treats a
// scheme-less argument. URLs that already carry a scheme (http://, https://, ws://,
// or any "scheme://") are left untouched.
export function ensureProtocol(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return trimmed
  // Already has a scheme like "http://", "https://", "ws://", "{{var}}://" etc.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  // Leave unresolved variable-only URLs alone — they'll be flagged downstream.
  if (trimmed.startsWith('{{')) return trimmed
  return `http://${trimmed}`
}

export function splitUrl(url: string): { base: string; search: string } {
  let depth = 0
  for (let i = 0; i < url.length; i++) {
    if (url[i] === '{' && url[i + 1] === '{') { depth++; i++; continue }
    if (url[i] === '}' && url[i + 1] === '}') { depth--; i++; continue }
    if (url[i] === '?' && depth === 0) return { base: url.slice(0, i), search: url.slice(i + 1) }
  }
  return { base: url, search: '' }
}

// Encode a query-string component with standard percent-encoding (spaces as
// %20). We deliberately do NOT use the '+'-for-space convention on encode: it
// makes a literal '+' in a value ambiguous on round-trip. A space becomes %20
// and a literal '+' becomes %2B, so the two never collide.
function encodeComponent(s: string): string {
  return encodeURIComponent(s)
}

// Decode tolerantly. We still treat '+' as a space here so that a query string
// pasted from elsewhere (which may use the '+' convention) decodes sensibly;
// our own encoder never emits a bare '+', so this only affects external input.
function decodeComponent(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    // Malformed percent-sequence — return as-is rather than throwing.
    return s
  }
}

export function paramsToSearch(params: KeyValuePair[]): string {
  return params
    .filter(p => p.enabled && p.key)
    .map(p => p.value ? `${encodeComponent(p.key)}=${encodeComponent(p.value)}` : `${encodeComponent(p.key)}=`)
    .join('&')
}

export function searchToParams(search: string, existing: KeyValuePair[]): KeyValuePair[] {
  if (!search) return []
  // Track which existing entries have already been reused so that (a) repeated
  // keys in the query string ("tag=a&tag=b") don't all collide onto the same
  // existing id — the editor identifies rows by id, so duplicate ids make rows
  // impossible to edit or delete independently — and (b) a matched-but-disabled
  // entry isn't *also* kept in the leftover "preserve disabled params" pass
  // below, which would otherwise show the same key twice.
  const used = new Set<number>()
  const pairs = search.split('&').map(part => {
    const eq = part.indexOf('=')
    const key = decodeComponent(eq === -1 ? part : part.slice(0, eq))
    const value = eq === -1 ? '' : decodeComponent(part.slice(eq + 1))
    const foundIdx = existing.findIndex((p, i) => p.key === key && !used.has(i))
    if (foundIdx !== -1) {
      used.add(foundIdx)
      return { ...existing[foundIdx], value, enabled: true }
    }
    return { ...createKeyValuePair(key, value), enabled: true }
  })
  const disabled = existing.filter((p, i) => !used.has(i) && !p.enabled && p.key)
  return [...pairs, ...disabled]
}
