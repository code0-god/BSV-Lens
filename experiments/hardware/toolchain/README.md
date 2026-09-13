# G1 toolchain experiment

These scripts compile test-only BSV, read real generated RTL, and emit an explicitly experimental metadata sidecar. They do not modify production code, the installed compiler, PATH, or external HDL trees.

Run from the repository root on the measured macOS host:

```sh
# Only when the isolated environment is absent; explicit opt-in download.
uv venv .build/hardware/toolchain/tools/venv
uv pip install --python .build/hardware/toolchain/tools/venv/bin/python -r experiments/hardware/toolchain/requirements.txt

# Real compile, Bluetcl query, Yosys import, dependency inventory, coverage.
python3 experiments/hardware/toolchain/run.py
.build/hardware/toolchain/tools/venv/bin/python experiments/hardware/toolchain/tool-info.py
python3 experiments/hardware/toolchain/probes.py

# Optional explicit source-only download for the pinned compiler study.
python3 experiments/hardware/toolchain/compiler-study.py

# Refresh manifest after optional evidence generation, then verify without tools.
python3 experiments/hardware/toolchain/run.py --summarize-only
python3 experiments/hardware/toolchain/run.py --verify-evidence
```

`run.py` accepts `--bsc`, `--bluetcl`, and `--yosys` executable paths. It is an experiment harness, not a security-hardened extension build provider. Its installation inventory uses macOS `otool`, `sw_vers`, and the measured Homebrew runtime roots; other platforms require a separate verified inventory adapter. No auto-install occurs in the harness. Reader cache is explicitly under `.build/hardware/toolchain/tools/cache`.

`docs/hardware/evidence/toolchain/{A,B,C}/design.json` is raw Yosys JSON. `design.il` is the same post-process-lowering stage, `pre-proc.il` retains behavioral processes. `rtl/` is unmodified BSC output. `recipe.json` captures exact argv and pass lists. The final stage uses `proc -noopt`; historical `import-initial-proc.txt` records discovery of plain `proc`'s implicit `opt_expr` pass and is not the baseline recipe.

`metadata.tcl` captures raw query strings and normalized records in `bluetcl.json`. `correspondence.json` is a proposed G1 sidecar, not a compiler-standard format. It contains verified fixture instance declarations and method-port contracts with source context; it intentionally supplies no exact BSV expression/register/scheduler-cell mapping. `coverage.json` keeps full denominators.

Byte-identical recompilation is not promised: BSC embeds generation timestamps, the recorded snapshot hashes identify exact captured artifacts, and compiler build paths appear in Yosys source attributes and generated IDs. The retained missing-`.ba` failure and debug build are separate experiments, not importer inputs. See `docs/hardware/FEASIBILITY.md` for support boundaries and provenance research.
