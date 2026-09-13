#!/usr/bin/env python3
"""Read installed tools and preserved .ba files; never compile or change G1."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "docs/hardware/evidence/bsv"
OLD = ROOT / "docs/hardware/evidence/toolchain"


def fingerprint(path):
    return {"path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bytes": path.stat().st_size}


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def preserve():
    receipt = OUT / "preserved-inputs.json"
    if receipt.exists():
        for item in json.loads(receipt.read_text())["files"]:
            assert fingerprint(ROOT / item["path"]) == item, item["path"]
        return
    paths = set(p for p in OLD.rglob("*") if p.is_file())
    paths.update((ROOT / "experiments/hardware/fixtures").glob("*.bsv"))
    paths.update(p for p in (ROOT / "experiments/hardware/toolchain").iterdir() if p.is_file())
    paths.update((ROOT / "experiments/hardware").glob("importer*"))
    paths.update(p for p in (ROOT / ".build/hardware/toolchain").rglob("*") if p.suffix in (".ba", ".bo"))
    paths.add(ROOT / "dist/bsv-lens-hardware-g1-review.zip")
    save(receipt, {"scope": "All original G1 evidence, manifest, fixture/toolchain/importer files, compiled ba/bo, review zip", "files": [fingerprint(p) for p in sorted(paths)]})


def run(argv, target, stdin=None):
    result = subprocess.run(argv, input=stdin, cwd=ROOT, text=True, capture_output=True, timeout=60)
    save(target, {"argv": argv, "stdin": stdin, "exitCode": result.returncode,
                  "stdout": result.stdout, "stderr": result.stderr})
    assert result.returncode == 0, str(target)
    return result.stdout


def main():
    preserve()
    run(["/opt/homebrew/bin/bsc", "-help"], OUT / "bsc-help.json")
    run(["/opt/homebrew/bin/bsc", "-v"], OUT / "bsc-version.json")
    help_script = 'puts [Bluetcl::help]\nforeach c {help version type browsetype browsepackage browsemodule module submodule browseinst bpackage defs rule schedule} {puts [Bluetcl::help $c]}\nputs [Bluetcl::version]\nexit\n'
    run(["/opt/homebrew/bin/bluetcl"], OUT / "bluetcl-help.json", help_script)
    for label, package, top in [("A", "Connected", "mkConnected"), ("B", "Control", "mkControl"), ("C", "Reuse", "mkReuse")]:
        target = OUT / label
        target.mkdir(exist_ok=True)
        run(["/opt/homebrew/bin/bluetcl", "experiments/hardware/bsv-evidence/query.tcl",
             f".build/hardware/toolchain/{label}/bdir", package, top,
             str((target / "bluetcl.json").relative_to(ROOT))], target / "query-command.json")
        assert json.loads((target / "bluetcl.json").read_text()) == json.loads((OLD / label / "bluetcl.json").read_text()), label
    preserve()
    print("Installed BSC/Bluetcl 2026.01 queried; A/B/C metadata replays match preserved G1 exactly; preserved inputs unchanged.")


if __name__ == "__main__":
    main()
