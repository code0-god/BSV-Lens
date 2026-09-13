#!/usr/bin/env python3
"""Strict author-workspace preservation plus shipped checks; no live tool replay.

Run: PYTHONDONTWRITEBYTECODE=1 python3 experiments/hardware/bsv-evidence/check_author.py
Requires every original preserved input, including all 14 non-shipped companions.
"""
import unittest

import check
from capture import OUT, ROOT, preserve


class AuthorPreservationChecks(unittest.TestCase):
    def test_all_original_inputs_preserved(self) -> None:
        # Read first: capture.preserve() may create a receipt when none exists.
        # Validation must never establish a new baseline from an incomplete tree.
        preserved = check.load(OUT / "preserved-inputs.json")["files"]
        self.assertEqual(len(preserved), 128)
        missing = [item["path"] for item in preserved if not (ROOT / item["path"]).is_file()]
        self.assertFalse(missing, "Missing required author inputs:\n" + "\n".join(missing))
        preserve()


if __name__ == "__main__":
    suite = unittest.TestSuite([
        unittest.defaultTestLoader.loadTestsFromTestCase(check.EvidenceChecks),
        unittest.defaultTestLoader.loadTestsFromTestCase(AuthorPreservationChecks),
    ])
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
