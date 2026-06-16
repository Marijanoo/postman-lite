'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { LoginForm } from './login-screen'

interface LoginDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Shown above the form to explain why sign-in is being requested.
  reason?: string
  // Called after a successful sign-in / registration.
  onSuccess?: () => void
}

export function LoginDialog({ open, onOpenChange, reason, onSuccess }: LoginDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sign in required</DialogTitle>
          <DialogDescription>
            {reason ?? 'Sign in to continue.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-center pt-2">
          <LoginForm
            onSuccess={() => {
              onSuccess?.()
              onOpenChange(false)
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
