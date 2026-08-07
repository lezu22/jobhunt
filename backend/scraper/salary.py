"""
salary.py — Extract and normalise salary information from text.
"""

import re
from typing import Optional


SALARY_PATTERNS = [
    # £60,000 - £80,000 / $60k-$80k
    r"[£$€]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*[kK]?\s*[-–—to]+\s*[£$€]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*[kK]?",
    # Up to £90,000
    r"[Uu]p\s+to\s+[£$€]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*[kK]?",
    # From £50k
    r"[Ff]rom\s+[£$€]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*[kK]?",
    # £75,000
    r"[£$€]\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*[kK]?(?:\s*(?:per\s+annum|pa|p\.a\.|annually|/yr|/year))?",
    # 75000 per annum
    r"(\d{1,3}(?:,\d{3})+)\s*(?:per\s+annum|pa|p\.a\.|annually|/yr|/year)",
]


def _normalise(raw: str) -> Optional[float]:
    raw = raw.replace(",", "").strip()
    try:
        val = float(raw)
        if val < 1000:
            val *= 1000
        return val
    except ValueError:
        return None


def extract_salary(text: str) -> dict:
    """Return {"min": float|None, "max": float|None, "raw": str|None}"""
    for pattern in SALARY_PATTERNS:
        m = re.search(pattern, text)
        if m:
            groups = [g for g in m.groups() if g is not None]
            raw = m.group(0).strip()
            if len(groups) >= 2:
                return {"min": _normalise(groups[0]), "max": _normalise(groups[1]), "raw": raw}
            elif len(groups) == 1:
                val = _normalise(groups[0])
                return {"min": val, "max": val, "raw": raw}
    return {"min": None, "max": None, "raw": None}


def salary_in_band(salary: dict, min_salary: Optional[float], max_salary: Optional[float]) -> bool:
    """True if salary overlaps the requested band, or if salary is unlisted, or if no filter set."""
    if min_salary is None and max_salary is None:
        return True
    if salary["min"] is None and salary["max"] is None:
        return True  # always include unlisted
    lo = salary["min"] or 0
    hi = salary["max"] or salary["min"] or 0
    if min_salary and hi < min_salary:
        return False
    if max_salary and lo > max_salary:
        return False
    return True
