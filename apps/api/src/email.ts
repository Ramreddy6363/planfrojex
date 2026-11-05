import type { Env } from './env'

type Mail = { to: string; subject: string; text: string }
export const outbox: Mail[] = []

async function deliver(env: Env['Bindings'], message: Mail) {
  if (!env.RESEND_API_KEY) {
    if (env.ENVIRONMENT !== 'production' && new URL(env.BETTER_AUTH_URL).hostname === 'localhost') {
      outbox.push(message)
      console.log(`Development email to ${message.to}: ${message.text}`)
      return
    }
    throw new Error('Email delivery is not configured')
  }
  if (!env.EMAIL_FROM) throw new Error('Email delivery is not configured')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [message.to],
      subject: message.subject,
      text: message.text,
    }),
  })
  if (!response.ok) throw new Error('Email delivery failed')
}
export async function sendCode(env: Env['Bindings'], email: string, otp: string) {
  await deliver(env, {
    to: email,
    subject: 'Your PlanFrojex sign-in code',
    text: `Your sign-in code is ${otp}. It expires in 10 minutes.`,
  })
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
