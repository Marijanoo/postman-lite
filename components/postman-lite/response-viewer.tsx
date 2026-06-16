'use client'

import { useState, useEffect, useRef } from 'react'
import type { ResponseData } from '@/lib/db/types'
import { CodeViewer } from './code-viewer'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Copy, Check, Clock, Database, FileDown, Music, Film, Eye, Code2, History } from 'lucide-react'

interface ResponseViewerProps {
  response: ResponseData | null
  isLoading: boolean
  historyTimestamp?: number | null
  scrollResetKey?: number
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getStatusColor(status: number): string {
  if (status >= 200 && status < 300) return 'text-[oklch(0.72_0.19_160)] bg-[oklch(0.72_0.19_160)]/10'
  if (status >= 300 && status < 400) return 'text-[oklch(0.65_0.2_250)] bg-[oklch(0.65_0.2_250)]/10'
  if (status >= 400 && status < 500) return 'text-[oklch(0.75_0.18_80)] bg-[oklch(0.75_0.18_80)]/10'
  return 'text-[oklch(0.65_0.22_25)] bg-[oklch(0.65_0.22_25)]/10'
}

function injectBaseHref(html: string, url?: string): string {
  if (!url) return html
  try {
    const origin = new URL(url).origin
    const baseTag = `<base href="${origin}/">`
    if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, m => m + baseTag)
    if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, m => m + `<head>${baseTag}</head>`)
    return `<head>${baseTag}</head>${html}`
  } catch {
    return html
  }
}

function base64ToBlobUrl(b64: string, mimeType: string): string {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }))
}

export function ResponseViewer({ response, isLoading, historyTimestamp, scrollResetKey }: ResponseViewerProps) {
  const [copied, setCopied] = useState(false)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState<'file' | 'raw'>('file')
  const [completing, setCompleting] = useState(false)
  const prevLoadingRef = useRef(false)

  useEffect(() => {
    if (prevLoadingRef.current && !isLoading) {
      setCompleting(true)
      const t = setTimeout(() => setCompleting(false), 300)
      return () => clearTimeout(t)
    }
    prevLoadingRef.current = isLoading
  }, [isLoading])

  // Reset preview mode when response changes
  useEffect(() => { setPreviewMode('file') }, [response?.body])

  useEffect(() => {
    if (!response?.isBinary || !response.body) {
      setBlobUrl(null)
      return
    }
    let url: string | null = null
    try {
      url = base64ToBlobUrl(response.body, response.contentType || 'application/octet-stream')
      setBlobUrl(url)
    } catch {
      setBlobUrl(null)
    }
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [response?.body, response?.isBinary, response?.contentType])

  const copyResponse = async () => {
    if (!response?.body) return
    await navigator.clipboard.writeText(response.body)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const downloadBinary = () => {
    if (!blobUrl || !response) return
    const cd = response.headers?.['content-disposition'] || ''
    const nameMatch = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
    const ext = response.contentType?.split('/')[1]?.split(';')[0] || 'bin'
    const filename = nameMatch?.[1]?.replace(/['"]/g, '') || `download.${ext}`
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  if (isLoading && !response) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent mb-4" />
        <p className="text-sm">Sending request...</p>
      </div>
    )
  }

  if (!response) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Database className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-sm">Send a request to see the response</p>
      </div>
    )
  }

  // A response can arrive with fields missing (empty/HEAD responses, results from
  // the `any`-typed Electron IPC bridge, or older persisted tabs). Normalize the
  // fields we read so the viewer never crashes on undefined.
  const body = response.body ?? ''
  const headers = response.headers ?? {}
  const ct = response.contentType || ''
  const isHtml = ct.includes('text/html') || ct.includes('application/xhtml') ||
                 body.trimStart().startsWith('<!')
  const isImage = response.isBinary && ct.startsWith('image/')
  const isPdf   = response.isBinary && ct.includes('application/pdf')
  const isAudio = response.isBinary && ct.startsWith('audio/')
  const isVideo = response.isBinary && ct.startsWith('video/')
  const hasPreview = isHtml || response.isBinary

  const defaultTab = hasPreview ? 'preview' : 'body'

  return (
    <div className="flex flex-col h-full relative">
      {(isLoading || completing) && (
        <div className="absolute inset-x-0 top-0 h-0.5 z-10 overflow-hidden">
          {completing ? (
            <div className="h-full bg-primary transition-all duration-200 ease-out" style={{ width: '100%' }} />
          ) : (
            <div className="h-full bg-primary animate-[loading-bar_1.2s_ease-in-out_infinite]" style={{ width: '40%' }} />
          )}
        </div>
      )}
      {historyTimestamp && (
        <div className="flex items-center gap-2 px-4 py-2 bg-[oklch(0.75_0.18_80)]/10 border-b border-[oklch(0.75_0.18_80)]/30 text-[oklch(0.75_0.18_80)] text-xs shrink-0">
          <History className="h-3.5 w-3.5 shrink-0" />
          <span>Historical response from {new Date(historyTimestamp).toLocaleString()} — actual responses may differ.</span>
        </div>
      )}
      {/* Response meta */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-border">
        <span className={cn('px-2 py-1 rounded text-sm font-semibold', getStatusColor(response.status))}>
          {response.status} {response.statusText}
        </span>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          {response.time}ms
        </div>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Database className="h-3.5 w-3.5" />
          {formatSize(response.size)}
        </div>
        <div className="flex-1" />
        {response.isBinary && blobUrl && (
          <Button variant="ghost" size="sm" onClick={downloadBinary} className="text-muted-foreground hover:text-foreground">
            <FileDown className="h-4 w-4 mr-1" />
            Download
          </Button>
        )}
        {!response.isBinary && (
          <Button variant="ghost" size="sm" onClick={copyResponse} className="text-muted-foreground hover:text-foreground">
            {copied ? <><Check className="h-4 w-4 mr-1" />Copied</> : <><Copy className="h-4 w-4 mr-1" />Copy</>}
          </Button>
        )}
      </div>

      {/* Tabs */}
      <Tabs
        key={`${response.time}-${response.size}`}
        defaultValue={defaultTab}
        className="flex-1 flex flex-col min-h-0"
      >
        <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent h-auto p-0">
          <TabsTrigger value="body" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">
            Body
          </TabsTrigger>
          {hasPreview && (
            <TabsTrigger value="preview" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">
              Preview
            </TabsTrigger>
          )}
          <TabsTrigger value="headers" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">
            Headers ({Object.keys(headers).length})
          </TabsTrigger>
        </TabsList>

        {/* Body tab */}
        <TabsContent value="body" className="flex-1 overflow-hidden m-0 p-0 min-h-0">
          {response.isBinary ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground p-8">
              <Database className="h-12 w-12 opacity-20" />
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-foreground">Binary content</p>
                <p className="text-xs">{ct || 'Unknown type'}</p>
                <p className="text-xs">{formatSize(response.size)}</p>
              </div>
              {blobUrl && (
                <Button variant="outline" size="sm" onClick={downloadBinary}>
                  <FileDown className="h-4 w-4 mr-2" />
                  Download file
                </Button>
              )}
              {hasPreview && (
                <p className="text-xs text-muted-foreground italic">Switch to the Preview tab to view.</p>
              )}
            </div>
          ) : (
            <CodeViewer data={body} language={ct.includes('application/json') ? 'json' : isHtml ? 'html' : 'auto'} className="h-full" scrollResetKey={scrollResetKey} />
          )}
        </TabsContent>

        {/* Preview tab */}
        {hasPreview && (
          <TabsContent value="preview" className="flex-1 m-0 p-0 min-h-0 flex flex-col">
            {/* File / Raw toggle for binary responses */}
            {response.isBinary && (
              <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-card shrink-0">
                <button
                  onClick={() => setPreviewMode('file')}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors',
                    previewMode === 'file'
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                  )}
                >
                  <Eye className="h-3.5 w-3.5" />
                  File
                </button>
                <button
                  onClick={() => setPreviewMode('raw')}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors',
                    previewMode === 'raw'
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                  )}
                >
                  <Code2 className="h-3.5 w-3.5" />
                  Raw
                </button>
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-auto">
              {previewMode === 'raw' && response.isBinary ? (
                <div className="p-4">
                  <CodeViewer data={body} language="auto" />
                </div>
              ) : isImage ? (
                <div
                  className="flex items-center justify-center h-full overflow-auto p-8"
                  style={{
                    backgroundImage:
                      'linear-gradient(45deg, oklch(0.25 0 0) 25%, transparent 25%),' +
                      'linear-gradient(-45deg, oklch(0.25 0 0) 25%, transparent 25%),' +
                      'linear-gradient(45deg, transparent 75%, oklch(0.25 0 0) 75%),' +
                      'linear-gradient(-45deg, transparent 75%, oklch(0.25 0 0) 75%)',
                    backgroundSize: '20px 20px',
                    backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                    backgroundColor: 'oklch(0.18 0 0)',
                  }}
                >
                  {blobUrl && (
                    <img
                      src={blobUrl}
                      alt="Response image"
                      className="max-w-full h-auto"
                      style={{ imageRendering: 'auto' }}
                    />
                  )}
                </div>
              ) : isPdf ? (
                blobUrl ? (
                  <iframe src={blobUrl} title="PDF Preview" className="w-full h-full border-none" />
                ) : (
                  <BinaryFallback contentType={ct} size={response.size} onDownload={downloadBinary} hasBlobUrl={false} />
                )
              ) : isAudio ? (
                <div className="flex flex-col items-center justify-center h-full gap-6">
                  <Music className="h-16 w-16 text-primary opacity-60" />
                  <p className="text-sm text-muted-foreground">{ct}</p>
                  {blobUrl && <audio src={blobUrl} controls className="w-full max-w-lg px-8" />}
                </div>
              ) : isVideo ? (
                <div className="flex items-center justify-center h-full bg-black p-4">
                  {blobUrl
                    ? <video src={blobUrl} controls className="max-w-full max-h-full" />
                    : <Film className="h-16 w-16 text-white opacity-30" />}
                </div>
              ) : isHtml ? (
                <iframe
                  srcDoc={injectBaseHref(body, response.url)}
                  title="HTML Preview"
                  className="w-full h-full border-none bg-white"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                />
              ) : (
                <BinaryFallback contentType={ct} size={response.size} onDownload={downloadBinary} hasBlobUrl={!!blobUrl} />
              )}
            </div>
          </TabsContent>
        )}

        {/* Headers tab */}
        <TabsContent value="headers" className="flex-1 overflow-auto m-0 p-4">
          <div className="space-y-1">
            {Object.entries(headers).map(([key, value]) => (
              <div key={key} className="flex gap-4 py-1 text-sm font-mono border-b border-border/30 last:border-0">
                <span className="text-muted-foreground min-w-[200px] shrink-0">{key}</span>
                <span className="text-foreground break-all">{value}</span>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function BinaryFallback({
  contentType, size, onDownload, hasBlobUrl,
}: {
  contentType: string; size: number; onDownload: () => void; hasBlobUrl: boolean
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
      <Database className="h-12 w-12 opacity-20" />
      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-foreground">No preview available</p>
        <p className="text-xs">{contentType || 'Unknown type'}</p>
        <p className="text-xs">{formatSize(size)}</p>
      </div>
      {hasBlobUrl && (
        <Button variant="outline" size="sm" onClick={onDownload}>
          <FileDown className="h-4 w-4 mr-2" />
          Download file
        </Button>
      )}
    </div>
  )
}
