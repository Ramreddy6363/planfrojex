export function chooseWorkspace(workspaces: { slug: string }[], last: string | null) {
  return workspaces.find((workspace) => workspace.slug === last)?.slug ?? workspaces[0]?.slug
}
