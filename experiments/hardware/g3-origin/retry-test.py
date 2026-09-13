"""Run02 receipt tests. No compiler or timing-sensitive behavior."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SPEC = importlib.util.spec_from_file_location("retry_verify",HERE/"retry-verify.py")
assert SPEC is not None and SPEC.loader is not None
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)


class RetryReceiptTests(unittest.TestCase):
    def setUp(self):
        scratch = ROOT/".build/hardware/g3-origin/retry-tests"
        scratch.mkdir(parents=True,exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)/"evidence"
        shutil.copytree(ROOT/"docs/hardware/evidence/g3-origin-retry",self.root)

    def mutate(self,name,fn):
        p = self.root/name
        value = json.loads(p.read_text())
        fn(value)
        p.write_text(json.dumps(value)+"\n")
        inv = self.root/"INVENTORY.json"
        value = json.loads(inv.read_text())
        for row in value["files"]:
            if row["path"] == name:
                row.update(bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest())
        inv.write_text(json.dumps(value)+"\n")

    def test_actual_receipt(self):
        value = VERIFY.audit(self.root)
        self.assertEqual(value["cgroupPeakBytes"],5368709120)
        self.assertEqual(value["baselineExit"],2)
        self.assertEqual(value["originClaims"],0)
        self.assertFalse(value["liveReplay"])

    def test_changed_log(self):
        with (self.root/"receipts/baseline-build-compatibility.log").open("ab") as f:f.write(b"changed")
        with self.assertRaisesRegex(ValueError,"inventory hash mismatch"):VERIFY.audit(self.root)

    def test_hash_valid_false_origin(self):
        self.mutate("RESULT.json",lambda d:d.update(originClaims=[{"status":"exact"}]))
        with self.assertRaisesRegex(ValueError,"false origin claim"):VERIFY.audit(self.root)

    def test_hash_valid_wrong_strategy(self):
        self.mutate("RESULT.json",lambda d:d["strategy"].update(GHCJOBS=2))
        with self.assertRaisesRegex(ValueError,"build strategy mismatch"):VERIFY.audit(self.root)

    def test_hash_valid_invented_memory_measurement(self):
        self.mutate("RESULT.json",lambda d:d["baselineBuild"].update(cgroupMemoryPeakBytes=1))
        with self.assertRaisesRegex(ValueError,"cgroup measurement contradiction"):VERIFY.audit(self.root)

    def test_hash_valid_checkpoint_swap(self):
        self.mutate("RESULT.json",lambda d:d["checkpoint"].update(sha256="0"*64))
        with self.assertRaisesRegex(ValueError,"amended checkpoint mismatch"):VERIFY.audit(self.root)


if __name__ == "__main__":unittest.main()
