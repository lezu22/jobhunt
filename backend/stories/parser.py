"""
stories/parser.py — markdown → staged import candidates.

Rules (from the feature spec):
- `## ` heading = category, `### ` heading = record title (both verbatim).
- Within a section, ONLY lines matching the score pattern
  ("question — Score: N/5 (optional note)") are lifted into question
  mappings. Every other line — "Best for:", "- Caution:", tables, code —
  stays in the body verbatim.
- A single-line HTML metadata comment (`<!-- ws: {...} -->`, written by
  export) directly inside a section is parsed and STRIPPED from the body so
  it can never be exported twice. The surrounding ## heading wins for
  category; the comment wins for every other field it carries.
- Fenced code blocks are opaque: headings or score-like lines inside them
  are body content, never structure.
- An ## heading with prose under it but NO ### children (a "quick-pick
  summary", talking-point framing, an opening self-introduction) becomes a
  single candidate record titled by the heading — these are exactly the
  sections the spec wants importable as notes. Prose under an ## that also
  has ### children, and content before any heading, is not importable as a
  record; it is counted and reported, never silently dropped.

Nothing here touches the database except duplicate detection, which is
read-only. Committing is a separate, explicit step.
"""

import json
import re

H2_RE = re.compile(r"^##\s+(?P<name>.*\S)\s*$")
H3_RE = re.compile(r"^###\s+(?P<title>.*\S)\s*$")
FENCE_RE = re.compile(r"^\s*(```|~~~)")
META_RE = re.compile(r"^\s*<!--\s*ws:\s*(?P<json>\{.*\})\s*-->\s*$")
SCORE_LINE_RE = re.compile(
    r"^\s*(?:[-*+]\s+)?(?P<q>.+?)\s+(?:—|–|--)\s+[Ss]core:\s*(?P<score>[0-5]|\?)\s*/\s*5\s*(?:\((?P<note>.*)\))?\s*$"
)  # '?' = a mapping without a score yet (export writes this for null scores)
LEADING_NUM_RE = re.compile(r"^\d+[.)]\s+")

QUOTE_PAIRS = [('"', '"'), ("“", "”"), ("'", "'")]


def _strip_quotes(q: str) -> str:
    q = q.strip()
    for a, b in QUOTE_PAIRS:
        if len(q) >= 2 and q.startswith(a) and q.endswith(b):
            return q[1:-1].strip()
    return q


_WORD_RE = re.compile(r"\w+")


def shingles(text: str, k: int = 3) -> frozenset:
    """Word k-shingles for body-similarity scoring."""
    words = _WORD_RE.findall(text.lower())
    if not words:
        return frozenset()
    if len(words) < k:
        return frozenset([tuple(words)])
    return frozenset(tuple(words[i:i + k]) for i in range(len(words) - k + 1))


def similarity(a: frozenset, b: frozenset) -> float:
    """Overlap coefficient: 1.0 when the smaller text is contained in the
    larger. Chosen over Jaccard so a short imported note still scores high
    against a longer existing story that contains the same prose."""
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def normalise_title(title: str) -> str:
    """D5: comparison form for duplicate detection — case-folded, whitespace
    collapsed, leading list numbering stripped. Storage stays verbatim."""
    t = LEADING_NUM_RE.sub("", title.strip())
    return " ".join(t.split()).casefold()


_ESCAPED_STRUCT_RE = re.compile(r"^\\(#{2,3}\s)")


def _unescape_struct(lines: list[str]) -> list[str]:
    """Undo the exporter's \\## / \\### body-line protection."""
    return [_ESCAPED_STRUCT_RE.sub(r"\1", l) for l in lines]


def _trim(lines: list[str]) -> list[str]:
    start, end = 0, len(lines)
    while start < end and not lines[start].strip():
        start += 1
    while end > start and not lines[end - 1].strip():
        end -= 1
    return lines[start:end]


META_FIELDS = ("id", "kind", "status", "nda", "labels", "jobs")


def _clean_meta(raw: dict) -> dict:
    meta = {}
    if isinstance(raw.get("id"), str):
        meta["id"] = raw["id"]
    if raw.get("kind") in ("story", "note"):
        meta["kind"] = raw["kind"]
    if raw.get("status") in ("draft", "gap", "ready"):
        meta["status"] = raw["status"]
    if isinstance(raw.get("nda"), bool):
        meta["nda"] = raw["nda"]
    if isinstance(raw.get("labels"), list):
        meta["labels"] = [str(x) for x in raw["labels"]]
    if isinstance(raw.get("jobs"), list):
        meta["jobs"] = [str(x) for x in raw["jobs"]]
    return meta


def parse_markdown(text: str) -> dict:
    """Parse into candidate records. Pure function of the text."""
    categories: list[str] = []          # H2 names in order of first appearance
    records: list[dict] = []
    preamble: list[str] = []            # lines before any heading
    cat_prose: dict[str, list[str]] = {}  # lines under an ## but outside any ###

    category = None                     # current H2 name (None = before any ##)
    section = None                      # current record dict being filled
    in_fence = False
    score_lines = 0

    def close_section():
        nonlocal section
        if section is None:
            return
        body_lines = _unescape_struct(_trim(section.pop("_body_lines")))
        section["body"] = "\n".join(body_lines)
        meta = section.get("meta") or {}
        section["kind"] = meta.get("kind") or ("story" if section["mappings"] else "note")
        section["kind_source"] = "meta" if meta.get("kind") else (
            "mappings" if section["mappings"] else "default-note")
        records.append(section)
        section = None

    def loose(line):
        """A line outside any ### section."""
        if category is not None:
            cat_prose.setdefault(category, []).append(line)
        else:
            preamble.append(line)

    for line in text.splitlines():
        if FENCE_RE.match(line):
            in_fence = not in_fence
            if section is not None:
                section["_body_lines"].append(line)
            else:
                loose(line)
            continue
        if in_fence:
            section["_body_lines"].append(line) if section is not None else loose(line)
            continue

        m = H2_RE.match(line)
        if m and not line.startswith("###"):
            close_section()
            category = m.group("name")
            if category not in categories:
                categories.append(category)
            continue

        m = H3_RE.match(line)
        if m:
            close_section()
            section = {
                "category": category,
                "title": m.group("title"),
                "_body_lines": [],
                "mappings": [],
                "meta": None,
            }
            continue

        if section is None:
            loose(line)
            continue

        m = META_RE.match(line)
        if m:
            try:
                section["meta"] = _clean_meta(json.loads(m.group("json")))
            except json.JSONDecodeError:
                section["_body_lines"].append(line)  # not ours: keep verbatim
            continue

        m = SCORE_LINE_RE.match(line)
        if m:
            note = (m.group("note") or "").strip() or None
            section["mappings"].append({
                "question": _strip_quotes(m.group("q")),
                "score": None if m.group("score") == "?" else int(m.group("score")),
                "note": note,
            })
            score_lines += 1
            continue

        section["_body_lines"].append(line)

    close_section()

    # H2s with prose but no ### children become one candidate record each,
    # titled by the heading (self-intro / talking-points / summary sections).
    cats_with_records = {r["category"] for r in records}
    synthesized = 0
    for name in categories:
        prose = _trim(cat_prose.get(name, []))
        if not prose or name in cats_with_records:
            continue
        body_lines, mappings, meta = [], [], None
        fence = False
        for line in prose:
            if FENCE_RE.match(line):
                fence = not fence
                body_lines.append(line)
                continue
            if not fence:
                m = META_RE.match(line)
                if m:
                    try:
                        meta = _clean_meta(json.loads(m.group("json")))
                        continue
                    except json.JSONDecodeError:
                        pass
                m = SCORE_LINE_RE.match(line)
                if m:
                    note = (m.group("note") or "").strip() or None
                    mappings.append({"question": _strip_quotes(m.group("q")),
                                     "score": None if m.group("score") == "?" else int(m.group("score")), "note": note})
                    score_lines += 1
                    continue
            body_lines.append(line)
        meta = meta or {}
        records.append({
            "category": name,
            "title": name,
            "body": "\n".join(_unescape_struct(_trim(body_lines))),
            "mappings": mappings,
            "meta": meta or None,
            "kind": meta.get("kind") or ("story" if mappings else "note"),
            "kind_source": "meta" if meta.get("kind") else (
                "mappings" if mappings else "default-note"),
        })
        synthesized += 1
        cat_prose.pop(name, None)

    # remaining loose lines: doc preamble + prose under H2s that have ### children
    for name, lines in cat_prose.items():
        trimmed = _trim(lines)
        if trimmed:
            preamble.append(f"(under ## {name})")
            preamble.extend(trimmed)
    preamble = _trim(preamble)

    return {
        "categories": categories,
        "records": records,
        "counts": {
            "records": len(records),
            "mappings": score_lines,
            "notes_defaulted": sum(1 for r in records if r["kind_source"] == "default-note"),
            "section_prose_records": synthesized,
            "preamble_lines": len(preamble),
        },
        "preamble": "\n".join(preamble),
    }
