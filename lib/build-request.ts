import type { RequestConfig, EnvironmentVariable } from './db/types'
import { parseVariables } from './variable-parser'
import { splitUrl, ensureProtocol } from './url-params'

export interface FormDataEntry {
  key: string
  value: string
  fileData?: { name: string; base64: string; mimeType: string }
}

export interface BuiltRequest {
  url: string
  method: string
  headers: Record<string, string>
  requestBody?: string
  formDataEntries?: FormDataEntry[]
}

const METHODS_WITH_BODY = ['POST', 'PUT', 'PATCH', 'DELETE']

/**
 * Resolve a RequestConfig into the concrete pieces that get dispatched to a
 * backend (Electron IPC or the Next.js proxy). This is the single source of
 * truth for request construction — both the interactive sender and the
 * sequence runner call it, so their behavior can never drift apart.
 */
export function buildRequest(request: RequestConfig, envVariables: EnvironmentVariable[]): BuiltRequest {
  // Strip the query string off the base URL first: it is kept in sync with
  // request.params, so re-appending params below would otherwise send every
  // URL-typed param twice.
  const { base } = splitUrl(request.url)
  let url = parseVariables(base, envVariables)

  // Add query params to URL
  const enabledParams = request.params.filter((p) => p.enabled && p.key)
  if (enabledParams.length > 0) {
    const params = new URLSearchParams()
    enabledParams.forEach((p) => {
      params.append(p.key, parseVariables(p.value, envVariables))
    })
    const separator = url.includes('?') ? '&' : '?'
    url = `${url}${separator}${params.toString()}`
  }

  // Build headers
  const headers: Record<string, string> = {}
  request.headers
    .filter((h) => h.enabled && h.key)
    .forEach((h) => {
      headers[parseVariables(h.key, envVariables)] = parseVariables(h.value, envVariables)
    })

  // Add auth headers / query param
  if (request.auth.type === 'bearer' && request.auth.bearer?.token) {
    headers['Authorization'] = `Bearer ${parseVariables(request.auth.bearer.token, envVariables)}`
  } else if (request.auth.type === 'basic' && request.auth.basic) {
    const { username, password } = request.auth.basic
    const encoded = btoa(`${parseVariables(username, envVariables)}:${parseVariables(password, envVariables)}`)
    headers['Authorization'] = `Basic ${encoded}`
  } else if (request.auth.type === 'api-key' && request.auth.apiKey) {
    const key = parseVariables(request.auth.apiKey.key, envVariables)
    const value = parseVariables(request.auth.apiKey.value, envVariables)
    if (request.auth.apiKey.addTo === 'header') {
      headers[key] = value
    } else {
      const separator = url.includes('?') ? '&' : '?'
      url = `${url}${separator}${key}=${encodeURIComponent(value)}`
    }
  }

  // Build body
  let requestBody: string | undefined
  let formDataEntries: FormDataEntry[] | undefined
  if (METHODS_WITH_BODY.includes(request.method)) {
    if (request.body.type === 'json' || request.body.type === 'raw') {
      requestBody = parseVariables(request.body.content, envVariables)
      if (request.body.type === 'json' && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json'
      }
    } else if (request.body.type === 'x-www-form-urlencoded') {
      const formData = request.body.formData?.filter((f) => f.enabled && f.key) || []
      const params = new URLSearchParams()
      formData.forEach((f) => params.append(f.key, parseVariables(f.value, envVariables)))
      requestBody = params.toString()
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    } else if (request.body.type === 'form-data') {
      const formData = request.body.formData?.filter((f) => f.enabled && f.key) || []
      formDataEntries = formData.map((f) => ({
        key: parseVariables(f.key, envVariables),
        value: parseVariables(f.value, envVariables),
        fileData: f.fileData,
      }))
    }
  }

  // Normalize the scheme once so the Electron and proxy backends dispatch an
  // identical URL regardless of how it was typed.
  url = ensureProtocol(url)

  return { url, method: request.method, headers, requestBody, formDataEntries }
}
