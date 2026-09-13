"""Deterministic preservation checks against isolated files, never submitted history."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from preserve import fingerprint, inspect, verify


class PreservationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="g4-preserve-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "test.js"
        self.source.write_bytes(b"source")
        self.evidence = self.root / "receipt.json"
        self.evidence.write_bytes(b'{"run":1}')
        self.entries = [inspect(self.root, {"path": "receipt.json", "groups": ["historicalBuild"]}),
                        inspect(self.root, {"path": "test.js", "groups": ["source"]})]
        self.baseline = {"entries": self.entries, "fingerprint": fingerprint(self.entries)}

    def test_exact_bytes_and_missing_history_are_detected(self):
        self.assertTrue(verify(self.root, self.baseline)["preserved"])
        self.evidence.write_bytes(b'{"run":2}')  # Same size is not preservation.
        result = verify(self.root, self.baseline)
        self.assertFalse(result["preserved"])
        self.assertEqual([change["path"] for change in result["unexpectedChanges"]], ["receipt.json"])
        self.assertFalse(result["groups"]["historicalBuild"]["unchanged"])
        self.evidence.unlink()
        self.assertEqual(verify(self.root, self.baseline)["unexpectedChanges"][0]["after"]["kind"], "missing")

    def test_only_named_source_changes_can_be_authorized(self):
        self.source.write_bytes(b"edited")
        self.assertFalse(verify(self.root, self.baseline)["preserved"])
        result = verify(self.root, self.baseline, ["test.js"])
        self.assertTrue(result["preserved"])
        self.assertEqual(len(result["authorizedChanges"]), 1)
        self.assertEqual(result["protectedFingerprint"], result["observedProtectedFingerprint"])
        with self.assertRaises(ValueError):
            verify(self.root, self.baseline, ["receipt.json"])
        self.source.unlink()
        self.assertFalse(verify(self.root, self.baseline, ["test.js"])["preserved"])

    def test_tampered_manifest_fails_before_verification(self):
        modified = copy.deepcopy(self.baseline)
        modified["entries"][0]["sha256"] = "0" * 64
        with self.assertRaises(ValueError):
            verify(self.root, modified)

    def test_symlinks_hash_targets_not_external_content(self):
        link = self.root / "link"
        link.symlink_to("receipt.json")
        before = inspect(self.root, {"path": "link", "groups": ["historicalBuild"]})
        self.evidence.write_bytes(b"new bytes")
        self.assertEqual(before, inspect(self.root, before))
        link.unlink()
        link.symlink_to("test.js")
        self.assertNotEqual(before["sha256"], inspect(self.root, before)["sha256"])

    def test_cli_creates_receipt_once_and_reports_nonzero_on_drift(self):
        baseline = self.root / "baseline.json"
        baseline.write_text(json.dumps(self.baseline))
        receipt = self.root / "verification.json"
        command = [sys.executable, "-B", str(Path(__file__).with_name("preserve.py")),
                   "--root", str(self.root), "--baseline", str(baseline), "--receipt", str(receipt)]
        first = subprocess.run(command, capture_output=True, text=True, timeout=10)
        self.assertEqual(first.returncode, 0, first.stderr)
        original = receipt.read_bytes()
        second = subprocess.run(command, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(second.returncode, 0)
        self.assertEqual(original, receipt.read_bytes())
        self.evidence.write_bytes(b"changed")
        command[-1] = str(self.root / "drift.json")
        drift = subprocess.run(command, capture_output=True, text=True, timeout=10)
        self.assertEqual(drift.returncode, 1, drift.stderr)
        self.assertFalse(json.loads((self.root / "drift.json").read_text())["preserved"])


if __name__ == "__main__":
    unittest.main()
