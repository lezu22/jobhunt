"""
TechNation job board scraper.
Old URL /jobs/ returns 404. Try multiple URL patterns and their job API.
"""

import json
import random
import time
from urllib.parse import quote_plus, urljoin
from scraper.base import BaseScraper, fuzzy_match
import logging

log = logging.getLogger(__name__)


class TechNationScraper(BaseScraper):
    name = "technation"
    domains = ["technation.io", "www.technation.io"]

    def search(self, role: str) -> list[dict]:
        self.warmup("https://technation.io")
        time.sleep(random.uniform(1.0, 2.0))

        # Try multiple URL patterns — the site has changed structure over time
        candidates = [
            f"https://technation.io/jobs/?s={quote_plus(role)}",
            f"https://technation.io/job-board/?s={quote_plus(role)}",
            f"https://technation.io/careers/?s={quote_plus(role)}",
            "https://technation.io/jobs/",
            "https://technation.io/job-board/",
        ]

        for url in candidates:
            soup = self.get(url)
            if not soup:
                continue

            # Check if we got a real jobs page (not 404/empty)
            page_text = soup.get_text()
            if "page not found" in page_text.lower() or "404" in page_text[:200]:
                continue

            results = []
            seen = set()

            # Look for job listings in various formats
            cards = (
                soup.select(".job-listing, .job-card, [class*='job_listing'], article.job") or
                soup.select("h2 a, h3 a") or  # Simple link lists
                []
            )

            # Also try generic job link scan
            for a in soup.select("a[href]")[:30]:
                href = a.get("href", "")
                title = a.get_text(strip=True)
                if not title or len(title) < 5:
                    continue
                # Only follow links that look like job postings
                if not any(kw in href.lower() for kw in ["/job/", "/jobs/", "/vacancy/", "/career/"]):
                    continue
                if not fuzzy_match(role, title):
                    continue
                job_url = href if href.startswith("http") else urljoin("https://technation.io", href)
                if job_url in seen:
                    continue
                seen.add(job_url)
                desc, salary_text = self.fetch_detail(job_url)
                results.append(self.make_job(
                    title=title, url=job_url,
                    description=desc, salary_text=salary_text or "",
                ))

            if results:
                return results[:8]

        return []
