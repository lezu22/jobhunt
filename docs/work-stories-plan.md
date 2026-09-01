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

| # | PR | Contains | Depends on | Check (run yourself) | Your action | Status |
|---|----|----------|------------|----------------------|-------------|--------|
| 1 | `stories-schema` | `stories/migrate.py`, tables + indexes, wired into lifespan; migration tests | — | `python3 -m stories.migrate up/down` against a copy of `backend/data/jobhunt.db`; up→down→up leaves schema identical, `tracked_jobs` intact | review schema in `stories/migrate.py` + migration tests; optionally run the up/down check and the suite; reply "go ahead with step 2" | merged (approved 2026-08-31, incl. richer `status` output added on review feedback) |
| 2 | `stories-crud` | `stories/db.py`, `models.py`, `router.py`; category/story/label/job-link CRUD, reorder, revert, bulk-delete; seeded-data tests incl. delete-category-moves-stories, delete-story-removes-mappings, delete-job-unlinks-stories | 1 | curl script + pytest output pasted in PR | review endpoint shapes against the plan; optionally replay `bash scripts/stories_crud_demo.sh` (scratch DB, live data untouched); reply "go ahead with step 3" | awaiting my review |
| 3 | `stories-index` | `/stories` route, sidebar entry, read-only index: category sections (uncategorised always last), expand/collapse cards with rendered GFM body + mappings, category+story reorder; react-markdown@10.1.0 + remark-gfm@4.0.1; `JOBHUNT_API` vite proxy override; seeded demo script | 2 | run app, view seeded data, reorder persists across reload | run `bash backend/scripts/stories_index_demo.sh` + `JOBHUNT_API=http://localhost:8010 npm run dev -- --port 5174` (or just open /stories in your running app — empty until import), eyeball layout/cards, reorder + reload; reply with UI tweaks or "go ahead with step 4" | merged (approved 2026-09-01) |
| 4 | `stories-editor` | story/note view page: rendered markdown (react-markdown+remark-gfm), edit mode with sessionStorage draft buffer keyed by story id, dirty indicator, discard confirm, immediate metadata chip commits (visually separated from the draft-buffered body), save→previous_body, revert-to-previous; creation UI (new category, new story/note) since the index is read-only | 3 | refresh mid-edit keeps draft; save/cancel clears it; chip change survives cancel; revert works | exercise the edit flow yourself (draft survives refresh, cancel semantics, chip/body boundary feels clear); reply "go ahead with step 5" | merged (approved 2026-09-01 incl. arrow/chevron layout feedback) |
| 5 | `stories-delete` | single delete confirm (names title, lists what goes with it); bulk delete: one dialog, per-row checkboxes all checked, count on the action button, visually distinct from export dialog; transactional backend path + rollback test | 4 | delete with rows unchecked removes only checked; forced mid-transaction failure deletes nothing | try single + bulk delete on seeded data, judge the two dialogs are not confusable; reply "go ahead with step 6" | merged (approved 2026-09-01 incl. red ✕, bulk move, toast fixes) |
| 6 | `stories-import` | parser (H2 category, H3 title, `— Score: N/5` lifting, everything else verbatim incl. Caution lines, metadata-comment strip), upload validation (ext + UTF-8 + 2MB, retry flow), staged review screen: category resolution (create-new / map-to-existing), kind selection (no-mappings ⇒ note default), title edit, merge/split, per-record category, duplicate flagging (id ⇒ update default, title ⇒ create-new default, or skip), counts report | 2 (UI: 4) | import `story-bank.md`, verify counts + Caution lines in bodies; import twice, verify dup flow | import your real `story-bank.md`, check the staged review reads right (counts, categories, note defaults) before committing it; reply "go ahead with step 7" | merged (approved 2026-09-01 incl. cross-cat/body-similarity signals, 80% floor, side-by-side compare, bulk rules) |
| 7 | `stories-export` | single + combined export: categories as `##` in user order (uncategorised last, empty categories skipped), titles as `###`, mappings back to `— Score: N/5` form, metadata HTML comment under each `###` (checkbox: default ON full export, OFF selection); export dialog shows the default filename in an editable field for confirm/change before download (Q3); round-trip tests | 6 | export-all → re-import → no drift, metadata stripped not duplicated; metadata-off round trip loses only meta fields | export your imported bank, diff it against the original by eye, confirm the filename edit field; reply "go ahead with step 8" | awaiting my review |
| 8 | `stories-search` | search mechanism per Q1 decision (FTS5 confirmed), index title/body/question with question weighted highest, ranking = relevance, ties by score desc, question-matches above body-only; result rows show matching question + score; index filters (category/label/job/status/kind) + sorts + job-link UI | 2, 3 | "pushed back" finds the "push back on scope" story; no-result query behaves | search your own bank with real interviewer phrasings, judge the <10s find target and result ordering; reply "ready for final merge" or list misses | not started |
| 9 | final merge | dedicated commit deleting this doc, then merge `feat/work-stories` → `main` | 1–8 | full verification pass (below) done and reported | read the verification report, approve the merge to main explicitly | not started |

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
- **D8** (step 1) `stories.category_id` carries `ON DELETE SET NULL` as a
  schema-level backstop; the category-delete endpoint still moves stories to
  uncategorised explicitly. `question_mappings.score` is
  `CHECK (score IS NULL OR score BETWEEN 0 AND 5)`. Category and label names
  are `COLLATE NOCASE UNIQUE` at the schema level, so the case-insensitive
  duplicate block holds even outside the API.
- **D9** (step 1) The live DB picked up the migration at first app start after
  the lifespan wiring — expected and harmless (`up` is idempotent and purely
  additive; `tracked_jobs` untouched, 16 rows before and after,
  `PRAGMA integrity_check` ok). Confirmed during step 3: Lucas's backend runs
  live on port 8000 with reload, so it applies migrations as code lands.
- **D10** (step 2) Labels are pruned automatically once their last story link
  goes away (on label edit, story delete, bulk delete), so the filter
  dropdown never accumulates dead tags. There is no persistent label
  vocabulary beyond current use.
- **D11** (step 2) Switching a story to `kind: note` while it still has
  question mappings is a 400 telling you to clear them; sending
  `{"kind": "note", "mappings": []}` in one PATCH does both. Prevents
  silently discarding mappings on a metadata chip change.
- **D12** (step 2) `JOBHUNT_DB` env var points the whole backend (DB layer,
  migration CLI, server) at an alternate DB file. Used by tests and
  `scripts/stories_crud_demo.sh` so checks never touch live data.
- **D14** (step 3) `vite.config.js` proxy target is overridable via the
  `JOBHUNT_API` env var so a dev server can point at a scratch backend;
  `scripts/stories_index_demo.sh` seeds a scratch DB (GFM markdown, an
  injection attempt, NDA/labels/jobs/scores, an empty category) and serves it
  on port 8010, leaving the live app on 8000 alone. Demo/verification servers
  use ports 8010/5174.
- **D16** (step 4) Title travels with the draft buffer (explicit save), not
  the immediate-commit chips — the spec lists only category/labels/status/
  NDA/kind/job-links as immediate. Create mode (`/stories/new?kind=…`) is the
  one place chips don't commit instantly: no record exists until Create, and
  the metadata panel label says so. The `title_dup` soft warning surfaces as
  a toast on save/create.
- **D17** (step 4) Switching kind→note while mappings exist is refused by the
  backend (D11); the UI surfaces the error toast telling you to clear
  mappings first rather than silently deleting them.
- **D15** (step 3, from #6 being merged early) The original gate "final PR
  merges only after verification" dissolved when #6 was merged mid-feature;
  steps 1–2 are on main (harmless: backend-only, tracker untouched, CI
  green). A fresh final PR to main will carry the remaining steps and the
  plan-doc deletion commit, with the same gate.
- **D13** (workflow, 2026-08-31, settled after discussion) Stacked PR flow:
  `feat/work-stories` is the one long-lived feature branch. Each step is
  built on a short-lived branch (`feat/stories-<step>`), opened as a PR into
  `feat/work-stories`, merged only after Lucas reviews it, then the step
  branch is deleted. Draft PR #6 (`feat/work-stories` → `main`) accumulates
  the merged steps and is the final merge, gated on the verification pass and
  the dedicated plan-doc-deletion commit. Historical wrinkles: step 1 has no
  step PR (committed before pushing began; reviewable in #6, approved
  locally); step 2's PR #5 was merged during a brief flow detour ahead of
  review — its review is still owed, fixes go in before step 3.

- **D18** (step 4 review) Status vocabulary (from the feature spec): `draft` =
  story is being written / not yet trusted; `gap` = a known hole in the bank —
  a question or theme that needs a story (or has only a weak one), kept
  visible so prep work targets it; `ready` = interview-ready. Statuses are a
  plain CHECK constraint, trivially renameable if this reading is wrong.
- **D19** (step 4 review) Reorder arrows on cards and category headers got a
  much larger padded hit area that swallows clicks (a near-miss no longer
  expands the card), with hover highlight.

- **D20** (step 5) Dialog identity: destructive dialogs are red-coded — ⚠ +
  `--danger` title, red-tinted rows, verbs "Delete N permanently" / "Delete
  category". The step-7 export dialog will use the accent-green save theme
  with an editable filename field, so the two flows launched from the same
  multi-select toolbar cannot be confused. Category rename/delete live as
  ✎ / red ✕ icons on the category header (rename never touches story links;
  category delete states how many stories move to Uncategorised).
- **D21** (step 5 review) Multi-select toolbar also offers **Move to
  category…** (neutral-themed dialog, category picker incl. Uncategorised)
  backed by a transactional `POST /api/stories/bulk-move`: moved stories are
  appended to the target bucket in index order, records already in the target
  are skipped, a missing record rolls the whole move back, and nothing else
  (labels, status, jobs, body) is touched.

- **D22** (step 6) An `##` heading with prose but NO `###` children (the
  doc's "Quick-pick summary", talking-points and self-intro sections) becomes
  one candidate record titled by the heading — these are precisely the
  spec's "prose that is not a STAR-style story" notes. Prose under an `##`
  that also has `###` children, and content before any heading, is reported
  as unmatched on the review screen (never silently dropped, never
  importable as a record). Fenced code blocks are opaque to the parser —
  headings/score-lines inside them stay body text.
- **D23** (step 6, extended on review) Duplicate signals on the review
  screen, strongest first: (1) metadata-id match and same-title-in-resolved-
  category are the strong ⚠ flag (live, recomputed as category resolutions
  change); (2) same title in a *different* category shows as a softer ◎
  indicator naming that category; (3) **body-text similarity** — word-shingle
  overlap coefficient (stdlib, containment-friendly so a short note scores
  100% against a longer story holding the same prose) — reported as a
  percentage against the top 3 existing records ≥ 80% (Lucas-set floor: high enough to be a near-duplicate, low enough to still catch an edited copy), each with an expandable side-by-side comparison of incoming vs existing body; records at ≥80% best-similarity default to SKIP and are amber-highlighted (id matches still default to update); a title match below the floor annotates as "body differs" rather than a low percentage; a bulk-by-similarity bar applies skip/create/update to records above a per-rule threshold (80–100%), highest threshold winning, with equal thresholds treated as an overlap that blocks both applying and importing until resolved. Any signal enables
  update/create/skip (create default unless id match), and when several
  records could be the update target an explicit labelled target picker
  chooses between them. Import commit is one transaction; job links
  referencing since-deleted jobs are dropped and counted, orphan labels
  pruned.

- **D24** (step 7) Round-trip protections: uncategorised records export under
  a literal `## Uncategorised` heading which the import review auto-maps back
  to the synthetic bucket; body lines starting with `## `/`### ` are escaped
  as `\##` on export (rendered literally in the standalone file) and
  unescaped on import, so a body containing real markdown headings cannot be
  split into fake records; unscored mappings export as `— Score: ?/5`, which
  the parser reads back as a null score. Verified on the real doc: import →
  export(meta) → re-import → export is byte-identical from the first cycle
  (30/30 id-matched updates, zero creations), and remains so after category
  reorder (export follows the new order, Uncategorised last). Known drift vs
  the ORIGINAL hand-written file, by design: H1+intro preamble is not
  imported (reported at import), question quotes are normalised away, `---`
  separators between sections live in bodies only if inside one, and score
  lines regroup after the body.

## Future work (agreed out of current scope, schema kept safe for it)

- **F1 — Questions as first-class shared records** (raised by Lucas during
  step 4 review, 2026-09-01): a `questions` table plus a story↔question link
  carrying score/note/position, so one question can be attached to several
  stories and a question view can list every story answering it with scores.
  Deferred until after step 8 because: (a) step 8's FTS search already
  answers the mid-interview case across stories — matching question text
  surfaces every story with its score, without normalising identity; (b) the
  `question — Score: N/5` export line carries no stable question id, so
  hand-edited/imported files would spawn near-duplicate question rows and
  need a dedupe UX; (c) it would ripple through the import parser, staged
  review, duplicate detection and export while they are being built.
  Migration path stays clean: `CREATE TABLE questions` + get-or-create from
  distinct `question_mappings.question` text, then swap the text column for
  an FK — no data loss, one migration. Revisit once search is usable and we
  can judge whether FTS alone covers the need.

## Open questions

- **Q1 — RESOLVED 2026-08-31**: search mechanism confirmed by Lucas as SQLite
  FTS5 (`porter unicode61` tokenizer, `bm25()` column weights
  question > title > body, external-content table synced by triggers).
  Verified working on this machine's SQLite 3.37.2, including the
  "pushed back" → "push back on scope" stem match. Alternatives considered:
  Postgres tsvector (would introduce a whole new DB engine to a sqlite3
  project), LIKE (excluded by spec).
- **Q2 — RESOLVED 2026-08-31**: D5's normalised comparison (case-folded,
  whitespace-collapsed, leading list number stripped) confirmed as the
  duplicate-title match; no fuzzier matching.
- **Q3 — RESOLVED 2026-08-31**: filename defaults confirmed
  (`work-stories-YYYY-MM-DD.md` combined, `<slug-of-title>.md` single), with
  the requirement that the export dialog shows the filename in an editable
  field so it can be changed/confirmed before the file is produced (step 7).
