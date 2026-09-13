#!/usr/bin/env python3
"""Explicit author-only GHC 9.6.7 run03 stages. No acquisition, host install or automatic retry."""
import argparse
import datetime
import re
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", required=True, type=Path)
    parser.add_argument("--kind", choices=("baseline", "instrumented"), required=True)
    parser.add_argument("--stage", choices=("build", "smoke", "compile"), required=True)
    parser.add_argument("--noemit", action="store_true")
    parser.add_argument("--continuation", default="")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    run = args.run.resolve(strict=True)
    if not run.is_relative_to(root/".build/hardware/g3-origin"):
        raise ValueError("run must be in the owned build namespace")
    manifest = json.loads((run/"inputs/build-inputs.json").read_text())
    for item in manifest["fixtures"]:
        actual = hashlib.sha256((run/"inputs/fixtures"/item["path"]).read_bytes()).hexdigest()
        if actual != item["sha256"]:
            raise ValueError("fixture hash changed")
    name = "g3-origin-st_01a07a97-run03"
    stem = args.kind+"-"+args.stage+("-noemit" if args.noemit else "")
    if args.continuation:
        if not re.fullmatch(r"[a-z0-9-]+", args.continuation):
            raise ValueError("invalid continuation label")
        stem += "-"+args.continuation
    receipt = run/"receipts"/(stem+".json")
    if receipt.exists():
        raise ValueError("receipt already exists; never overwrite a prior stage")
    seconds = 5400 if args.stage == "build" else 120
    if args.stage == "build" and args.continuation:
        original = json.loads((run/"receipts"/(args.kind+"-build.running.json")).read_text())
        start = datetime.datetime.fromisoformat(original["started"])
        elapsed = (datetime.datetime.now(datetime.timezone.utc)-start).total_seconds()
        seconds = int(5400-elapsed)
        if seconds <= 20:
            raise ValueError("original 90-minute build budget exhausted")
    if args.stage == "build":
        command = "make -j1 GHCJOBS=1 GHCOPTLEVEL=-O2 " + shlex.quote("GHCRTSFLAGS="+manifest["GHCRTSFLAGS"]) + " PREFIX=/work/inst install-src"
    elif args.stage == "smoke":
        command = "make PREFIX=/work/inst check-smoke"
    else:
        target = "/work/run-noemit" if args.noemit else "/work/run"
        metadata = "" if args.kind == "baseline" else " -trace-g3-origin" + (" -trace-g3-noemit" if args.noemit else "")
        commands = ["mkdir -p "+target, "cd "+target, "/work/inst/bin/bsc -v"]
        for label, package, top in (("A","Connected","mkConnected"),("B","Control","mkControl"),("C","Reuse","mkReuse")):
            commands += [f"mkdir -p {label}/bdir {label}/rtl {label}/info",
                         f"/work/inst/bin/bsc -u -verilog -elab -g {top} -bdir {label}/bdir -vdir {label}/rtl -info-dir {label}/info -show-schedule -show-module-use -show-elab-progress{metadata} /input/fixtures/{package}.bsv"]
        command = " && ".join(commands)
    wrapped = "timeout --signal=TERM --kill-after=10s " + str(seconds-20) + "s /bin/sh -ec " + shlex.quote(command)
    wrapped += '; rc=$?; printf "\nG3_BUILD_CGROUP_BEGIN\n"; for f in memory.max memory.peak memory.events pids.max; do printf "%s\n" "$f"; head -40 /sys/fs/cgroup/$f; done; printf "G3_BUILD_CGROUP_END exit=%s\n" "$rc"; exit "$rc"'
    argv = ["docker","create","--name",name,"--pull=never","--platform","linux/arm64",
            "--cpus","4","--memory","5g","--memory-swap","5g","--pids-limit","512",
            "--init","--network","none","--read-only","--cap-drop","ALL",
            "--security-opt","no-new-privileges","--log-driver","local",
            "--log-opt","max-size=16m","--log-opt","max-file=1","--log-opt","compress=false",
            "--tmpfs","/tmp:rw,nosuid,size=256m","--tmpfs","/run:rw,nosuid,size=16m",
            "--mount",f"type=bind,src={run/args.kind},dst=/work",
            "--mount",f"type=bind,src={run/'inputs'},dst=/input,readonly",
            "--env","HOME=/opt/g3-ghc96-home","--env","CABAL_DIR=/opt/g3-cabal",
            "--env","GHC=/opt/ghc-9.6.7/bin/ghc -XFlexibleContexts",
            "--env","PATH=/opt/ghc-9.6.7/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "--env","GIT_CONFIG_COUNT=1","--env","GIT_CONFIG_KEY_0=safe.directory",
            "--env","GIT_CONFIG_VALUE_0=/work/bsc","--workdir","/work/bsc",
            "--label","g3.task=st_01a07a97","--label","g3.run=run03",
            "--entrypoint","/bin/sh",manifest["dependenciesImage"],"-c",wrapped]
    created = subprocess.run(argv,capture_output=True,text=True,timeout=120)
    (run/"receipts"/(stem+"-create.json")).write_text(json.dumps(dict(argv=argv,exit=created.returncode,
                 stdout=created.stdout,stderr=created.stderr),indent=2)+"\n")
    if created.returncode:
        raise RuntimeError(created.stderr)
    monitor = [sys.executable,"-B",str(Path(__file__).with_name("monitor.py")),
               "--receipt",str(receipt),"--seconds",str(seconds),"--container",name,
               "--watch",str(run/args.kind)+":4294967296","--","docker","start","-a",name]
    env = dict(os.environ,PYTHONDONTWRITEBYTECODE="1")
    return subprocess.run(monitor,env=env,timeout=seconds+120).returncode


if __name__ == "__main__":
    raise SystemExit(main())
