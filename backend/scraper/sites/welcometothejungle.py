"""
Welcome to the Jungle (UK) scraper.
Issues: 404 on query with refinementList[] params (URL encoding issue), general bot blocking.
Strategy: use their API endpoint and correct URL format.
"""

import json
import random
import time
from urllib.parse import quote, quote_plus, urljoin
from scraper.base import BaseScraper, fuzzy_match
import logging

log = logging.getLogger(__name__)


class WelcomeToTheJungleScraper(BaseScraper):
    name = "welcometothejungle"
    domains = ["welcometothejungle.com", "uk.welcometothejungle.com", "www.welcometothejungle.com"]

    def search(self, role: str) -> list[dict]:
        self.warmup("https://uk.welcometothejungle.com")
        time.sleep(random.uniform(1.0, 2.0))

        results = self._try_api(role)
        if not results:
            results = self._try_html(role)
        return results

    def _try_api(self, role: str) -> list[dict]:
        """WTTJ has a public Algolia-backed search API."""
        # Their search uses Algolia — try the public API
        api_url = (
            f"https://api.welcometothejungle.com/api/v1/jobs"
            f"?query={quote_plus(role)}&country_code=GB&page=1&per_page=10"
        )
        data = self.get_json(api_url, extra_headers={
            "Referer": "https://uk.welcometothejungle.com/",
            "Origin": "https://uk.welcometothejungle.com",
        })
        if data:
            return self._parse_api_response(data, role)

        # Try alternate API format
        api_url2 = (
            f"https://uk.welcometothejungle.com/api/v1/jobs"
            f"?query={quote_plus(role)}&page=1"
        )
        data2 = self.get_json(api_url2)
        if data2:
            return self._parse_api_response(data2, role)

        return []

    def _parse_api_response(self, data: dict, role: str) -> list[dict]:
        results = []
        jobs = (
            data.get("jobs") or
            data.get("results") or
            data.get("data", {}).get("jobs") or
            []
        )
        for job in jobs[:8]:
            title = job.get("name") or job.get("title") or ""
            if not fuzzy_match(role, title):
                continue
            org = job.get("organization") or {}
            company = org.get("name") if isinstance(org, dict) else None
            slug = job.get("slug") or job.get("id") or ""
            org_slug = org.get("slug", "") if isinstance(org, dict) else ""
            job_url = job.get("url") or f"https://uk.welcometothejungle.com/companies/{org_slug}/jobs/{slug}"
            contract = job.get("contract_type") or ""
            salary = job.get("salary_min") or ""
            salary_max = job.get("salary_max") or ""
            salary_text = f"£{salary} - £{salary_max}" if salary and salary_max else str(salary or "")
            location_data = job.get("office") or job.get("location") or {}
            location = location_data.get("city") if isinstance(location_data, dict) else str(location_data or "")
            results.append(self.make_job(
                title=title, url=job_url, company=company,
                location=location, salary_text=salary_text,
            ))
        return results

    def _try_html(self, role: str) -> list[dict]:
        # Use correct URL format WITHOUT array bracket notation
        search_url = f"https://uk.welcometothejungle.com/jobs?query={quote_plus(role)}&refinementList%5Bcontract_type_names.en%5D%5B%5D=Full-Time"
        soup = self.get(search_url, extra_headers={"Referer": "https://uk.welcometothejungle.com/"})
        if not soup:
            # Try simpler URL
            simple_url = f"https://uk.welcometothejungle.com/jobs?query={quote_plus(role)}"
            soup = self.get(simple_url)
        if not soup:
            return []

        # Check for Next.js data
        script = soup.find("script", {"id": "__NEXT_DATA__"})
        if script and script.string:
            try:
                data = json.loads(script.string)
                jobs_data = (
                    data.get("props", {}).get("pageProps", {}).get("jobs") or
                    data.get("props", {}).get("dehydratedState", {}).get("queries", [{}])[0].get("state", {}).get("data", {}).get("jobs") or
                    []
                )
                results = []
                for job in (jobs_data or [])[:8]:
                    title = job.get("name") or job.get("title") or ""
                    if not fuzzy_match(role, title):
                        continue
                    org = job.get("organization") or {}
                    slug = job.get("slug", "")
                    org_slug = org.get("slug", "") if isinstance(org, dict) else ""
                    job_url = f"https://uk.welcometothejungle.com/companies/{org_slug}/jobs/{slug}"
                    results.append(self.make_job(
                        title=title, url=job_url,
                        company=org.get("name") if isinstance(org, dict) else None,
                    ))
                if results:
                    return results
            except Exception:
                pass

        # HTML link scan
        results = []
        seen = set()
        for a in soup.select("a[href*='/jobs/']")[:15]:
            title = a.get_text(strip=True)
            if not title or len(title) < 4 or not fuzzy_match(role, title):
                continue
            href = a.get("href", "")
            job_url = href if href.startswith("http") else f"https://uk.welcometothejungle.com{href}"
            if job_url in seen:
                continue
            seen.add(job_url)
            results.append(self.make_job(title=title, url=job_url))
        return results
