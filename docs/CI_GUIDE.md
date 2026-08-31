# CI in this project — a working guide

This repo runs **Continuous Integration (CI)** via GitHub Actions. This doc explains
what the current pipeline does, why each piece exists, and a staged roadmap for
levelling it up. Use it as a learning path: each stage is small, self-contained,
and immediately visible on the repo's Actions tab.

## What CI is

CI is the practice of automatically building and testing the project **on every
push and pull request**, on a fresh machine that has none of your local setup.
The point is fast, impartial feedback:

- **Catches "works on my machine" bugs** — the runner starts from a clean Ubuntu
  image and must succeed using only what the repo declares (`requirements.txt`,
  `package-lock.json`). If a dependency is missing or an import only works
  because of something installed locally, CI fails and tells you.
- **Catches regressions at the commit that caused them** — when a refactor breaks
  salary parsing, the test run on that exact commit goes red, instead of you
  discovering it days later mid-job-hunt.
- **Makes every commit's health public** — the green check/badge is a signal to
  anyone reading the repo (including recruiters) that the project verifies itself.
- **Enables confident collaboration** — on a team, a PR can't merge until checks
  pass, so `main` stays releasable. Solo, it enforces the same discipline.

## What runs today (`.github/workflows/ci.yml`)

Two independent jobs, triggered on every push to `main` and every PR:

| Job | What it does | What it protects against |
|---|---|---|
| `backend-tests` | Installs `backend/requirements.txt` + pytest on Python 3.11, runs `pytest backend/tests` | Regressions in salary parsing, fuzzy matching, job-ID logic; broken imports; missing dependencies |
| `frontend-build` | `npm ci && npm run build` on Node 20 | Broken JSX/imports, dependency drift (`npm ci` fails if `package-lock.json` is out of sync) |

Key details worth understanding:

- **`npm ci` vs `npm install`**: `ci` installs *exactly* what the lockfile says and
  fails on any mismatch — deterministic, which is what you want in CI.
- Jobs run **in parallel** on separate runners; one failing doesn't hide the other.
- The workflow file is just YAML in the repo, so pipeline changes are code-reviewed
  and versioned like everything else.

## Roadmap — levelling up, one stage at a time

Each stage is a good standalone commit. Do them in order; each one you add is a
real, interview-discussable skill.

### Stage 1 — Linting (ruff)

A linter catches unused imports, undefined names, and style drift without running
the code. [Ruff](https://docs.astral.sh/ruff/) is the modern standard: one fast tool
that replaces flake8 + isort.

```yaml
# add to the backend-tests job, before "Run tests"
- name: Lint
  run: |
    pip install ruff
    ruff check backend
```

Run `ruff check backend --fix` locally first to clean up existing warnings.

### Stage 2 — Coverage reporting

Measure how much of the code the tests actually execute — and watch the number as
you add tests around `runner.py` and `database.py`:

```yaml
- name: Run tests with coverage
  run: |
    pip install pytest-cov
    pytest backend/tests -q --cov=backend --cov-report=term-missing
```

`--cov-report=term-missing` prints exactly which lines are untested — a built-in
to-do list for the next test to write.

### Stage 3 — API tests with FastAPI's TestClient

The current tests cover pure logic. The next tier tests HTTP endpoints without
running a server:

```python
# backend/tests/test_api.py
from fastapi.testclient import TestClient
from main import app

def test_stats_endpoint():
    with TestClient(app) as client:   # `with` triggers the lifespan/DB init
        resp = client.get("/api/stats")
        assert resp.status_code == 200
        assert "results_count" in resp.json()
```

This exercises routing, validation, and the database layer in one go. Gotcha to
solve (a great exercise): tests must not touch your real `backend/data/jobhunt.db`
— refactor `database.py` to accept a DB path so tests can use a temp file.

### Stage 4 — Python version matrix

Prove the backend runs on more than one Python version:

```yaml
strategy:
  matrix:
    python-version: ["3.10", "3.11", "3.12"]
steps:
  - uses: actions/setup-python@v5
    with:
      python-version: ${{ matrix.python-version }}
```

One YAML block → three parallel jobs. This is how libraries guarantee
compatibility claims (the README says "Python 3.10+" — CI can prove it).

### Stage 5 — Branch protection + PR workflow

In the repo settings → Branches → protect `main`: require the CI checks to pass
before merging. Then stop committing to `main` directly — branch, push, open a PR,
let CI go green, merge. Solo it feels ceremonious; it is also exactly the
workflow every professional team uses, and practising it here means it's muscle
memory in a job.

### Stage 6 — Pre-commit hooks (CI's local twin)

CI catches problems after push; [pre-commit](https://pre-commit.com/) catches them
before commit. A `.pre-commit-config.yaml` running ruff + trailing-whitespace
fixes means CI almost never fails on trivia.

### Beyond CI: CD (Continuous Deployment)

CD extends the same idea to shipping: after checks pass, automatically deploy.
For this app the natural experiments are building a Docker image in CI, or
deploying the backend to a free host (Fly.io/Render) on every green `main`.
That's the "CI/CD pipelines" line on a CV backed by a working example.

## Reading list

- [GitHub Actions docs](https://docs.github.com/en/actions) — especially "Understanding GitHub Actions"
- [FastAPI testing guide](https://fastapi.tiangolo.com/tutorial/testing/)
- [Martin Fowler — Continuous Integration](https://martinfowler.com/articles/continuousIntegration.html) — the canonical essay on *why*
