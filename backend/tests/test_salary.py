from scraper.salary import extract_salary, salary_in_band


class TestExtractSalary:
    def test_range_with_commas(self):
        s = extract_salary("Salary: £60,000 - £80,000 per annum")
        assert s["min"] == 60000
        assert s["max"] == 80000
        assert s["raw"]

    def test_range_with_k_suffix(self):
        s = extract_salary("£45k - £55k depending on experience")
        assert s["min"] == 45000
        assert s["max"] == 55000

    def test_up_to(self):
        s = extract_salary("Up to £90,000")
        assert s["min"] == 90000
        assert s["max"] == 90000

    def test_from(self):
        s = extract_salary("From £50k")
        assert s["min"] == 50000
        assert s["max"] == 50000

    def test_single_value_per_annum(self):
        s = extract_salary("£75,000 per annum plus benefits")
        assert s["min"] == 75000
        assert s["max"] == 75000

    def test_no_salary(self):
        s = extract_salary("Competitive salary and great benefits")
        assert s == {"min": None, "max": None, "raw": None}

    def test_empty_string(self):
        s = extract_salary("")
        assert s == {"min": None, "max": None, "raw": None}


class TestSalaryInBand:
    def test_no_filter_includes_everything(self):
        assert salary_in_band({"min": 30000, "max": 40000, "raw": "x"}, None, None)

    def test_unlisted_salary_always_included(self):
        assert salary_in_band({"min": None, "max": None, "raw": None}, 50000, 90000)

    def test_overlapping_band_included(self):
        assert salary_in_band({"min": 45000, "max": 60000, "raw": "x"}, 50000, 90000)

    def test_below_band_excluded(self):
        assert not salary_in_band({"min": 20000, "max": 30000, "raw": "x"}, 50000, None)

    def test_above_band_excluded(self):
        assert not salary_in_band({"min": 120000, "max": 150000, "raw": "x"}, None, 90000)
