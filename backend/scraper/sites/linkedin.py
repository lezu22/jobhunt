"""LinkedIn job scraper."""

from urllib.parse import quote_plus
from scraper.base import BaseScraper, fuzzy_match
import logging

log = logging.getLogger(__name__)


class LinkedInScraper(BaseScraper):
    name = "linkedin"
    domains = ["linkedin.com", "www.linkedin.com"]

    def search(self, role: str) -> list[dict]:
        results = []
        url = f"https://www.linkedin.com/jobs/search/?keywords={quote_plus(role)}&location=United+Kingdom&f_WT=2"
        soup = self.get(url)
        if not soup:
            return results

        cards = soup.select(".base-card, .job-search-card")
        for card in cards[:8]:
            title_el = card.select_one(".base-search-card__title, h3")
            link_el = card.select_one("a[href*='/jobs/view/']")
            company_el = card.select_one(".base-search-card__subtitle, h4")
            location_el = card.select_one(".job-search-card__location")

            if not title_el or not link_el:
                continue
            title = title_el.get_text(strip=True)
            if not fuzzy_match(role, title):
                continue

            job_url = link_el["href"].split("?")[0]
            company = company_el.get_text(strip=True) if company_el else None
            location = location_el.get_text(strip=True) if location_el else None
            desc, salary_text = self.fetch_detail(job_url)

            results.append(self.make_job(
                title=title, url=job_url, company=company,
                description=desc, salary_text=salary_text or card.get_text(),
                location=location,
            ))

        return results
