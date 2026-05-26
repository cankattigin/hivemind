# HIVEMIND — Project Document

> Game Production Platform. Keep this file updated whenever a significant change is made.
> Last updated: 2026-05-26

---

## Live URLs

| | URL |
|---|---|
| **App (production)** | Railway auto-deploy from `master` branch |
| **GitHub repo** | https://github.com/cankattigin/hivemind |
| **Supabase project** | https://supabase.com/dashboard/project/cfavismisghsohlumqmu |
| **Railway project** | https://railway.com/project/1dc3ff39-ecc6-4024-ac33-63638538ab76 |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js |
| **Web framework** | Express 4 |
| **Database** | PostgreSQL via Supabase |
| **DB client** | `@supabase/supabase-js` (service key, bypasses RLS) |
| **Auth** | express-session + bcryptjs (server-side sessions, 7-day cookie) |
| **Frontend** | Single-page app — all UI in `public/index.html` (vanilla JS, no framework) |
| **File storage** | Supabase Storage (`hivemind-assets` bucket, public) |
| **Hosting** | Railway (auto-deploys on push to `master`) |
| **Migrations** | Run via Supabase dashboard SQL editor (or `migrate.js` with `DATABASE_URL`) |
| **Whiteboard** | Excalidraw 0.17.6 via CDN (React 17 + ReactDOM 17) |

### Key env vars (`.env`, never committed)

```
SUPABASE_URL=https://cfavismisghsohlumqmu.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...      # bypasses RLS — server-only
SESSION_SECRET=...
PORT=3000
DATABASE_URL=postgresql://postgres:[PW]@db.cfavismisghsohlumqmu.supabase.co:5432/postgres
```

---

## Database Schema

> All DB columns are `snake_case`. The JS layer maps them to `camelCase` at response time.

### `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| username | text | unique |
| password | text | bcrypt hash |
| account_type | text | `director` or `employee` |
| display_name | text | nullable — director-set display name, falls back to username |
| status | text | `active` or `archived` — archived = locked out of everything |
| created_at | timestamptz | |

### `projects`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| name | text | |
| invite_code | text | 8-char unique code |
| owner_id | uuid | FK → users |
| created_at | timestamptz | |
| pipelines | jsonb | legacy category pipelines + `templates` array (pipeline templates stored here under `templates` key) |
| permissions | jsonb | per-role permission overrides `{}` |
| departments | jsonb | array of dept strings |
| roles | jsonb | array of role strings available in project |
| pipeline_templates | jsonb | unused legacy column |

### `memberships`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK → users |
| project_id | uuid | FK → projects |
| role | text | legacy single role string (kept in sync with tiers) |
| roles | jsonb | legacy roles array (kept for backward compat) |
| tiers | jsonb | **authoritative** — array of permission tiers e.g. `["member"]`, `["designer","lead"]` |
| job_title | text | display-only label e.g. "Prop Artist", "Game Designer" |
| department | text | art / design / programming / qa / audio / production |
| status | text | `active`, `removed` (from this project), `archived` (company-wide) |
| joined_at | timestamptz | |

### `entity_types`  *(displayed as Class or Subclass)*
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| project_id | uuid | FK → projects |
| name | text | |
| category | text | `entity`, `mechanic`, `system`, etc. |
| color | text | hex color |
| icon | text | emoji |
| fields | jsonb | custom field definitions array |
| pipeline | jsonb | ordered pipeline step array |
| parent_id | uuid | nullable FK → entity_types (makes it a Subclass) |
| detail_blocks | jsonb | array of content blocks — see Detail Blocks section |
| created_at | timestamptz | |
| created_by | uuid | FK → users |

### `entities`  *(displayed as Element)*
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| project_id | uuid | FK → projects |
| name | text | |
| type_id | uuid | FK → entity_types |
| fields | jsonb | key-value custom field data |
| tags | jsonb | array of tag ids |
| nature | text | nullable — one of 7 nature values |
| status | text | `draft`, `in_progress`, `in_review`, `done` |
| environment | text | `not_in_engine`, `zoo`, `gym`, `playable_build`, `iteration` |
| pipeline | jsonb | per-step completion map |
| pipeline_steps | jsonb | step metadata |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| created_by | uuid | FK → users |
| owned_by | uuid | FK → users |
| icon_url | text | nullable — uploaded icon image URL |

### `tags`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| project_id | uuid | FK → projects |
| name | text | |
| category | text | |
| color | text | |
| description | text | |
| created_at | timestamptz | |

### `tasks`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| project_id | uuid | FK → projects |
| entity_id | uuid | FK → entities |
| step_id | text | pipeline step id |
| step_name | text | |
| dept | text | |
| assignee_id | uuid | FK → users |
| assigned_by | uuid | FK → users |
| assigned_by_name | text | |
| status | text | `not_started`, `in_progress`, `in_review`, `done`, `blocked` |
| needs_reassignment | boolean | true when assigned user was removed/archived |
| due_date | date | nullable |
| note | text | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `comments`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| entity_id | uuid | FK → entities |
| parent_id | uuid | nullable FK → comments (for threaded replies) |
| text | text | |
| type | text | `comment` or `feedback` |
| author_id | uuid | FK → users |
| author_name | text | denormalised |
| resolved | boolean | |
| created_at | timestamptz | |

### `activity`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| project_id | uuid | FK → projects |
| entity_id | uuid | FK → entities |
| user_id | uuid | FK → users |
| username | text | denormalised |
| action | text | `created`, `status`, `environment`, `task_assigned`, `task_status` |
| detail | text | human-readable description |
| created_at | timestamptz | |

---

## Terminology

| UI Term | DB / Code Term | Meaning |
|---|---|---|
| **Class** | entity_type (no parent_id) | Top-level category of game content |
| **Subclass** | entity_type (with parent_id) | Child type nested under a Class |
| **Element** | entity | A concrete game asset/item |
| **Nature** | nature (text on entities) | Production nature of an Element |

### Nature values
| Value | Icon | Meaning |
|---|---|---|
| `original` | ✨ | Brand-new creation |
| `variant` | 🔀 | Variation of an existing Element |
| `reskin` | 🎨 | Visual-only change |
| `port` | 📦 | Ported from another project/platform |
| `outsourced` | 🤝 | Made by external party |
| `procedural` | ⚙️ | Generated procedurally |
| `placeholder` | 🔲 | Temporary stand-in |

---

## Permission System

### Account types (on `users.account_type`)
- **director** — full access to everything, manages team, cannot be overridden
- **employee** — project access determined by membership tiers

### Permission Tiers (on `memberships.tiers[]`, combinable)

| Tier | Content Creation | Assign Tasks | Approve Reviews | Manage Team |
|---|:---:|:---:|:---:|:---:|
| `member` | ❌ | Self only | ❌ | ❌ |
| `designer` | ✅ Classes + Elements | Self only | ❌ | ❌ |
| `lead` | ❌ | Own dept only | Own dept only | ❌ |
| `designer` + `lead` | ✅ | Own dept only | Own dept only | ❌ |
| `manager` | ❌ | Any dept | Any dept | ✅ |
| director | ✅ | Anyone | Anyone | ✅ |

**Rules:**
- `lead` is always department-scoped — Lead Artist cannot assign to Programmers
- `designer` + `lead` in dept `design` = Design Lead (content rights + dept task assignment)
- `manager` overrides all leads but has zero content creation rights
- Self-assign is allowed for everyone but still goes to `in_review` requiring lead/manager/director approval
- Everyone can read and comment freely

### Membership Status
- `active` — normal access
- `removed` — removed from this project only; can access other projects
- `archived` — company-wide; `users.status = 'archived'`; blocked at login entirely

---

## Detail Blocks (on Classes/Subclasses)

Stored as `entity_types.detail_blocks` JSONB array. Each block:

```json
{
  "id": "uuid",
  "type": "richtext" | "whiteboard" | "image",
  "title": "string",
  "content": "string or JSON string",
  "caption": "string (image only)",
  "height": "number (whiteboard only, px)",
  "created_at": "ISO timestamp"
}
```

| Type | Content stored | Notes |
|---|---|---|
| `richtext` | plain text string | Full-width textarea, auto-saves on blur |
| `whiteboard` | Excalidraw scene JSON string | Lazy-loads React 17 + Excalidraw 0.17.6 from CDN, resizable (default 1000px), drag handle to resize, saves with 2s debounce |
| `image` | public URL string | Uploaded via `/api/upload/icon`, optional caption |

Only `designer` tier or director can add/edit blocks.

---

## Features Built

### Auth
- Register as director or employee
- Login / logout (session-based, 7-day cookie)
- Archived users blocked at login

### Projects
- Directors create projects (auto-generates invite code)
- Employees join via invite code (start as `pending`/`viewer`)
- Project settings: rename, regenerate invite code

### Team Management
- View all members with role, job title, department, tiers
- **Display Name** — director can set a display name per person (falls back to username)
- **Job Title** — free text label (e.g. "Prop Artist")
- **Tiers** — multi-select checkbox picker (member / designer / lead / manager)
- **Remove from Project** — revokes project access, flags their tasks ⚠️
- **Archive (Company)** — locks account entirely, all projects, blocks login, name shows as `Name 💀`
- **Restore** — director can un-archive or re-add to project
- Ex-members shown at bottom of Team list in a collapsed section

### Classes & Subclasses (entity_types)
- Create / edit / delete Classes (top-level) and Subclasses (nested)
- Each has: name, icon, color, category, custom fields, pipeline steps
- Sidebar shows Class → Subclass hierarchy
- **Detail Blocks** — attach Rich Text, Whiteboard (Excalidraw), or Image blocks to any Class/Subclass

### Elements (entities)
- Create / edit / delete Elements
- **Duplicate** — copies fields/tags/nature/typeId, resets status+environment+pipeline, new item appears at top of list with toast notification (does not navigate away)
- **Delete** — confirm dialog, removes from list
- **Sort & Filter toolbar** on both All Elements and Class-specific pages: sort by name/date, filter by Class/Nature/Status/Environment, search by name — all client-side
- Action buttons (📋 Duplicate, 🗑️ Delete) appear on row hover
- Nature pill selector, nature badge in tables/cards
- Icon upload, custom fields, tags

### Pipeline System
- Named reusable pipeline templates (8 defaults: 3D Prop, 3D Character, UI Asset, VFX, Audio, Gameplay Mechanic, Narrative, Level)
- Pipeline inheritance: Subclass inherits parent Class pipeline if it has none
- Templates stored in `projects.pipelines.templates` (no extra table)
- "Apply template" dropdown in Class/Subclass edit modal

### Tasks
- Self-assign allowed for everyone (goes to in_review)
- Leads assign tasks within their department only
- Managers/directors assign across any department
- Task statuses: `not_started`, `in_progress`, `in_review`, `done`, `blocked`
- **⚠️ Needs Reassignment** — tasks flagged when assignee is removed/archived, sorted to top of task lists
- Review queue scoped by department for leads

### Comments
- Threaded replies (↩ Reply inline, indented below parent)
- Delete own comments (directors can delete any)
- Deleting a parent cascades to delete its replies

### Activity Log
- Events: created, status change, environment change, task assigned, task status change
- Per-project feed, last 50 events

### Dashboard & Stats
- Elements by status/environment/class
- Recently updated elements, in-iteration list, blocked tasks

### Reports
- Completion % by Class
- Tasks by team member
- Environment breakdown
- Unassigned pipeline steps
- Week activity feed

### Themes
- 3-way switcher in topbar: 🌙 Dark / 😊 Umut / 💃 Girl (Barbie pink)
- Persisted to localStorage

### File Upload
- Icon images for Elements
- Supabase Storage `hivemind-assets` bucket (auto-created if missing)

---

## Pending / Known Issues

- [ ] **Excalidraw** — CDN loading is fragile (React 17 + Excalidraw 0.17.6). If whiteboard block shows error, check browser console. Needs user confirmation it's working reliably.
- [ ] **Railway auto-deploy** — was broken (no webhook), manually fixed by reconnecting `cankattigin/hivemind` master via Railway GraphQL API. Monitor to confirm future pushes auto-deploy.
- [ ] Real-time updates — no live sync, requires page refresh to see others' changes
- [ ] Element bulk actions (bulk status change, bulk assign)
- [ ] Export (CSV / spreadsheet)
- [ ] Role-based permissions editor UI (`permissions` JSONB column exists, no UI built)
- [ ] Password reset / account management
- [ ] Audit trail page (activity API exists, no dedicated page)
- [ ] Mobile layout
- [ ] Notification system (task assigned, status changes)
- [ ] `pipeline_templates` column on projects is unused legacy — can be cleaned up

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Single `public/index.html` | No build step, simple deploy |
| Supabase service key server-side | Avoids RLS complexity; server enforces all auth |
| Pipeline templates in `projects.pipelines.templates` | No extra table needed |
| `tiers[]` array separate from `role` string | `role` kept for legacy; `tiers` is authoritative for permissions |
| `users.status` for company-wide archive | Membership-level removal is per-project; user-level archive blocks login entirely |
| `display_name` on users, not memberships | Display name is company-wide identity, not per-project |
| Excalidraw via CDN (React 17 + 0.17.6) | No bundler — must use UMD builds; React 17 chosen for Excalidraw peer-dep compatibility |
| Migrations via Supabase SQL editor | `pg` + `DATABASE_URL` works locally but Railway injects its own DB URL; Supabase browser API is the most reliable migration path |
| DB = snake_case, JS = camelCase | Supabase convention; mapped at API response boundary |

---

## Deployment Workflow

### Normal change
```bash
git add .
git commit -m "describe change"
git push
# Railway auto-deploys in ~1 min
```

### Adding a new DB column
1. Add `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` to `migrate.js`
2. Run it via Supabase SQL Editor (preferred), or `node migrate.js` with `DATABASE_URL` in `.env`
3. Commit and push

### If Railway stops auto-deploying
Railway session expires and the GitHub webhook breaks. Fix by logging into railway.com and running in browser console:
```js
// Reconnect GitHub
fetch('https://backboard.railway.com/graphql/v2', {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `mutation { serviceConnect(id: "cf3d1813-28ba-4366-bcf3-d358bcc9be59", input: { repo: "cankattigin/hivemind", branch: "master" }) { id } }` })
})
// Then trigger redeploy
fetch('https://backboard.railway.com/graphql/v2', {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `mutation { serviceInstanceRedeploy(environmentId: "4ddf3a63-0a62-4b07-98c8-a2b102ae25fb", serviceId: "cf3d1813-28ba-4366-bcf3-d358bcc9be59") }` })
})
```

### npm scripts
```bash
npm start          # start server locally
npm run migrate    # run migrate.js (requires DATABASE_URL in .env)
```

### Railway env vars (set in Railway dashboard → service → Variables)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`
- `SESSION_SECRET`
- `PORT` (set automatically by Railway)
