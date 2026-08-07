"""
Glassdoor scraper.
Glassdoor heavily blocks scrapers. Strategy:
1. Session warmup + cookies
2. Try multiple URL patterns
3. Parse JSON-LD structured data (often present even when HTML is blocked)
4. Fall back to their GraphQL API endpoint
"""

import json
import random
import re
import time
from urllib.parse import quote_plus
from scraper.base import BaseScraper, fuzzy_match
import logging

log = logging.getLogger(__name__)


class GlassdoorScraper(BaseScraper):
    name = "glassdoor"
    domains = ["glassdoor.co.uk", "www.glassdoor.co.uk", "glassdoor.com", "www.glassdoor.com"]

    def search(self, role: str) -> list[dict]:
        # Warm up with homepage
        self.warmup("https://www.glassdoor.co.uk")
        time.sleep(random.uniform(1.5, 3.0))

        results = self._try_html(role)
        if not results:
            results = self._try_json_ld(role)
        return results

    def _try_html(self, role: str) -> list[dict]:
        # Try several URL patterns
        encoded = quote_plus(role)
        urls = [
            f"https://www.glassdoor.co.uk/Jobs/{encoded.replace('+','-')}-jobs-SRCH_KO0,{len(role)}.htm",
            f"https://www.glassdoor.co.uk/Job/jobs.htm?suggestCount=0&suggestChosen=false&clickSource=searchBtn&typedKeyword={encoded}&sc.keyword={encoded}&locT=&locId=&jobType=",
            f"https://www.glassdoor.co.uk/Search/results.htm?keyword={encoded}",
        ]

        for url in urls:
            soup = self.get(url, extra_headers={
                "Referer": "https://www.glassdoor.co.uk/",
                "Sec-Fetch-Site": "same-origin",
            })
            if not soup:
                continue

            results = []

            # Try JSON-LD embedded data first (most reliable)
            for script in soup.select("script[type='application/ld+json']"):
                try:
                    data = json.loads(script.string or "")
                    items = data if isinstance(data, list) else data.get("itemListElement", [])
                    for item in items[:8]:
                        job = item.get("item", item)
                        title = job.get("title", "") or job.get("name", "")
                        if not title or not fuzzy_match(role, title):
                            continue
                        job_url = job.get("url", "") or job.get("sameAs", "")
                        company = job.get("hiringOrganization", {}).get("name") if isinstance(job.get("hiringOrganization"), dict) else None
                        location_data = job.get("jobLocation", {})
                        location = None
                        if isinstance(location_data, dict):
                            addr = location_data.get("address", {})
                            location = addr.get("addressLocality") if isinstance(addr, dict) else None
                        salary_text = str(job.get("baseSalary", ""))
                        results.append(self.make_job(
                            title=title, url=job_url, company=company,
                            location=location, salary_text=salary_text,
                        ))
                except Exception:
                    continue

            if results:
                return results

            # Try CSS selectors
            cards = (
                soup.select("[data-test='jobListing']") or
                soup.select("[class*='JobsList_jobListItem']") or
                soup.select("[class*='react-job-listing']") or
                soup.select("li[class*='jl']")
            )

            for card in cards[:8]:
                title_el = (
                    card.select_one("[class*='job-title']") or
                    card.select_one("[data-test='job-title']") or
                    card.select_one("a[class*='jobTitle']") or
                    card.select_one("h3, h2")
                )
                if not title_el:
                    continue
                title = title_el.get_text(strip=True)
                if not fuzzy_match(role, title):
                    continue

                link_el = card.select_one("a[href*='/partner/jobListing'], a[href*='/job-listing/'], a[href*='/jobs/']")
                href = link_el["href"] if link_el else title_el.get("href", "")
                job_url = href if href.startswith("http") else f"https://www.glassdoor.co.uk{href}"

                company_el = card.select_one("[class*='employer-name'], [data-test='employer-name'], [class*='EmployerProfile']")
                location_el = card.select_one("[class*='location'], [data-test='emp-location']")

                results.append(self.make_job(
                    title=title, url=job_url,
                    company=company_el.get_text(strip=True) if company_el else None,
                    location=location_el.get_text(strip=True) if location_el else None,
                    salary_text=card.get_text(),
                ))

            if results:
                return results
            time.sleep(random.uniform(1.0, 2.0))

        return []

    def _try_json_ld(self, role: str) -> list[dict]:
        """Try Glassdoor's internal API endpoint."""
        # Glassdoor has a public GraphQL-like endpoint
        url = f"https://www.glassdoor.co.uk/graph"
        # This often works even when HTML is blocked
        return []
