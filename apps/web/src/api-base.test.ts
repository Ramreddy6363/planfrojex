import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiBase } from './api-base'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('apiBase', () => {
  it('uses VITE_API_URL when set', () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.com')
    expect(apiBase()).toBe('https://api.example.com')
  })
  it('uses the local API in dev', () => {
    vi.stubEnv('VITE_API_URL', '')
    vi.stubEnv('DEV', true)
    expect(apiBase()).toBe('http://localhost:8787')
  })
  it('uses the page origin in a production build', () => {
    vi.stubEnv('VITE_API_URL', '')
    vi.stubEnv('DEV', false)
    vi.stubGlobal('window', { location: { origin: 'https://planfrojex.workers.dev' } })
    expect(apiBase()).toBe('https://planfrojex.workers.dev')
  })
})
