#!/usr/bin/env python3
"""Explicit isolated reader capture of newly compiled run03 RTL."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


PASSES = ["proc_clean","proc_rmdead","proc_prune","proc_init","proc_arst","proc_rom",
          "proc_mux","proc_dlatch","proc_dff","proc_memwr","proc_clean"]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--run",required=True,type=Path)
    p.add_argument("--kind",required=True,choices=("baseline","instrumented","instrumented-noemit"))
    p.add_argument("--captures",action="store_true")
    p.add_argument("--receipt-suffix",choices=("", "final"),default="")
    a = p.parse_args()
    root = Path(__file__).resolve().parents[3]
    run = a.run.resolve(strict=True)
    if not run.is_relative_to(root/".build/hardware/g3-origin"):
        raise ValueError("outside owned build namespace")
    kind = "instrumented" if a.kind == "instrumented-noemit" else a.kind
    source = run/kind/("run-noemit" if a.kind == "instrumented-noemit" else "run")
    target = run/"results"/a.kind
    target.mkdir(parents=True,exist_ok=True)
    for label in ("A","B","C"):
        dest = target/label/"rtl"
        if not dest.exists():
            dest.mkdir(parents=True)
            for f in sorted((source/label/"rtl").glob("*.v")):
                shutil.copy2(f,dest/f.name)
                assert f.read_bytes() == (dest/f.name).read_bytes()
        if not list(dest.glob("*.v")):
            raise ValueError("no actual generated RTL")
    executable = root/".build/hardware/toolchain/tools/venv/bin/yowasp-yosys"
    environment = dict(os.environ,YOWASP_CACHE_DIR=str(run/"tools/yowasp-cache"),PYTHONDONTWRITEBYTECODE="1")
    mode = "captures" if a.captures else "regular"
    for label,top in (("A","mkConnected"),("B","mkControl"),("C","mkReuse")):
        rtl = sorted((target/label/"rtl").glob("*.v"))
        read = "read_verilog " + ("-dump_ast1 -dump_ast2 -no_dump_ptr " if a.captures else "") + " ".join(str(f.relative_to(target)) for f in rtl)
        commands = [read,f"hierarchy -check -top {top}"]
        if a.captures:
            (target/label/"captures").mkdir(exist_ok=False)
            commands = [read,f"write_rtlil {label}/captures/read.il",f"hierarchy -check -top {top}",f"write_rtlil {label}/captures/00-pre-proc.il"]
            for index,step in enumerate(PASSES,1):
                commands += [step,f"write_rtlil {label}/captures/{index:02d}-{step}.il"]
            commands += [f"write_json {label}/capture-design.json"]
        else:
            commands += [f"write_rtlil {label}/pre-proc.il","proc -noopt",f"write_json {label}/design.json",f"write_rtlil {label}/design.il"]
        suffix = "-"+a.receipt_suffix if a.receipt_suffix else ""
        receipt = run/"receipts"/f"{a.kind}-{label}-reader-{mode}{suffix}.json"
        if receipt.exists():raise ValueError("reader receipt already exists")
        argv = [sys.executable,"-B",str(Path(__file__).with_name("monitor.py")),"--receipt",str(receipt),
                "--seconds","120","--",str(executable),"-p","; ".join(commands)]
        result = subprocess.run(argv,cwd=target,env=environment,timeout=150)
        if result.returncode:return result.returncode
        (target/label/f"recipe-{mode}.json").write_text(json.dumps({"stage":"bsc-generated-rtl/yosys-hierarchy-proc-noopt",
             "commands":commands,"expandedProc":PASSES if a.captures else None,
             "readerExecutableSha256":hashlib.sha256(executable.read_bytes()).hexdigest(),
             "rtlInputs":[{"path":str(f.relative_to(target)),"sha256":hashlib.sha256(f.read_bytes()).hexdigest()} for f in rtl]},indent=2)+"\n")
    return 0


if __name__ == "__main__":raise SystemExit(main())
