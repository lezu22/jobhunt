#!/usr/bin/env bash
# Exercises the Work Stories CRUD endpoints via curl against a scratch DB.
# Run from backend/:  bash scripts/stories_crud_demo.sh
# Never touches data/jobhunt.db — the server runs with JOBHUNT_DB pointing at
# a throwaway copy seeded with one tracked job.
set -euo pipefail

PORT=8756
DB=$(mktemp /tmp/stories-demo-XXXX.db)
export JOBHUNT_DB=$DB
BASE=http://127.0.0.1:$PORT/api/stories

say()  { echo; echo "── $1"; }
J()    { python3 -m json.tool --compact 2>/dev/null || cat; }

python3 - <<'EOF'
import database
from stories import migrate
database.init_db()
migrate.migrate(database.DB_PATH)
database.upsert_job({"id": "job-demo", "title": "Robotics Engineer", "company": "ACME"})
print(f"seeded scratch DB at {database.DB_PATH}")
EOF

python3 -m uvicorn main:app --port $PORT --log-level warning &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -f "$DB"' EXIT
for i in $(seq 1 40); do curl -s -o /dev/null $BASE/categories && break; sleep 0.25; done

say "create two categories; duplicate name is a 409"
curl -s -X POST $BASE/categories -H 'Content-Type: application/json' -d '{"name":"Requirements Capture"}' | J
curl -s -X POST $BASE/categories -H 'Content-Type: application/json' -d '{"name":"Architecture"}' | J
curl -s -w ' [%{http_code}]\n' -X POST $BASE/categories -H 'Content-Type: application/json' -d '{"name":"requirements capture"}'

say "create a story with mappings, labels and a job link"
SID=$(curl -s -X POST $BASE -H 'Content-Type: application/json' -d '{
  "title": "Tracer AGV second platform", "category_id": 1,
  "body": "Led the project end to end, from knowledge transfer to rollout.",
  "mappings": [{"question": "Tell me about a time you owned a project end to end.", "score": 5}],
  "labels": ["ownership"], "job_ids": ["job-demo"]}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["story"]["id"])')
echo "story id: $SID"

say "empty body is rejected"
curl -s -w ' [%{http_code}]\n' -X POST $BASE -H 'Content-Type: application/json' -d '{"title":"X","body":"   "}'

say "immediate metadata patch (status/nda), then a body save, then revert"
curl -s -X PATCH $BASE/$SID -H 'Content-Type: application/json' -d '{"status":"ready","nda_sensitive":true}' | python3 -c 'import sys,json; s=json.load(sys.stdin)["story"]; print({k:s[k] for k in ("status","nda_sensitive","has_previous")})'
curl -s -X PATCH $BASE/$SID -H 'Content-Type: application/json' -d '{"body":"Rewritten body v2."}' | python3 -c 'import sys,json; s=json.load(sys.stdin)["story"]; print({k:s[k] for k in ("body","has_previous")})'
curl -s -X POST $BASE/$SID/revert | python3 -c 'import sys,json; print({"body_after_revert": json.load(sys.stdin)["body"]})'

say "delete the category: story moves to uncategorised"
curl -s -X DELETE $BASE/categories/1 | J
curl -s $BASE/$SID | python3 -c 'import sys,json; print({"category_id": json.load(sys.stdin)["category_id"]})'

say "delete the tracked job: story is unlinked, not deleted"
curl -s -X DELETE http://127.0.0.1:$PORT/api/tracker/job-demo | J
curl -s $BASE/$SID | python3 -c 'import sys,json; s=json.load(sys.stdin); print({"job_ids": s["job_ids"], "title": s["title"]})'

say "bulk delete with a bad id rolls back; with good ids it deletes"
S2=$(curl -s -X POST $BASE -H 'Content-Type: application/json' -d '{"title":"Second","body":"B"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["story"]["id"])')
curl -s -w ' [%{http_code}]\n' -X POST $BASE/bulk-delete -H 'Content-Type: application/json' -d "{\"ids\": [\"$SID\", \"missing\"]}"
curl -s $BASE | python3 -c 'import sys,json; print({"stories_left": len(json.load(sys.stdin))})'
curl -s -X POST $BASE/bulk-delete -H 'Content-Type: application/json' -d "{\"ids\": [\"$SID\", \"$S2\"]}" | J
curl -s $BASE | python3 -c 'import sys,json; print({"stories_left": len(json.load(sys.stdin))})'

say "delete-story cascade counts came from a story's own mappings/links"
echo "(see removed_with_it in DELETE /api/stories/{id} — exercised in pytest)"
echo
echo "demo done (scratch DB removed, live DB untouched)"
