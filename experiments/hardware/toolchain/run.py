#!/usr/bin/env python3
"""Reproduce actual G1 compiler artifacts and conservative metadata sidecars."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/hardware/evidence/toolchain"
BUILD = ROOT / ".build/hardware/toolchain"
FIXTURES = {"A": ("Connected", "mkConnected"), "B": ("Control", "mkControl"), "C": ("Reuse", "mkReuse")}
STAGE = "bsc-generated-rtl/yosys-hierarchy-proc-noopt"


def relative(path):
    return str(Path(path).relative_to(ROOT))


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(path, data):
    Path(path).write_text(json.dumps(data, indent=2) + "\n")


def run(argv, output, *, env=None, expected=0):
    result = subprocess.run([str(a) for a in argv], cwd=ROOT, env=env,
                            text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120)
    Path(output).write_text("argv: " + json.dumps([str(a) for a in argv]) +
                            "\nexit: " + str(result.returncode) + "\n" + result.stdout)
    if result.returncode != expected:
        raise RuntimeError(f"Command failed ({result.returncode}); see {output}")
    return result.stdout


def position(values):
    if not values:
        return None
    path, line, column = values
    source = ROOT / path
    text = source.read_text()
    lines = text.splitlines()
    line, column = int(line), int(column)
    assert 1 <= line <= len(lines) and 1 <= column <= len(lines[line - 1]) + 1
    return {"path": path, "sha256": digest(source), "line1": line, "column1": column,
            "columnConvention": "BSC-reported; ASCII fixtures only; not a source range",
            "lineText": lines[line - 1]}


def summarize(label, top):
    directory = EVIDENCE / label
    design = json.loads((directory / "design.json").read_text())
    meta = json.loads((directory / "bluetcl.json").read_text())
    metadata = {m["name"]: m for m in meta["modules"]}
    modules = design["modules"]
    mappings, module_rows = [], []
    counts = dict(modules=0, cells=0, hierarchyCells=0, leafCells=0, ports=0,
                  methodPortBindings=0, netnames=0, moduleLocalIntegerBits=0,
                  cellPins=0, cellPinBits=0, constantCellPinBits=0, openCellPins=0,
                  cellsWithGeneratedRtlSrc=0, netnamesWithGeneratedRtlSrc=0,
                  hierarchyCellsWithBsvPosition=0, leafCellsWithExactBsvOrigin=0,
                  netnamesWithExactBsvOrigin=0)
    for name, module in modules.items():
        # hdlname is explicit Yosys parameter-derivation metadata, not a regex.
        original = module.get("attributes", {}).get("hdlname", name)
        bsv = metadata.get(original)
        counts["modules"] += 1
        counts["ports"] += len(module["ports"])
        counts["netnames"] += len(module["netnames"])
        all_bits = set()
        for net in module["netnames"].values():
            all_bits.update(b for b in net["bits"] if isinstance(b, int))
            counts["netnamesWithGeneratedRtlSrc"] += bool(net.get("attributes", {}).get("src"))
        for port in module["ports"].values():
            all_bits.update(b for b in port["bits"] if isinstance(b, int))
        for cellname, cell in module["cells"].items():
            counts["cells"] += 1
            counts["cellsWithGeneratedRtlSrc"] += bool(cell.get("attributes", {}).get("src"))
            is_hierarchy = cell["type"] in modules
            counts["hierarchyCells" if is_hierarchy else "leafCells"] += 1
            for pin, bits in cell["connections"].items():
                counts["cellPins"] += 1
                counts["cellPinBits"] += len(bits)
                counts["constantCellPinBits"] += sum(isinstance(b, str) for b in bits)
                counts["openCellPins"] += not bits
                assert all(type(b) is int or b in ("0", "1", "x", "z") for b in bits)
                all_bits.update(b for b in bits if isinstance(b, int))
                if is_hierarchy:
                    formal = modules[cell["type"]]["ports"][pin]
                    assert not bits or len(bits) == len(formal["bits"])
                    assert cell["port_directions"][pin] == formal["direction"]
            if is_hierarchy and bsv:
                candidates = [i for i in bsv["instances"] if i["name"] == cellname]
                target = modules[cell["type"]].get("attributes", {}).get("hdlname", cell["type"])
                if len(candidates) == 1 and candidates[0]["definition"] == target:
                    pos = position(candidates[0]["position"])
                    if pos:
                        counts["hierarchyCellsWithBsvPosition"] += 1
                        mappings.append({"kind": "instance-declaration", "module": name, "cell": cellname,
                                         "source": pos, "status": "verified-fixture-boundary",
                                         "evidence": ["Bluetcl::submodule full", "Yosys cell exact identifier/type", "Yosys hdlname when parameter-derived"],
                                         "generatedRtl": cell["attributes"].get("src")})
        counts["moduleLocalIntegerBits"] += len(all_bits)
        if bsv:
            bindings = set()
            for method in bsv["methods"]:
                roles = [("argument", arg["port"]) for arg in method["args"]]
                roles += [(role, method[role]) for role in ("enable", "ready", "result") if method[role]]
                for role, port in roles:
                    assert port in module["ports"]
                    bindings.add(port)
                    mappings.append({"kind": "method-port", "module": name, "method": method["name"],
                                     "role": role, "port": port, "bits": module["ports"][port]["bits"],
                                     "status": "verified-port-contract/source-context-only",
                                     "sourceContext": position(bsv["definitionPosition"]),
                                     "exactMethodSourceRange": None,
                                     "evidence": ["Bluetcl::module ports", "Yosys ports exact identifier"]})
            counts["methodPortBindings"] += len(bindings)
        module_rows.append({"module": name, "bsvDefinition": original if bsv else None,
                            "parameters": module.get("parameter_default_values", {}),
                            "cells": len(module["cells"]), "ports": len(module["ports"]),
                            "netnames": len(module["netnames"]), "integerBits": len(all_bits)})
    counts["sourceHierarchyNodes"] = len(meta["hierarchy"])
    counts["sourcePrimitiveNodes"] = sum(n["Node"] == "Primitive" for n in meta["hierarchy"])
    counts["sourceInlinedBoundaryNodes"] = sum(n["Node"] == "Instance" for n in meta["hierarchy"])
    counts["sourceRulesWithPositions"] = sum(bool(r["position"]) for m in meta["modules"] for r in m["rules"])
    # Full occurrence denominator is distinct from definition-local cell counts.
    def occurrence_count(name):
        return 1 + sum(occurrence_count(c["type"]) for c in modules[name]["cells"].values() if c["type"] in modules)
    counts["implementationOccurrencesIncludingTop"] = occurrence_count(top)
    sidecar = {"schema": "g1-correspondence-experiment-v1", "existingBscStandard": False,
               "stage": STAGE, "artifactSha256": digest(directory / "design.json"),
               "metadataSha256": digest(directory / "bluetcl.json"), "mappings": mappings,
               "unmappedPolicy": "No expression/register/scheduler cell or net is given an exact original BSV origin; generated RTL src is not BSV."}
    save(directory / "correspondence.json", sidecar)
    summary = {"fixture": label, "top": top, "stage": STAGE, "counts": counts, "modules": module_rows}
    save(directory / "coverage.json", summary)
    return summary


def build(bsc, bluetcl, yosys):
    env = dict(os.environ, YOWASP_CACHE_DIR=str(BUILD / "tools/cache"))
    for label, (package, top) in FIXTURES.items():
        directory = EVIDENCE / label
        work = BUILD / label
        for path in (directory / "rtl", directory / "schedule", work / "bdir", work / "info"):
            path.mkdir(parents=True, exist_ok=True)
        # Invalidate only this experiment package output so each run really compiles.
        (work / "bdir" / f"{package}.bo").unlink(missing_ok=True)
        argv = [bsc, "-u", "-verilog", "-elab", "-g", top, "-bdir", relative(work / "bdir"),
                "-vdir", relative(directory / "rtl"), "-info-dir", relative(work / "info"),
                "-show-schedule", "-show-module-use", "-show-elab-progress",
                f"experiments/hardware/fixtures/{package}.bsv"]
        run(argv, directory / "compile.txt")
        for path in (work / "info").glob("*.sched"):
            shutil.copyfile(path, directory / "schedule" / path.name)
        rtl = sorted((directory / "rtl").glob("*.v"))
        passes = ["read_verilog " + " ".join(relative(p) for p in rtl),
                  f"hierarchy -check -top {top}", f"write_rtlil {relative(directory / 'pre-proc.il')}",
                  "proc -noopt", f"write_json {relative(directory / 'design.json')}",
                  f"write_rtlil {relative(directory / 'design.il')}"]
        run([yosys, "-p", "; ".join(passes)], directory / "import.txt", env=env)
        run([bluetcl, "experiments/hardware/toolchain/metadata.tcl", relative(work / "bdir"),
             package, top, relative(directory / "bluetcl.json")], directory / "bluetcl.txt")
        save(directory / "recipe.json", {"stage": STAGE, "compileArgv": argv, "passes": passes,
             "procExpansion": ["proc_clean", "proc_rmdead", "proc_prune", "proc_init", "proc_arst", "proc_rom", "proc_mux", "proc_dlatch", "proc_dff", "proc_memwr", "proc_clean"],
             "externalRtlLibraryInputs": [], "macros": "Yosys read_verilog default SYNTHESIS; BSC reset macros from emitted RTL; translate_off initial blocks omitted",
             "bscDirectPackageDependencies": ["Prelude", "PreludeBSV"],
             "compiledMetadataArtifacts": [{"path": relative(p), "sha256": digest(p), "bytes": p.stat().st_size} for p in sorted((work / "bdir").iterdir()) if p.is_file()],
             "source": {"path": f"experiments/hardware/fixtures/{package}.bsv", "sha256": digest(ROOT / f"experiments/hardware/fixtures/{package}.bsv")}})
    run([bsc, "-v"], EVIDENCE / "bsc-version.txt")
    run([yosys, "-V"], EVIDENCE / "yosys-version.txt", env=env)
    run([yosys, "-p", "help read_verilog; help hierarchy; help proc; help write_json; help write_rtlil; license"], EVIDENCE / "yosys-help.txt", env=env)


def inventory(bsc, bluetcl):
    root = Path(bsc).resolve().parents[1]
    # Full installation inventory is conservative, not a claim every file was consumed.
    files = []
    for path in sorted(root.rglob("*")):
        if path.is_file():
            files.append({"path": str(path), "sha256": digest(path), "bytes": path.stat().st_size})
    save(EVIDENCE / "bsc-installation-inventory.json", {"root": str(root), "scope": "entire installed BSC distribution; conservative dependency fingerprint", "files": files})
    for name in ("COPYING", "LICENSE.txt"):
        shutil.copyfile(root / name, EVIDENCE / ("bsc-" + name + ".txt"))
    run(["otool", "-L", root / "libexec/bin/core/bsc"], EVIDENCE / "bsc-dylibs.txt")
    run(["otool", "-L", root / "libexec/bin/core/bluetcl"], EVIDENCE / "bluetcl-dylibs.txt")
    runtime_roots = [Path("/opt/homebrew/opt/gmp").resolve(), Path("/opt/homebrew/opt/tcl-tk").resolve()]
    runtime_files = [{"path": str(p), "sha256": digest(p), "bytes": p.stat().st_size}
                     for directory in runtime_roots for p in sorted(directory.rglob("*")) if p.is_file()]
    save(EVIDENCE / "native-runtime-inventory.json", {"scope": "conservative entire GMP and Tcl distributions; OS shared-cache libraries identified by macOS build, not individually hashed", "files": runtime_files})
    run(["sw_vers"], EVIDENCE / "host-version.txt")


def extract_example():
    modules = json.loads((EVIDENCE / "A/design.json").read_text())["modules"]
    parent = modules["mkConnected"]
    left = parent["cells"]["left"]
    child = modules[left["type"]]
    bit = left["connections"]["get"][0]
    endpoints = [{"cell": name, "pin": pin, "bitOffsetLsb0": offset,
                  "direction": cell["port_directions"].get(pin)}
                 for name, cell in parent["cells"].items()
                 for pin, bits in cell["connections"].items()
                 for offset, value in enumerate(bits) if value == bit]
    save(EVIDENCE / "extraction-example.json", {
        "artifact": "A/design.json", "module": "mkConnected", "cell": "left",
        "cellType": left["type"], "instanceSource": left["attributes"]["src"],
        "parentActualGet": left["connections"]["get"], "childFormalGet": child["ports"]["get"]["bits"],
        "boundaryPairs": list(zip(left["connections"]["get"], child["ports"]["get"]["bits"])),
        "parentBit": bit, "parentBitAliases": [n for n, v in parent["netnames"].items() if bit in v["bits"]],
        "parentBitCellEndpoints": endpoints, "readyConstant": parent["ports"]["RDY_put"]["bits"],
        "unconnectedChildReady": left["connections"]["RDY_put"]})


def manifest():
    paths = sorted(p for p in EVIDENCE.rglob("*") if p.is_file() and p.name not in ("manifest.json", "verification.txt"))
    paths += sorted((ROOT / "experiments/hardware/fixtures").glob("*.bsv"))
    paths += sorted(p for p in (ROOT / "experiments/hardware/toolchain").iterdir() if p.is_file())
    save(EVIDENCE / "manifest.json", {"schema": "g1-evidence-manifest-v1", "host": {"system": platform.system(), "release": platform.release(), "machine": platform.machine()},
         "files": [{"path": relative(p), "sha256": digest(p), "bytes": p.stat().st_size} for p in paths]})


def verify():
    data = json.loads((EVIDENCE / "manifest.json").read_text())
    for item in data["files"]:
        assert digest(ROOT / item["path"]) == item["sha256"], item["path"]
    for label, (_, top) in FIXTURES.items():
        p = json.loads((EVIDENCE / label / "design.json").read_text())
        assert top in p["modules"]
        assert all(not m.get("processes") for m in p["modules"].values())
        c = json.loads((EVIDENCE / label / "coverage.json").read_text())["counts"]
        assert c["hierarchyCellsWithBsvPosition"] == c["hierarchyCells"]
        assert c["leafCellsWithExactBsvOrigin"] == c["netnamesWithExactBsvOrigin"] == 0
        sidecar = json.loads((EVIDENCE / label / "correspondence.json").read_text())
        assert sidecar["artifactSha256"] == digest(EVIDENCE / label / "design.json")
        assert sidecar["metadataSha256"] == digest(EVIDENCE / label / "bluetcl.json")
        for mapping in sidecar["mappings"]:
            source = mapping.get("source", mapping.get("sourceContext"))
            assert source is not None
            path = ROOT / source["path"]
            assert source["sha256"] == digest(path)
            assert source["lineText"] == path.read_text().splitlines()[source["line1"] - 1]
            if mapping["kind"] == "method-port":
                assert mapping["bits"] == p["modules"][mapping["module"]]["ports"][mapping["port"]]["bits"]
    a = json.loads((EVIDENCE / "A/design.json").read_text())["modules"]["mkConnected"]
    assert a["cells"]["left"]["type"] == a["cells"]["right"]["type"] == "mkStage"
    assert a["cells"]["left"]["connections"]["put_value"] == a["ports"]["put_value"]["bits"]
    c = json.loads((EVIDENCE / "C/design.json").read_text())["modules"]
    low = c[c["mkReuse"]["cells"]["low"]["type"]]
    high = c[c["mkReuse"]["cells"]["high"]["type"]]
    assert int(low["parameter_default_values"]["bias"], 2) == 3
    assert int(high["parameter_default_values"]["bias"], 2) == 9
    assert low["attributes"]["hdlname"] == high["attributes"]["hdlname"] == "mkBiased"
    assert len(c["mkNarrow"]["ports"]["get"]["bits"]) == 8
    assert len(c["mkWide"]["ports"]["get"]["bits"]) == 12
    print(f"Verified {len(data['files'])} file hashes, all three artifacts, hierarchy/parameter/width invariants, and conservative mapping counts.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-evidence", action="store_true")
    parser.add_argument("--summarize-only", action="store_true")
    parser.add_argument("--bsc", default=shutil.which("bsc"))
    parser.add_argument("--bluetcl", default=shutil.which("bluetcl"))
    parser.add_argument("--yosys", default=str(BUILD / "tools/venv/bin/yowasp-yosys"))
    args = parser.parse_args()
    if args.verify_evidence:
        verify()
        return
    if not args.summarize_only:
        build(args.bsc, args.bluetcl, args.yosys)
        inventory(args.bsc, args.bluetcl)
    save(EVIDENCE / "coverage.json", [summarize(label, top) for label, (_, top) in FIXTURES.items()])
    extract_example()
    manifest()
    verify()


if __name__ == "__main__":
    main()
