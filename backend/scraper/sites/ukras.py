"""UK Robotics and Autonomous Systems (UK-RAS) job board scraper."""

from urllib.parse import quote_plus, urljoin
from scraper.base import BaseScraper, fuzzy_match
import logging

log = logging.getLogger(__name__)


class UKRASScraper(BaseScraper):
    name = "uk-ras"
    domains = ["uk-ras.org.uk", "www.uk-ras.org.uk"]

    def search(self, role: str) -> list[dict]:
        results = []
        base = "https://uk-ras.org.uk"
        pages = [
            f"{base}/jobs",
            f"{base}/jobs/?s={quote_plus(role)}",
        ]

        seen = set()
        for page_url in pages:
            soup = self.get(page_url)
            if not soup:
                continue

            for a in soup.select("a[href*='/jobs/'], h2 a, h3 a, .job-title a"):
                title = a.get_text(strip=True)
                if not title or len(title) < 4:
                    continue
                if not fuzzy_match(role, title):
                    continue
                href = a.get("href", "")
                job_url = href if href.startswith("http") else urljoin(base, href)
                if job_url in seen or "/jobs/" not in job_url:
                    continue
                seen.add(job_url)

                desc, salary_text = self.fetch_detail(job_url)

                # Try to get company from detail page
                company = None
                if desc:
                    import re
                    m = re.search(r"(?:Company|Organisation|Employer)[:\s]+([A-Z][^\n]{2,60})", desc)
                    if m:
                        company = m.group(1).strip()

                results.append(self.make_job(
                    title=title, url=job_url, company=company,
                    description=desc, salary_text=salary_text or "",
                ))
                if len(results) >= 8:
                    break

        return results
