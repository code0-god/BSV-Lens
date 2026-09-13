#!/usr/bin/env python3
"""Recheck a G4 exact-byte baseline without rewriting history or old receipts."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess


def fingerprint(entries):
    data = json.dumps(entries, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(data).hexdigest()


def inspect(root, entry):
    file = root / entry["path"]
    try:
        if file.is_symlink():
            data = os.readlink(file).encode()
            kind = "symlink"
        else:
            data = file.read_bytes()
            kind = "file"
    except FileNotFoundError:
        return {**entry, "kind": "missing", "bytes": None, "sha256": None}
    return {**entry, "kind": kind, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def identity(root):
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=root, text=True).strip()
    return {
        "branch": git("branch", "--show-current"),
        "head": git("rev-parse", "HEAD"),
        "originMain": git("rev-parse", "origin/main"),
        "packageVersion": json.loads((root / "package.json").read_text())["version"],
        "tagsAtHead": git("tag", "--points-at", "HEAD").splitlines(),
        "tags": git("show-ref", "--tags").splitlines(),
    }


def verify(root, baseline, allow_source_changes=()):
    entries = baseline["entries"]
    if fingerprint(entries) != baseline["fingerprint"]:
        raise ValueError("Baseline inventory fingerprint mismatch")
    by_path = {entry["path"]: entry for entry in entries}
    if len(by_path) != len(entries):
        raise ValueError("Duplicate baseline paths")
    allowed = set(allow_source_changes)
    for name in allowed:
        if name not in by_path or by_path[name]["groups"] != ["source"]:
            raise ValueError(f"Only baseline source-only files may be authorized: {name}")
    observed = [inspect(root, entry) for entry in entries]
    changes = [{"path": before["path"], "before": before, "after": after}
               for before, after in zip(entries, observed) if before != after]
    authorized = [change for change in changes if change["path"] in allowed
                  and change["after"]["kind"] == change["before"]["kind"]]
    unexpected = [change for change in changes if change not in authorized]
    groups = {}
    for group in sorted({group for entry in entries for group in entry["groups"]}):
        before = [entry for entry in entries if group in entry["groups"] and entry["path"] not in allowed]
        after = [entry for entry in observed if group in entry["groups"] and entry["path"] not in allowed]
        groups[group] = {"files": len(before), "expectedFingerprint": fingerprint(before),
                         "observedFingerprint": fingerprint(after), "unchanged": before == after}
    protected_before = [entry for entry in entries if entry["path"] not in allowed]
    protected_after = [entry for entry in observed if entry["path"] not in allowed]
    highlights = []
    for before, after in zip(entries, observed):
        name = before["path"]
        if ("distDeliverables" in before["groups"] or name.endswith("/origin-sidecar.json")
                or name.startswith(".build/hardware/g3-a/") and Path(name).name in {
                    "cancellation.json", "measurements.json", "A-bundle.json", "B-bundle.json",
                    "C-bundle.json", "A-query.json", "B-query.json", "C-query.json"}):
            highlights.append({"path": name, "beforeSha256": before["sha256"],
                               "afterSha256": after["sha256"], "unchanged": before == after})
    identity_changes = {}
    observed_identity = None
    if "identity" in baseline:
        observed_identity = identity(root)
        identity_changes = {key: {"before": baseline["identity"][key], "after": value}
                            for key, value in observed_identity.items() if value != baseline["identity"][key]}
    return {
        "schema": "g4-preservation-verification-v1",
        "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "baselineFingerprint": baseline["fingerprint"],
        "observedFingerprint": fingerprint(observed),
        "checkedFiles": len(entries), "unchangedFiles": len(entries) - len(changes),
        "allowSourceChanges": sorted(allowed), "authorizedChanges": authorized,
        "unexpectedChanges": unexpected, "groups": groups,
        "protectedFingerprint": fingerprint(protected_before),
        "observedProtectedFingerprint": fingerprint(protected_after),
        "highlights": highlights, "identity": observed_identity, "identityChanges": identity_changes,
        "preserved": not unexpected and not identity_changes,
        "scope": "Every baseline path rehashed. New paths are outside this frozen baseline; no mtime-only or sampled comparison.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[3])
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--allow-source-change", action="append", default=[])
    args = parser.parse_args()
    baseline_bytes = args.baseline.read_bytes()
    result = verify(args.root, json.loads(baseline_bytes), args.allow_source_change)
    result["baselinePath"] = str(args.baseline)
    result["baselineFileSha256"] = hashlib.sha256(baseline_bytes).hexdigest()
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    with args.receipt.open("x") as output:
        json.dump(result, output, indent=2)
        output.write("\n")
    print(json.dumps({key: result[key] for key in ["preserved", "checkedFiles", "unchangedFiles", "protectedFingerprint"]}))
    return 0 if result["preserved"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
