import { reservedSlugs } from '@planfrojex/api/rules'

const generic = new Set(['project', 'projects', 'team', 'workspace'])

export function slugForName(name: string) {
  const words = name
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  while (words.length > 1 && generic.has(words[words.length - 1] as string)) words.pop()
  let slug = words
    .join('-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/g, '')
  if (!slug) slug = 'my-space'
  else if (slug.length < 3 || reservedSlugs.has(slug)) slug = `${slug}-space`
  return slug
}

export function personalSlug(slug: string, attempt: number) {
  if (!attempt) return slug
  const suffix = `-${attempt + 1}`
  return `${slug.slice(0, 40 - suffix.length).replace(/-+$/g, '')}${suffix}`
}
