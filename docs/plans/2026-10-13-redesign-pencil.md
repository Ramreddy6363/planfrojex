# PlanFrojex Redesign (Pencil) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full PlanFrojex redesign in a single Pencil file: tokens, components, 16 desktop pages, 3 mobile pages and the shared states.

**Architecture:**
- One `.pen` file.
- Design tokens are stored as Pencil variables, with light and dark values for each colour.
- Every repeated element is a reusable component.
- Screens are top-level frames built from component instances (`ref` nodes) and only ever reference `$tokens`.
- Work is checked after every task by a lint pass (`Get` visitor) plus a screenshot.

**Tech Stack:** Pencil (pen.dev) via the MCP `execute` tool; IBM Plex Sans / Plex Mono (Google Fonts); Lucide icons.

**Spec:** `docs/specs/2026-10-13-redesign-design.md`

## Global Constraints

- **File:** `/home/ramreddey/Documents/personal/planforjex/design/planfrojex.pen`
- **Fonts:** `IBM Plex Sans` for the interface, `IBM Plex Mono` for IDs, numbers and code. No other families.
- **Type tokens (size / line height / weight):**

  | Token | Size / LH | Weight |
  |---|---|---|
  | display | 24 / 32 | 600 |
  | title | 20 / 28 | 600 |
  | body | 15 / 22 | 400 |
  | ui | 14 / 20 | 400 |
  | caption | 13 / 18 | 500 |
  | mono | 13 / 18 | 400 |

- **Colour tokens (light):**

  | Token | Hex |
  |---|---|
  | bg | `#FFFFFF` |
  | bg-subtle | `#F7F7F5` |
  | bg-muted | `#EFEFEC` |
  | border | `#E4E4E0` |
  | border-strong | `#CFCFCA` |
  | text | `#1A1A18` |
  | text-muted | `#6B6B66` |
  | text-faint | `#9A9A94` |
  | accent | `#2550C9` |
  | accent-subtle | `#EAF0FC` |
  | success | `#1F7A4D` |
  | warning | `#A15C07` |
  | danger | `#C4321F` |

- **Spacing:** 4, 8, 12, 16, 24, 32, 48.
- **Radius:** 6 on controls, 8 on dialogs and popovers. Never above 8.
- **Sizes:** 32px controls, 40px rows, 240px sidebar, 1440 desktop frames, 390 mobile frames.
- **Shadows:** only on Menu, Dialog, Toast and the ⌘K overlay.
- **Banned:**
  - gradients, glows, blur effects
  - sparkle, wand, star-burst or bot icons (`sparkles`, `wand`, `wand-sparkles`, `bot`, `brain`)
  - emoji, purple or indigo, lorem ipsum
  - "AI" in any interface label
- **Status:** `Status/*` glyph components (Draft, Planning, In progress, Completed, Archived). No dots, no pills; colour only on glyph and text.
- **Placeholders:** placeholder text uses `$text-muted`; `$text-faint` only for disabled text and decorative marks.
- **Brand:** "PlanFrojex" in Plex Sans 600 next to a 16px solid `$text` square mark.
- **Sample content:** workspace "Northwind".
  - **Members:** Maya Chen (PM, owner), Daniel Okafor (eng lead), Priya Raman (design), Tom Becker (backend), Sofia Alvarez (frontend), Kenji Sato (QA).
  - **Projects:** Customer portal rebuild, Billing migration, Mobile check-in app.

## Review Focus

1. **Long names and labels:** a 60-character project title or task title must truncate or wrap, never overflow its row. Every table and task row gets one long-title sample.
2. **Many items:** avatar stacks with 6+ members show 3 avatars plus "+3"; tags beyond 3 show "+n". Pinned in components (Task 2) and Projects list (Task 3).
3. **Empty workspace / first run:** Home and Projects must have an empty version, not just a full one. Pinned in Task 6.
4. **Viewer role:** the share page and viewer permissions hide edit actions. The share page (Task 5) shows no edit controls, and the Members page shows the viewer role.
5. **Draft rejection:** the Plan diff must show both accepted and pending sections, so the reject path is visible. Pinned in Task 4.

### Lint pass (used by every task as its "test")

Run this in an `execute` call with the screen or section id. It must print nothing (`OK` only) before a task is complete.

```js
const ban=["sparkles","wand","wand-sparkles","bot","brain"]
Get(ROOT,(n,c)=>{
  if(c.problems) Print("CLIP",n.name,c.problems)
  for (const k of ["fill","stroke"]) { const v=n[k]; const arr=Array.isArray(v)?v:[v]; for (const f of arr) { if(typeof f==="string"&&f.startsWith("#")) Print("RAW",n.name,k,f); if(f&&typeof f==="object"&&f.type&&f.type!=="color"&&f.type!=="image") Print("FILLTYPE",n.name,f.type) } }
  if(typeof n.cornerRadius==="number"&&n.cornerRadius>8) Print("RADIUS",n.name,n.cornerRadius)
  if(n.type==="text"&&n.fontFamily&&!/^(\$font-|IBM Plex)/.test(n.fontFamily)) Print("FONT",n.name,n.fontFamily)
  if(n.type==="icon"&&ban.includes(n.icon)) Print("ICON",n.name,n.icon)
  if(n.type==="text"&&/\bAI\b|lorem/i.test(n.content||"")) Print("COPY",n.name,n.content)
})
Print("OK")
```

Exceptions: the Foundations frame may contain raw hex in its swatch labels (text content, not fills), and the Avatar component may use raw hex fills for 6 fixed avatar colours.

---

### Task 1: File + Foundations

**Files:**
- Create: `design/planfrojex.pen`

**Interfaces:**
- **Produces variables:** `bg`, `bg-subtle`, `bg-muted`, `border`, `border-strong`, `text`, `text-muted`, `text-faint`, `accent`, `accent-subtle`, `success`, `warning`, `danger` (light and dark), plus `font-sans`, `font-mono`, `radius-control`=6, `radius-panel`=8.
- **Produces:** a "Foundations" frame showing colour swatches, the type scale, spacing and radius.

- [ ] **Step 1:** Save the untitled document as `design/planfrojex.pen` (open it via the `filePath` argument). Clear the empty default frame `bi8Au`.
- [ ] **Step 2:** `SetVariables` with every token above. Dark values:

  | Token | Dark hex |
  |---|---|
  | bg | `#141413` |
  | bg-subtle | `#1B1B1A` |
  | bg-muted | `#252523` |
  | border | `#2E2E2B` |
  | border-strong | `#3D3D39` |
  | text | `#EDEDEA` |
  | text-muted | `#A3A39D` |
  | text-faint | `#6E6E69` |
  | accent | `#6F93F0` |
  | accent-subtle | `#1C2740` |
  | success | `#4CB782` |
  | warning | `#D69A3A` |
  | danger | `#E5664F` |

- [ ] **Step 3:** Build the Foundations frame (1440 wide, vertical): colour swatch rows (token name + hex), type scale sample lines, a spacing ruler, and radius samples.
- [ ] **Step 4:** Run the lint pass on Foundations (raw-hex exception for labels), then take a screenshot. Expected: `OK`, no clipping.

### Task 2: Components

**Files:**
- Modify: `design/planfrojex.pen`

**Interfaces:**
- **Produces reusable components:**
  - Button/Primary, Button/Secondary, Button/Ghost, Button/Danger (md 32px, sm 28px)
  - Input, Textarea, Select, Checkbox
  - Tabs, Tab item
  - Status/Draft, Status/Planning, Status/In progress, Status/Completed, Status/Archived
  - Avatar, Avatar stack
  - Sidebar item, Table row, Task row
  - Comment, Activity item
  - Dialog, Menu, Toast
  - Empty state, Skeleton row
  - Diff block (pending and accepted variants), Progress bar
- **Named descendants** used in overrides: `Label`, `Icon`, `Value`, `Title`, `Meta`, `Body`.

- [ ] **Step 1:** Create a "Components" frame below Foundations. Build the controls first (Buttons, Input, Textarea, Select, Checkbox) at 32px height, `$radius-control`, 1px `$border-strong` stroke on inputs.
- [ ] **Step 2:** Build the display components: Badge, Status dot, Avatar (initials on one of 6 muted colours), Avatar stack (3 avatars + "+3" counter), Progress bar (4px track `$bg-muted`, fill `$accent`).
- [ ] **Step 3:** Build the rows:
  - **Sidebar item** (icon + label + optional count; selected uses `$accent-subtle` background)
  - **Table row** (36px, bottom border)
  - **Task row** (checkbox, ID in mono, title truncating, priority, assignee avatar, due date)
  - **Comment**
  - **Activity item**
- [ ] **Step 4:** Build the floating layers: Menu, Dialog, Toast (shadow `0 4 16 #0000001A`, `$radius-panel`), plus Empty state, Skeleton row and Diff block.
- [ ] **Step 5:** Run the lint pass on Components (avatar hex exception), then screenshot. Get user review before Task 3.

### Task 3: Batch A: App frame, Home, Projects list, New project dialog

**Files:**
- Modify: `design/planfrojex.pen`

**Interfaces:**
- **Consumes:** all Task 2 components.
- **Produces:** reusable "App sidebar" component (workspace switcher, search, Home/My tasks/Inbox, Starred, Projects, Members/Settings, account), with the selected item overridable via `descendants`.

- [ ] **Step 1:** Build the App sidebar component (240 × 900, `$bg-subtle`, right border).
- [ ] **Step 2:** **Home.** Header "Good morning, Maya" is banned as filler; use "Home" plus today's date. My tasks grouped Overdue / Today / This week (Task rows); "Your projects" list with progress; "Recent activity" column on the right at 320px.
- [ ] **Step 3:** **Projects list.** Title, filter bar (status, lead, priority, "Starred"), saved-view tabs (All, Active, Mine). Table with 8 rows including one 60-character title and one row with 6 members. Primary button "New project".
- [ ] **Step 4:** **New project dialog** over a dimmed Projects list (overlay `$text` at 40% alpha via hex `#1A1A1866` is the one allowed raw scrim). Template list on the left (Blank + 5), title and brief fields on the right.
- [ ] **Step 5:** Run the lint pass on each of the three frames, then screenshot them. User review.

### Task 4: Batch B: Project tabs

**Files:**
- Modify: `design/planfrojex.pen`

**Interfaces:**
- **Consumes:** App sidebar, Task 2 components.
- **Produces:** reusable "Project header" component (breadcrumb, title, status badge, lead, due date, star, Share button, tab row with the active tab overridable).

- [ ] **Step 1:** Build the Project header component. The project is "Customer portal rebuild".
- [ ] **Step 2:** **Brief.**
  - Document column (720 max): Problem, Goals, Constraints, Tags.
  - Right column (320): properties (status, lead, due, members) plus comments thread with an @mention.
- [ ] **Step 3:** **Plan.**
  - Toolbar with secondary button "Draft plan from brief".
  - Sections: Requirements, User stories, Milestones (timeline row), Risks (severity dot plus mitigation), Tech stack, Estimate (mono "9 weeks").
  - Show one section as an accepted Diff block and one as pending, with Accept / Reject.
- [ ] **Step 4:** **Tasks.**
  - List view grouped by status, with the board view toggle in the toolbar.
  - A Task side panel open on the right (480) showing description, properties and comments.
- [ ] **Step 5:** **Diagrams.**
  - Left list (240) of diagrams with type labels.
  - Centre canvas area (`$bg`, dotted grid made of a few `$border` frames is banned as decoration; use a plain canvas with a simple drawn flow of 5 boxes and arrows built from rectangles and lines).
  - Right panel (300): "Draft diagram" form (type select plus description plus button) and version history list.
- [ ] **Step 6:** **Activity.** Filter row (person, type) and a timeline grouped by day.
- [ ] **Step 7:** Run the lint pass on each of the five frames, then screenshot them. User review.

### Task 5: Batch C: Remaining pages

**Files:**
- Modify: `design/planfrojex.pen`

**Interfaces:**
- **Consumes:** App sidebar, Project header, Task 2 components.
- **Produces:** none.

- [ ] **Step 1:** **My tasks** (grouped by due date across projects; project name shown on each row) and **Inbox** (list of notifications on the left, selected notification's context on the right).
- [ ] **Step 2:** **Members** (table with role select, pending invites section, Invite dialog over the page) and **Workspace settings** (General, Share links table with Revoke, Danger zone with a Danger button).
- [ ] **Step 3:** **⌘K search** overlay over Home: input, then grouped results (Projects, Tasks, Commands) with key hints in mono.
- [ ] **Step 4:** **Sign in** (form left: email, password, "Continue with Google" as a secondary button; right: a cropped screenshot of the Projects list on `$bg-subtle`) and **Create workspace + invite** (two-step, step indicator "1 of 2" in text).
- [ ] **Step 5:** **Public share page** (no sidebar; top bar with brand plus "Read-only"; Brief, Plan summary and one diagram; footer "Made with PlanFrojex"). No edit controls anywhere (Review Focus 4).
- [ ] **Step 6:** Run the lint pass on each frame, then screenshot them. User review.

### Task 6: Mobile + States

**Files:**
- Modify: `design/planfrojex.pen`

**Interfaces:**
- **Consumes:** Task 2 components.
- **Produces:** none.

- [ ] **Step 1:** **Mobile 390** frames: Projects list (stacked rows, top bar with menu and search, floating-free "New" button in the top bar), Project › Brief (tabs scroll horizontally as text, properties stacked under the title) and Share page.
- [ ] **Step 2:** **States** frame:
  - Home empty ("No tasks assigned to you. Tasks you're assigned show up here." plus "Browse projects")
  - Projects empty ("No projects yet." plus "New project")
  - Loading (skeleton table)
  - Error ("Couldn't load projects. Check your connection and try again." plus Retry)
  - Drafting ("Drafting plan from brief…" plus progress bar at 40%)
- [ ] **Step 3:** Run the lint pass on all new frames, then screenshot them. Final user review.
- [ ] **Step 4:** Remove `placeholder` flags, arrange frames left to right in the spec order, and export PNGs of every screen to `design/exports/`.
