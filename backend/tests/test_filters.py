from scraper.filters import dedupe_jobs, filter_excluded, job_matches_exclusions, listing_keys


def make_job(id, title, company=None, description=None, location=None):
    return {"id": id, "title": title, "company": company,
            "description": description, "location": location}


class TestExclusions:
    KEYWORDS = ["defence", "military", "security clearance"]

    def test_keyword_in_title(self):
        job = make_job("a1", "Software Engineer - Defence Systems")
        assert job_matches_exclusions(job, self.KEYWORDS)

    def test_keyword_in_description(self):
        job = make_job("a2", "Robotics Engineer", description="Requires active security clearance (SC)")
        assert job_matches_exclusions(job, self.KEYWORDS)

    def test_keyword_in_company(self):
        job = make_job("a3", "Backend Engineer", company="UK Military Tech Ltd")
        assert job_matches_exclusions(job, self.KEYWORDS)

    def test_case_insensitive(self):
        job = make_job("a4", "MILITARY Robotics Lead")
        assert job_matches_exclusions(job, ["military"])

    def test_clean_job_not_excluded(self):
        job = make_job("a5", "Python Engineer", company="HealthTech", description="Build APIs")
        assert not job_matches_exclusions(job, self.KEYWORDS)

    def test_no_keywords_keeps_everything(self):
        job = make_job("a6", "Defence Analyst")
        assert not job_matches_exclusions(job, [])

    def test_blank_keywords_ignored(self):
        job = make_job("a7", "Python Engineer")
        assert not job_matches_exclusions(job, ["", "   "])

    def test_filter_excluded_counts(self):
        jobs = [make_job("b1", "Defence Engineer"), make_job("b2", "Web Developer")]
        kept, dropped = filter_excluded(jobs, self.KEYWORDS)
        assert [j["id"] for j in kept] == ["b2"]
        assert dropped == 1


class TestDedupe:
    def test_same_id_first_wins(self):
        jobs = [make_job("x1", "Engineer"), make_job("x1", "Engineer")]
        kept, dropped = dedupe_jobs(jobs, set())
        assert len(kept) == 1 and dropped == 1

    def test_same_listing_across_boards(self):
        # Same title+company+location but different URLs → different ids
        a = make_job("id-linkedin", "ROS2 Engineer", company="Acme Robotics", location="Sheffield")
        b = make_job("id-indeed", "ROS2 Engineer", company="Acme Robotics", location="Sheffield")
        kept, dropped = dedupe_jobs([a, b], set())
        assert [j["id"] for j in kept] == ["id-linkedin"]
        assert dropped == 1

    def test_same_title_no_company_not_deduped(self):
        # Without a company the title-based key is too collision-prone, so
        # two different listings sharing a title must both survive
        a = make_job("y1", "Software Engineer")
        b = make_job("y2", "Software Engineer")
        kept, dropped = dedupe_jobs([a, b], set())
        assert len(kept) == 2 and dropped == 0

    def test_same_company_different_location_kept(self):
        a = make_job("z1", "Engineer", company="Acme", location="London")
        b = make_job("z2", "Engineer", company="Acme", location="Manchester")
        kept, _ = dedupe_jobs([a, b], set())
        assert len(kept) == 2

    def test_seen_set_skips_tracked(self):
        job = make_job("tracked-1", "Engineer")
        kept, dropped = dedupe_jobs([job], {"tracked-1"})
        assert kept == [] and dropped == 1

    def test_listing_keys_requires_company_for_alt_key(self):
        assert listing_keys(make_job("k1", "Engineer")) == {"k1"}
        assert len(listing_keys(make_job("k2", "Engineer", company="Acme"))) == 2
