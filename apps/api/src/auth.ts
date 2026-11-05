import { neon } from '@neondatabase/serverless'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { betterAuth } from 'better-auth/minimal'
import { emailOTP } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './db/schema'
import { sendCode } from './email'
import type { Env } from './env'

export { sendCode } from './email'

export function createAuth(env: Env['Bindings'], database?: Parameters<typeof drizzleAdapter>[0]) {
  const db = database ?? drizzle(neon(env.DATABASE_URL), { schema })
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    logger: { disabled: true },
    disabledPaths: [
      '/email-otp/request-password-reset',
      '/forget-password/email-otp',
      '/email-otp/reset-password',
      '/email-otp/check-verification-otp',
    ],
    // Better Auth expects an unused password column even when password auth is disabled.
    advanced: {
      database: { validateSchema: false },
      // Only Cloudflare's header is trustworthy; X-Forwarded-For is client-controlled.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    trustedOrigins: [env.WEB_ORIGIN],
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    socialProviders: {
      google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
    },
    account: { encryptOAuthTokens: true },
    rateLimit: { enabled: true, storage: 'database' },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 3,
        storeOTP: 'hashed',
        async sendVerificationOTP({ email, otp }) {
          await sendCode(env, email, otp)
        },
      }),
    ],
  })
}
