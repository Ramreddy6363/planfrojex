import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createApp } from './index'
import { reservedSlugs } from './workspaces/rules'

// wrangler.jsonc is JSONC: drop whole-line comments, then parse.
const wrangler = JSON.parse(
  readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, ''),
) as { assets: { run_worker_first: string[] }; vars?: Record<string, string> }
const patterns = wrangler.assets.run_worker_first

// Cloudflare globs: `*` matches anything, including `/`. A bare pattern matches exactly.
// `bare` also lets `/x/*` match `/x` (the stricter reading for the web-route check).
const matches = (pattern: string, path: string, bare = false) =>
  pattern.endsWith('/*')
    ? path.startsWith(pattern.slice(0, -1)) || (bare && path === pattern.slice(0, -2))
    : pattern === path
const workerFirst = (path: string, bare = false) => patterns.some((p) => matches(p, path, bare))

// Registered paths with `:param` and `*` turned into a sample segment; whole-app middleware is skipped.
const apiPaths = [
  ...new Set(
    createApp()
      .routes.filter((r) => !['/', '/*', '*'].includes(r.path))
      .map((r) => r.path.replace(/:[^/]+/g, 'x').replace(/\*/g, 'x')),
  ),
]
const firstSegment = (path: string) => path.split('/')[1] as string

describe('single Worker routing', () => {
  it('builds the web app before every deploy', () => {
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(scripts.deploy).toBe('pnpm --filter @planfrojex/web build && wrangler deploy --minify')
  })
  it('marks the deployed Worker as production, which turns the sample drafter off', () => {
    expect(wrangler.vars?.ENVIRONMENT).toBe('production')
  })
  it('runs the Worker first for every API route', () => {
    expect(apiPaths.filter((p) => !workerFirst(p))).toEqual([])
  })
  it('lets the web app answer its own routes', () => {
    for (const segment of [
      'sign-in',
      'sign-up',
      'verify',
      'onboarding',
      'invite',
      'share',
      'auth',
      'acme',
    ])
      for (const path of [`/${segment}`, `/${segment}/x`])
        expect(workerFirst(path, true), path).toBe(false)
    expect(workerFirst('/')).toBe(false)
  })
  it('reserves every API first segment as a workspace slug', () => {
    const missing = [...new Set(apiPaths.map(firstSegment))].filter((s) => !reservedSlugs.has(s))
    expect(missing).toEqual([])
  })
})
