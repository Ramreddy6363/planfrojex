# Feature 2: App shell and Home

Status: **approved** · Worktree: `feat/app-shell`

Provide a workspace frame, let members switch between their workspaces, and replace the workspace placeholder with Home. Use real account and workspace data; never display the sample records from the exports as real data.

## Screens

- Sidebar: `design/exports/103-app-sidebar-component.png`.
- Home: `design/exports/301-home.png`, including My tasks, Your projects, and Recent activity areas.
- Use existing no-access screen for a workspace the user cannot access.
- Until projects, tasks and activity are implemented in later features, show clear empty states in their sections. Do not invent counts or working actions for those features.

## Scope and decisions for approval

1. Use `GET /me` for the workspace switcher and signed-in identity, and `GET /workspaces/:ws` to protect the selected workspace. Switching navigates to the selected workspace's Home and remembers the last workspace using the existing mechanism.
2. Home displays the current date and empty task, project and activity sections until their respective features provide data. No new tables, migrations, or Home endpoints are required in this slice.
3. Sidebar entries and New project/Search controls for features not yet implemented are visibly unavailable; they must not navigate to broken routes or imply that the feature works. Sign out remains functional. The exact availability treatment uses existing design primitives and tokens.
4. Workspace switcher lists only workspaces returned by `/me`. It supports keyboard use, loading and error recovery. Creating or managing workspaces remains outside this feature.

## Tasks and tests

1. Test first: workspace shell renders the authorized workspace and signed-in identity, preserves the existing 401 redirect and 404 no-access behavior, and shows loading/error states. Implement the shared shell using `apps/web/src/ui/` primitives and design tokens. Run `pnpm check`.
2. Test first: switch between multiple memberships, retain the last workspace on return, and verify an inaccessible workspace is not revealed. Implement the switcher using existing APIs. Run `pnpm check`.
3. Test first: Home shows the date and honest empty states without sample tasks, projects, activity or fabricated counts. Implement the Home layout and unavailable future controls. Run `pnpm check`.
4. Compare shell and Home with exports 103 and 301; run `pnpm --filter @planfrojex/web e2e`, `pnpm check`, and independent reviewer and security passes. Fix findings and stop at the ship gate.

## Out of scope

Members management, projects and project creation, tasks, inbox, search, settings, activity data, mobile-specific screens, new dependencies, deployment, and production domain decisions.
