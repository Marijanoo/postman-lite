'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth/auth-context'
import { PostmanLite } from '@/components/postman-lite/postman-lite'

export default function Home() {
  const { state } = useAuth()
  const [updateProgress, setUpdateProgress] = useState<number | null>(null)
  const [updateDownloaded, setUpdateDownloaded] = useState(false)

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onUpdateDownloaded) return

    api.onUpdateAvailable?.(() => setUpdateProgress(0))
    api.onUpdateProgress?.((percent) => setUpdateProgress(percent))
    api.onUpdateDownloaded(() => { setUpdateProgress(100); setUpdateDownloaded(true) })
  }, [])

  if (state.status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    )
  }

  // No auth gate: the app is fully usable signed-out (local workspaces). Sign-in
  // is requested on-demand only for cloud workspaces and invites.
  return (
    <PostmanLite
      updateProgress={updateProgress}
      updateDownloaded={updateDownloaded}
      onInstallUpdate={() => window.electronAPI?.installUpdate?.()}
      onDismissUpdate={() => { setUpdateProgress(null); setUpdateDownloaded(false) }}
    />
  )
}
