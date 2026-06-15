import { generateId } from '@/lib/utils'
import type { Collection, RequestConfig, KeyValuePair, AuthConfig, BodyType, HttpMethod } from '@/lib/db/types'

type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue }

export function parseYaml(text: string): unknown {
  try { return JSON.parse(text) } catch {}

  const lines = text.split('\n')

  const parseValue = (raw: string): YamlValue => {
    const v = raw.trim()
    if (v === 'true') return true
    if (v === 'false') return false
    if (v === 'null' || v === '~' || v === '') return null
    if (/^-?\d+$/.test(v)) return parseInt(v, 10)
    if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v)
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"')
    }
    return v
  }

  const getIndent = (line: string) => line.match(/^(\s*)/)?.[1].length ?? 0

  const parseBlock = (startIdx: number, baseIndent: number): [YamlValue, number] => {
    let i = startIdx
    while (i < lines.length && lines[i].trim() === '') i++
    if (i >= lines.length) return [null, i]

    const firstIndent = getIndent(lines[i])
    if (firstIndent < baseIndent) return [null, i]

    if (lines[i].trimStart().startsWith('- ') || lines[i].trim() === '-') {
      const arr: YamlValue[] = []
      while (i < lines.length) {
        const line = lines[i]
        if (line.trim() === '') { i++; continue }
        const indent = getIndent(line)
        if (indent < firstIndent) break
        const stripped = line.trimStart()
        if (!stripped.startsWith('- ')) { i++; continue }
        const rest = stripped.slice(2).trim()
        if (rest === '') {
          const [val, nextI] = parseBlock(i + 1, indent + 2)
          arr.push(val)
          i = nextI
        } else if (rest.includes(': ') || rest.endsWith(':')) {
          const obj: Record<string, YamlValue> = {}
          const colonIdx = rest.indexOf(': ')
          if (colonIdx !== -1) {
            const k = rest.slice(0, colonIdx).trim()
            const v = rest.slice(colonIdx + 2).trim()
            obj[k] = v === '' ? null : parseValue(v)
          }
          i++
          const itemIndent = indent + 2
          while (i < lines.length) {
            const iline = lines[i]
            if (iline.trim() === '') { i++; continue }
            if (getIndent(iline) < itemIndent) break
            const istripped = iline.trimStart()
            const iColon = istripped.indexOf(': ')
            const iColonEnd = istripped.endsWith(':')
            if (iColon !== -1) {
              const k = istripped.slice(0, iColon).trim()
              const v = istripped.slice(iColon + 2).trim()
              if (v === '') {
                const [nested, nextI] = parseBlock(i + 1, getIndent(iline) + 2)
                obj[k] = nested
                i = nextI
              } else {
                obj[k] = parseValue(v)
                i++
              }
            } else if (iColonEnd) {
              const k = istripped.slice(0, -1).trim()
              const [nested, nextI] = parseBlock(i + 1, getIndent(iline) + 2)
              obj[k] = nested
              i = nextI
            } else { i++ }
          }
          arr.push(obj)
        } else {
          arr.push(parseValue(rest))
          i++
        }
      }
      return [arr, i]
    } else {
      const obj: Record<string, YamlValue> = {}
      while (i < lines.length) {
        const line = lines[i]
        if (line.trim() === '') { i++; continue }
        const indent = getIndent(line)
        if (indent < firstIndent) break
        const stripped = line.trimStart()
        const colonIdx = stripped.indexOf(': ')
        const endsColon = stripped.endsWith(':') && !stripped.startsWith('- ')
        if (colonIdx !== -1) {
          const k = stripped.slice(0, colonIdx).trim()
          const v = stripped.slice(colonIdx + 2).trim()
          if (v === '') {
            const [nested, nextI] = parseBlock(i + 1, indent + 2)
            obj[k] = nested
            i = nextI
          } else {
            obj[k] = parseValue(v)
            i++
          }
        } else if (endsColon) {
          const k = stripped.slice(0, -1).trim()
          const [nested, nextI] = parseBlock(i + 1, indent + 2)
          obj[k] = nested
          i = nextI
        } else { i++ }
      }
      return [obj, i]
    }
  }

  const [result] = parseBlock(0, 0)
  return result
}

export function parseOpenApiSpec(data: unknown): { collection: Collection; requests: RequestConfig[] } | null {
  try {
    const spec = data as Record<string, unknown>
    if (!spec.paths || typeof spec.paths !== 'object') return null

    let baseUrl = ''
    if (spec.openapi && typeof spec.openapi === 'string') {
      const servers = spec.servers as Array<{ url?: string }> | undefined
      baseUrl = servers?.[0]?.url?.replace(/\/$/, '') ?? ''
    } else if (spec.swagger === '2.0') {
      const host = (spec.host as string | undefined) ?? ''
      const basePath = (spec.basePath as string | undefined) ?? ''
      const schemes = spec.schemes as string[] | undefined
      const scheme = schemes?.[0] ?? 'https'
      baseUrl = host ? `${scheme}://${host}${basePath}` : basePath
    } else {
      return null
    }

    const infoTitle = (spec.info as Record<string, unknown> | undefined)?.title
    const collectionName = typeof infoTitle === 'string' && infoTitle ? infoTitle : 'Imported API'
    const now = Date.now()
    const collectionId = generateId()

    const collection: Collection = {
      id: collectionId,
      name: collectionName,
      description: typeof (spec.info as Record<string, unknown> | undefined)?.description === 'string'
        ? (spec.info as Record<string, unknown>).description as string
        : undefined,
      folders: [],
      createdAt: now,
      updatedAt: now,
    }

    const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const
    const importedRequests: RequestConfig[] = []

    const resolveRef = (ref: string): Record<string, unknown> | null => {
      try {
        const parts = ref.replace(/^#\//, '').split('/')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let node: any = spec
        for (const p of parts) node = node?.[p]
        return node ?? null
      } catch { return null }
    }

    const schemaToExample = (schema: Record<string, unknown> | null, depth = 0): unknown => {
      if (!schema || depth > 3) return null
      if (schema.$ref) return schemaToExample(resolveRef(schema.$ref as string), depth + 1)
      const type = schema.type as string | undefined
      if (schema.example !== undefined) return schema.example
      if (schema.enum) return (schema.enum as unknown[])[0]
      if (type === 'object' || schema.properties) {
        const props = schema.properties as Record<string, Record<string, unknown>> | undefined
        if (!props) return {}
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(props)) out[k] = schemaToExample(v, depth + 1)
        return out
      }
      if (type === 'array' || schema.items) {
        const items = schema.items as Record<string, unknown> | undefined
        return items ? [schemaToExample(items, depth + 1)] : []
      }
      if (type === 'string') return ''
      if (type === 'integer' || type === 'number') return 0
      if (type === 'boolean') return false
      return null
    }

    const paths = spec.paths as Record<string, Record<string, unknown>>

    for (const [path, pathItem] of Object.entries(paths)) {
      const pathParams = (pathItem.parameters ?? []) as Array<Record<string, unknown>>

      for (const method of METHODS) {
        const operation = pathItem[method] as Record<string, unknown> | undefined
        if (!operation) continue

        const operationParams = (operation.parameters ?? []) as Array<Record<string, unknown>>
        const allParams = [...pathParams, ...operationParams]

        const summary = operation.summary ?? operation.operationId ?? `${method.toUpperCase()} ${path}`
        const reqName = typeof summary === 'string' ? summary : `${method.toUpperCase()} ${path}`
        const url = `${baseUrl}${path}`

        const queryParams: KeyValuePair[] = allParams
          .filter(p => p.in === 'query')
          .map(p => ({
            id: generateId(),
            key: String(p.name ?? ''),
            value: '',
            description: typeof p.description === 'string' ? p.description : undefined,
            enabled: p.required === true,
          }))

        const headers: KeyValuePair[] = allParams
          .filter(p => p.in === 'header')
          .map(p => ({
            id: generateId(),
            key: String(p.name ?? ''),
            value: '',
            description: typeof p.description === 'string' ? p.description : undefined,
            enabled: p.required === true,
          }))

        let bodyType: BodyType = 'none'
        let bodyContent = ''
        let formData: KeyValuePair[] = []

        const requestBody = operation.requestBody as Record<string, unknown> | undefined
        if (requestBody) {
          const content = requestBody.content as Record<string, { schema?: Record<string, unknown> }> | undefined
          if (content?.['application/json']?.schema) {
            bodyType = 'json'
            const example = schemaToExample(content['application/json'].schema)
            bodyContent = example !== null ? JSON.stringify(example, null, 2) : ''
          } else if (content?.['application/x-www-form-urlencoded']?.schema) {
            bodyType = 'x-www-form-urlencoded'
            const props = (content['application/x-www-form-urlencoded'].schema?.properties ?? {}) as Record<string, unknown>
            formData = Object.keys(props).map(k => ({ id: generateId(), key: k, value: '', enabled: true }))
          } else if (content?.['multipart/form-data']?.schema) {
            bodyType = 'form-data'
            const props = (content['multipart/form-data'].schema?.properties ?? {}) as Record<string, unknown>
            formData = Object.keys(props).map(k => ({ id: generateId(), key: k, value: '', enabled: true }))
          }
        } else {
          const bodyParam = allParams.find(p => p.in === 'body')
          if (bodyParam?.schema) {
            bodyType = 'json'
            const example = schemaToExample(bodyParam.schema as Record<string, unknown>)
            bodyContent = example !== null ? JSON.stringify(example, null, 2) : ''
          }
          const formParams = allParams.filter(p => p.in === 'formData')
          if (formParams.length > 0) {
            bodyType = 'form-data'
            formData = formParams.map(p => ({ id: generateId(), key: String(p.name ?? ''), value: '', enabled: true }))
          }
        }

        let auth: AuthConfig = { type: 'none' }
        const securityReqs = (operation.security ?? spec.security ?? []) as Array<Record<string, unknown>>
        if (securityReqs.length > 0) {
          const schemeKey = Object.keys(securityReqs[0])[0]
          const schemes = (
            (spec.components as Record<string, unknown>)?.securitySchemes ??
            (spec.securityDefinitions as Record<string, unknown>)
          ) as Record<string, Record<string, unknown>> | undefined
          const scheme = schemes?.[schemeKey]
          if (scheme) {
            const stype = scheme.type as string
            const sin = scheme.in as string
            if (stype === 'http' && scheme.scheme === 'bearer') {
              auth = { type: 'bearer', bearer: { token: '' } }
            } else if (stype === 'http' && scheme.scheme === 'basic') {
              auth = { type: 'basic', basic: { username: '', password: '' } }
            } else if (stype === 'apiKey') {
              auth = { type: 'api-key', apiKey: { key: String(scheme.name ?? ''), value: '', addTo: sin === 'query' ? 'query' : 'header' } }
            } else if (stype === 'oauth2') {
              auth = { type: 'bearer', bearer: { token: '' } }
            }
          }
        }

        importedRequests.push({
          id: generateId(),
          name: reqName,
          method: method.toUpperCase() as HttpMethod,
          url,
          params: queryParams,
          headers,
          body: { type: bodyType, content: bodyContent, formData },
          auth,
          collectionId,
          createdAt: now,
          updatedAt: now,
        })
      }
    }

    return { collection, requests: importedRequests }
  } catch {
    return null
  }
}
