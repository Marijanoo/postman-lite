import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Opens a URL in the user's default browser rather than navigating the app's
// own window — via Electron's shell.openExternal in the desktop build, or a
// plain window.open when running as a web page.
export function openExternalUrl(url: string): void {
  if (typeof window === 'undefined') return
  if (window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

// crypto.randomUUID() requires a secure context (HTTPS or localhost).
// This fallback uses Math.random so the app works over plain HTTP (e.g. LAN access).
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
