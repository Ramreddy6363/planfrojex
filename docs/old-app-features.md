# PlanFrojex: Feature List

Current features, checked against the code in `planfrojex-backend/` and `planfrojex-ui/`.

## 1. Accounts and login (Clerk)
- Sign up, log in and forgot password, using Clerk's built-in screens.
- Every API call requires login except the public share link and the health check.
- Each user sees and edits only their own projects.

## 2. Projects ("Ideas")
- Create, view, edit and delete projects.
- Fields: title, summary, description, tags, tech stack, status, priority, due date, favorite.
- Statuses: draft, planning, in progress, completed, archived.
- Priorities: low, medium, high.
- A "design completed" flag can be switched on and off.

## 3. Project list (`/Ideas`)
- Search by name or keyword.
- Filter by status, by priority, and to show favorites only.
- Results are paged, with favorites sorted first.

## 4. Dashboard (`/Dashboard`)
- Counts for total projects, in motion, completed, and due in the next 7 days.
- A list of recent projects.

## 5. Templates (`/Templates`)
- 5 starter templates: SaaS MVP, AI Product, Mobile App, E-commerce, Portfolio.
- Templates can be searched, and picking one fills in the new-project form.

## 6. AI project plan
- One click turns a project's title and description into:
  - requirements and user stories
  - tasks, each with a status, priority and due date
  - milestones (planned, in progress, completed)
  - risks, each with a severity and a mitigation
  - a suggested tech stack and estimated weeks
- You can edit the draft before saving, including changing each task's status, and a progress count shows completed tasks.

## 7. AI diagrams and canvas
- Diagram types: flowchart, architecture, sequence, ER, class, plus a manual (blank) mode.
- Two ways to generate:
  - from a text prompt you write
  - automatically from the project's own details
- The generated diagram becomes shapes you can edit on an Excalidraw canvas. You can also view the Mermaid source.
- Save, rename and delete diagrams.
- Version history: the last 20 versions are kept, and restoring an old one saves it as a new version.

## 8. Collaboration
- Discussion: add and delete comments (up to 2,000 characters).
- Activity log: records created, updated, planned, diagram saved, shared, unshared, commented and deleted.

## 9. Sharing
- Create or turn off a read-only public link (`/share/$token`) that needs no login.

## 10. Onboarding and landing
- A public landing page at `/`.
- A first-run onboarding card that can be dismissed and stays dismissed in that browser.

## 11. Platform and operations
- Rate limits: a general API limit, plus 20 AI requests per 10 minutes per user.
- AI providers: tries NVIDIA, then Groq, then Gemini, with timeouts and checks on the output.
- Security: helmet, a CORS allowlist, compression, error handling that changes by environment, and protection against prompt injection.
- Health check: `/api/health` reports which AI providers are available.
- CI: both repos run tests, build and `npm audit`. Deployed on Render (backend) and Vercel (UI).

## Half-built or broken

| Item | State |
|---|---|
| Favorite | Can be filtered and sorted, but there's no button in the UI to mark a project as favorite |
| AI diagrams | NVIDIA and Gemini fail, so only Groq works |
| ER diagrams | Show as a flat image, not editable shapes |
| Diagram version restore | Uses a basic browser `window.prompt` box |
| `Hero.tsx` | Not used anywhere |
| Theme | Login and landing pages use a different colour scheme from the rest of the app |
