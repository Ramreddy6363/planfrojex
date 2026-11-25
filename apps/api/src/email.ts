import type { Env } from './env'

type Mail = { to: string; subject: string; text: string; html?: string }
export const outbox: Mail[] = []

async function deliver(env: Env['Bindings'], message: Mail, idempotencyKey?: string) {
  if (!env.RESEND_API_KEY) {
    if (env.ENVIRONMENT !== 'production' && new URL(env.BETTER_AUTH_URL).hostname === 'localhost') {
      outbox.push(message)
      return
    }
    throw new Error('Email delivery is not configured')
  }
  if (!env.EMAIL_FROM) throw new Error('Email delivery is not configured')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  })
  if (!response.ok) {
    if (response.status === 409 && idempotencyKey) {
      const body: unknown = await response.json().catch(() => null)
      if (
        body &&
        typeof body === 'object' &&
        'name' in body &&
        (body.name === 'invalid_idempotent_request' || body.name === 'invalid_idempotency_request')
      )
        return
    }
    throw new Error('Email delivery failed')
  }
}

export const sendStatusEmail = (
  env: Env['Bindings'],
  message: Mail & { html: string },
  idempotencyKey: string,
) => deliver(env, message, idempotencyKey)

export async function sendCode(env: Env['Bindings'], email: string, otp: string) {
  await deliver(env, {
    to: email,
    subject: 'Your PlanFrojex sign-in code',
    text: `Your sign-in code is ${otp}. It expires in 10 minutes.`,
  })
  if (
    !env.RESEND_API_KEY &&
    env.ENVIRONMENT !== 'production' &&
    new URL(env.BETTER_AUTH_URL).hostname === 'localhost'
  )
    console.warn(`Development sign-in code for ${email}: ${otp}`)
}
export async function sendInvite(
  env: Env['Bindings'],
  email: string,
  workspace: string,
  token: string,
) {
  const url = new URL(`/invite/${token}`, env.WEB_ORIGIN).toString()
  await deliver(env, {
    to: email,
    subject: 'You have been invited to PlanFrojex',
    text: `You have been invited to ${workspace}. Join here: ${url}\nThis invitation expires in 7 days.`,
  })
}

export async function sendReviewInvitations(
  env: Env['Bindings'],
  recipients: { email: string; token: string }[],
  requester: string,
  project: string,
  dueDate: string | null,
) {
  if (!recipients.length) return
  const messages = recipients.map(({ email, token }) => ({
    to: email,
    subject: 'You have a plan to review in PlanFrojex',
    text: `${requester} asked you to review ${project}${dueDate ? ` by ${dueDate}` : ''}.\n\nOpen your review: ${new URL(`/share/${token}?review=1`, env.WEB_ORIGIN)}`,
  }))
  if (!env.RESEND_API_KEY) {
    if (env.ENVIRONMENT !== 'production' && new URL(env.BETTER_AUTH_URL).hostname === 'localhost') {
      outbox.push(...messages)
      return
    }
    throw new Error('Email delivery is not configured')
  }
  if (!env.EMAIL_FROM) throw new Error('Email delivery is not configured')
  const response = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(
      messages.map((message) => ({
        from: env.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      })),
    ),
  })
  if (!response.ok) throw new Error('Email delivery failed')
}

export async function sendReviewCode(env: Env['Bindings'], email: string, code: string) {
  await deliver(env, {
    to: email,
    subject: 'Your PlanFrojex review code',
    text: `Your review code is ${code}. It expires in 10 minutes.`,
  })
}
