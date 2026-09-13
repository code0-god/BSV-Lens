#!/usr/bin/env python3
"""Run with the isolated reader's Python to inventory its actual distribution."""
import hashlib
import importlib.metadata as metadata
import json
from pathlib import Path
import platform
import shutil
import sys

root = Path(__file__).resolve().parents[3]
out = root / "docs/hardware/evidence/toolchain"
rows = []
for name in ("yowasp-yosys", "yowasp-runtime", "wasmtime", "click", "platformdirs"):
    dist = metadata.distribution(name)
    files = []
    entries = dist.files
    if entries is None:
        raise RuntimeError(f"Distribution has no file inventory: {name}")
    for entry in entries:
        path = Path(str(dist.locate_file(entry)))
        if path.is_file() and path.suffix != ".pyc":
            files.append({"path": str(entry), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size})
            if "/licenses/" in str(entry):
                shutil.copyfile(path, out / (name + "-" + path.name + ".txt"))
    rows.append({"name": name, "version": dist.version,
                 "license": dist.metadata.get("License-Expression"), "files": files,
                 "requires": dist.requires, "projectUrls": dist.metadata.get_all("Project-URL"),
                 "description": dist.metadata.get("Description")})
(out / "reader-installation-inventory.json").write_text(json.dumps({"python": sys.version, "pythonExecutable": sys.executable, "platform": platform.platform(), "packages": rows}, indent=2) + "\n")
print("Inventoried five pinned reader/runtime distributions and copied their installed license files.")
