#!/usr/bin/env python3
"""Reproduce the expected missing-.ba failure and separate debug snapshot."""
import difflib
import json
import os
import shutil
import sys

# Keep experiment bytecode out of the shipped source tree.
sys.dont_write_bytecode = True
from run import BUILD, EVIDENCE, ROOT, digest, relative, run, save

bsc, bluetcl = shutil.which("bsc"), shutil.which("bluetcl")
yosys = BUILD / "tools/venv/bin/yowasp-yosys"
env = dict(os.environ, YOWASP_CACHE_DIR=str(BUILD / "tools/cache"))
noelab = BUILD / "no-elab"
for name in ("bdir", "rtl", "info"):
    (noelab / name).mkdir(parents=True, exist_ok=True)
(noelab / "bdir/Connected.bo").unlink(missing_ok=True)
run([bsc, "-u", "-verilog", "-g", "mkConnected", "-bdir", relative(noelab / "bdir"),
     "-vdir", relative(noelab / "rtl"), "-info-dir", relative(noelab / "info"),
     "experiments/hardware/fixtures/Connected.bsv"], EVIDENCE / "no-elab-compile.txt")
run([bluetcl, "experiments/hardware/toolchain/load-module.tcl", relative(noelab / "bdir"),
     "mkConnected"], EVIDENCE / "no-elab-failure.txt", expected=1)
diffs = []
for path in sorted((noelab / "rtl").glob("*.v")):
    baseline = EVIDENCE / "A/rtl" / path.name
    diffs += difflib.unified_diff(path.read_text().splitlines(True), baseline.read_text().splitlines(True),
                                 fromfile=relative(path), tofile=relative(baseline))
(EVIDENCE / "rtl-elab-diff.txt").write_text("".join(diffs))
directory, work = EVIDENCE / "B-debug", BUILD / "B-debug"
for path in (directory / "rtl", directory / "schedule", work / "bdir", work / "info"):
    path.mkdir(parents=True, exist_ok=True)
(work / "bdir/Control.bo").unlink(missing_ok=True)
argv = [bsc, "-u", "-verilog", "-elab", "-keep-fires", "-keep-inlined-boundaries", "-g", "mkControl",
        "-bdir", relative(work / "bdir"), "-vdir", relative(directory / "rtl"),
        "-info-dir", relative(work / "info"), "-show-schedule", "-show-module-use",
        "experiments/hardware/fixtures/Control.bsv"]
run(argv, directory / "compile.txt")
for path in (work / "info").glob("*.sched"):
    shutil.copyfile(path, directory / "schedule" / path.name)
passes = [f"read_verilog {relative(directory / 'rtl/mkControl.v')}", "hierarchy -check -top mkControl",
          "proc -noopt", f"write_json {relative(directory / 'design.json')}",
          f"write_rtlil {relative(directory / 'design.il')}"]
run([yosys, "-p", "; ".join(passes)], directory / "import.txt", env=env)
run([bluetcl, "experiments/hardware/toolchain/metadata.tcl", relative(work / "bdir"), "Control",
     "mkControl", relative(directory / "bluetcl.json")], directory / "bluetcl.txt")
base = json.loads((EVIDENCE / "B/design.json").read_text())["modules"]["mkControl"]
debug = json.loads((directory / "design.json").read_text())["modules"]["mkControl"]
# hide_name is provider metadata, not a signal-name heuristic.
public_base = {n for n, value in base["netnames"].items() if value["hide_name"] == 0}
public_debug = {n for n, value in debug["netnames"].items() if value["hide_name"] == 0}
save(directory / "comparison.json", {"baselineSha256": digest(EVIDENCE / "B/design.json"),
     "debugSha256": digest(directory / "design.json"), "addedPublicNetnames": sorted(public_debug - public_base),
     "removedPublicNetnames": sorted(public_base - public_debug), "baselineCells": len(base["cells"]),
     "debugCells": len(debug["cells"]), "baselineNetnames": len(base["netnames"]), "debugNetnames": len(debug["netnames"])})
save(directory / "recipe.json", {"stage": "debug-keep-fires-keep-inlined-boundaries/yosys-hierarchy-proc-noopt",
     "compileArgv": argv, "passes": passes, "usedByBaselineImporter": False})
print("Expected missing-.ba failure reproduced; separate debug compile/import succeeded.")
