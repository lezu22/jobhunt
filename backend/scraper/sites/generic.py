"""
generic.py — Fallback scraper for any job board or company career page.
Uses heuristic CSS selectors and link scanning.
"""

from urllib.parse import quote_plus, urljoin, urlparse
from scraper.base import BaseScraper, fuzzy_match
import logging

log = logging.getLogger(__name__)

SEARCH_SUFFIXES = [
    "/jobs?q={role}",
    "/jobs?search={role}",
    "/careers?q={role}",
    "/careers?search={role}",
    "/jobs/search?keywords={role}",
    "/search?q={role}+jobs",
    "",  # try the page itself last
]

JOB_LINK_PATTERNS = [
    "a[href*='/jobs/']",
    "a[href*='/job/']",
    "a[href*='/careers/']",
    "a[href*='/career/']",
    "a[href*='/vacancy/']",
    "a[href*='/vacancies/']",
    "a[href*='/position/']",
    "a[href*='/opening/']",
]


class GenericScraper(BaseScraper):
    name = "generic"
    domains = []  # catch-all

    def search(self, role: str) -> list[dict]:
        results = []
        seen = set()
        encoded = quote_plus(role)

        for suffix in SEARCH_SUFFIXES:
            url = self.base_url + suffix.format(role=encoded)
            soup = self.get(url)
            if not soup:
                continue

            # Try structured job cards first
            cards = soup.select(
                "[class*='job-card'], [class*='JobCard'], [class*='job_card'], "
                "[class*='vacancy'], [class*='listing'], [class*='opening']"
            )

            if cards:
                for card in cards[:10]:
                    link_el = None
                    for pat in JOB_LINK_PATTERNS:
                        link_el = card.select_one(pat)
                        if link_el:
                            break
                    if not link_el:
                        link_el = card.select_one("a[href]")

                    title_el = card.select_one("h2, h3, h4, [class*='title'], [class*='name']")
                    if not title_el and link_el:
                        title_el = link_el

                    if not title_el:
                        continue
                    title = title_el.get_text(strip=True)
                    if not title or not fuzzy_match(role, title):
                        continue

                    href = link_el["href"] if link_el else ""
                    job_url = href if href.startswith("http") else urljoin(self.base_url, href)
                    if job_url in seen:
                        continue
                    seen.add(job_url)

                    company_el = card.select_one("[class*='company'], [class*='employer'], [class*='org']")
                    location_el = card.select_one("[class*='location'], [class*='place']")

                    desc, salary_text = self.fetch_detail(job_url)
                    results.append(self.make_job(
                        title=title, url=job_url,
                        company=company_el.get_text(strip=True) if company_el else None,
                        location=location_el.get_text(strip=True) if location_el else None,
                        description=desc,
                        salary_text=salary_text or card.get_text(),
                    ))
            else:
                # Fallback: scan all matching anchors
                for pat in JOB_LINK_PATTERNS:
                    for a in soup.select(pat)[:15]:
                        title = a.get_text(strip=True)
                        if not title or len(title) < 5:
                            continue
                        if not fuzzy_match(role, title):
                            continue
                        href = a.get("href", "")
                        job_url = href if href.startswith("http") else urljoin(self.base_url, href)
                        if job_url in seen:
                            continue
                        seen.add(job_url)

                        desc, salary_text = self.fetch_detail(job_url)
                        results.append(self.make_job(
                            title=title, url=job_url,
                            description=desc,
                            salary_text=salary_text or "",
                        ))

            if results:
                break

        return results[:10]
