# G3-B run02: serial lower-memory retry, blocked

Run02 is separate from preserved run01 and uses only
`docs/hardware/evidence/g3-origin-retry/` for shipped evidence. It did not
produce a BSC binary, origin sidecar, accepted ledger, generated RTL/netlist,
or verified storage/RHS contributor. The historical origin counts are unchanged.

## Executed strategy

The input manifest hashes the **amended** G3-A checkpoint document:
`3c4305803cea94fb3e065778dbd2e3440464fd86502b30aeb7938ad0c7ee911c`.
The older machine checkpoint JSON is separately identified and is not mislabeled
as a new 70-test receipt. The parent reapproved 70 tests and compiler-free
extraction; this child binds that checkpoint rather than claiming to rerun it.

The exact acquired BSC pin and Yices submodule were copied into NEW baseline
and instrumented trees. The existing isolated dependency image was reused:
`sha256:07896abd5a50fab0f7274a0e4a9b994276c6d286c45d9fd91a34978795191516`.
No host install, installed compiler replacement, package download or Docker-wide
setting change was performed in run02.

One materially different resource strategy was attempted:

```sh
make -j1 GHCJOBS=1 GHCOPTLEVEL=-O2   'GHCRTSFLAGS=+RTS -M3500m -A32m -s -RTS'   PREFIX=/work/inst install-src
```

Four CPUs, 5 GiB memory/no additional swap, 512 PIDs and the original 90-minute
per-build wall deadline remained enforced. Build-directory allocation was
monitored against 4 GiB, not a filesystem quota. The complete command streams
were bounded at 16 MiB. GHC allocation/heap/concurrency changed; BSC optimization
and generation policy did not. `-s` requested actual GHC runtime statistics.

### First failure: stock source compatibility, not OOM

After 266.766 seconds, GHC 9.0.2 rejected two constraint synonyms at
`ISyntaxSubst.hs:58-59`, requiring `FlexibleContexts`. The source declares
`ConstraintKinds` but omits that extension. The baseline source remained
byte-identical to the pin. Kernel peak was 2,508,308,480 bytes, with zero OOMs.
The GHC statistics for this failed invocation reported 577,825,120 bytes maximum
sampled residency and 1466 MiB total memory in use; these are **not** measurements
of the later killed invocation.

A diagnosed compatibility continuation set the container-local environment
`GHC=ghc -XFlexibleContexts`, symmetrically specified for both prospective builds.
This enables the source's existing language construct; no type error/warning was
suppressed and no source code or optimization policy was changed. The emitted
GHC command retained upstream `-Wtabs`, `-fmax-pmcheck-models=800`, `-Wall` and
`-O2`. The initial failure was kept intact. The continuation used only the
remaining time of the original 90-minute build window, not a reset deadline.

### Final failure: genuine cgroup OOM under serial compilation

The compatibility continuation reached the unmodified
`Parser.BSV.CVParser` compilation, module 138/227, and was killed after
238.381 seconds. The kernel's final counters, captured before container exit:

```text
memory.max  5368709120
memory.peak 5368709120
memory.events: max 49, oom 1, oom_kill 1, oom_group_kill 0
pids.max 512
```

Docker also recorded `start -> oom -> die`, `OOMKilled=true`, and container
exit 2. GHC's make error was 137. Highest periodic Docker sample was only
3.792 GiB; the exact cgroup high-water counter is stronger evidence and is
reported separately. GHC's configured heap cap was 3,670,016,000 bytes and its
allocation area 33,554,432 bytes. **Actual maximum GHC heap is unknown:** SIGKILL
prevented final RTS statistics. This was not a reported GHC heap-exhaustion
exception. Cgroup memory covers more than the GHC heap.

The build also reported that this GHC native code generator does not support
the target platform and it was using LLVM. Exact GHC settings are shipped.
The two run02 command logs, failure/source snippets and relevant complete pinned
source files are included. No memory strategy was tried after this OOM.

## Minimal remaining tool/resource requirement

A lower-concurrency setting alone has now been tested and did not suffice for
this GHC 9.0.2 / pinned-parser / `-O2` build. This does **not** prove that every
compiler or allocation strategy needs more than 5 GiB, nor establish an exact
successful RAM threshold. The preferred next isolated tool experiment would use
upstream-recommended GHC 9.6.7 and matching dependencies within the existing
ceiling, before considering a Docker-wide memory increase. Its success is
unverified. No third strategy, new dependency toolchain or global change was
performed in this authorized single retry.

The actual resumed command can be inspected in
`receipts/baseline-build-compatibility-create.json`; the initial command is in
`receipts/baseline-build.json` under the captured container configuration.
`retry-stage.py` is the author-only executable stage harness. It never performs
acquisition or automatic retries and refuses to overwrite a receipt. An explicit
continuation keeps the initial build's deadline. `monitor.py` remains unchanged
from run01; the stage-harness change history is shipped in `history/`.

## Origin scope and draft history

The run01 14-file draft remains unchanged and unverified. A separate run02
18-file draft adds explicit parser/typecheck observations, compiler completion
markers, and source hashing/full logical paths in candidate tokens. The hashing
call is constant `/usr/bin/sha256sum` inside the isolated author compiler, not a
workspace command. It is **unbuilt**, was never invoked and is not a trusted
provider, actual sidecar schema, source-span proof or transformation ledger.

Per-stage object tuples, actual occurrence/parameter scope and complete lineage
still require runtime instrumentation and independent validation. Neither a
Debug.Trace line nor an output attribute would establish a complete origin set.
No attribute transport through Yosys was exercised. The existing reader was only
invoked for version/help using its absolute path and a NEW cache: actual Yosys
0.68 / 38e001a6f. Historical `read_verilog; hierarchy; proc -noopt` remains the
planned stage, not an executed RTL import in run02.

## Offline verification and preservation

```sh
python3 -B experiments/hardware/g3-origin/retry-verify.py
python3 -B experiments/hardware/g3-origin/retry-test.py -v
```

These need Python 3.9+, not Docker, GHC, BSC, Yosys, network or node_modules.
They audit the immutable captured run result and reject changed logs, hash-valid
false origin claims, wrong concurrency, invented memory values and checkpoint
swaps. They do not execute the drafted exporter or prove source origins.
The original run01 checker and its schema are unchanged.

The preservation receipt checked 170 run01 evidence/harness records and 108
original source/evidence/installed-binary records, all unchanged. Only the two
child-generated `.pyc` files requested for cleanup were removed; `-B` and
`PYTHONDONTWRITEBYTECODE` prevent new source-tree caches. The stopped run02
container was inspected and removed; user containers and existing images were
not modified. Full checkouts, partial object files and reader caches stay in
`.build`, outside shipped evidence. No product code, UI, G4, commit/push or
release work was performed by this child.
