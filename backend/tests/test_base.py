from scraper.base import fuzzy_match, job_id


class TestFuzzyMatch:
    def test_partial_title_match(self):
        assert fuzzy_match("Robotics Software Engineer", "Senior Robotics Engineer")

    def test_reordered_words_match(self):
        assert fuzzy_match("Python Software Engineer", "Software Engineer (Python)")

    def test_unrelated_title_no_match(self):
        assert not fuzzy_match("ROS2 Engineer", "Data Analyst")

    def test_short_words_ignored(self):
        # "ROS2 Dev" has no words longer than 4 chars except ROS2 itself
        assert not fuzzy_match("a of in", "anything at all")

    def test_case_insensitive(self):
        assert fuzzy_match("robotics engineer", "ROBOTICS ENGINEER")


class TestJobId:
    def test_deterministic(self):
        assert job_id("https://x.com/j/1", "Engineer") == job_id("https://x.com/j/1", "Engineer")

    def test_distinct_inputs_distinct_ids(self):
        assert job_id("https://x.com/j/1", "Engineer") != job_id("https://x.com/j/2", "Engineer")

    def test_length(self):
        assert len(job_id("u", "t")) == 12
