# Isolated G3-B execution: blocked

Run `st_01a07a97` acquired the exact BSC/Yices sources, provisioned an isolated
Linux/arm64 dependency image, and actually attempted the unmodified optimized
BSC build. Docker killed the build at its enforced 5 GiB memory limit. This is
an execution result, not a second preflight or a completed origin exporter.

## Offline audit

From the repository root, with Python 3.9+ and no compiler, Docker, network,
node_modules, or installed reader:

```sh
python3 experiments/hardware/g3-origin/verify.py
python3 -m unittest discover -s experiments/hardware/g3-origin -p 'test_*.py' -v
```

The audit verifies file hashes, pinned acquisition, checkpoint binding,
prerequisite completion, container resource settings, the actual start/oom/die
sequence and exit, cleanup, and the absence of origin claims. Six tests include
hash-valid contradictory receipts and false origin/coverage claims. This does
not rerun BSC or verify the unbuilt compiler patch.

Evidence: `docs/hardware/evidence/g3-origin/RESULT.json`, `COVERAGE.json`,
`INVENTORY.json`, complete command logs/receipts, copied source inputs, and an
explicitly unbuilt draft patch with its upstream patch inputs. The full checkout,
partial compiler build and dependency caches remain under
`.build/hardware/g3-origin/run-st_01a07a97-01/`, not in the shipped evidence.

## Actual live recipe and boundary

The authoritative executed argv, container args, timestamps, exits and output
hashes are in the receipts. `provision.sh` is the first attempted provisioning
script, not a recipe claimed to pass unchanged. Its first container start failed
because the Docker local logging driver rejects its default compression with
`max-file=1`; recreation added `--log-opt compress=false`. Signed APT installation
then succeeded, but Cabal 3.4.1.0 rejected Hackage's current root using its old
bootstrap keys. `bootstrap-current-root.sh` completed secure provisioning after
matching the version-8 root bytes from Hackage and the upstream
`haskell-infra/hackage-root-keys` repository, maintaining threshold 3. No secure
verification or expiry check was disabled. Actual resolved index state:
`2026-09-07T04:49:09Z`; strict-concurrency `0.2.4.3`; GHC `9.0.2`.
Resolved Debian/package identities and hashes are in `provision-02.log` and
`provision-03.log`. The final task-owned image is
`sha256:07896abd5a50fab0f7274a0e4a9b994276c6d286c45d9fd91a34978795191516`
(812,109,662 bytes as recorded by Docker). Image digests identify the actual
local build environment; recreating it against future APT indexes is a new
environment, not automatically a byte-identical replay.

Acquisition used:

```sh
git clone --no-checkout https://github.com/B-Lang-org/bsc.git "$RUN/source/bsc"
git -C "$RUN/source/bsc" checkout --detach 9bd39e6f3d54d314a94ce30339a224bb283cbade
git -C "$RUN/source/bsc" submodule update --init --recursive
```

The acquired Yices submodule is
`f705557b7d33d866eb1b47b5471f97189eb31cc4`. Five previously cached source-file
hashes matched this checkout. Two separate source copies were made before any
instrumentation edit; only the `instrumented` copy received the draft patch.
The baseline directory was mounted at `/work` and built with:

```sh
make -j2 GHCJOBS=2 PREFIX=/work/inst install-src
```

The actual container used four CPUs, 5 GiB memory with no additional swap,
512 PIDs, no network, a read-only root, dropped capabilities, no-new-privileges,
256 MiB `/tmp` and 16 MiB `/run` tmpfs. GHC retained upstream `-O2` and
`+RTS -M4G -A128m -RTS`. Both STP and Yices were enabled. The host monitor and
inner timeout both bounded the build at 5,400 seconds. Task directory storage
was sampled against 4 GiB, not enforced by an aggregate filesystem quota.
Command output was bounded at 16 MiB; the complete failed build log is 723,360
bytes. Dependency image size was checked before/after provisioning, not under
a proved hard transient image-layer quota. No APFS image, global mount or
Docker-wide setting change was used.

`monitor.py` captures merged stdout/stderr with exact argv, exit, timing,
resource samples, output digest, and Docker lifecycle events. Event subscription
starts before attach; `--since` makes a subscription race replayable. No fixed
sleep is used as test/completion evidence. Ten-second sampling belongs only to
the resource monitor and is not a proof of an exact resource peak.

At 251.177 seconds, Docker had recorded `oom`, GHC exited with make error 137,
and outer make/container exited 2 with `OOMKilled=true`. The last compilation
line was `Parser.BSV.CVParser` (138/227). The highest sampled usage was
`4.983GiB / 5GiB`; it is not a continuously measured maximum. Highest sampled
PIDs: 19. Highest sampled baseline directory allocation: 525,418,496 bytes.
The recorded OOM abort rule ended this run. No larger-memory, unoptimized or
silent retry was made. The stopped owned container was inspected and removed;
the task-owned dependency images were retained as replay caches.

A new attempt needs a separately recorded memory-bounded strategy that first
builds the unmodified optimized compiler inside the same ceiling. Serial GHC
compilation and a lower RTS heap cap are possible changes to evaluate, not
verified remedies and not executed here. No conclusion is drawn that a larger
Docker-wide RAM setting is necessary.

## Draft instrumentation: not a delivered exporter

`patches/bsc-origin-DRAFT.patch` is the actual 14-file source draft authored
while the baseline was compiling. It adds an equality-neutral Id metadata field,
experimental `.bo`/`.ba` format tags and sharing-key transport; parser binding/RHS
mint sites; selected typecheck, IConv, evaluator, CSE and state observations; and
candidate operator/singleton-process attributes. It has not been built or run.
Haskell diagnostics were attempted on all 14 files but unavailable because HLS
is absent; no host installation was performed. No syntax/type/PASS claim applies
to the draft.

The draft's diagnostic event format is not an accepted sidecar/ledger schema:
it still lacks complete stage-local object identities, all actual transformation
branches and completeness accounting, independently validated full declaration/
behavior/occurrence spans, and a closed compiler event digest. Source capture
and parser tokens have not been observed at runtime. Candidate singleton process
attributes and operator attributes have not been exercised by Yosys. No missing
name is interpreted as removed, and no source origin is inferred from name,
type, enclosing source ranges, or Q connectivity.

Before origin acceptance, this draft requires actual compilation, early-token
inspection, correction of any unsupported propagation, full supported lineage,
noninterference on paired functional RTL and whole ordered netlist structure,
and independently checked reader creation/transport. The historical chosen
reader stage remains `read_verilog; hierarchy -check; proc -noopt`; the reader
was not invoked in this failed run. Extra flags are not relabeled historical.

No product files, original A/B/C inputs/evidence, installed BSC/Bluetcl binaries,
or original ZIPs were modified by this experiment. The protected-input receipt
compares 108 original source/evidence/binary files, with zero changed hashes;
it does not claim to audit concurrently edited parent product files or the
pre-existing ZIP companion preservation contract. No commit/push/release or G4
work was performed.
