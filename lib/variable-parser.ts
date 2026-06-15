// Variable substitution utility
// Replaces {{variable}} placeholders with values from the active environment

import type { EnvironmentVariable } from './db/types'

const VARIABLE_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g

export function parseVariables(text: string, variables: EnvironmentVariable[]): string {
  if (!text) return text

  return text.replace(VARIABLE_PATTERN, (match, variableName) => {
    const trimmedName = variableName.trim()
    const variable = variables.find(
      (v) => v.key.trim() === trimmedName && v.enabled
    )
    return variable ? variable.value : match
  })
}

export function extractVariables(text: string): string[] {
  if (!text) return []
  
  const matches = text.matchAll(VARIABLE_PATTERN)
  const variables = new Set<string>()
  
  for (const match of matches) {
    variables.add(match[1].trim())
  }
  
  return Array.from(variables)
}

export function highlightVariables(text: string): { text: string; isVariable: boolean }[] {
  if (!text) return []

  const parts: { text: string; isVariable: boolean }[] = []
  let lastIndex = 0

  const matches = text.matchAll(VARIABLE_PATTERN)

  for (const match of matches) {
    if (match.index !== undefined && match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), isVariable: false })
    }
    parts.push({ text: match[0], isVariable: true })
    lastIndex = (match.index ?? 0) + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), isVariable: false })
  }

  return parts
}
