"""
base.py — Abstract base class for all site scrapers.
Includes polite rate-limiting (randomised request delays, Retry-After
handling), retry with backoff, and browser-like request headers.
"""

import hashlib
import logging
import random
import time
from abc import ABC, abstractmethod
from typing import Optional
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from scraper.salary import extract_salary

log = logging.getLogger(__name__)

# Realistic rotating user agents
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
    "Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0",
]

BASE_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9,en-US;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "DNT": "1",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
}

REQUEST_DELAY_MIN = 1.5
REQUEST_DELAY_MAX = 3.0
MAX_RETRIES = 2


def _random_delay(extra: float = 0):
    time.sleep(random.uniform(REQUEST_DELAY_MIN, REQUEST_DELAY_MAX) + extra)


def job_id(url: str, title: str) -> str:
    return hashlib.md5(f"{url}|{title}".encode()).hexdigest()[:12]


def fuzzy_match(role: str, text: str, threshold: float = 0.45) -> bool:
    """Return True if enough key words in role appear in text."""
    role_words = [w.lower() for w in role.split() if len(w) > 3]
    if not role_words:
        return False
    text_lower = text.lower()
    hits = sum(1 for w in role_words if w in text_lower)
    return hits >= max(1, len(role_words) * threshold)


class BaseScraper(ABC):
    name: str = "base"
    domains: list[str] = []

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self._rotate_ua()

    def _rotate_ua(self):
        headers = {**BASE_HEADERS, "User-Agent": random.choice(USER_AGENTS)}
        self.session.headers.update(headers)

    def get(self, url: str, timeout: int = 20, retries: int = MAX_RETRIES,
            extra_headers: dict = None) -> Optional[BeautifulSoup]:
        if extra_headers:
            self.session.headers.update(extra_headers)

        for attempt in range(retries + 1):
            try:
                if attempt > 0:
                    self._rotate_ua()
                    time.sleep(random.uniform(3.0, 6.0))

                resp = self.session.get(url, timeout=timeout, allow_redirects=True)

                if resp.status_code == 429:
                    wait = int(resp.headers.get("Retry-After", 15))
                    log.warning(f"[{self.name}] Rate limited, waiting {wait}s...")
                    time.sleep(wait + random.uniform(2, 5))
                    continue

                resp.raise_for_status()
                _random_delay()
                return BeautifulSoup(resp.text, "html.parser")

            except requests.exceptions.HTTPError as e:
                code = e.response.status_code if e.response else 0
                if code in (403, 429) and attempt < retries:
                    log.warning(f"[{self.name}] {code} on attempt {attempt+1}, retrying...")
                    continue
                log.warning(f"[{self.name}] GET failed {url}: {e}")
                return None
            except Exception as e:
                log.warning(f"[{self.name}] GET failed {url}: {e}")
                return None
        return None

    def get_json(self, url: str, timeout: int = 15, extra_headers: dict = None) -> Optional[dict]:
        try:
            headers = {**BASE_HEADERS, "User-Agent": random.choice(USER_AGENTS),
                       "Accept": "application/json, text/plain, */*",
                       "X-Requested-With": "XMLHttpRequest"}
            if extra_headers:
                headers.update(extra_headers)
            resp = self.session.get(url, headers=headers, timeout=timeout)
            resp.raise_for_status()
            _random_delay()
            return resp.json()
        except Exception as e:
            log.warning(f"[{self.name}] JSON GET failed {url}: {e}")
            return None

    def warmup(self, home_url: str):
        """Visit homepage to get cookies before scraping — reduces 403s."""
        try:
            self._rotate_ua()
            self.session.get(home_url, timeout=15, allow_redirects=True)
            _random_delay()
        except Exception:
            pass

    def fetch_detail(self, url: str) -> tuple[Optional[str], Optional[str]]:
        soup = self.get(url)
        if not soup:
            return None, None
        desc = None
        for sel in [
            "[class*='description']", "[class*='job-desc']", "[class*='jobDesc']",
            "[class*='job_description']", "[class*='Details']",
            "[itemprop='description']", "article", "main", "[class*='content']",
        ]:
            el = soup.select_one(sel)
            if el and len(el.get_text(strip=True)) > 120:
                desc = el.get_text(separator=" ", strip=True)[:2500]
                break
        full_text = soup.get_text(separator=" ", strip=True)[:5000]
        return desc, full_text

    def make_job(self, title: str, url: str, company: str = None,
                 description: str = None, salary_text: str = "",
                 location: str = None) -> dict:
        salary = extract_salary(salary_text or "")
        return {
            "id": job_id(url, title),
            "title": title[:200],
            "company": company,
            "location": location,
            "url": url,
            "source": self.name,
            "salary": salary,
            "description": description,
        }

    @abstractmethod
    def search(self, role: str) -> list[dict]:
        ...
