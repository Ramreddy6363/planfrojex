import { z } from 'zod'
import type { Env } from '../env'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function base64url(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function bytesFromBase64(value: string) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) =>
    char.charCodeAt(0),
  )
}

export async function digest(value: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))))
}

async function hmac(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function makeOAuthState(secret: string) {
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmac(secret),
    encoder.encode(`linear-state:${nonce}`),
  )
  return `${nonce}.${base64url(new Uint8Array(signature))}`
}

export async function validOAuthState(secret: string, state: string) {
  const [nonce, signature] = state.split('.')
  if (!nonce || !signature) return false
  return crypto.subtle.verify(
    'HMAC',
    await hmac(secret),
    bytesFromBase64(signature),
    encoder.encode(`linear-state:${nonce}`),
  )
}

export async function pkceVerifier(secret: string, state: string) {
  const value = await crypto.subtle.sign(
    'HMAC',
    await hmac(secret),
    encoder.encode(`linear-pkce:${state}`),
  )
  return base64url(new Uint8Array(value))
}

export async function verifyWebhook(secret: string, header: string, body: ArrayBuffer) {
  if (!/^[a-f0-9]{64}$/i.test(header)) return false
  const signature = Uint8Array.from(header.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16))
  return crypto.subtle.verify('HMAC', await hmac(secret), signature, body)
}

export const credentialsSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullable(),
  expiresAt: z.number().int().positive(),
})
export type Credentials = z.infer<typeof credentialsSchema>

export type LinearConfig = {
  mode: 'fake' | 'real'
  encryptionKey: CryptoKey
  webhookSecret: string
}
export async function linearConfig(
  env: Env['Bindings'],
  dev: boolean,
): Promise<LinearConfig | null> {
  if (env.ENVIRONMENT !== 'production' && (dev || env.ENVIRONMENT === 'test')) {
    const key = await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(`local-linear:${env.BETTER_AUTH_SECRET}`),
    )
    return {
      mode: 'fake',
      encryptionKey: await crypto.subtle.importKey('raw', key, 'AES-GCM', false, [
        'encrypt',
        'decrypt',
      ]),
      webhookSecret: 'planfrojex-fake-linear-webhook',
    }
  }
  if (
    !env.LINEAR_CLIENT_ID ||
    !env.LINEAR_CLIENT_SECRET ||
    !env.LINEAR_TOKEN_ENCRYPTION_KEY ||
    !env.LINEAR_WEBHOOK_SECRET
  )
    return null
  const key = env.LINEAR_TOKEN_ENCRYPTION_KEY
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(key)) return null
  const raw = bytesFromBase64(key)
  if (raw.byteLength !== 32) return null
  return {
    mode: 'real',
    encryptionKey: await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ]),
    webhookSecret: env.LINEAR_WEBHOOK_SECRET,
  }
}

export async function encryptCredentials(key: CryptoKey, context: string, value: Credentials) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(context) },
    key,
    encoder.encode(JSON.stringify(value)),
  )
  return `${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`
}

export async function decryptCredentials(key: CryptoKey, context: string, value: string) {
  const [iv, encrypted] = value.split('.')
  if (!iv || !encrypted) throw new Error('Invalid Linear credential storage')
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytesFromBase64(iv), additionalData: encoder.encode(context) },
    key,
    bytesFromBase64(encrypted),
  )
  return credentialsSchema.parse(JSON.parse(decoder.decode(decrypted)))
}

// Linear accepts caller-supplied UUIDv4 IDs. Deriving the same ID on retry keeps a
// remote create idempotent even when the response or the local transaction is lost.
export async function stableLinearId(...parts: string[]) {
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(parts))),
  )
  const bytes = hash.slice(0, 16)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
