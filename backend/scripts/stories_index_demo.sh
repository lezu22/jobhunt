#!/usr/bin/env bash
# Seeds a scratch DB with demo Work Stories data and serves the backend on
# port 8000 (so the vite dev server's /api proxy hits it). Live DB untouched.
#
#   terminal 1:  cd backend && bash scripts/stories_index_demo.sh
#   terminal 2:  cd frontend && npm run dev     → http://localhost:5173/stories
set -euo pipefail

export JOBHUNT_DB=${JOBHUNT_DB:-/tmp/stories-index-demo.db}
rm -f "$JOBHUNT_DB"

python3 - <<'EOF'
import database
from stories import migrate, db
database.init_db()
migrate.migrate(database.DB_PATH)
database.upsert_job({"id": "job-ai", "title": "Systems QA Engineer", "company": "Applied Intuition"})
database.upsert_job({"id": "job-ox", "title": "Robotics Engineer", "company": "Oxbotica"})

req = db.create_category("Requirements Capture")["id"]
sys_ = db.create_category("Systems Engineering")["id"]
db.create_category("Architecture")  # deliberately left empty

def story(**kw):
    base = dict(kind="story", category_id=None, status="draft", nda_sensitive=False,
                labels=[], job_ids=[], mappings=[])
    base.update(kw)
    return db.create_story(base)[0]

story(
    title="Tracer AGV second testing platform",
    category_id=req, status="ready", labels=["ownership", "hardware"],
    job_ids=["job-ai", "job-ox"],
    body="""Leading a project to give QA a second testing platform.

## Key facts

| Aspect | Detail |
|--------|--------|
| Platform | Tracer AGV |
| Handover | From another team |
| Scope | Requirements doc + TDD + physical build |

- Knowledge transfer from previous engineer
  - ROS2 environment
  - LiDAR-based mapping
- Validation testing before rollout

```bash
ros2 launch tracer bringup.launch.py
```

- Caution: do not mention the customer name in interviews.
""",
    mappings=[
        {"question": "Tell me about a time you owned requirements capture end to end.", "score": 5, "note": "full ownership"},
        {"question": "Describe a project you inherited from another team.", "score": 5},
        {"question": "How do you handle ambiguous requirements?", "score": 3, "note": "not the sharpest fit"},
    ],
)
story(
    title="Boot/deploy rework scope pullback",
    category_id=req, status="ready", nda_sensitive=True, labels=["pushback"],
    body="Pushed to narrow requirements back to what was realistically testable.\n\n---\n\n**Outcome:** tested properly and released successfully.",
    mappings=[
        {"question": "Tell me about a time you had to push back on scope.", "score": 5},
        {"question": "Describe a time requirements were too broad or vague.", "score": 4},
    ],
)
story(
    title="Localization quality tier testability gap",
    category_id=sys_, status="gap", nda_sensitive=True, labels=["observability"],
    body="Flagged a testability gap; a debug mode was added that logged the tier on every switch.\n\nAttempted injection (must render as text): <script>alert('xss')</script> and <img src=x onerror=alert(1)>",
    mappings=[{"question": "How do you improve system observability?", "score": 5}],
)
story(
    title="Opening self-introduction",
    kind="note", status="ready", labels=["framing"],
    body="**90-second version.** QA lead with robotics + systems background:\n\n1. Current role and scope\n2. The Tracer platform story as proof of ownership\n3. Why this company",
)
print(f"seeded {database.DB_PATH}: 3 categories (one empty), 3 stories + 1 uncategorised note, 2 jobs")
EOF

exec python3 -m uvicorn main:app --port 8000
