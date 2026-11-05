import { createRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { auth } from '../auth-client'
import { codeVerificationMessage, requestCodeMessage } from '../auth-errors'
import { AuthShell, label } from '../layouts'
import { nextPath } from '../session'
import { Button } from '../ui/button'
import { OtpInput } from '../ui/otp-input'
import { TextAction, TextLink } from '../ui/text-link'
import { ActionError, useAction } from '../use-action'
import { UserError } from '../user-error'
import { rootRoute } from './root'

function Verify() {
  const navigate = useNavigate()
  const { busy, error, run, submit } = useAction()
  const email = sessionStorage.getItem('email') ?? ''
  const [otp, setOtp] = useState('')
  return (
    <AuthShell
      footer={
        <p className="text-text-muted">
          Didn't get it?{' '}
          <TextAction
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await auth.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })
                if (result.error) throw new UserError(requestCodeMessage(result.error))
                setOtp('')
              })
            }
          >
            Send a new code
          </TextAction>
        </p>
      }
    >
      <h1 className="text-display font-semibold">Check your email</h1>
      <p className="mt-4 text-body text-text-muted">
        We sent a 6-digit code to {email}. It expires in 10 minutes.
      </p>
      <form
        className="mt-3 space-y-4"
        onSubmit={submit(async () => {
          const name = sessionStorage.getItem('signupName') || undefined
          const result = await auth.signIn.emailOtp({ email, otp, name })
          if (result.error) {
            setOtp('')
            throw new UserError(codeVerificationMessage(result.error))
          }
          if (result.data?.user.name) sessionStorage.setItem('displayName', result.data.user.name)
          sessionStorage.removeItem('signupName')
          await navigate({ to: await nextPath() })
        })}
      >
        <p className={label}>Code</p>
        <OtpInput value={otp} onChange={setOtp} invalid={!!error} describedBy="code-error" />
        <Button type="submit" variant="primary" size="lg" disabled={busy} className="w-full">
          Verify and continue
        </Button>
      </form>
      <TextLink href="/sign-in" className="mt-4 inline-block">
        Use a different email
      </TextLink>
      <ActionError error={error} id="code-error" />
    </AuthShell>
  )
}

export const verifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/verify',
  component: Verify,
})
