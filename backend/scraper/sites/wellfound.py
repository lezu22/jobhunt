"""
Wellfound (formerly AngelList) scraper.
Wellfound blocks direct requests. Strategy:
1. Warmup session
2. Try their public job search page
3. Try their jobs API endpoint (JSON)
4. Scan job listing links from main page
"""

import json
import random
import time
from urllib.parse import quote_plus, urljoin
from scraper.base import BaseScraper, fuzzy_match
import logging

log = logging.getLogger(__name__)


class WellfoundScraper(BaseScraper):
    name = "wellfound"
    domains = ["wellfound.com", "www.wellfound.com"]

    def search(self, role: str) -> list[dict]:
        self.warmup("https://wellfound.com")
        time.sleep(random.uniform(1.5, 2.5))

        # Try JSON API first
        results = self._try_json_api(role)
        if results:
            return results

        # Try HTML scrape
        return self._try_html(role)

    def _try_json_api(self, role: str) -> list[dict]:
        """Wellfound has a public jobs JSON endpoint."""
        api_urls = [
            f"https://wellfound.com/jobs/search?query={quote_plus(role)}&remote=true",
            f"https://wellfound.com/jobs?q={quote_plus(role)}",
        ]
        for url in api_urls:
            data = self.get_json(url, extra_headers={
                "Referer": "https://wellfound.com/",
                "X-Requested-With": "XMLHttpRequest",
            })
            if not data:
                continue
            # Wellfound returns various formats
            jobs_raw = (
                data.get("jobs") or
                data.get("data", {}).get("jobs") or
                data.get("results") or
                []
            )
            results = []
            for job in jobs_raw[:8]:
                title = job.get("title") or job.get("name") or ""
                if not fuzzy_match(role, title):
                    continue
                slug = job.get("slug") or job.get("id") or ""
                startup = job.get("startup") or job.get("company") or {}
                company_name = startup.get("name") if isinstance(startup, dict) else str(startup)
                company_slug = startup.get("slug", "") if isinstance(startup, dict) else ""
                job_url = job.get("url") or f"https://wellfound.com/jobs/{slug}"
                location = job.get("location") or job.get("locationStr")
                results.append(self.make_job(
                    title=title, url=job_url, company=company_name,
                    location=location,
                    salary_text=str(job.get("compensation") or job.get("salary") or ""),
                ))
            if results:
                return results
        return []

    def _try_html(self, role: str) -> list[dict]:
        search_url = f"https://wellfound.com/jobs?q={quote_plus(role)}&remote=true"
        soup = self.get(search_url, extra_headers={"Referer": "https://wellfound.com/"})
        if not soup:
            return []

        # Try to find embedded JSON data (Next.js __NEXT_DATA__)
        script = soup.find("script", {"id": "__NEXT_DATA__"})
        if script and script.string:
            try:
                data = json.loads(script.string)
                jobs_data = (
                    data.get("props", {}).get("pageProps", {}).get("jobs") or
                    data.get("props", {}).get("initialState", {}).get("jobs", {}).get("results") or
                    []
                )
                results = []
                for job in jobs_data[:8]:
                    title = job.get("title") or job.get("name") or ""
                    if not fuzzy_match(role, title):
                        continue
                    job_url = job.get("url") or f"https://wellfound.com/jobs/{job.get('slug','')}"
                    startup = job.get("startup") or {}
                    results.append(self.make_job(
                        title=title, url=job_url,
                        company=startup.get("name") if isinstance(startup, dict) else None,
                        salary_text=str(job.get("compensation") or ""),
                    ))
                if results:
                    return results
            except Exception:
                pass

        # HTML fallback — scan all job links
        results = []
        seen = set()
        for a in soup.select("a[href*='/jobs/']")[:15]:
            title = a.get_text(strip=True)
            if not title or len(title) < 4 or not fuzzy_match(role, title):
                continue
            href = a.get("href", "")
            job_url = href if href.startswith("http") else f"https://wellfound.com{href}"
            if job_url in seen:
                continue
            seen.add(job_url)
            parent = a.find_parent(["div", "li", "article"])
            company_el = parent.select_one("[class*='company'], [class*='startup']") if parent else None
            results.append(self.make_job(
                title=title, url=job_url,
                company=company_el.get_text(strip=True) if company_el else None,
            ))
        return results
