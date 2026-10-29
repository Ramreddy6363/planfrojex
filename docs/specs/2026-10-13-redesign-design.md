# PlanFrojex Redesign: Design Spec

Date: 2026-10-13 · Status: awaiting review · Scope: interface and design system (backend gets its own spec later)

## 1. Problem statement

**Users:** small product teams of 2–10 people (PM, engineers, designer) planning features together.

**Job:** turn a rough brief into an agreed plan with owners and dates, then track the work against that plan.

**Why the current app fails**
- It's single-user. Teammates can only see a read-only share link, and there are no assignees, mentions or roles.
- The interface reads as AI-generated: templated stat cards, two conflicting colour schemes, an orange accent everywhere, and fonts that never actually load.
- AI is presented as a gimmick instead of a tool, and drafts overwrite content with no review step.
- The navigation is page-shaped (Dashboard, Ideas, Templates) instead of work-shaped (what's mine, what changed, what's next).

**Success criteria**
1. A team goes from brief to accepted plan, with owners and due dates, in one sitting.
2. Tasks are tracked in the same place they were planned.
3. Every AI draft is reviewed before it changes anything.
4. Nobody looking at a screenshot would guess an AI made it.

## 2. Decisions

| Decision | Choice |
|---|---|
| Primary user | Small product teams |
| Collaboration | Full workspaces: members, roles (owner, editor, viewer), email invites, assignees, @mentions |
| AI | Keep plan and diagram generation; drop every AI visual cue |
| Direction | Quiet working tool (in the spirit of Linear, GitHub, Stripe's dashboard) |
| Information architecture | Project workspace: sidebar plus project tabs |
| Coverage | Light theme, desktop first (1440px); dark mode as tokens only; mobile for 3 pages |
| Brand name | Keep "PlanFrojex" |
| Landing page | One public home page for first-time visitors (added Oct 13 at user request) |

## 3. Changes from the current app

| Today | Redesign |
|---|---|
| Dashboard of stat cards | Home: my tasks, due soon, recent activity |
| Templates page | Template picker inside the New project dialog |
| Favorite flag with no button | Star toggle; starred projects listed in the sidebar |
| "Design completed" switch | Removed; project status covers it |
| Discussion tab | Comments on the brief and on each task; Inbox for @mentions |
| AI output overwrites the plan | AI output arrives as a draft shown as a diff; accept or reject each section |
| Single user | Workspaces, members, roles, assignees |

## 4. Navigation and pages

**App frame:** a 240px left sidebar plus a content area. The sidebar holds:
- the workspace switcher
- Search (⌘K)
- Home, My tasks and Inbox (with an unread count)
- starred projects
- Projects
- Members and Settings
- your account at the bottom

**Project tabs:** Brief · Plan · Tasks · Diagrams · Activity.

| # | Page | Content |
|---|---|---|
| 1 | Sign in / Sign up | Form on the left, product screenshot on the right. Clerk handles login, with styled screens. |
| 2 | Create workspace + invite | First-run setup: name the workspace, then invite by email (optional; can skip). |
| 3 | Home | My open tasks grouped Overdue / Today / This week / Later; projects I'm on; workspace activity. |
| 4 | Projects list | Table: name, status, lead, progress, due date, last updated. Filter bar (status, lead, priority), saved views, star toggle. |
| 5 | New project dialog | Blank or a template (SaaS MVP, AI Product, Mobile App, E-commerce, Portfolio), then title and brief. |
| 6 | Project › Brief | Problem, goals, constraints, tags, status, lead, due date. Comment column on the right. |
| 7 | Project › Plan | Requirements, user stories, milestones, risks, tech stack, estimate. "Draft plan from brief" button; draft shown as a diff, accepted or rejected per section. |
| 8 | Project › Tasks | List and board views; assignee, priority, due date. Task side panel with description and comments. |
| 9 | Project › Diagrams | Diagram list (left), React Flow canvas with our shape library and ELK auto-layout (centre), "Draft diagram" form + version history (right). Drafts return JSON nodes and edges, reviewable as a diff. Storage: scenes live in Postgres (`diagram_versions.scene`, JSONB); each diagram keeps its last 50 versions plus every named version; a scene over 1 MB moves to R2 with only `r2_key` kept in Postgres. |
| 10 | Project › Activity | Full change timeline, filterable by person and type. |
| 11 | My tasks | My tasks across all projects, grouped by due date. |
| 12 | Inbox | @mentions, assignments, replies; mark read, open source. |
| 13 | Members | Members with roles, pending invites, invite dialog, role change, remove. |
| 14 | Workspace settings | General settings, active share links (revoke), danger zone. |
| 15 | Public share page | Read-only brief, plan and diagrams. No app frame; small "Made with PlanFrojex" footer. |
| 16 | ⌘K search | Overlay: projects, tasks, commands. |
| 17 | Landing page | Public home page for first-time visitors: nav; hero ("Turn a rough brief into a plan your team agrees on.") with a real Plan screen; How it works (brief, review the draft, track the work); dark "Nothing changes until you accept it" section; one person vs team; share links; final call to action; footer. No testimonials, customer logos or invented numbers. |

**Mobile (390px):** Projects list, Project › Brief, Public share page.

**States (drawn once each and reused):**
- **Empty:** one line explaining what goes here, plus the single action that fills it.
- **Loading:** skeleton rows matching the real layout.
- **Error:** what failed, plus a Retry button.
- **Drafting:** a plain text line ("Drafting plan from brief…") with a thin progress bar. No spinner art.

## 5. Design system

### 5.1 Rules
- Structure comes from 1px borders and spacing, never from shadowed cards.
- Shadows appear only on floating layers: menus, popovers, dialogs, ⌘K.
- Dense but calm: 32px controls, 40px rows, 14px interface text, 15px paragraphs.
- Exactly one accent colour. Status is shown by a 14px glyph (dashed circle = draft, empty circle = planning or to do, half-filled = in progress, check circle = completed, minus circle = archived) plus a text label; status colours appear only on glyphs and text, never as filled backgrounds. No status dots or bordered pills.
- **Banned (app screens):** gradients, glows, glass blur, sparkle or wand icons, emoji in the interface, purple or indigo, radius above 8px, stock illustrations, "AI-powered" labels, typing animations, lorem ipsum.

**Landing page exception:** the public landing page uses the light tokens and uses a "milestone ruler" hero background (a faint Oct to Jan timeline with milestone diamonds, done span in text colour, active span in accent, and a TODAY marker) and may use a soft accent glow behind product windows and the closing logo mark. These effects never appear inside the app.

### 5.2 Type
IBM Plex Sans for the interface; IBM Plex Mono for IDs, numbers, estimates and code.

| Token | Size / line height | Weight | Use |
|---|---|---|---|
| display | 24 / 32 | 600 | Large titles (Foundations, onboarding) |
| title | 20 / 28 | 600 | Page titles |
| body | 15 / 22 | 400 | Paragraphs, section headers (600) |
| ui | 14 / 20 | 400 | Rows, controls, navigation, comments |
| caption | 13 / 18 | 500 | Labels, column headers, metadata |
| mono | 13 / 18 | 400 | IDs, numbers, dates |

### 5.3 Colour (light theme)

| Token | Hex | Use |
|---|---|---|
| bg | `#FFFFFF` | Page background |
| bg-subtle | `#F7F7F5` | Sidebar, table headers |
| bg-muted | `#EFEFEC` | Hover, selected row |
| border | `#E4E4E0` | Dividers |
| border-strong | `#CFCFCA` | Input borders |
| text | `#1A1A18` | Main text |
| text-muted | `#6B6B66` | Secondary text and placeholders (≥ 4.5:1 on bg and bg-subtle) |
| text-faint | `#9A9A94` | Disabled text and decorative marks only; never for readable text |
| accent | `#2550C9` | Main buttons, links, focus ring |
| accent-subtle | `#EAF0FC` | Selected nav item, accent badge background |
| success | `#1F7A4D` | Done |
| warning | `#A15C07` | At risk, due soon |
| danger | `#C4321F` | Overdue, destructive actions |

Dark mode uses the same token names with inverted values. It's defined as tokens only; no dark screens are drawn.

### 5.4 Spacing, shape, icons
- Spacing: 4px grid (4, 8, 12, 16, 24, 32, 48).
- Corner radius: 6px on controls, 8px on dialogs and popovers.
- Icons: Lucide, 16px, 1.5px line weight.
- Focus: 2px accent outline with a 2px offset.

### 5.5 Components
Button (primary, secondary, ghost, danger; sm and md), Input, Textarea, Select, Checkbox, Tabs, Status glyph + label, Avatar + avatar stack, Table row, Sidebar item, Task row, Comment, Activity item, Dialog, Menu, Toast, Empty state, Skeleton, Diff block (accept / reject), Progress bar.

### 5.6 Brand
- **Wordmark:** "planfrojex" in lowercase IBM Plex Sans 600, letter spacing -0.3. The "o" is replaced by the In progress glyph (a ring with the right half filled), sized to the x-height and sitting on the baseline.
- **Mark:** the "o" glyph on its own (component "Logo mark"). Use it for the favicon, app icon, and footers.
- **Colour:** always one colour (`$text`, or `$bg` on dark). No tile, no gradient, no accent colour.
- **Name in sentences:** keep "PlanFrojex" in running text; the lowercase form is only for the logo.

## 6. Pencil file

**Path:** `planforjex/design/planfrojex.pen`

**Frames, left to right:**
1. **Foundations:** tokens stored as Pencil variables.
2. **Components:** each variant drawn as a reusable component.
3. **Desktop pages:** 1440 × 900; long pages get taller frames.
4. **Mobile pages:** 390 wide.
5. **States.**

**Sample content:** workspace "Northwind" with 6 members. Projects: Customer portal rebuild, Billing migration, Mobile check-in app. Tasks, dates, risks and comments are realistic.

## 7. Build order and review

1. Foundations and components. Screenshot review with the user before any pages.
2. Batch A: app frame, Home, Projects list, New project dialog.
3. Batch B: the five project tabs.
4. Batch C: My tasks, Inbox, Members, Settings, ⌘K, Sign in, onboarding, share page, mobile, states.

After each batch, screenshot every frame and check it against:
- the banned list in 5.1
- tokens only: no raw colour codes on screens
- one accent colour per screen
- alignment on the 4px grid
- contrast meets AA

The user reviews each batch before the next one starts.

## 8. Competitive features (designed Oct 13, build after the core redesign)

Positioning: the planning layer for product teams. Draft the plan, keep it true, and show stakeholders where things stand, on top of the tools they already use.

| Feature | Screen | Behaviour |
|---|---|---|
| Tracker sync | Settings > Integrations | Linear connected (push accepted milestones as projects/issues, pull status back, optional import of new issues, status mapping). GitHub links PRs to tasks; Jira two-way sync; Slack posts drafts and drift alerts. |
| Drift detection | Project > Plan, "The plan has drifted" card | Compares plan to tracker activity: late milestones, tasks added outside the plan, overdue risk decisions. Proposes a plan update as a diff; Accept update / Review each / Dismiss; optional reason saved to the decision log. |
| Decision log | Activity + drift/draft reasons | Every accept/reject stores who, when and why. |
| Stakeholder approval | Public share page with review banner | Invited reviewer (verified by email link) approves sections or the whole plan, or requests changes with a comment. Progress shows "1 of 3 sections approved". |
| Weekly status email | Email to reviewers and the team | Written from plan vs actual: on track / at risk, summary, milestone progress, decisions this week, next week, link to the plan. Sent Mondays. |

Not built: sprints, story points, custom workflows, a docs editor, a general chat assistant.

## 9. Out of scope
- Backend architecture (next spec; it must support workspaces, roles, assignees, mentions, an inbox and plan drafts).
- Marketing pages beyond the single landing page (pricing page, blog, docs).
- Dark screens and mobile layouts beyond the three listed.
- Front-end code.
