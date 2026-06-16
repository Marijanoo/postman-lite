'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { Loader2, Minus, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth/auth-context'

type Mode = 'login' | 'register'

// The credential form itself — reused by the full-screen LoginScreen and by the
// on-demand LoginDialog. Calls onSuccess once authentication completes.
export function LoginForm({ onSuccess }: { onSuccess?: () => void } = {}) {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'login') {
        await login(email, password)
      } else {
        if (!name.trim()) {
          setError('Name is required')
          return
        }
        await register(email, password, name.trim())
      }
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  function switchMode(next: Mode) {
    setMode(next)
    setError('')
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      {/* Logo / title */}
      <div className="space-y-1 text-center">
        <div className="flex justify-center mb-3">
          <Image src="/logo.png" alt="Quence" width={56} height={56} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {mode === 'login'
            ? 'Enter your credentials to continue'
            : 'Fill in the details below to get started'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'register' && (
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              type="text"
              placeholder="Your name"
              value={name}
              onChange={e => setName(e.target.value)}
              autoComplete="name"
              required
              disabled={loading}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete={mode === 'login' ? 'username' : 'email'}
            required
            disabled={loading}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            disabled={loading}
          />
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="animate-spin" />}
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
        <button
          type="button"
          onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
          className="text-primary underline-offset-4 hover:underline font-medium"
        >
          {mode === 'login' ? 'Sign up' : 'Sign in'}
        </button>
      </p>
    </div>
  )
}

export function LoginScreen() {
  const [isElectron, setIsElectron] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI) setIsElectron(true)
  }, [])

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Draggable title bar area */}
      <div
        className="h-8 bg-card border-b border-border shrink-0 flex items-center justify-between"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-1.5 px-3">
          <Image src="/logo.png" alt="Quence" width={16} height={16} className="shrink-0" />
          <span className="text-xs font-medium text-muted-foreground">Quence</span>
        </div>
        {isElectron && (
          <div className="flex items-center h-full" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <Button
              variant="ghost" size="icon"
              className="h-full w-10 rounded-none hover:bg-secondary text-muted-foreground hover:text-foreground"
              onClick={() => window.electronAPI?.minimize()}
              tabIndex={-1}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost" size="icon"
              className="h-full w-10 rounded-none hover:bg-secondary text-muted-foreground hover:text-foreground"
              onClick={() => window.electronAPI?.maximize()}
              tabIndex={-1}
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost" size="icon"
              className="h-full w-10 rounded-none hover:bg-[oklch(0.65_0.22_25)] hover:text-white text-muted-foreground"
              onClick={() => window.electronAPI?.close()}
              tabIndex={-1}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <LoginForm />
      </div>
    </div>
  )
}
