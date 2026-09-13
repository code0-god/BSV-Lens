#!/usr/bin/env python3
"""Explicit, source-only download of pinned upstream compiler research excerpts."""
import hashlib
import json
from pathlib import Path
import urllib.request

root = Path(__file__).resolve().parents[3]
commit = "9bd39e6f3d54d314a94ce30339a224bb283cbade"
work = root / ".build/hardware/toolchain/compiler-source"
work.mkdir(parents=True, exist_ok=True)
regions = {"bluetcl.hs": [(1438, 1496), (1626, 1654)],
           "ASyntax.hs": [(716, 749), (1221, 1238)],
           "AVerilog.hs": [(885, 929)],
           "AVerilogUtil.hs": [(595, 631), (648, 682)],
           "Verilog.hs": [(731, 763), (799, 820), (839, 850)]}
rows = []
for name, ranges in regions.items():
    url = f"https://raw.githubusercontent.com/B-Lang-org/bsc/{commit}/src/comp/{name}"
    with urllib.request.urlopen(url, timeout=45) as response:
        data = response.read()
    (work / name).write_bytes(data)
    lines = data.decode().splitlines()
    rows.append({"file": name, "url": url, "sha256": hashlib.sha256(data).hexdigest(),
                 "excerpts": [{"firstLine1": lo, "lastLine1": hi,
                               "text": "\n".join(lines[lo - 1:hi])} for lo, hi in ranges]})
(root / "docs/hardware/evidence/toolchain/compiler-source-study.json").write_text(json.dumps({"commit": commit, "license": "BSC BSD-3-Clause; see bsc-COPYING.txt and bsc-LICENSE.txt.txt", "files": rows}, indent=2) + "\n")
print("Saved pinned source hashes and excerpts; no compiler source was edited or compiled.")
