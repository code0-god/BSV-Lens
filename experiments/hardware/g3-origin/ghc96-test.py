"""Actual captured G3 transport oracles and fail-closed negative inputs."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
EVIDENCE=ROOT/"docs/hardware/evidence/g3-origin-ghc96"


def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/(name+".py"))
    assert spec is not None and spec.loader is not None
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


ORIGIN=load("ghc96-origin")
COMPARE=load("ghc96-compare")


class ActualOriginTests(unittest.TestCase):
    def setUp(self):
        scratch=ROOT/".build/hardware/g3-origin/run-st_01a07a97-03/test-work"
        scratch.mkdir(parents=True,exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(dir=scratch);self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        for name in ["inputs","results"]:shutil.copytree(EVIDENCE/name,self.root/name)
        (self.root/"receipts").mkdir()
        for name in ["instrumented-compile-final.json","instrumented-compile-final.log"]:
            shutil.copy2(EVIDENCE/"receipts"/name,self.root/"receipts"/name)
        self.sidecar=json.loads((self.root/"results/origin-sidecar.json").read_text())

    def model(self,label):
        path=self.root/"results/instrumented"/label/"design.json"
        return path,json.loads(path.read_text())

    def save(self,path,data):path.write_text(json.dumps(data)+"\n")

    def test_actual_storage_rhs_and_occurrences(self):
        data=ORIGIN.validate_sidecar(self.root,self.sidecar)
        self.assertEqual(data["coverage"]["verifiedKnownContributorLeafDefinitions"],6)
        self.assertEqual(len(data["coverage"]["leafPopulation"]),53)
        self.assertEqual(data["coverage"]["completeOriginSetLeafDefinitions"],0)
        left_right=[x for x in data["links"] if x["target"]["module"]=="mkStage" and x["target"]["kind"]=="leaf-cell"]
        self.assertEqual(len(left_right),2)
        self.assertEqual({next(s["slice"] for s in data["sourceOrigins"] if s["token"]==x["origin"]) for x in left_right},{"value + 1","state <- mkReg(0)"})
        for link in left_right:
            self.assertEqual(link["status"],"verified-known-contributor")
            self.assertEqual(link["implementationOccurrences"],[["mkConnected","left"],["mkConnected","right"]])
            root=next(r for r in data["compilerRoots"] if r["id"]==link["compilerRootId"])
            self.assertEqual(len(root["trace"]),34)
            self.assertFalse(root["gaps"])
        widths={}
        for link in data["links"]:
            if link["target"]["module"] in ("mkNarrow","mkWide") and "Q" in link["orderedConnections"]:
                widths[link["target"]["module"]]=len(link["orderedConnections"]["Q"])
        self.assertEqual(widths,{"mkNarrow":8,"mkWide":12})
        self.assertTrue(any(x["status"]=="partial-observed-token-transport" for x in data["links"]))

    def test_full_noninterference(self):
        result=COMPARE.compare(self.root)
        self.assertTrue(result["verified"])
        self.assertFalse(result["originCorrectnessEstablished"])
        self.assertEqual(len(result["rows"]),3)
        self.assertTrue(all(r["noemitEntireJsonEqual"] and r["expandedProcEntireJsonEqual"] for r in result["rows"]))

    def test_hash_seed_does_not_change_origin_reduction(self):
        for seed in ("0", "1", "2", "3"):
            result = subprocess.run(
                [sys.executable, "-B", str(HERE/"ghc96-origin.py"), "--run", str(self.root),
                 "--verify", str(self.root/"results/origin-sidecar.json")],
                env={**os.environ, "PYTHONHASHSEED": seed}, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, f"PYTHONHASHSEED={seed}: {result.stderr}")

    def test_swapped_operator_bits_reject(self):
        path,model=self.model("A")
        cell=next(c for c in model["modules"]["mkStage"]["cells"].values() if c["type"]=="$add")
        cell["connections"]["A"]=list(reversed(cell["connections"]["A"]))
        self.save(path,model)
        with self.assertRaisesRegex(ValueError,"ordered operator inputs"):ORIGIN.build(self.root)

    def test_valid_token_copied_to_unrelated_cell_rejects(self):
        path,model=self.model("A");cells=model["modules"]["mkStage"]["cells"]
        source=next(c for c in cells.values() if c["type"]=="$add")
        target=next(c for c in cells.values() if c["type"]=="$eq")
        for key in ("g3_emit_id","g3_origin_ref"):target["attributes"][key]=source["attributes"][key]
        self.save(path,model)
        # Any accepted result is wrong; rejection may occur at target identity
        # before the later operator-kind check.
        with self.assertRaises(ValueError):ORIGIN.build(self.root)

    def test_forged_unminted_token_rejects(self):
        path,model=self.model("A")
        cell=next(c for c in model["modules"]["mkStage"]["cells"].values() if c["type"]=="$add")
        cell["attributes"].update(g3_emit_id="operator:forged",g3_origin_ref="forged")
        self.save(path,model)
        with self.assertRaisesRegex(ValueError,"no unique compiler-emitted object"):ORIGIN.build(self.root)

    def test_source_revision_change_rejects(self):
        p=self.root/"inputs/fixtures/Connected.bsv"
        p.write_text(p.read_text()+" ")
        with self.assertRaisesRegex(ValueError,"source capture mismatch"):ORIGIN.build(self.root)

    def test_invented_complete_set_rejects(self):
        value=copy.deepcopy(self.sidecar);value["links"][0]["completeOriginSet"]=True
        with self.assertRaisesRegex(ValueError,"contradicts"):ORIGIN.validate_sidecar(self.root,value)

    def test_wrong_occurrence_rejects(self):
        value=copy.deepcopy(self.sidecar)
        value["links"][0]["implementationOccurrences"]=[["mkConnected","nonexistent"]]
        with self.assertRaisesRegex(ValueError,"contradicts"):ORIGIN.validate_sidecar(self.root,value)

    def test_partial_derivation_cannot_self_promote(self):
        value=copy.deepcopy(self.sidecar)
        link=next(x for x in value["links"] if x["status"]=="partial-observed-token-transport")
        link["status"]="verified-known-contributor";link["gaps"]=[]
        with self.assertRaisesRegex(ValueError,"contradicts"):ORIGIN.validate_sidecar(self.root,value)

    def test_multi_update_process_rejects(self):
        p=self.root/"results/instrumented/A/captures/08-proc_dlatch.il"
        text=p.read_text();needle=next(line for line in text.splitlines() if line.startswith("      update "))
        p.write_text(text.replace(needle,needle+"\n"+needle))
        with self.assertRaisesRegex(ValueError,"not a single-vector"):ORIGIN.build(self.root)

    def test_concrete_parameter_swap_rejects(self):
        path,model=self.model("C")
        child=model["modules"][model["modules"]["mkReuse"]["cells"]["low"]["type"]]
        child["parameter_default_values"]["bias"]="00001001"
        self.save(path,model)
        with self.assertRaises(ValueError):ORIGIN.build(self.root)

    def test_noninterference_preserves_clock_semantics(self):
        _,before=self.model("A");after=copy.deepcopy(before)
        cell=next(c for c in after["modules"]["mkStage"]["cells"].values() if c["type"]=="$dff")
        cell["parameters"]["CLK_POLARITY"]="0"
        with self.assertRaisesRegex(ValueError,"functional hardware projection differs"):
            COMPARE.object_bijection(before,after)


if __name__=="__main__":unittest.main()
