# HIVEMIND — Project Document

> Game Production Platform. Keep this file updated whenever a significant change is made.

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
| **Migrations** | `migrate.js` using `pg` library + `DATABASE_URL` |

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

> All DB columns are `snake_case`. The JS layer maps them to `camelCase` at response time (e.g. `type_id` → `typeId`, `parent_id` → `parentId`).

### `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| username | text | unique |
| password | text | bcrypt hash |
| account_type | text | `director` or `employee` |
| created_at | timestamptz | |

### `projects`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| name | text | |
| invite_code | text | 8-char unique code |
| owner_id | uuid | FK → users |
| created_at | timestamptz | |
| pipelines | jsonb | legacy category pipelines + `templates` array (pipeline templates live here) |
| permissions | jsonb | per-role permission overrides `{}` |
| departments | jsonb | array of dept strings |
| roles | jsonb | array of role strings available in project |
| pipeline_templates | jsonb | unused legacy column (templates now in `pipelines.templates`) |

### `memberships`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK → users |
| project_id | uuid | FK → projects |
| role | text | single role string (legacy, kept in sync) |
| roles | jsonb | array of role strings (authoritative) |
| department | text | nullable |
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
| pipeline | jsonb | ordered step array for this type |
| parent_id | uuid | nullable FK → entity_types (makes it a Subclass) |
| detail_blocks | jsonb | array of content blocks (richtext / whiteboard / image) |
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
| due_date | date | nullable |
| note | text | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `comments`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| entity_id | uuid | FK → entities |
| text | text | |
| type | text | `comment` or `feedback` |
| author_id | uuid | FK → users |
| author_name | text | denormalised for speed |
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
| **Class** | entity_type (no parent) | Top-level category of game content (e.g. "Character", "Prop") |
| **Subclass** | entity_type (with parent_id) | A child type under a Class (e.g. "Enemy" under "Character") |
| **Element** | entity | A concrete game asset/item belonging to a Class or Subclass |
| **Nature** | nature (text column on entities) | The production nature of an Element — see values below |

### Nature values
| Value | Icon | Meaning |
|---|---|---|
| `original` | ✨ | Brand-new creation |
| `variant` | 🔀 | Variation of an existing Element |
| `reskin` | 🎨 | Visual-only change to existing Element |
| `port` | 📦 | Ported from another project/platform |
| `outsourced` | 🤝 | Made by external party |
| `procedural` | ⚙️ | Generated procedurally |
| `placeholder` | 🔲 | Temporary stand-in |

---

## Account Types & Roles

### Account types (set at registration, stored on `users.account_type`)
- **director** — can create projects, has all permissions in every project
- **employee** — joins projects via invite code, has role-based permissions

### Built-in roles (stored in `memberships.roles[]`)
Directors and leads can assign tasks. Roles that include `lead` or equal `project_manager` are treated as leads.

Default roles seeded into every project: `lead_designer`, `designer`, `lead_artist`, `character_artist`, `prop_artist`, `environment_artist`, `concept_artist`, `animator`, `vfx_artist`, `ui_artist`, `tech_artist`, `lead_developer`, `developer`, `project_manager`, `qa_lead`, `qa_tester`, `audio_lead`, `audio_designer`, `viewer`.

---

## Features Built

### Auth
- Register as director or employee
- Login / logout (session-based, 7-day cookie)
- `/api/auth/me` hydrates session on page load

### Projects
- Directors create projects (auto-generates 8-char invite code)
- Employees join via invite code (join as `pending`/`viewer` until assigned a role)
- Project settings: rename, regenerate invite code

### Team Management
- View all members, their role and department
- Director assigns roles and departments to members
- Remove members

### Classes & Subclasses (entity_types)
- Create / edit / delete Classes (top-level types)
- Create Subclasses nested under a Class
- Each Class/Subclass has: name, icon (emoji), color, category, custom fields, pipeline steps
- Sidebar shows Class → Subclass hierarchy
- Clicking a Class/Subclass shows its Elements in a table

### Elements (entities)
- Create / edit / delete Elements under a Class or Subclass
- Fields: name, nature, status, environment, custom fields, tags, icon upload
- Nature pill selector (7 options) shown on create/edit
- Nature badge shown in table rows, detail views, and dashboard cards

### Pipeline System
- Each Class/Subclass has an ordered pipeline of steps (name + department)
- **Pipeline inheritance**: if a Subclass has no pipeline, it inherits from its parent Class (walks ancestor chain)
- **Pipeline Templates**: 8 default named templates (3D Prop, 3D Character, UI Asset, VFX, Audio, Gameplay Mechanic, Narrative, Level)
- Templates CRUD: create, edit, delete, reorder steps
- Templates stored inside `projects.pipelines.templates` (no extra table)
- "Apply template" dropdown in Class/Subclass edit modal pre-fills pipeline steps

### Tasks
- Directors and leads assign pipeline steps to team members
- Task statuses: `not_started`, `in_progress`, `in_review`, `done`, `blocked`
- "My Tasks" view for employees
- Review queue shows all tasks in `in_review` status
- Task assignment triggers activity log entry

### Comments & Feedback
- Comment thread on each Element detail panel
- Comment types: `comment` or `feedback`
- Comments can be resolved

### Activity Log
- Logged events: element created, status change, environment change, task assigned, task status change
- Per-project feed (last 50 events), filterable by entity

### Dashboard & Stats
- Total elements, types, comments, tasks
- Elements by status and environment
- Elements by Class (count + progress bar)
- Recently updated elements
- Elements currently in Iteration environment
- Blocked tasks

### Reports
- Completion % by Class
- Tasks by team member (breakdown by status)
- Environment breakdown
- Unassigned pipeline steps
- Week activity feed

### File Upload
- Upload icon images for Elements
- Stored in Supabase Storage bucket `hivemind-assets` (auto-created if missing)
- Returns public URL saved to `entities.icon_url`

### Themes
- 3-way theme switcher in topbar (cycles on click)
- 🌙 **Dark** — default dark theme
- 😊 **Umut** — light theme
- 💃 **Girl** — pink/Barbie theme
- Persisted to `localStorage`

### Tags
- Create / edit / delete tags per project
- Tags have name, category, color, description
- Assignable to Elements

---

## Features Pending / Known Gaps

- [ ] Notifications (task assigned, status changes)
- [ ] Real-time updates (currently requires page refresh to see others' changes)
- [ ] Element bulk actions (bulk status change, bulk assign)
- [ ] Search across all elements globally (currently per-project only)
- [ ] Pipeline step completion tracking per Element (pipeline progress UI)
- [ ] Export (CSV / spreadsheet of elements)
- [ ] Role-based permissions editor (permissions JSONB column exists, UI not built)
- [ ] Password reset / account management
- [ ] Audit trail UI (activity API exists, no dedicated page)
- [ ] Mobile-responsive layout

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Single `public/index.html` for all UI | Simplest possible SPA, no build step, easy to deploy |
| Supabase service key on server (bypasses RLS) | Avoids per-table RLS policy complexity; server enforces all auth |
| Pipeline templates stored in `projects.pipelines.templates` | Avoided creating a new DB table; all pipeline data lives in one JSONB column |
| `roles` array (not just `role` string) on memberships | Supports multi-role in future; `role` string kept in sync for legacy code |
| `nature` as free text column (not FK to a lookup table) | Values are a fixed enum in code; avoids join overhead |
| DB = snake_case, JS = camelCase | Supabase convention; mapped at API boundary in `server.js` response layer |
| `migrate.js` for all DDL | Supabase JS client cannot run DDL; `pg` library + `DATABASE_URL` is the only reliable path |

---

## Deployment Workflow

### Normal change
```bash
# make changes to server.js / public/index.html
git add .
git commit -m "describe change"
git push
# Railway auto-deploys in ~1 min
```

### Adding a new DB column
1. Add `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` to `migrate.js`
2. Add `DATABASE_URL` to `.env` if not already present (Supabase → Settings → Database → Connection string → URI)
3. Run `node migrate.js` (or `npm run migrate`)
4. Commit and push

### npm scripts
```bash
npm start          # start server locally
npm run migrate    # run migrate.js (requires DATABASE_URL in .env)
```

### Environment variables on Railway
Set via Railway dashboard → service → Variables:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`
- `SESSION_SECRET`
- `PORT` (Railway sets this automatically)
