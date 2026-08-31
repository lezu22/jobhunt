# Job Hunt Command Centre

[![CI](https://github.com/lezu22/jobhunt/actions/workflows/ci.yml/badge.svg)](https://github.com/lezu22/jobhunt/actions/workflows/ci.yml)

A full-stack job search and application tracking app. See [docs/CI_GUIDE.md](docs/CI_GUIDE.md) for how this repo's CI pipeline works.

```
React frontend ↔ FastAPI backend ↔ SQLite database
                       ↕
              Modular job scraper
         (LinkedIn, Indeed, Glassdoor,
          Wellfound, Welcome to the Jungle,
          TechNation, UK-RAS + generic fallback)
```

---

## Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+

### macOS / Linux
```bash
chmod +x start.sh
./start.sh
```

### Windows
```
double-click start.bat
```

### Manual start (two terminals)

**Terminal 1 — backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Terminal 2 — frontend:**
```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**

---

## Project Structure

```
jobhunt/
├── backend/
│   ├── main.py              # FastAPI REST API
│   ├── database.py          # SQLite operations
│   ├── config/
│   │   ├── search_config.json  # Your CV profiles + roles
│   │   ├── urls.json           # Target sites
│   │   └── last_results.json   # Latest scrape output
│   ├── data/
│   │   └── jobhunt.db       # SQLite database (auto-created)
│   └── scraper/
│       ├── runner.py        # Orchestrator
│       ├── base.py          # BaseScraper class
│       ├── salary.py        # Salary extraction
│       └── sites/
│           ├── linkedin.py
│           ├── indeed.py
│           ├── glassdoor.py
│           ├── wellfound.py
│           ├── welcometothejungle.py
│           ├── technation.py
│           ├── ukras.py
│           └── generic.py   # Fallback for any site
└── frontend/
    └── src/
        ├── App.jsx
        ├── api.js           # API client
        ├── pages/
        │   ├── Dashboard.jsx
        │   ├── Config.jsx   # Edit CV profiles + roles
        │   ├── Urls.jsx     # Manage target URLs
        │   ├── Scrape.jsx   # Run scraper with live progress
        │   ├── Results.jsx  # Browse results, track jobs
        │   └── Tracker.jsx  # Application pipeline manager
        └── components/
            ├── Sidebar.jsx
            ├── JobCard.jsx
            ├── TrackerCard.jsx   # Expandable with full editing
            ├── StatusPipeline.jsx
            └── UI.jsx            # Design system primitives
```

---

## App Flow

```
1. Search Config → define CV profiles + target roles
2. Target URLs  → pick job boards to scrape
3. Run Scraper  → click Run, watch live progress bar
4. Results      → browse all found jobs, click "+ Track"
5. Tracker      → manage pipeline per job:
                   ✓ Update status (Applied/Interview/Offer etc.)
                   ✓ Set stage dates (Applied → HR Screen → Tech Screen → ...)
                   ✓ Add notes with timestamps
                   ✓ Add tasks with checkboxes
                   ✓ Write personal research notes
                   ✓ Set key dates (interview, decision, start date)
```

---

## Supported Job Boards

| Site | Scraper type |
|------|-------------|
| linkedin.com | Dedicated |
| uk.indeed.com / indeed.co.uk | Dedicated |
| glassdoor.co.uk | Dedicated |
| wellfound.com | Dedicated |
| uk.welcometothejungle.com | Dedicated |
| technation.io | Dedicated |
| uk-ras.org.uk | Dedicated |
| **Any other URL** | Generic CSS fallback |

> Add company career pages directly (e.g. `https://wayve.ai/careers`) — the generic scraper handles most sites.

**Scraping etiquette:** this is a personal, single-user tool. All scrapers throttle themselves with randomised delays between requests, honour `Retry-After` headers, and back off on rate-limiting. Before adding a site, check its terms of service and `robots.txt` — some job boards (notably the large aggregators) restrict automated access, and their official APIs or email alerts may be the better option.

---

## Adding a New Site Scraper

1. Create `backend/scraper/sites/mysite.py`
2. Subclass `BaseScraper`, set `name` and `domains`, implement `search(role)`
3. Register in `backend/scraper/runner.py` → `SCRAPER_MAP`

```python
from scraper.base import BaseScraper, fuzzy_match

class MySiteScraper(BaseScraper):
    name = "mysite"
    domains = ["mysite.com", "www.mysite.com"]

    def search(self, role: str) -> list[dict]:
        soup = self.get(f"https://mysite.com/jobs?q={role}")
        results = []
        for card in soup.select(".job-card"):
            title = card.select_one("h3").get_text(strip=True)
            if not fuzzy_match(role, title):
                continue
            url = "https://mysite.com" + card.select_one("a")["href"]
            desc, salary_text = self.fetch_detail(url)
            results.append(self.make_job(title=title, url=url, description=desc, salary_text=salary_text))
        return results
```

---

## Database Schema

All tracked jobs are stored in `backend/data/jobhunt.db`:

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | MD5 of url+title |
| title, company, location, url | TEXT | Job info |
| source, cv_profile, role_searched | TEXT | Search metadata |
| salary_raw, salary_min, salary_max | TEXT/REAL | Extracted salary |
| description | TEXT | Job description |
| status | TEXT | none/applied/interview/offer/rejected/withdrawn |
| applied_date | TEXT | ISO date |
| stages | JSON | { "Applied": "2024-01-15", "Interview": "..." } |
| notes | JSON | [{ text, date }, ...] |
| tasks | JSON | [{ text, done, created }, ...] |
| research | TEXT | Free-form research notes |
| extra_dates | JSON | { "Interview Date": "...", ... } |
| created_at, updated_at | TEXT | ISO timestamps |
