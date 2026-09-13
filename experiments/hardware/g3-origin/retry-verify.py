#!/usr/bin/env python3
"""Compiler-free validation of run02 execution receipts, not an origin mapper."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path, PurePosixPath
import re


def check(value, message):
    if not value:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit(directory):
    root = Path(directory).resolve(strict=True)

    def path(ref):
        p = PurePosixPath(ref)
        check(not p.is_absolute() and ".." not in p.parts and "\\" not in ref, "unsafe path")
        result = root.joinpath(*p.parts)
        check(result.resolve(strict=True).is_relative_to(root), "escaped root")
        check(result.is_file() and result.stat().st_size <= 16*1024*1024, "file limit")
        return result

    inventory = json.loads(path("INVENTORY.json").read_text())
    check(inventory["schema"] == "g3-origin-retry-inventory-v1", "inventory version")
    registered = set()
    for row in inventory["files"]:
        check(row["path"] not in registered, "duplicate path")
        registered.add(row["path"])
        p = path(row["path"])
        check(p.stat().st_size == row["bytes"] and digest(p) == row["sha256"], "inventory hash mismatch")

    def load(ref):
        check(ref in registered, "unregistered evidence")
        return json.loads(path(ref).read_text())

    result = load("RESULT.json")
    check(result["schema"] == "g3-origin-retry-result-v1" and result["status"] == "blocked", "result version/status")
    inputs = load("inputs/build-inputs.json")
    checkpoint = result["checkpoint"]
    check(digest(path(checkpoint["path"])) == checkpoint["sha256"] == inputs["amendedCheckpoint"]["sha256"],
          "amended checkpoint mismatch")
    check(digest(path(checkpoint["historicalMachinePath"])) == checkpoint["historicalMachineSha256"] ==
          inputs["historicalMachineCheckpoint"]["sha256"], "historical checkpoint mismatch")
    for key, value in (("makeJobs",1),("GHCJOBS",1),("GHCOPTLEVEL","-O2"),
                       ("GHCRTSFLAGS","+RTS -M3500m -A32m -s -RTS")):
        check(inputs[key] == result["strategy"][key] == value, "build strategy mismatch")
    check(result["strategy"]["actualMaximumHeapBytes"] is None, "invented heap measurement")
    compatibility = load("inputs/build-compatibility.json")
    check(compatibility["environment"] == {"GHC":"ghc -XFlexibleContexts"}, "compatibility environment")
    check(digest(path("source/"+compatibility["upstreamSource"])) == compatibility["sourceSha256"],
          "stock source mismatch")
    check(load("receipts/baseline-source-clean.json")["exit"] == 0, "baseline source changed")
    first = load("receipts/baseline-build.json")
    build = load(result["baselineBuild"]["receipt"])
    check(first["exit"] == 2 and first["containerInspect"][0]["State"]["OOMKilled"] is False,
          "first failure classification")
    check(digest(path("receipts/baseline-build.log")) == first["logSha256"], "first log binding")
    container = build["containerInspect"][0]
    state = container["State"]
    check(build["exit"] == state["ExitCode"] == result["baselineBuild"]["exit"] == 2 and
          state["OOMKilled"] is True and state["Running"] is False, "OOM exit mismatch")
    check(container["Id"] == result["baselineBuild"]["containerId"] and
          container["Image"] == result["dependenciesImage"] == inputs["dependenciesImage"], "container identity")
    for key,value in (("NanoCpus",4000000000),("Memory",5368709120),("MemorySwap",5368709120),("PidsLimit",512)):
        check(container["HostConfig"][key] == value, "resource setting mismatch")
    check("GHC=ghc -XFlexibleContexts" in container["Config"]["Env"], "missing compatibility flag")
    start = datetime.datetime.fromisoformat(first["started"])
    finish = datetime.datetime.fromisoformat(build["finished"])
    check(0 < (finish-start).total_seconds() <= 5400 and build["secondsLimit"] < 5400,
          "original wall budget exceeded")
    log = path(result["baselineBuild"]["log"])
    check(build["completeLog"] and build["outputBytes"] == log.stat().st_size and
          digest(log) == build["logSha256"] == result["baselineBuild"]["logSha256"], "build log binding")
    text = log.read_text()
    for value in ("--make bsc -j1", "-O2", "+RTS -M3500m -A32m -s -RTS", "ghc -XFlexibleContexts"):
        check(value in text, "executed compiler flags mismatch")
    match = re.search(r"G3_BUILD_CGROUP_BEGIN\nmemory.max\n(\d+)\nmemory.peak\n(\d+)\nmemory.events\n(.*?)pids.max\n(\d+)\nG3_BUILD_CGROUP_END exit=(\d+)", text, re.S)
    check(match is not None, "missing cgroup receipt")
    assert match is not None
    events = {key:int(value) for key,value in (line.split() for line in match[3].splitlines())}
    check(int(match[1]) == result["baselineBuild"]["cgroupMemoryMaxBytes"] == 5368709120 and
          int(match[2]) == result["baselineBuild"]["cgroupMemoryPeakBytes"] == 5368709120 and
          events == result["baselineBuild"]["cgroupMemoryEvents"] and events["oom_kill"] == 1,
          "cgroup measurement contradiction")
    check(int(match[4]) == 512 and int(match[5]) == build["exit"], "cgroup PID/exit mismatch")
    stream = [json.loads(line) for line in path(result["baselineBuild"]["events"]).read_text().splitlines()]
    stream = [item for item in stream if item["Actor"]["ID"] == container["Id"]]
    actions = [item["Action"] for item in stream]
    check(all(action in actions for action in ("start","oom","die")) and
          actions.index("start") < actions.index("oom") < actions.index("die"), "missing OOM lifecycle")
    check(load("receipts/owned-container-remove.json")["exit"] == 0, "cleanup failure")
    check(result["sidecar"] is None and result["acceptedLedger"] is None and result["artifact"] is None and
          result["originClaims"] == [] and result["instrumentedBuild"] == "not-run", "false origin claim")
    coverage = load("COVERAGE.json")
    check(coverage["newPopulation"] is None and coverage["newOriginClaims"] ==
          coverage["verifiedKnownContributorObjects"] == coverage["completeSupportedOriginSetObjects"] == 0,
          "false coverage")
    check([row["denominator"] for row in coverage["historical"]] == [8,22,53,168] and
          all(row["known"] == row["complete"] == 0 for row in coverage["historical"]), "historical coverage")
    preservation = load("results/preservation.json")
    check(all(item["passed"] and not item["changed"] for item in preservation["checks"]), "preservation failure")
    patch = load("patches/identity.json")
    check(patch["status"] == "draft-unbuilt-not-accepted" and
          digest(path(result["draftPatch"]["path"])) == patch["patchSha256"] == result["draftPatch"]["sha256"],
          "draft status/hash")
    return {"status":"verified-blocked-retry-receipt","files":len(registered),"originClaims":0,
            "cgroupPeakBytes":int(match[2]),"baselineExit":2,"liveReplay":False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence",type=Path,default=Path(__file__).resolve().parents[3]/"docs/hardware/evidence/g3-origin-retry")
    print(json.dumps(audit(parser.parse_args().evidence),indent=2))
