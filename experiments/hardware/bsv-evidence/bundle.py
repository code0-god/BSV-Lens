#!/usr/bin/env python3
"""Fixture evidence census, raw-boundary connectivity, and one audited chain.

Not a Source Model adapter or a BSC exporter. No BSV is inferred from Yosys.
"""
import argparse
from collections import defaultdict
import json
import subprocess
from capture import ROOT, OUT, OLD, fingerprint, preserve, save

FIXTURES = {"A": ("Connected", "mkConnected"), "B": ("Control", "mkControl"), "C": ("Reuse", "mkReuse")}
# Reviewed lexical ranges in the unchanged fixtures, not compiler-exported ends.
INVENTORY = {
    "A": [("mkStage", 10, 16, [("state", 11)], [("put", 12, 14), ("get", 15, 15)], [], []),
          ("mkConnected", 19, 27, [], [("put", 22, 25), ("get", 26, 26)], [], [("left", 20), ("right", 21)])],
    "B": [("mkControl", 9, 28, [("count", 10), ("phase", 11)], [("inject", 24, 26), ("read", 27, 27)], [("tick", 13, 15), ("decrement", 17, 19), ("increment", 20, 22)], [])],
    "C": [("mkBiased", 9, 15, [("state", 10)], [("put", 11, 13), ("get", 14, 14)], [], []),
          ("mkWidth", 18, 24, [("state", 19)], [("put", 20, 22), ("get", 23, 23)], [], []),
          ("mkNarrow", 27, 30, [], [], [], [("implementation", 28)]),
          ("mkWide", 33, 36, [], [], [], [("implementation", 34)]),
          ("mkReuse", 44, 56, [], [("put", 49, 54), ("get", 55, 55)], [], [("low", 45), ("high", 46), ("narrow", 47), ("wide", 48)])]
}

# Outermost behavior RHS/call and explicit guard sites; not every AST subexpression.
# Constructor/initializer/return-interface expressions are excluded by definition.
EXPRESSIONS = {
    "A": [(13, "value + 1"), (15, "state"), (23, "left.put(value)"),
          (24, "right.put(left.get + value)"), (26, "right.get")],
    "B": [(14, "!phase"), (17, "count > 0 && phase"), (18, "count - 1"),
          (20, "count < 8"), (21, "count + 2"), (24, "count < 4"),
          (25, "value"), (27, "count")],
    "C": [(12, "value + bias"), (14, "state"), (21, "value + 1"), (23, "state"),
          (50, "low.put(value)"), (51, "high.put(value)"), (52, "narrow.put(low.get)"),
          (53, "wide.put(zeroExtend(high.get))"), (55, "wide.get + zeroExtend(narrow.get)")]
}


def load(path):
    return json.loads(path.read_text())


def source_range(path, start, end):
    lines = (ROOT / path).read_text().splitlines()
    first = len(lines[start - 1]) - len(lines[start - 1].lstrip()) + 1
    return {**fingerprint(ROOT / path), "start": {"line1": start, "column1": first},
            "endExclusive": {"line1": end, "column1": len(lines[end - 1]) + 1},
            "convention": "1-based ASCII code-point columns, exclusive end; source-reviewed, not compiler-exported",
            "text": "\n".join(lines[start - 1:end])[first - 1:]}


def census(label, meta):
    package, top = FIXTURES[label]
    path = f"experiments/hardware/fixtures/{package}.bsv"
    definitions = []
    for name, first, last, storage, methods, rules, children in INVENTORY[label]:
        row = {"definitionId": f"{package}::{name}", "name": name, "source": source_range(path, first, last)}
        for kind, entries in [("storage", storage), ("methods", methods), ("rules", rules), ("children", children)]:
            row[kind] = [{"name": entry[0], "definitionId": f"{package}::{name}.{entry[0]}",
                          "source": source_range(path, entry[1], entry[-1])} for entry in entries]
        definitions.append(row)
    # The public hierarchy gives occurrence identity and points, not full ranges.
    occurrences = []
    for node in meta["hierarchy"]:
        if node["Node"] == "Rule":
            continue
        if node["parent"] == 0:
            definition = next(d for d in definitions if d["name"] == top)
            source = definition["source"]
            identity = definition["definitionId"]
        else:
            _, line, _ = node["position"].split()
            matches = [(d, item) for d in definitions for kind in ("storage", "children") for item in d[kind]
                       if item["source"]["start"]["line1"] == int(line)]
            assert len(matches) == 1, node
            definition, item = matches[0]
            source, identity = item["source"], item["definitionId"]
        occurrences.append({"occurrence": "/".join([top] + node["BSVPath"].split()),
                            "sourceDeclarationId": identity, "source": source, "compiler": node,
                            "classification": {"Primitive": "storage-inlined-into-rtl", "Instance": "source-module-boundary-inlined", "Synthesized": "retained-rtl-module-boundary"}[node["Node"]]})
    expressions = []
    lines = (ROOT / path).read_text().splitlines()
    for line, expression in EXPRESSIONS[label]:
        assert lines[line - 1].count(expression) == 1
        start = lines[line - 1].index(expression) + 1
        source = source_range(path, line, line)
        source.update(start={"line1": line, "column1": start},
                      endExclusive={"line1": line, "column1": start + len(expression)}, text=expression)
        owner = next(d for d in definitions if d["source"]["start"]["line1"] <= line <= d["source"]["endExclusive"]["line1"])
        expressions.append({"definitionId": owner["definitionId"] + f":behavior-expression:{line}:{start}",
                            "source": source, "exactRtlOriginSet": None})
    return {"fixture": label, "sourceDefinitions": definitions, "occurrences": occurrences,
            "behaviorExpressionSites": expressions,
            "ownership": "Evidence census only; peer Source/Semantic adapter owns application source identity. Compiler fields and source-derived ranges remain separate."}


def vectors(module):
    for name, port in module["ports"].items():
        yield ("port", name), port["bits"]
    for name, net in module["netnames"].items():
        yield ("alias", name), net["bits"]
    for name, cell in module["cells"].items():
        for pin, bits in cell["connections"].items():
            yield ("cell", name, pin), bits


def connectivity(modules, top):
    """Only formal/actual scalar pairs may join occurrence namespaces.

    Leaf-cell input/output connectivity is NEVER unioned. Each string literal
    has a separate endpoint site, even if another site has the same value.
    """
    parent, occurrences, bindings, constants, opens = {}, [], [], [], []

    def add(key):
        parent.setdefault(key, key)
        return key

    def root(key):
        while parent[key] != key:
            parent[key] = parent[parent[key]]
            key = parent[key]
        return key

    def scalar(occurrence, site, index, value):
        if type(value) is int:
            return add((occurrence, "bit", value))
        assert value in ("0", "1", "x", "z")
        return add((occurrence, "literal", *site, index, value))

    def visit(name, occurrence, ancestors):
        assert name not in ancestors, "Recursive hierarchy"
        module = modules[name]
        occurrences.append({"occurrence": occurrence, "module": name})
        for site, bits in vectors(module):
            for i, bit in enumerate(bits):
                key = scalar(occurrence, site, i, bit)
                if type(bit) is str:
                    constants.append(key)
        for cellname, cell in module["cells"].items():
            if cell["type"] not in modules:
                continue
            child = occurrence + "/" + cellname
            visit(cell["type"], child, ancestors + [name])
            formal_ports = modules[cell["type"]]["ports"]
            assert set(cell["connections"]) == set(formal_ports)
            for pin, actual in cell["connections"].items():
                formal = formal_ports[pin]
                assert formal["direction"] == cell["port_directions"][pin]
                if not actual:
                    opens.append({"occurrence": child, "port": pin, "formalBits": formal["bits"]})
                    continue
                assert len(actual) == len(formal["bits"])
                for index, (a, f) in enumerate(zip(actual, formal["bits"])):
                    left = scalar(occurrence, ("cell", cellname, pin), index, a)
                    right = scalar(child, ("port", pin), index, f)
                    parent[root(right)] = root(left)
                    bindings.append({"parent": occurrence, "child": child, "pin": pin,
                                     "indexLsb0": index, "actual": a, "formal": f,
                                     "left": left, "right": right})
    visit(top, top, [])
    groups = defaultdict(list)
    for key in parent:
        groups[root(key)].append(key)
    groups = sorted((sorted(values, key=str) for values in groups.values()), key=str)
    integer_groups = [g for g in groups if any(k[1] == "bit" for k in g)]
    counts = {"implementationOccurrences": len(occurrences),
              "occurrenceLocalIntegerBits": sum(k[1] == "bit" for k in parent),
              "hierarchyScalarBindings": len(bindings),
              "integerIntegerBindings": sum(type(b["actual"]) is int and type(b["formal"]) is int for b in bindings),
              "literalIntegerBindings": sum((type(b["actual"]) is int) != (type(b["formal"]) is int) for b in bindings),
              "normalizedIntegerConnectivityComponents": len(integer_groups),
              "integerComponentsWithLiteralBinding": sum(any(k[1] == "literal" for k in g) for g in integer_groups),
              "literalEndpointSites": len(constants), "openHierarchyPins": len(opens),
              "componentsIncludingSiteLocalLiterals": len(groups),
              "definitionNetnameAliases": sum(len(m["netnames"]) for m in modules.values()),
              "occurrenceNetnameAliases": sum(len(modules[o["module"]]["netnames"]) for o in occurrences),
              "definitionLocalIntegerBits": sum(len({b for _, bits in vectors(m) for b in bits if type(b) is int}) for m in modules.values())}
    return {"counts": counts, "occurrences": occurrences, "boundaryBindings": bindings,
            "openPins": opens, "components": groups,
            "policy": "Components contain raw integer identities and site-local literals only. Union edges are exclusively raw hierarchy port/formal bindings, never cell input/output unions. Aliases are not distinct nets. Constants have no global driver identity."}


def method_contracts(label, meta, modules):
    records = []
    by_name = {m["name"]: m for m in meta["modules"]}
    for name, module in modules.items():
        original = module["attributes"].get("hdlname", name)
        bsv = by_name[original]
        for method in bsv["methods"]:
            roles = [("argument", a["port"], a["size"]) for a in method["args"]]
            roles += [(role, method[role], None) for role in ("enable", "ready", "result") if method[role]]
            for role, port, width in roles:
                rtl_port = module["ports"][port]
                assert rtl_port["direction"] == ("input" if role in ("argument", "enable") else "output")
                if width is not None:
                    assert len(rtl_port["bits"]) == width
                records.append({"fixture": label, "module": name, "compilerDefinition": original,
                                "method": method["name"], "role": role, "port": port, **rtl_port,
                                "status": "VERIFIED-method-port-contract", "exactLeafCause": False})
    return records


def representative(meta, modules, inventory, normalized):
    stage = next(m for m in meta["modules"] if m["name"] == "mkStage")
    top = next(m for m in meta["modules"] if m["name"] == "mkConnected")
    instance = next(i for i in top["instances"] if i["name"] == "left")
    method = next(m for m in stage["methods"] if m["name"] == "get")
    assert instance["definition"] == "mkStage" and ["get", "get"] in instance["mports"]
    assert method["result"] == "get" and method["enable"] == ""
    source_def = next(d for d in inventory["sourceDefinitions"] if d["name"] == "mkStage")
    source_method = next(m for m in source_def["methods"] if m["name"] == "get")
    parent = modules["mkConnected"]
    child = modules["mkStage"]
    actual = parent["cells"]["left"]["connections"][method["result"]]
    formal = child["ports"][method["result"]]["bits"]
    assert actual == parent["netnames"]["left$get"]["bits"]
    assert len(actual) == len(formal) == 8
    rtl_path = "docs/hardware/evidence/toolchain/A/rtl/mkConnected.v"
    rtl = (ROOT / rtl_path).read_text()
    assert ".get(left$get)" in rtl
    endpoints = [{"occurrence": "mkConnected", "cell": name, "pin": pin,
                  "direction": cell["port_directions"][pin], "bits": bits,
                  "generatedRtl": cell["attributes"]["src"]}
                 for name, cell in parent["cells"].items() if cell["type"] not in modules
                 for pin, bits in cell["connections"].items() if bits == actual]
    assert len(endpoints) == 1 and endpoints[0]["pin"] == "A"
    # Also expose the real Q endpoint without calling this a source-state cause.
    q = [{"occurrence": "mkConnected/left", "cell": name, "pin": pin, "bits": bits}
         for name, cell in child["cells"].items() for pin, bits in cell["connections"].items()
         if cell["port_directions"][pin] == "output" and bits == formal]
    assert len(q) == 1
    components = [g for g in normalized["components"] if ("mkConnected", "bit", actual[0]) in g]
    assert len(components) == 1 and ("mkConnected/left", "bit", formal[0]) in components[0]
    return {"id": "A:mkConnected/left:get:result", "status": "VERIFIED",
            "kind": "source-method/compiler-port/rtl-instance/netlist-pin-connectivity",
            "sourceMethod": source_method, "sourceInstance": instance,
            "compilerMethod": method, "occurrence": "mkConnected/left",
            "generatedRtlInstance": source_range(rtl_path, 75, 81),
            "generatedRtlMethodPort": source_range("docs/hardware/evidence/toolchain/A/rtl/mkStage.v", 52, 52),
            "artifact": fingerprint(OLD / "A/design.json"),
            "metadata": fingerprint(OUT / "A/bluetcl.json"),
            "formalBitsLsbFirst": formal, "actualBitsLsbFirst": actual,
            "parentAlias": "left$get", "parentLeafEndpoints": endpoints,
            "childOutputEndpoint": q[0], "scalar0Component": components[0],
            "sourceInvocationContext": source_range("experiments/hardware/fixtures/Connected.bsv", 24, 24),
            "exactInvocationToWire": False, "exactLeafCellCause": False,
            "caveat": "Source-reviewed method range plus compiler contract proves method-port connectivity. The destination add and Q endpoint are real pin contacts, not claims of exact source expression/register cause. No leaf origin is assigned."}


def build():
    preserve()
    population_run = subprocess.run(["node", "experiments/hardware/bsv-evidence/source-populations.js"],
                                    cwd=ROOT, text=True, capture_output=True, timeout=30, check=True)
    populations = json.loads(population_run.stdout)
    save(OUT / "source-populations.json", populations)
    population_by_fixture = {p["fixture"]: p for p in populations["fixtures"]}
    inventories, connectivity_rows, contracts, category_rows = [], {}, [], []
    for label, (_, top) in FIXTURES.items():
        meta = load(OUT / label / "bluetcl.json")
        modules = load(OLD / label / "design.json")["modules"]
        inventory = census(label, meta)
        population = population_by_fixture[label]
        source_paths = {o["path"].replace(".", "/") for o in population["occurrences"]}
        compiler_paths = {o["occurrence"] for o in inventory["occurrences"] if o["compiler"]["Node"] != "Primitive"}
        assert source_paths == compiler_paths, label
        inventories.append(inventory)
        graph = connectivity(modules, top)
        connectivity_rows[label] = graph["counts"]
        save(OUT / label / "connectivity.json", graph)
        bindings = method_contracts(label, meta, modules)
        contracts.extend(bindings)
        methods = [m for d in inventory["sourceDefinitions"] for m in d["methods"]]
        rules = [r for d in inventory["sourceDefinitions"] for r in d["rules"]]
        primitives = [n for n in meta["hierarchy"] if n["Node"] == "Primitive"]
        children = [n for n in meta["hierarchy"] if n["Node"] in ("Instance", "Synthesized") and n["parent"] != 0]
        cells = [c for m in modules.values() for c in m["cells"].values()]
        nets = [n for m in modules.values() for n in m["netnames"].values()]
        category_rows.append({"fixture": label, **population["counts"], "nonrootModuleInstancesSource": len(children),
                              "retainedModuleInstances": sum(n["Node"] == "Synthesized" for n in children),
                              "inlinedModuleInstances": sum(n["Node"] == "Instance" for n in children),
                              "lexicalMethodDefinitionsSource": len(methods), "lexicalRuleDefinitionsSource": len(rules),
                              "compilerMethodEntries": sum(len(m["methods"]) for m in meta["modules"]),
                              "compilerExactMethodRanges": 0, "compilerRulePoints": sum(len(m["rules"]) for m in meta["modules"]),
                              "storageOccurrencesSource": len(primitives), "methodGeneratedPortContracts": len(bindings),
                              "implementationDefinitionPorts": sum(len(m["ports"]) for m in modules.values()),
                              "cells": len(cells), "cellsWithGeneratedRtlSrc": sum(bool(c["attributes"].get("src")) for c in cells),
                              "leafCells": sum(c["type"] not in modules for c in cells), "exactLeafCellCauses": 0,
                              "netnameAliases": len(nets), "netnamesWithGeneratedRtlSrc": sum(bool(n["attributes"].get("src")) for n in nets),
                              "exactNetnameCauses": 0, "exactStateRtlOrigins": 0,
                              "behaviorExpressionSites": len(inventory["behaviorExpressionSites"]), "exactExpressionRtlOrigins": 0})
        if label == "A":
            chain = representative(meta, modules, inventory, graph)
            save(OUT / "representative-chain.json", chain)
    save(OUT / "source-inventory.json", inventories)
    save(OUT / "method-port-contracts.json", contracts)
    save(OUT / "connectivity-counts.json", {"fixtures": connectivity_rows,
         "total": {k: sum(c[k] for c in connectivity_rows.values()) for k in connectivity_rows["A"]}})
    totals = {k: sum(r[k] for r in category_rows) for k in category_rows[0] if k != "fixture"}
    save(OUT / "category-coverage.json", {"fixtures": category_rows, "totals": totals,
         "completeChains": {"verified": 1, "denominator": 1, "denominatorKind": "explicitly audited representative method-result vector; not exhaustive paths", "exactLeafCauseChains": 0},
         "status": "Partial compiler provenance; source census and port connectivity verified, state/expression cause exporter absent"})
    preserve()
    print(json.dumps({"categories": totals, "connectivity": load(OUT / "connectivity-counts.json")["total"], "representativeChain": load(OUT / "representative-chain.json")["id"]}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    build()
