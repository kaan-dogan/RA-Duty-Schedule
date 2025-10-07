import sys
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT / "calendar"))

from csv_to_ics import build_ics, load_events, person_matches  # noqa: E402


CSV_SAMPLE = """Title,Start,End,Duty Type,Assigned To,Duty Complete
Hot Chocolate,20/10/2025 19:00,20/10/2025 20:00,"[""Event""]","Alice Gleadle;Sangwon Kang;Keira Rafferty",False
Team Duty,01/10/2025 18:00,01/10/2025 22:00,"[""6pm-10pm""]",Andrew,False
"RA On Call: Alice, Sangwon, Keira",21/10/2025 18:00,21/10/2025 22:00,"[""6pm-10pm""]",,False
Andrew Leave,02/10/2025 00:00,05/10/2025 00:00,,Andrew - On Leave - Approved,False
"Spooky, Game Night",10/10/2025 19:00,10/10/2025 21:00,"[""Event""]","Ellen Mphande;Andrew",True
"""


def write_csv(contents: str) -> Path:
    with tempfile.NamedTemporaryFile("w", delete=False, suffix=".csv", encoding="utf-8") as handle:
        handle.write(contents)
        return Path(handle.name)


class CsvToIcsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.csv_path = write_csv(CSV_SAMPLE)
        self.events = load_events(self.csv_path)
        self.events_by_summary = {event.summary: event for event in self.events}

    def tearDown(self) -> None:
        self.csv_path.unlink(missing_ok=True)

    def test_people_are_canonicalised(self):
        duty_people = tuple(self.events_by_summary["RA On Call: Alice, Sangwon, Keira"].people)
        leave_people = tuple(self.events_by_summary["Andrew Leave"].people)
        self.assertEqual(duty_people, ("Alice Gleadle", "Sangwon Kang", "Keira Rafferty"))
        self.assertEqual(leave_people, ("Andrew",))

    def test_person_filter_matches_canonical_name(self):
        andrew_events = [event for event in self.events if person_matches(event, "Andrew")]
        summaries = {event.summary for event in andrew_events}
        self.assertEqual(summaries, {"Team Duty", "Andrew Leave", "Spooky, Game Night"})

    def test_ics_contains_expected_fields(self):
        ics = build_ics(self.events)
        self.assertIn("SUMMARY:Andrew Leave", ics)
        self.assertIn("SUMMARY:RA On Call: Alice\\, Sangwon\\, Keira", ics)
        self.assertIn("Assigned To: Andrew - On Leave - Approved", ics)
        self.assertIn("SUMMARY:Spooky\\, Game Night", ics)

    def test_title_fallback_extracts_people(self):
        event = self.events_by_summary["RA On Call: Alice, Sangwon, Keira"]
        self.assertEqual(tuple(event.people), ("Alice Gleadle", "Sangwon Kang", "Keira Rafferty"))

    def test_person_filter_case_insensitive(self):
        mixed_case = [event for event in self.events if person_matches(event, "aNdReW")]
        self.assertEqual({ev.summary for ev in mixed_case}, {"Team Duty", "Andrew Leave", "Spooky, Game Night"})

    def test_total_events_parsed(self):
        self.assertEqual(len(self.events), 5)


if __name__ == "__main__":
    unittest.main()
