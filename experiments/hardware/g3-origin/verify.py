#!/usr/bin/env python3
"""Offline audit of the G3-B blocked execution receipt, never an origin importer."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit(directory):
    root = Path(directory).resolve(strict=True)

    def path(ref):
        require(isinstance(ref, str), "path must be a string")
        relative = PurePosixPath(ref)
        require(not relative.is_absolute() and bool(relative.parts) and
                all(p not in (".", "..") for p in relative.parts) and "\\" not in ref,
                "unsafe evidence path")
        candidate = root.joinpath(*relative.parts)
        require(candidate.resolve(strict=True).is_relative_to(root), "evidence path escaped root")
        require(candidate.is_file() and candidate.stat().st_size <= 16*1024*1024,
                "missing or oversized evidence file")
        return candidate

    inventory = json.loads(path("INVENTORY.json").read_text())
    require(inventory["schema"] == "g3-origin-offline-inventory-v1", "inventory schema")
    seen = set()
    for row in inventory["files"]:
        require(row["path"] not in seen, "duplicate inventory path")
        seen.add(row["path"])
        p = path(row["path"])
        require(p.stat().st_size == row["bytes"] and digest(p) == row["sha256"],
                "inventory hash mismatch: " + row["path"])

    def load(ref):
        require(ref in seen, "unregistered receipt")
        return json.loads(path(ref).read_text())

    result = load("RESULT.json")
    require(result["schema"] == "g3-origin-blocked-result-v1" and result["status"] == "blocked",
            "not a blocked execution receipt")
    checkpoint = result["checkpoint"]
    require(digest(path(checkpoint["path"])) == checkpoint["sha256"], "checkpoint hash")
    inputs = load("inputs/build-inputs.json")
    require(inputs["checkpointSha256"] == checkpoint["sha256"], "checkpoint input binding")
    acquire = load("receipts/acquire.json")
    provision = load("receipts/provision-03.json")
    for receipt in (acquire, provision):
        require(receipt["exit"] == 0 and receipt["reason"] is None and receipt["completeLog"],
                "prerequisite failed")
    for stem, receipt in (("acquire", acquire), ("provision-03", provision)):
        require(digest(path("receipts/"+stem+".log")) == receipt["logSha256"], "prerequisite log binding")
    acquire_log = path("receipts/acquire.log").read_text()
    require(result["sourcePin"] in acquire_log and result["yicesPin"] in acquire_log,
            "source pin receipt")

    build = load("receipts/baseline-build.json")
    container = build["containerInspect"][0]
    state = container["State"]
    require(build["exit"] == result["baselineBuild"]["exit"] != 0 and state["OOMKilled"] is True and
            state["Running"] is False and state["ExitCode"] == build["exit"], "OOM exit contradiction")
    require(container["Id"] == result["baselineBuild"]["containerId"] and
            container["Image"] == result["dependenciesImage"], "container identity mismatch")
    for field, expected in (("Memory", 5*1024**3), ("MemorySwap", 5*1024**3),
                            ("NanoCpus", 4_000_000_000), ("PidsLimit", 512)):
        require(container["HostConfig"][field] == expected, "container resource limit mismatch")
    require(build["secondsLimit"] == 5400 and build["elapsedSeconds"] <= 5400,
            "wall budget contradiction")
    require(build["completeLog"] and build["outputBytes"] <= 16*1024*1024, "truncated required log")
    log = path(result["baselineBuild"]["log"])
    require(digest(log) == build["logSha256"] == result["baselineBuild"]["logSha256"],
            "build output hash")
    require(b"Error 137" in log.read_bytes(), "missing observed GHC failure")
    events = [json.loads(line) for line in path(result["baselineBuild"]["events"]).read_text().splitlines()]
    events = [event for event in events if event["Actor"]["ID"] == container["Id"]]
    actions = [event["Action"] for event in events]
    require("oom" in actions and "die" in actions and actions.index("start") < actions.index("oom") < actions.index("die"),
            "missing or out-of-order OOM lifecycle evidence")
    require(any(event["Action"] == "die" and event["Actor"]["Attributes"]["exitCode"] == str(build["exit"])
                for event in events), "die exit mismatch")
    removed = load("receipts/owned-container-remove.json")
    require(removed["exit"] == 0, "container cleanup failed")

    coverage = load("COVERAGE.json")
    require(result["sidecars"] is None and result["transformLedger"] is None and result["artifact"] is None and
            result["originClaims"] == [], "blocked run must not assert an origin")
    require(coverage["newArtifactPopulation"] is None and coverage["newOriginClaims"] == 0 and
            coverage["verifiedKnownContributorObjects"] == coverage["completeSupportedContributorObjects"] == 0,
            "unmeasured population or false numerator")
    require([row["denominator"] for row in coverage["historicalBaseline"]] == [8,22,53,168] and
            all(row["known"] == row["complete"] == 0 for row in coverage["historicalBaseline"]),
            "historical coverage changed")
    protected = load("results/protected-input-verification.json")
    require(protected["passed"] and not protected["changed"] and
            protected["checkedFiles"] == len(load("inputs/preserved-inputs.json")), "protected-input failure")
    patch = load("patches/identity.json")
    require(patch["status"] == "draft-unbuilt-not-accepted" and
            digest(path(result["draftPatch"]["path"])) == patch["patchSha256"] == result["draftPatch"]["sha256"],
            "draft patch identity/status mismatch")
    for row in patch["files"]:
        if row["upstreamSha256"] is not None:
            require(digest(path("draft-upstream/"+row["path"])) == row["upstreamSha256"],
                    "draft upstream identity mismatch")
    return {"status":"verified-blocked-receipt", "files":len(seen), "baselineExit":build["exit"],
            "oomKilled":True, "originClaims":0, "liveCompilerReplay":False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=Path,
                        default=Path(__file__).resolve().parents[3]/"docs/hardware/evidence/g3-origin")
    args = parser.parse_args()
    print(json.dumps(audit(args.evidence), indent=2))


if __name__ == "__main__":
    main()
