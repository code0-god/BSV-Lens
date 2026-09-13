#!/usr/bin/env python3
"""Shipped-bundle checks using Python/Node only; no compiler replay or companions."""
import copy
from collections import defaultdict
import json
import re
import subprocess
import unittest
from bundle import FIXTURES, ROOT, OUT, OLD, connectivity, load, method_contracts, census, representative
from capture import fingerprint


def independent_components(modules, top):
    """Separate raw reader and BFS, not the bundle's DSU or emitted edge list."""
    graph = defaultdict(set)

    def node(occ, site, index, value):
        key = (occ, "bit", value) if type(value) is int else (occ, "literal", *site, index, value)
        graph[key]
        return key

    def walk(module_name, occ):
        mod = modules[module_name]
        for kind, collection in (("port", mod["ports"]), ("alias", mod["netnames"])):
            for name, item in collection.items():
                for i, value in enumerate(item["bits"]):
                    node(occ, (kind, name), i, value)
        for name, cell in mod["cells"].items():
            for pin, bits in cell["connections"].items():
                for i, value in enumerate(bits):
                    node(occ, ("cell", name, pin), i, value)
            if cell["type"] in modules:
                child = occ + "/" + name
                walk(cell["type"], child)
                for pin, formal in modules[cell["type"]]["ports"].items():
                    actual = cell["connections"][pin]
                    if not actual:
                        continue
                    assert len(actual) == len(formal["bits"])
                    for i in range(len(actual)):
                        a = node(occ, ("cell", name, pin), i, actual[i])
                        f = node(child, ("port", pin), i, formal["bits"][i])
                        graph[a].add(f)
                        graph[f].add(a)
    walk(top, top)
    seen, result = set(), set()
    for start in graph:
        if start in seen:
            continue
        todo, group = [start], set()
        seen.add(start)
        while todo:
            key = todo.pop()
            group.add(key)
            for neighbor in graph[key] - seen:
                seen.add(neighbor)
                todo.append(neighbor)
        result.add(frozenset(group))
    return result


class EvidenceChecks(unittest.TestCase):
    def test_shipped_preservation_and_original_manifest(self):
        scope = load(OUT / "offline-inputs.json")
        self.assertEqual(fingerprint(OUT / "preserved-inputs.json"), scope["preservedManifest"])
        preserved = load(OUT / "preserved-inputs.json")["files"]
        companions = set(scope["authorCompanions"])
        self.assertEqual(companions, {item["path"] for item in preserved
                                     if item["path"].startswith((".build/hardware/toolchain/", "dist/"))})
        self.assertEqual(len(companions), 14)
        shipped = [item for item in preserved if item["path"] not in companions]
        self.assertEqual(len(shipped), 114)
        for item in shipped:
            self.assertEqual(fingerprint(ROOT / item["path"]), item)
        for item in load(OLD / "manifest.json")["files"]:
            self.assertEqual(fingerprint(ROOT / item["path"]), item)

    def test_shipped_bsv_evidence_hashes(self):
        for item in load(OUT / "offline-inputs.json")["files"]:
            self.assertEqual(fingerprint(ROOT / item["path"]), item)

    def test_captured_public_tool_outputs_match(self):
        for label in FIXTURES:
            self.assertEqual(load(OUT / label / "bluetcl.json"), load(OLD / label / "bluetcl.json"))
            self.assertEqual(load(OUT / label / "query-command.json")["exitCode"], 0)
            self.assertIn({"command": ["Bluetcl::version"], "result": "2026.01 9bd39e6f3"},
                          load(OUT / label / "supplemental.json")["records"])

    def test_independent_raw_binding_bfs(self):
        expected = {"A": (123, 85, 131), "B": (79, 79, 145), "C": (255, 175, 279)}
        for label, (_, top) in FIXTURES.items():
            modules = load(OLD / label / "design.json")["modules"]
            computed = independent_components(modules, top)
            saved = load(OUT / label / "connectivity.json")
            actual = {frozenset(tuple(k) for k in g) for g in saved["components"]}
            self.assertEqual(actual, computed)
            bits = sum(sum(k[1] == "bit" for k in g) for g in computed)
            integer_components = sum(any(k[1] == "bit" for k in g) for g in computed)
            self.assertEqual((bits, integer_components, len(computed)), expected[label])

    def test_aliases_constants_and_no_cell_union(self):
        graphs = {label: load(OUT / label / "connectivity.json") for label in FIXTURES}
        a_groups = {tuple(k): i for i, g in enumerate(graphs["A"]["components"]) for k in g}
        self.assertNotEqual(a_groups[("mkConnected", "bit", 21)], a_groups[("mkConnected", "bit", 29)])
        self.assertNotEqual(a_groups[("mkConnected/left", "bit", 21)], a_groups[("mkConnected/right", "bit", 21)])
        c_groups = graphs["C"]["components"]
        literal_groups = [g for g in c_groups if any(k[1] == "literal" for k in g)]
        self.assertEqual(len(literal_groups), 108)
        self.assertTrue(all(sum(k[1] == "literal" for k in g) == 1 for g in literal_groups))
        tied = [g for g in literal_groups if any(k[1] == "bit" for k in g)]
        self.assertEqual(len(tied), 4)
        self.assertEqual({k[-1] for g in tied for k in g if k[1] == "literal"}, {"0"})
        self.assertEqual(len(graphs["A"]["openPins"]), 4)

    def test_source_census_machine_ranges(self):
        for inventory in load(OUT / "source-inventory.json"):
            for definition in inventory["sourceDefinitions"]:
                text = definition["source"]["text"]
                module_match = re.search(r"module\s+(\w+)", text)
                assert module_match is not None
                self.assertEqual(module_match.group(1), definition["name"])
                method_names = re.findall(r"\bmethod\s+(?:Action|Bit#\([^)]*\))\s+(\w+)", text)
                self.assertEqual(method_names, [m["name"] for m in definition["methods"]])
                rule_names = re.findall(r"\brule\s+(\w+)", text)
                self.assertEqual(rule_names, [r["name"] for r in definition["rules"]])
                for source in [definition["source"]] + [v["source"] for kind in ("methods", "rules", "storage", "children") for v in definition[kind]]:
                    lines = (ROOT / source["path"]).read_text().splitlines()
                    start, end = source["start"], source["endExclusive"]
                    chunk = lines[start["line1"] - 1:end["line1"]]
                    chunk[-1] = chunk[-1][:end["column1"] - 1]
                    chunk[0] = chunk[0][start["column1"] - 1:]
                    self.assertEqual("\n".join(chunk), source["text"])
            for item in inventory["behaviorExpressionSites"]:
                source = item["source"]
                line = (ROOT / source["path"]).read_text().splitlines()[source["start"]["line1"] - 1]
                self.assertEqual(line[source["start"]["column1"] - 1:source["endExclusive"]["column1"] - 1], source["text"])
        a = load(OUT / "source-inventory.json")[0]
        left = next(d for d in a["sourceDefinitions"] if d["name"] == "mkStage")
        self.assertEqual([s["name"] for s in left["storage"]], ["state"])
        self.assertEqual(left["children"], [])
        self.assertEqual(left["rules"], [])

    def test_method_contracts_and_parameterized_inlined_cases(self):
        actual = []
        for label in FIXTURES:
            actual += method_contracts(label, load(OUT / label / "bluetcl.json"), load(OLD / label / "design.json")["modules"])
        self.assertEqual(actual, load(OUT / "method-port-contracts.json"))
        self.assertEqual(len(actual), 40)
        c = load(OLD / "C/design.json")["modules"]
        self.assertEqual([int(c[c["mkReuse"]["cells"][n]["type"]]["parameter_default_values"]["bias"], 2) for n in ("low", "high")], [3, 9])
        self.assertEqual([len(c[n]["ports"]["get"]["bits"]) for n in ("mkNarrow", "mkWide")], [8, 12])
        meta = load(OUT / "C/bluetcl.json")
        inline = [n for n in meta["hierarchy"] if n["Node"] == "Instance"]
        self.assertEqual([n["BSVPath"] for n in inline], ["narrow implementation", "wide implementation"])
        self.assertNotIn("mkWidth", c)

    def test_chain_and_negative_port_binding_mutation(self):
        meta = load(OUT / "A/bluetcl.json")
        modules = load(OLD / "A/design.json")["modules"]
        inventory = census("A", meta)
        chain = representative(meta, modules, inventory, connectivity(modules, "mkConnected"))
        self.assertEqual(json.loads(json.dumps(chain)), load(OUT / "representative-chain.json"))
        self.assertFalse(chain["exactLeafCellCause"])
        bad = copy.deepcopy(modules)
        bad["mkConnected"]["cells"]["left"]["connections"]["get"][0] = 29
        with self.assertRaises(AssertionError):
            representative(meta, bad, inventory, connectivity(bad, "mkConnected"))
        badmeta = copy.deepcopy(meta)
        next(m for m in badmeta["modules"] if m["name"] == "mkStage")["methods"][1]["result"] = "RDY_get"
        with self.assertRaises(AssertionError):
            representative(badmeta, modules, inventory, connectivity(modules, "mkConnected"))

    def test_existing_semantic_contextual_populations(self):
        result = subprocess.run(["node", "experiments/hardware/bsv-evidence/source-populations.js"],
                                cwd=ROOT, text=True, capture_output=True, timeout=30, check=True)
        populations = json.loads(result.stdout)
        self.assertEqual(populations, load(OUT / "source-populations.json"))
        expected = {"A": (3, 2, 6, 0, 6, 6), "B": (1, 2, 2, 3, 5, 2), "C": (7, 4, 10, 0, 10, 14)}
        keys = ("sourceModuleOccurrencesIncludingRoots", "contextualStorageOccurrences", "contextualMethodBodies",
                "contextualRuleBodies", "contextualBehaviors", "contextualMethodInterfaceContacts")
        for population in populations["fixtures"]:
            self.assertEqual(tuple(population["counts"][k] for k in keys), expected[population["fixture"]])
            if population["fixture"] == "C":
                wrappers = [o for o in population["occurrences"] if o["path"] in ("mkReuse.narrow", "mkReuse.wide")]
                self.assertEqual(len(wrappers), 2)
                for wrapper in wrappers:
                    self.assertEqual(wrapper["methodBodyIds"], [])
                    self.assertEqual(len(wrapper["methodContactIds"]), 2)
                inlined = [o for o in population["occurrences"] if o["definitionId"] == "def:Reuse:mkWidth"]
                self.assertEqual(len(inlined), 2)
                self.assertTrue(all(len(o["methodBodyIds"]) == 2 for o in inlined))

    def test_category_denominators(self):
        totals = load(OUT / "category-coverage.json")["totals"]
        self.assertEqual((totals["exactLeafCellCauses"], totals["leafCells"]), (0, 53))
        self.assertEqual((totals["exactNetnameCauses"], totals["netnameAliases"]), (0, 168))
        self.assertEqual(totals["behaviorExpressionSites"], 22)
        self.assertEqual(totals["storageOccurrencesSource"], 8)
        self.assertEqual(totals["lexicalMethodDefinitionsSource"], 12)
        self.assertEqual(totals["lexicalRuleDefinitionsSource"], 3)
        self.assertEqual(totals["nonrootModuleInstancesSource"], 8)
        self.assertEqual(totals["sourceModuleOccurrencesIncludingRoots"], 11)
        self.assertEqual(totals["contextualMethodBodies"], 18)
        self.assertEqual(totals["contextualRuleBodies"], 3)
        self.assertEqual(totals["contextualBehaviors"], 21)
        self.assertEqual(totals["contextualMethodInterfaceContacts"], 22)


if __name__ == "__main__":
    unittest.main(verbosity=2)
