"""Independent mutations of machine-consumed blocked receipts; no compiler execution."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
EVIDENCE = ROOT / "docs/hardware/evidence/g3-origin"
SCRATCH = ROOT / ".build/hardware/g3-origin/verification-tests"
SPEC = importlib.util.spec_from_file_location("g3_verify", HERE / "verify.py")
assert SPEC is not None and SPEC.loader is not None
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        SCRATCH.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=SCRATCH)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)/"evidence"
        shutil.copytree(EVIDENCE, self.root)

    def update(self, relative, mutate):
        p = self.root/relative
        data = json.loads(p.read_text())
        mutate(data)
        p.write_text(json.dumps(data)+"\n")
        inv = self.root/"INVENTORY.json"
        data = json.loads(inv.read_text())
        for row in data["files"]:
            if row["path"] == relative:
                row.update(bytes=p.stat().st_size, sha256=hashlib.sha256(p.read_bytes()).hexdigest())
        inv.write_text(json.dumps(data)+"\n")

    def test_complete_actual_receipt(self):
        value = VERIFY.audit(self.root)
        self.assertEqual(value["baselineExit"], 2)
        self.assertTrue(value["oomKilled"])
        self.assertEqual(value["originClaims"], 0)
        self.assertFalse(value["liveCompilerReplay"])

    def test_modified_log_rejects(self):
        with (self.root/"receipts/baseline-build.log").open("ab") as stream:
            stream.write(b"changed")
        with self.assertRaisesRegex(ValueError, "inventory hash mismatch"):
            VERIFY.audit(self.root)

    def test_self_declared_origin_rejects_even_with_valid_hash(self):
        self.update("RESULT.json", lambda d: d.update(originClaims=[{"status":"exact"}]))
        with self.assertRaisesRegex(ValueError, "must not assert an origin"):
            VERIFY.audit(self.root)

    def test_oom_contradiction_rejects_even_with_valid_hash(self):
        self.update("receipts/baseline-build.json", lambda d:
                    d["containerInspect"][0]["State"].update(OOMKilled=False))
        with self.assertRaisesRegex(ValueError, "OOM exit contradiction"):
            VERIFY.audit(self.root)

    def test_false_coverage_rejects_even_with_valid_hash(self):
        self.update("COVERAGE.json", lambda d: d.update(verifiedKnownContributorObjects=1))
        with self.assertRaisesRegex(ValueError, "false numerator"):
            VERIFY.audit(self.root)

    def test_inventory_traversal_rejects(self):
        inv = self.root/"INVENTORY.json"
        data = json.loads(inv.read_text())
        data["files"][0]["path"] = "../escape"
        inv.write_text(json.dumps(data)+"\n")
        with self.assertRaisesRegex(ValueError, "unsafe evidence path"):
            VERIFY.audit(self.root)


if __name__ == "__main__":
    unittest.main()
