# Feature 0: Design system in code

Status: **shipped** (D1 primitives now, D2 17px token) · Worktree: `feat/design-system` · Before feature 1 (auth and workspace)

Turn Foundations (`F0ST7o`, `101-foundations.png`) and Components (`Vztu5`, `102-components.png`) into tokens and React primitives in `apps/web`, so every later screen is assembled from them and nothing else.

## Gaps found (code vs Pencil)

| Gap | Fix |
|---|---|
| `styles.css` has light values only | Dark values from Pencil variables under `[data-theme="dark"]` (tokens only, no toggle: spec 5.3) |
| No shadow token; Menu, Dialog, Toast use `0 4 16 #1A1A181A` | `--shadow-float`; the only shadow allowed |
| Avatar fills are raw hex (`#4E6A8C`, `#4F7A64`, `#8C5A4F`) | Three `--color-avatar-1..3` tokens, picked by hash of user id |
| No control/row heights | `--spacing-control: 32px`, `--spacing-row: 40px` |
| Dialog title is 17px, not in the type scale | Use `title` (20/28)? **Decision D2** |
| No icons installed | `lucide-react` (spec 5.4: Lucide 16px, stroke 1.5) |

## Decisions to approve

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Which components now | **Primitives now; domain rows with their feature.** Now: Button (4 variants, sm/md, icon), Input, Textarea, Select, Checkbox, Tabs, Status glyph + label (5), Avatar + stack, Progress bar, Dialog, Menu, Toast, Empty state, Skeleton row, Brand + Logo mark, Icon. Later: Sidebar item (feature 2), Task row, Comment, Activity item, Diff block. | Domain rows depend on data shapes that don't exist yet; building them blind means rebuilding. |
| D2 | Dialog title size | Keep 17px as a `--text-dialog` token (matches drawn screens) | Build what is drawn; changing it means re-exporting 5 dialogs |
| D3 | Behaviour for Dialog, Menu, Select | Native: `<dialog>` (focus trap, Esc), `popover` attribute + arrow-key handler for Menu, native `<select>` styled | No headless-UI dependency; accessible by default |
| D4 | Where to see them | Dev-only gallery `apps/web/design.html` mirroring the Components board (Vite serves it in dev, never builds it) | QA compares it to `102-components.png`; no router needed yet |

## Tasks (each test first)

1. **Design-rule guard** (Vitest, `src/design-rules.test.ts`): fails on raw hex/rgb outside `styles.css`, `gradient`, `purple|indigo|violet|fuchsia`, `shadow-` other than `shadow-float`, radius above 8, emoji, and the word "AI" in UI strings. Enforces CLAUDE.md rule 7 on every `pnpm check`.
2. **Tokens**: dark values, `--shadow-float`, avatar colours, heights; keep `--color-*: initial` so Tailwind's palette stays off. Favicon = Logo mark SVG.
3. **Primitives** in `src/ui/`, one file each, props match Pencil variants. `cn` helper only if needed (no `clsx` dep).
4. **Gallery** `design.html` + `src/design.tsx`: every primitive in every state, light and dark side by side.
5. **Playwright** (`apps/web/e2e/`, config added): gallery renders; Dialog opens, traps focus, closes on Esc and returns focus; Menu opens with Enter, arrows move, Esc closes; Toast announced via `aria-live`; checkbox toggles by Space; visible focus ring on every control.
6. `pnpm check` green; `progress.md` line.

## New dependencies
- `lucide-react` (icons, spec 5.4). Nothing else.

## Out of scope
- Theme toggle, dark screens (spec: tokens only).
- Landing page effects.
- Router, API calls, auth (feature 1).
