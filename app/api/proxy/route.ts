import { NextRequest, NextResponse } from 'next/server'
import { ProxyAgent, fetch as undiciFetch } from 'undici'

function getProxyAgent(targetUrl: string): ProxyAgent | undefined {
  const proxyUrl =
    (targetUrl.startsWith('https')
      ? process.env.HTTPS_PROXY || process.env.https_proxy
      : process.env.HTTP_PROXY || process.env.http_proxy) ||
    process.env.ALL_PROXY || process.env.all_proxy
  if (!proxyUrl) return undefined
  return new ProxyAgent(proxyUrl)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { url, method, headers, requestBody, formDataEntries } = body

    if (!url) {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      )
    }

    if (url.includes('{{') && url.includes('}}')) {
      return NextResponse.json(
        { error: `Unresolved environment variable in URL: ${url}. Please check if the environment is active and variables are enabled.` },
        { status: 400 }
      )
    }

    // Build headers object, filtering out certain headers
    const fetchHeaders: Record<string, string> = {}
    // Also strip content-type when sending form-data — fetch sets it automatically with the correct boundary
    const isFormData = formDataEntries && formDataEntries.length > 0
    const skipHeaders = ['host', 'connection', 'content-length', 'transfer-encoding', ...(isFormData ? ['content-type'] : [])]
    
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        if (!skipHeaders.includes(key.toLowerCase()) && typeof value === 'string') {
          fetchHeaders[key] = value
        }
      }
    }

    const startTime = Date.now()

    const fetchOptions: RequestInit = {
      method: method || 'GET',
      headers: fetchHeaders,
      signal: request.signal,
    }

    // Add body for methods that support it
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      if (formDataEntries && formDataEntries.length > 0) {
        const fd = new FormData()
        for (const entry of formDataEntries) {
          if (entry.fileData) {
            const bytes = Buffer.from(entry.fileData.base64, 'base64')
            const blob = new Blob([bytes], { type: entry.fileData.mimeType })
            fd.append(entry.key, blob, entry.fileData.name)
          } else {
            fd.append(entry.key, entry.value)
          }
        }
        fetchOptions.body = fd
      } else if (requestBody) {
        fetchOptions.body = requestBody
      }
    }

    // Ensure URL has a protocol. The client normalizes this too; this is a
    // safety net for any caller that hits the proxy directly. A scheme-less
    // host (with or without a dot) gets http://, matching curl's behavior.
    const finalUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`

    const dispatcher = getProxyAgent(finalUrl)
    const response = await (dispatcher
      ? undiciFetch(finalUrl, { ...fetchOptions, dispatcher } as Parameters<typeof undiciFetch>[1])
      : fetch(finalUrl, fetchOptions))

    const endTime = Date.now()
    const responseTime = endTime - startTime

    // Get response body
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const isBinary = !isTextContentType(contentType)

    let responseBody: string
    let size: number

    if (isBinary) {
      const buffer = await response.arrayBuffer()
      responseBody = Buffer.from(buffer).toString('base64')
      size = buffer.byteLength
    } else {
      responseBody = await response.text()

      if (contentType.includes('application/json')) {
        try {
          const json = JSON.parse(responseBody)
          responseBody = JSON.stringify(json, null, 2)
        } catch {
          // keep original text if JSON parse fails
        }
      }

      size = new TextEncoder().encode(responseBody).length
    }

    // Convert headers to plain object
    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })

    return NextResponse.json({
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      size: size,
      time: responseTime,
      contentType: contentType,
      isBinary: isBinary,
      url: finalUrl,
    })
  } catch (error) {
    const raw = error instanceof Error ? error.message : 'Unknown error occurred'
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined
    const errorMessage = friendlyNetworkError(raw)
    const detail = cause && cause !== raw ? `${errorMessage} (${cause})` : errorMessage

    return NextResponse.json({
      status: 0,
      statusText: 'Network Error',
      headers: {},
      body: JSON.stringify({ error: detail }, null, 2),
      size: 0,
      time: 0,
      contentType: 'application/json',
      isBinary: false,
    })
  }
}

function isTextContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase().split(';')[0].trim()
  if (ct.startsWith('text/')) return true
  const textTypes = [
    'application/json',
    'application/ld+json',
    'application/geo+json',
    'application/xml',
    'application/xhtml+xml',
    'application/javascript',
    'application/x-javascript',
    'application/typescript',
    'application/graphql',
    'application/x-www-form-urlencoded',
    'application/x-ndjson',
    'application/problem+json',
    'application/vnd.api+json',
    'image/svg+xml',
  ]
  return textTypes.includes(ct)
}

function friendlyNetworkError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('fetch failed') || m.includes('econnrefused')) {
    return 'Connection refused — the server is not reachable. Check the URL and make sure the server is running.'
  }
  if (m.includes('enotfound') || m.includes('getaddrinfo')) {
    return 'Could not resolve host — check the URL and your network connection.'
  }
  if (m.includes('etimedout') || m.includes('timed out') || m.includes('timeout')) {
    return 'Request timed out — the server took too long to respond.'
  }
  if (m.includes('econnreset') || m.includes('connection reset')) {
    return 'Connection was reset by the server.'
  }
  if (m.includes('cert') || m.includes('ssl') || m.includes('tls')) {
    return `SSL/TLS error — ${message}`
  }
  return message
}
