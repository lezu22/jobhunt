# Work Stories — build plan

Working document for the Work Stories feature (searchable bank of interview
stories/notes, user categories, optional links to tracked jobs). Lives on
`feat/work-stories`; updated in the same commit as each step's code; deleted in
its own dedicated commit on the final PR before merge to main.

Reference content: `~/myCode/docs/story-bank.md` (~3,650 words, H2 categories,
numbered H3 titles, `— Score: N/5 (note)` bullets, Caution lines, tables).

Canonical test command on this machine (ROS pytest plugins clash otherwise):

```
cd backend && PYTHONPATH= python3 -m pytest tests/ -q -p no:launch_testing -p no:launch_testing_ros
```

Baseline before this feature: 34 passed.

---

## Where it fits in the existing app

- **Backend**: FastAPI app in `backend/main.py`, raw `sqlite3` in
  `backend/database.py` (no ORM, no Alembic; migrations are hand-rolled
  idempotent steps run at startup). DB file: `backend/data/jobhunt.db`. Jobs
  live in `tracked_jobs` with `id TEXT PRIMARY KEY`.
- New backend code goes in a `backend/stories/` package (`router.py` with an
  `APIRouter` included from `main.py`, `db.py`, `migrate.py`, `parser.py`,
  `exporter.py`, `search.py`, `models.py` for pydantic schemas) instead of
  growing the 438-line `main.py`.
- **Frontend**: React 18 + react-router-dom 6 + Vite 5, pages in
  `frontend/src/pages/`, sidebar nav via `NavLink` in
  `components/Sidebar.jsx`, shared primitives in `components/UI.jsx`
  (`Btn, Input, Select, Label, Card, SectionTitle, Badge, Modal, Toast,
  Spinner`), API calls through the `req()` helper in `src/api.js`, styling via
  inline styles + CSS variables (`--accent`, `--surface2`, `--border`, …).
- New route `/stories` in `App.jsx`, new `Sidebar` entry, page
  `pages/Stories.jsx` + `pages/StoryView.jsx`, feature components under
  `components/stories/`. All shared UI primitives above get reused; new
  chips/dialogs follow the same inline-style + CSS-var conventions.

## Libraries

- `react-markdown@10.1.0` + `remark-gfm@4.0.1` (checked against npm
  2026-08-31; peer dep `react >=18` satisfied by 18.3.1; ESM, fine under
  Vite 5). GFM: tables, task lists, strikethrough, autolinks.
- Sanitisation: react-markdown does **not** render raw HTML unless
  `rehype-raw` is added (we don't add it) — `<script>` and inline handlers
  come out as inert text, satisfying the no-raw-HTML requirement.
  `rehype-sanitize@6.0.0` is compatible if we want defence in depth.
- No new Python deps: upload uses `python-multipart` (already present),
  parser/exporter are stdlib, search is SQLite FTS5 (verified available:
  SQLite 3.37.2 with FTS5 + porter tokenizer works from this Python).

## Data model (agreed)

All new tables; `tracked_jobs` is untouched. Story ids are `TEXT` uuid4-hex
(matches `tracked_jobs` TEXT-id style and stays stable through export/import
metadata). Category/label/mapping ids are `INTEGER PRIMARY KEY`.

```
story_categories  id INTEGER PK
                  name TEXT NOT NULL UNIQUE COLLATE NOCASE   -- dup names blocked, case-insensitive
                  position INTEGER NOT NULL
                  created_at TEXT NOT NULL

stories           id TEXT PK (uuid4 hex)
                  title TEXT NOT NULL                        -- dups allowed; soft warning on exact match within category
                  body TEXT NOT NULL                         -- markdown; empty/whitespace rejected at API layer
                  kind TEXT NOT NULL CHECK (kind IN ('story','note'))
                  category_id INTEGER NULL REFERENCES story_categories(id)  -- NULL = uncategorised (synthesised bucket, no row)
                  status TEXT NOT NULL CHECK (status IN ('draft','gap','ready'))
                  nda_sensitive INTEGER NOT NULL DEFAULT 0
                  position INTEGER NOT NULL                  -- order within its category bucket (incl. NULL bucket)
                  previous_body TEXT NULL                    -- one-level revert
                  created_at TEXT NOT NULL
                  updated_at TEXT NOT NULL

question_mappings id INTEGER PK
                  story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE
                  question TEXT NOT NULL
                  score INTEGER NULL CHECK (score BETWEEN 0 AND 5)
                  note TEXT NULL
                  position INTEGER NOT NULL

labels            id INTEGER PK
                  name TEXT NOT NULL UNIQUE COLLATE NOCASE

story_label_links story_id TEXT REFERENCES stories(id) ON DELETE CASCADE
                  label_id INTEGER REFERENCES labels(id) ON DELETE CASCADE
                  PRIMARY KEY (story_id, label_id)

story_job_links   story_id TEXT REFERENCES stories(id) ON DELETE CASCADE
                  job_id TEXT REFERENCES tracked_jobs(id) ON DELETE CASCADE
                  PRIMARY KEY (story_id, job_id)
```

- Deleting a category: `UPDATE stories SET category_id = NULL` first, then
  delete the row (spec: stories move to uncategorised) — the FK never fires
  for this path.
- Deleting a job: cascade removes only `story_job_links` rows; stories
  survive. Requires `PRAGMA foreign_keys = ON` per connection — see
  decision D2.
- Search: FTS5 virtual table + sync triggers added in step 8 only after the
  mechanism is confirmed (see Open questions Q1).

## Endpoints (all under `/api/stories`, static paths registered before `/{id}`)

Categories
- `GET  /api/stories/categories` — ordered list with story counts
- `POST /api/stories/categories` — create (409 on case-insensitive dup name)
- `PATCH /api/stories/categories/{id}` — rename (409 on dup)
- `DELETE /api/stories/categories/{id}` — moves its stories to uncategorised, returns moved count
- `PUT  /api/stories/categories/order` — full ordered id list

Stories / notes
- `GET  /api/stories` — filters: `category` (id or `none`), `label`, `job`,
  `status`, `kind`; sort: `position` (default) | `updated` | `title`;
  includes labels, mapping score min/max, linked job ids
- `POST /api/stories` — create (400 on empty/whitespace body); response carries
  `title_dup: true` when an exact title already exists in the same category (soft warning)
- `GET  /api/stories/{id}` — full record incl. mappings, labels, job links
- `PATCH /api/stories/{id}` — body+mappings (explicit save; copies body →
  previous_body) and/or metadata (category_id, labels, status, nda, kind,
  job_ids — immediate commits)
- `POST /api/stories/{id}/revert` — swap body ↔ previous_body (one level)
- `PUT  /api/stories/order` — reorder within a category bucket
- `DELETE /api/stories/{id}` — hard delete (cascades mappings/links)
- `POST /api/stories/bulk-delete` — id list, single transaction, all-or-nothing;
  failure response names the offending record

Labels
- `GET /api/stories/labels` — for filter dropdown / autocomplete

Import / export
- `POST /api/stories/import/parse` — multipart upload (.md/.txt, 2MB cap,
  UTF-8 decode check) → staged candidates + counts + category/duplicate resolution info; commits nothing
- `POST /api/stories/import/commit` — reviewed decisions → transaction
- `POST /api/stories/export` — `{ids, include_metadata}` → combined .md
  (also serves the single-story case)

Search (step 8, after mechanism confirmed)
- `GET /api/stories/search?q=` — ranked stories + best matching question + score

Jobs for the link picker come from the existing `GET /api/tracker`.

## Migration

`backend/stories/migrate.py` with `up(conn)` / `down(conn)` and a CLI
(`python3 -m stories.migrate up|down [--db PATH]`). `up` creates the tables
above + indexes; `down` drops them (all-new tables, so rollback is clean and
`tracked_jobs` is never touched). `main.py` lifespan calls `up` idempotently,
matching the existing hand-rolled migration style. Step 1's check runs
up → down → up against a copy of the live DB.

---

## PR plan

Integration branch `feat/work-stories` (this doc is its first commit). Each
step is a PR into `feat/work-stories`, reviewed before the next starts. The
final PR merges `feat/work-stories` → `main`; the last commit before that
merge is the dedicated deletion of this document. Every PR from step 2 onward
re-runs the full backend suite, not just its own tests.

| # | PR | Contains | Depends on | Check (run yourself) | Status |
|---|----|----------|------------|----------------------|--------|
| 1 | `stories-schema` | `stories/migrate.py`, tables + indexes, wired into lifespan; migration tests | — | `python3 -m stories.migrate up/down` against a copy of `backend/data/jobhunt.db`; up→down→up leaves schema identical, `tracked_jobs` intact | not started |
| 2 | `stories-crud` | `stories/db.py`, `models.py`, `router.py`; category/story/label/job-link CRUD, reorder, revert, bulk-delete; seeded-data tests incl. delete-category-moves-stories, delete-story-removes-mappings, delete-job-unlinks-stories | 1 | curl script + pytest output pasted in PR | not started |
| 3 | `stories-index` | `/stories` route, sidebar entry, read-only index: category sections (uncategorised always last), expand/collapse cards, category+story reorder | 2 | run app, view seeded data, reorder persists across reload | not started |
| 4 | `stories-editor` | story/note view page: rendered markdown (react-markdown+remark-gfm), edit mode with sessionStorage draft buffer keyed by story id, dirty indicator, discard confirm, immediate metadata chip commits (visually separated from the draft-buffered body), save→previous_body, revert-to-previous | 3 | refresh mid-edit keeps draft; save/cancel clears it; chip change survives cancel; revert works | not started |
| 5 | `stories-delete` | single delete confirm (names title, lists what goes with it); bulk delete: one dialog, per-row checkboxes all checked, count on the action button, visually distinct from export dialog; transactional backend path + rollback test | 4 | delete with rows unchecked removes only checked; forced mid-transaction failure deletes nothing | not started |
| 6 | `stories-import` | parser (H2 category, H3 title, `— Score: N/5` lifting, everything else verbatim incl. Caution lines, metadata-comment strip), upload validation (ext + UTF-8 + 2MB, retry flow), staged review screen: category resolution (create-new / map-to-existing), kind selection (no-mappings ⇒ note default), title edit, merge/split, per-record category, duplicate flagging (id ⇒ update default, title ⇒ create-new default, or skip), counts report | 2 (UI: 4) | import `story-bank.md`, verify counts + Caution lines in bodies; import twice, verify dup flow | not started |
| 7 | `stories-export` | single + combined export: categories as `##` in user order (uncategorised last, empty categories skipped), titles as `###`, mappings back to `— Score: N/5` form, metadata HTML comment under each `###` (checkbox: default ON full export, OFF selection); round-trip tests | 6 | export-all → re-import → no drift, metadata stripped not duplicated; metadata-off round trip loses only meta fields | not started |
| 8 | `stories-search` | search mechanism per Q1 decision (FTS5 proposed), index title/body/question with question weighted highest, ranking = relevance, ties by score desc, question-matches above body-only; result rows show matching question + score; index filters (category/label/job/status/kind) + sorts + job-link UI | 2, 3 | "pushed back" finds the "push back on scope" story; no-result query behaves | not started |
| 9 | final merge | dedicated commit deleting this doc, then merge `feat/work-stories` → `main` | 1–8 | full verification pass (below) done and reported | not started |

## Verification pass (before final merge)

The full checklist from the feature spec, run against the real
`story-bank.md`: import counts and note-defaults; partial category matching
both ways; Caution-line survival; metadata round trip (on and off); double
import duplicate flow; edit/save/reload/revert; draft-buffer semantics;
single + partial bulk delete; forced bulk rollback; dialog distinctness;
category/story/job deletion interactions; reorder-then-export order; empty and
whitespace bodies, very long lines, uncategorised records; script-tag and
event-handler markdown; non-UTF-8, wrong-type and oversized files; search
misses and the stemmed "pushed back" hit. Results reported per item, including
anything that could not be executed.

## Decisions

- **D1** Story id = uuid4 hex TEXT: consistent with `tracked_jobs`, stable
  identity for export/import metadata; dup titles allowed since id is identity.
- **D2** Add `PRAGMA foreign_keys = ON` to every new connection and to the
  shared `database._connect()` so deleting a job cascades `story_job_links`.
  No existing FKs in the schema, so this changes nothing for current tables.
  (Belt-and-braces: step 2 tests assert the unlink actually happens.)
- **D3** Parser, exporter, and round-trip logic live backend-side under
  pytest — the repo has no JS test runner, and this keeps import/export
  covered by the suite. UI behaviour is verified by the per-step manual
  checks. (Add vitest later only if JS unit tests become worth it.)
- **D4** New endpoints live in an `APIRouter` package rather than `main.py`,
  which is already 438 lines of scraper/tracker concerns.
- **D5** Titles are kept verbatim on import (including "1. " numbering).
  Duplicate-title detection compares case-folded, whitespace-collapsed,
  leading-list-number-stripped forms so "1. Tracer AGV" ≈ "Tracer AGV".
- **D6** NDA flag is a marker/badge only — no redaction behaviour anywhere.
- **D7** Raw HTML in markdown is rendered as inert text (no `rehype-raw`),
  which satisfies "no raw HTML or script through" without a sanitiser pass.

## Open questions

- **Q1 (blocking step 8)** Search mechanism — recommendation made, awaiting
  confirmation: SQLite FTS5, `porter unicode61` tokenizer, `bm25()` column
  weights (question > title > body), external-content table synced by
  triggers. Verified working on this machine's SQLite 3.37.2, including the
  "pushed back" → "push back on scope" stem match. Costs/trade-offs in the
  PR-plan discussion. Alternatives considered: Postgres tsvector (would
  introduce a whole new DB engine to a sqlite3 project), LIKE (excluded by
  spec).
- **Q2** "Near-identical" title matching for import duplicate flagging is
  defined as D5's normalised comparison — flag if you want fuzzier matching
  (e.g. edit distance).
- **Q3** Export filename convention: proposing `work-stories-YYYY-MM-DD.md`
  for combined, `<slug-of-title>.md` for single. Confirm or name a preference.
