import { describe, expect, it } from 'vitest'

// CLAUDE.md rule 7, enforced on every `pnpm check`.
const hex =
  /(?<!(?:href|to|src|id)\s*=\s*["'{`]*)#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/
const fn = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\(/
const inlineStyle = /style=\{\{[^}]*(?:[bB]ackground|[cC]olor|fill|stroke|border)/
const colour = new RegExp(`${hex.source}|${fn.source}|${inlineStyle.source}`)

const over8 = String.raw`(?:9|[1-9]\d+)(?:\.\d+)?px|8\.\d*[1-9]px|(?:0?\.5\d*[1-9]|0?\.[6-9]\d*|[1-9]\d*(?:\.\d+)?)rem`
const radius = new RegExp(
  String.raw`\brounded(?:-[a-z]+)?-(?:xl|2xl|3xl|4xl|\[(?:${over8})\])|(?:border-radius|--radius-[\w-]+)\s*:\s*(?:${over8})`,
)

const rules: [string, RegExp][] = [
  ['raw colour', colour],
  ['gradient', /gradient/i],
  ['banned hue', /purple|indigo|violet|fuchsia/i],
  ['shadow other than shadow-float', /\bshadow\b(?!-float)|box-?shadow|boxShadow/i],
  ['radius above 8', radius],
  ['emoji', /(?![©™])\p{Extended_Pictographic}/u],
  ['AI wording', /\bAI\b|\bA\.I\.|\bai\b(?!\.)/i],
  ['sparkle/wand/bot icon', /Sparkle|Wand|\bBot(?:[A-Z]|\b)/],
]

const check = (path: string, text: string) => {
  // Colours may be declared only in the token blocks of styles.css; favicon.svg cannot use tokens.
  // Every other rule still sees the whole file.
  const tokens = /(?:@theme|\[data-theme=['"]dark['"]\])\s*\{[^}]*\}/g
  const colourText = path.endsWith('styles.css') ? text.replace(tokens, '') : text
  return rules
    .filter(([name, re]) => {
      if (name !== 'raw colour') return re.test(text)
      return !path.endsWith('favicon.svg') && re.test(colourText)
    })
    .map(([name]) => `${path}: ${name}`)
}

const violations = (files: Record<string, string>) =>
  Object.entries(files).flatMap(([path, text]) => check(path, text))

describe('design rules', () => {
  it('detects each banned pattern', () => {
    const bad = (s: string, path = 'a.tsx') => check(path, s).length
    for (const s of [
      'color: #fff',
      'bg-[#1a1a18]',
      'rgb(1 2 3)',
      'oklch(0.5 0.1 200)',
      'oklab(1 0 0)',
      'lab(50 0 0)',
      'lch(50 0 0)',
      'hwb(0 0% 0%)',
      'color(srgb 1 0 0)',
      "<i style={{ color: 'red' }} />",
      "<i style={{ background: 'x' }} />",
      'bg-gradient-to-r',
      'text-purple-500',
      'shadow-md',
      'box-shadow: 0 0 1px x',
      'boxShadow',
      'shadow',
      'rounded-2xl',
      'rounded-t-xl',
      'rounded-[12px]',
      'rounded-[1rem]',
      'rounded-[0.75rem]',
      'border-radius: 10px',
      'border-radius: 0.6rem',
      'Done \u{1F389}',
      'Ask AI',
      'Ask A.I.',
      'ask ai',
      '<Sparkles />',
      '<WandSparkles />',
      '<Bot />',
      '<BotIcon />',
    ])
      expect(bad(s), s).toBe(1)
    for (const s of [
      'shadow-float',
      'dark:shadow-float',
      'rounded-[6px]',
      'rounded-[8px]',
      'rounded-[0.5rem]',
      'rounded-full',
      'border-radius: 8px',
      "href='#add'",
      'href="#bad"',
      '© 2026 PlanFrojex™',
      'Bottom',
      'a.i - b.i',
      "style={{ width: '40%' }}",
    ])
      expect(bad(s), s).toBe(0)
  })

  it('exempts only the token blocks of styles.css and colours in favicon.svg', () => {
    expect(check('styles.css', '@theme {\n  --color-bg: #fff;\n}')).toEqual([])
    expect(check('styles.css', "[data-theme='dark'] {\n  --color-bg: #000;\n}")).toEqual([])
    expect(check('styles.css', '.x { color: #fff }')).toHaveLength(1)
    expect(check('styles.css', '.x { --c: #fff }')).toHaveLength(1)
    expect(check('styles.css', '--color-accent: purple;')).toHaveLength(1)
    expect(check('styles.css', '--shadow-glow: 0 0 24px x;')).toHaveLength(1)
    expect(check('styles.css', '--radius-xl: 16px;')).toHaveLength(1)
    expect(check('public/favicon.svg', ':root{color:#1a1a18}')).toEqual([])
    expect(check('public/other.svg', 'fill="#1a1a18"')).toHaveLength(1)
  })

  it('finds none in the app source', () => {
    const files = import.meta.glob(
      ['./**/*.{ts,tsx,js,jsx,css}', '!./**/*.test.*', '../*.html', '../public/**/*.svg'],
      { query: '?raw', import: 'default', eager: true },
    ) as Record<string, string>
    const paths = Object.keys(files)
    expect(paths.some((p) => p.endsWith('.html'))).toBe(true)
    expect(paths.some((p) => p.endsWith('favicon.svg'))).toBe(true)
    expect(violations(files)).toEqual([])
  })
})
