import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { auth } from './auth-client'
import { googleSignInMessage, requestCodeMessage } from './auth-errors'
import { AuthShell, label } from './layouts'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { TextLink } from './ui/text-link'
import { ActionError, useAction } from './use-action'
import { UserError } from './user-error'

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const signUp = mode === 'sign-up'
  const navigate = useNavigate()
  const { busy, error, run, submit } = useAction()
  const [email, setEmail] = useState(sessionStorage.getItem('email') ?? '')
  const [fullName, setFullName] = useState(sessionStorage.getItem('signupName') ?? '')
  return (
    <AuthShell
      footer={
        <p className="text-text-muted">
          {signUp ? 'Already have an account?' : 'New to PlanFrojex?'}{' '}
          <TextLink href={signUp ? '/sign-in' : '/sign-up'}>
            {signUp ? 'Sign in' : 'Create an account'}
          </TextLink>
        </p>
      }
    >
      <h1 className="text-display font-semibold">
        {signUp ? 'Create your account' : 'Sign in to PlanFrojex'}
      </h1>
      <p className="mt-4 text-body text-text-muted">
        {signUp
          ? 'Free for one person. Invite your team whenever you like. No password needed.'
          : "We'll email you a 6-digit code. No password needed."}
      </p>
      <form
        className="mt-3 space-y-4"
        onSubmit={submit(async () => {
          const result = await auth.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })
          if (result.error) throw new UserError(requestCodeMessage(result.error))
          sessionStorage.setItem('email', email)
          if (signUp) sessionStorage.setItem('signupName', fullName.trim())
          else sessionStorage.removeItem('signupName')
          await navigate({ to: '/verify' })
        })}
      >
        {signUp && (
          <div>
            <label className={label} htmlFor="full-name">
              Full name
            </label>
            <Input
              id="full-name"
              height="lg"
              required
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
        )}
        <label className={label} htmlFor="email">
          {signUp ? 'Work email' : 'Email'}
        </label>
        <Input
          id="email"
          height="lg"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit" variant="primary" size="lg" disabled={busy} className="w-full">
          Continue with email
        </Button>
      </form>
      <div className="my-3.5 flex items-center gap-3 text-center text-text-muted">
        <span className="h-px flex-1 bg-border" />
        <span>or</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button
        size="lg"
        className="w-full"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const result = await auth.signIn.social({
              provider: 'google',
              callbackURL: `${window.location.origin}/auth/callback`,
            })
            if (result.error) throw new UserError(googleSignInMessage)
          })
        }
      >
        {signUp ? 'Sign up with Google' : 'Continue with Google'}
      </Button>
      {signUp && (
        <p className="mt-4 text-caption text-text-muted">
          By creating an account you agree to the Terms and Privacy Policy.
        </p>
      )}
      <ActionError error={error} />
    </AuthShell>
  )
}
