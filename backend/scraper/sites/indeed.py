"""
Indeed scraper.
Indeed aggressively blocks bots. Strategy:
1. Warm up session by visiting homepage first
2. Use their public RSS/JSON search API as fallback
3. Try multiple search URL formats
"""

import random
import time
from urllib.parse import quote_plus, urlparse
from scraper.base import BaseScraper, fuzzy_match
import logging

log = logging.getLogger(__name__)


class IndeedScraper(BaseScraper):
    name = "indeed"
    domains = ["indeed.co.uk", "www.indeed.co.uk", "uk.indeed.com", "indeed.com", "www.indeed.com"]

    def search(self, role: str) -> list[dict]:
        domain = urlparse(self.base_url).netloc or "uk.indeed.com"
        base = f"https://{domain}"

        # Warm up: visit homepage first to get cookies
        self.warmup(base)
        time.sleep(random.uniform(1.0, 2.0))

        # Try multiple URL patterns
        search_urls = [
            f"{base}/jobs?q={quote_plus(role)}&l=United+Kingdom&sort=date",
            f"{base}/jobs?q={quote_plus(role)}&l=London%2C+England&sort=date",
            f"{base}/jobs?as_and={quote_plus(role)}&l=United+Kingdom",
        ]

        for search_url in search_urls:
            results = self._try_search(search_url, role)
            if results:
                return results
            time.sleep(random.uniform(1.5, 3.0))

        # Fallback: try indeed's job widget API (public, less blocked)
        return self._try_api(role)

    def _try_search(self, search_url: str, role: str) -> list[dict]:
        soup = self.get(search_url, extra_headers={"Referer": "https://uk.indeed.com/"})
        if not soup:
            return []

        results = []
        # Indeed uses multiple different card structures
        cards = (
            soup.select("[class*='job_seen_beacon']") or
            soup.select("[data-jk]") or
            soup.select(".slider_container .slider_item") or
            soup.select("[class*='jobsearch-SerpJobCard']")
        )

        for card in cards[:8]:
            title_el = (
                card.select_one("[class*='jobTitle'] a span") or
                card.select_one("h2.jobTitle a span") or
                card.select_one("[class*='title'] a") or
                card.select_one("h2 a span")
            )
            link_el = (
                card.select_one("[class*='jobTitle'] a") or
                card.select_one("h2 a") or
                card.select_one("a[href*='/rc/clk'], a[href*='/pagead/clk']")
            )
            company_el = (
                card.select_one("[class*='companyName']") or
                card.select_one("[data-testid='company-name']") or
                card.select_one("[class*='company']")
            )
            location_el = (
                card.select_one("[class*='companyLocation']") or
                card.select_one("[data-testid='text-location']")
            )

            if not title_el:
                continue
            title = title_el.get_text(strip=True)
            if not title or not fuzzy_match(role, title):
                continue

            href = link_el.get("href", "") if link_el else ""
            job_url = href if href.startswith("http") else f"https://uk.indeed.com{href}"

            # Extract salary from card text before hitting detail page
            card_text = card.get_text(separator=" ", strip=True)
            desc, salary_text = self.fetch_detail(job_url)

            results.append(self.make_job(
                title=title,
                url=job_url,
                company=company_el.get_text(strip=True) if company_el else None,
                location=location_el.get_text(strip=True) if location_el else None,
                description=desc,
                salary_text=salary_text or card_text,
            ))

        return results

    def _try_api(self, role: str) -> list[dict]:
        """
        Indeed has a publisher API and some public JSON endpoints.
        This uses the public job search widget endpoint which is less rate-limited.
        """
        api_url = (
            f"https://uk.indeed.com/jobs?q={quote_plus(role)}"
            f"&l=United+Kingdom&format=json"
        )
        data = self.get_json(api_url)
        if not data or "results" not in data:
            return []

        results = []
        for item in data.get("results", [])[:8]:
            title = item.get("jobtitle", "")
            if not fuzzy_match(role, title):
                continue
            job_url = item.get("url", "")
            results.append(self.make_job(
                title=title,
                url=job_url,
                company=item.get("company"),
                location=item.get("formattedLocation"),
                description=item.get("snippet"),
                salary_text=item.get("snippet", ""),
            ))
        return results
