# G3-B origin experiment

## Current result: supported contributor paths verified

The third strategy completed with GHC 9.6.7's AArch64 native backend.
The older planning and failed-build records below remain historical.
Current evidence lives in `evidence/g3-origin-ghc96/`; its `INVENTORY.json`
identifies the captured files, including complete command logs.

The resumed offline tests exposed Python set-order nondeterminism in the
unresolved-context list. Only this unordered enumeration was sorted; compiler
stages, operands and bit vectors keep their original order. The original reducer,
sidecar and execution identities are preserved byte-for-byte under
`history/reducer-before-order-fix/`. `history/reducer-change.json` records the
new reducer identity. Raw compiler/reader execution, binaries and patch did not
change; `originAdapterSha256` now identifies the rerun offline reducer.
Regression verification explicitly uses Python hash seeds 0, 1, 2 and 3.

Actual compiler-minted storage and RHS roots reach emitted RTL and real reader
leaf cells. This verifies **known contributors**, not complete origin sets:
six leaf definition objects out of 53 have accepted contributors; none has a
complete set. The product expands these to four A and four C occurrence cells.
All 168 definition aliases retain zero origin claims.
Historical 0/8, 0/22, 0/53 and 0/168 ledgers are unchanged.

| Input context | Actual result | Limit |
| --- | --- | --- |
| `mkConnected/left` and `right` | `state <- mkReg(0)` reaches `$procdff$10`; `value + 1` reaches the actual `$add`. | Distinct occurrence targets share definition-scoped lexical roots. |
| `mkReuse/narrow` and `wide` | Storage and RHS contributors reach actual 8-bit and 12-bit leaf objects. | No invented retained `implementation` child. |
| `mkControl` arithmetic | Tokens reach reader cells, but `aopt` changes operands without a supported branch event. | Partial; product returns no accepted origin claim. |
| `mkControl` storage | No unique attributed singleton emitted process. | Unresolved, not removed. |
| Biased 3/9 specializations | Parameters and copied tokens are captured. | Reader derivation lacks independent AST clone identity; partial. |
| Reset, enable, mux, sharing, merging and removal | No complete causal attribution is established. | No propagation from containment, net contact or missing names. |

### Actual transport and independent checks

The final patch mints source/hash/path/span tokens at parser reductions.
Binding-name, type conversion, elaboration and state events preserve their
identity before A-level conversion. Thirty-four compiler boundaries per
compiled definition record stage-local object tuples and ordered descriptors.
Changed descriptors require specific witnessed conversions; unsupported
rewrites break accepted transport. Read-only stages are not invented rewrites.

The emitter marks actual binary operators or supported singleton register
processes. The reader captures `read_verilog`, hierarchy and every one of the
11 `proc -noopt` subpasses. The storage check requires one positive-edge sync,
one update vector and matching clock/D/Q on the lowered `$dff`.
The operator check verifies operation, signedness, width and ordered operands.
Neither check uses nearby source text or same-net contact to infer origin.
See [actual schema](evidence/g3-origin-ghc96/ORIGIN_SCHEMA.md) for exact scope.

Independent Python reduction and product JavaScript validation consume the raw
compiler log, source, RTL, RTLIL and JSON. `origin-sidecar.json` is captured
experimental data, not a stock BSC format or cryptographic attestation.
Product authority is explicitly caller-approved instrumented capture, bound to
the compiler, patch, exporter, source and artifact identities.

Noninterference separately compares baseline, instrumented and no-emission
instrumented outputs. Functional RTL tokens match after excluding only the
generation timestamp and exact two-field origin attributes. Full structural
projection preserves ports, order, parameters, constants, integer bit IDs and
connectivity; 39/75/113 cell-plus-alias bijections are recorded for A/B/C.
No-emission JSON and expanded-proc JSON are entirely equal to their respective
references. This proves the measured noninterference scope, not origin meaning.

### Toolchain and replay

- BSC source: `9bd39e6f3d54d314a94ce30339a224bb283cbade`.
- Yices source: `f705557b7d33d866eb1b47b5471f97189eb31cc4`.
- Baseline BSC SHA-256: `fca222952f5b69df384f1aa079efc70fa57b8c2ba5b185ef53d34a9f9943807b`.
- Instrumented BSC SHA-256: `74a8004efdd032860e788dac3ff2d182a62bb3f9f2f79f07314d4774e85d94de`.
- Final patch SHA-256: `d15955aceb355d0e2e19322a62a2f7928166ff15beb87ec286c44bf83931df85`.
- Isolated image: `sha256:d94a69f27fec8d669fa1d14bbaccdcd3182e82e31aacd7d6e329a47de93aafe0`.

`TOOLCHAIN.json` is the earlier provisioning receipt; its historical
`baselineStatus` is superseded by `RESULT.json` and the final build/compile
receipts. `inputs/execution-identities.json` identifies the final binaries,
patch and Python adapters. The actual reader recipes and executable hashes
are under `results/*/{A,B,C}/recipe-*.json`.

Run captured verification from either shipped archive:

```sh
python3 -B experiments/hardware/g3-origin/ghc96-origin.py \
  --run docs/hardware/evidence/g3-origin-ghc96 \
  --verify docs/hardware/evidence/g3-origin-ghc96/results/origin-sidecar.json
python3 -B experiments/hardware/g3-origin/ghc96-test.py
node --no-global-search-paths experiments/hardware/g3/origin-query.js A mkConnected/left
node --no-global-search-paths experiments/hardware/g3/origin-query.js C mkReuse/wide
```

These commands execute no compiler. Actual earlier live execution is recorded
in `receipts/baseline-build-package-path.json`,
`instrumented-build-final-transport.json`, `baseline-compile.json`,
`instrumented-compile-final.json` and the reader receipts.

Live reproduction requires a separately staged task-owned run, the pinned BSC
and Yices source/dependencies, the recorded image or its provisioning recipe,
and the final patch at `patches/final-bsc-origin.patch`. The archive deliberately
does not contain tool installations. `provision.sh`, `ghc96-provision.sh` and
the input/receipt records describe acquisition; `ghc96-stage.py --help` and
`ghc96-reader.py --help` expose the actual build/smoke/compile/reader commands.
`ghc96-stage.py` requires prepared `inputs`, `baseline/bsc` and
`instrumented/bsc` trees; it is not a one-command bootstrap.
Existing receipts and captures refuse overwrite, so use a new run directory.
The recorded container name must be free before an author stage runs.

Both compiler builds used `-O2`, serial Make/GHC and
`+RTS -M3500m -A32m -s -RTS`; BSV options and synthesis boundaries were paired.
Hard limits were four CPUs, 5 GiB, 512 PIDs and 90 minutes per build.
Storage limits were monitored, not hard filesystem quotas.
Build/compile containers were removed after recorded exit. No installed host
compiler, PATH, Docker-wide limit, original source or baseline was replaced.

## Historical planning and failed attempts

Current record: two isolated baseline strategies failed with verified OOM.
A third isolated GHC-backend strategy is in progress. No storage,
RHS origin or noninterference success is implied by either failed attempt.
The final G3 report distinguishes attempts and their actual outcomes.

## Loss map and instrumentation scope

Pinned source: BSC `9bd39e6f3d54d314a94ce30339a224bb283cbade`, matching the
2026.01 source studied in the earlier gates. The original cache held only five
files; this experiment acquired the complete pinned source and pinned Yices
`f705557b7d33d866eb1b47b5471f97189eb31cc4` in a task-owned directory.

The inspected path is source/parser storage/RHS identity, typed/desugared
expressions, elaboration/state IDs, A-level objects/CSE, register inlining,
Verilog expressions/processes/printing, and reader AST/process lowering.
Existing `Id` equality and `AExpr` equality/CSE keys must remain semantically
unchanged. Adding provenance as an `IdProp` is not neutral because compiler
cross-reference equality examines properties.

The draft proposes a separate Id origin field, early parser mint/transfer,
state/primitive observations, contributor preservation at CSE, actual emitted
operator/process attributes and a versioned intermediate serialization.
It is explicitly **unbuilt and unverified**, not an accepted exporter.
Tokens containing only basename/position are insufficient as a full input/
occurrence identity; any accepted ledger must bind actual file hashes, lexical
and elaborated context and per-stage objects.

`Debug.Trace` observations alone are not a complete transformation graph.
An emitted attribute alone is not proof of its source meaning or supported
reader transport. No production origin provider may trust this draft as if a
compiler/reader lineage had executed.

## Attempt 1: actual preparation and build failure

Evidence: [RESULT](evidence/g3-origin/RESULT.json),
[README](evidence/g3-origin/README.md),
[inventory](evidence/g3-origin/INVENTORY.json),
[coverage](evidence/g3-origin/COVERAGE.json).

- Source acquisition succeeded at the pinned commits.
- Initial dependency bootstrap failed; the isolated container's outdated
  Hackage root trust was repaired against independently obtained current root
  authority, with secure verification retained. Host configuration was not
  changed.
- Final dependency image:
  `sha256:07896abd5a50fab0f7274a0e4a9b994276c6d286c45d9fd91a34978795191516`.
- Unmodified baseline command:
  `make -j2 GHCJOBS=2 PREFIX=/work/inst install-src`.
  Default compiler-build runtime flags were `+RTS -M4G -A128m -RTS`;
  GHC optimization remained `-O2`.
- Hard limits: one owned Docker container, four CPUs, 5 GiB, 512 PIDs and
  5,400 seconds. Log limit 16 MiB; aggregate output limit was monitored,
  not a falsely claimed hard filesystem quota.
- Baseline failed after 251.177 seconds: make exit 2, GHC error 137,
  Docker `OOMKilled=true`; highest sampled memory 4.983 GiB/5 GiB.
  Last logged compilation was `Parser.BSV.CVParser`, 138/227 modules.
- Required logs are complete and hash-inventoried. The owned container was
  removed; dependency images and evidence were retained.

There was **no instrumented compiler build, emitted origin sidecar, accepted
transformation ledger, reader origin transport or noninterference result**.
All 108 checked protected inputs remained unchanged.

The retained patch is `patches/bsc-origin-DRAFT.patch`, SHA256
`c59adfefa9959362ee9860a8102c01288328d9a3b65bc2b999c295e5488b978b`.
Applying it to pinned source is only a patch-replay check, not compilation
or proof that tokens survive compiler optimization.

## Bounded retry policy

The second attempt is preserved separately in
`evidence/g3-origin-retry/RESULT.json`. It used serial Make/GHC and
`+RTS -M3500m -A32m -s -RTS`, keeping `-O2` and the 5 GiB cgroup limit.
The recorded compatibility flag `-XFlexibleContexts` addresses the pinned
source's constraint-synonym requirements under GHC 9.0.2; it is a compiler-build
setting, not a BSV synthesis option.

It also failed at `Parser.BSV.CVParser`: GHC error 137, make exit 2,
`OOMKilled=true`, cgroup peak exactly 5 GiB. Final GHC heap statistics were
unavailable because SIGKILL prevented reporting; the configured heap maximum
is not relabeled as a measured maximum.
The log warned that GHC 9.0.2 used LLVM because its native backend did not
support the target. No instrumented compile or reader origin chain ran.

The third strategy tests a separate official GHC 9.6.7 AArch64 native backend
inside the isolated container, with the same BSC pin, `-O2`, memory budget and
unchanged hardware generation policy. It is a hypothesis, not a claimed remedy.
No global Docker resource or host compiler setting changes are authorized.

The first attempt's memory failure is preserved rather than erased.
An OOM at two-way compiler-build parallelism is not by itself proof that
the existing environment cannot build BSC.
The second strategy uses a fresh run/receipt with single-job GHC/Make and a
smaller allocation/heap setting inside the same 5 GiB limit.

Compiler-build concurrency/heap tuning is distinct from changing BSC hardware
generation or disabling optimization. Keep `GHCOPTLEVEL=-O2` and the same
paired source/parameters/tops/options/passes. No global Docker memory increase,
host GHC installation, original fixture change, keep/dont_touch attribute or
new synthesis boundary is authorized or used as a workaround.
If the retry succeeds, actual instrumentation and reader/noninterference
verification must still pass; baseline success alone is not G3-B success.

## Offline, author and live execution are separate

```sh
PYTHONDONTWRITEBYTECODE=1 python3 experiments/hardware/g3-origin/verify.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s experiments/hardware/g3-origin -p 'test_verify.py'
```

These verify the first attempt's captured blocked receipt and files. They do
not replay compiler execution or create origin claims. The first attempt's
six offline tests passed in a fresh compiler-free extraction.
Actual acquisition/provision/build commands, resource limits and expected
companion environment are recorded in the experiment README and receipts.

G2's strict author preservation remains a separate `check_author.py` command
requiring its original 14 companions. A bare review/Source ZIP intentionally
lacks them and must continue to fail that author check explicitly.

## Coverage and unresolved origin paths

Until a validated experiment artifact exists, both representative storage
and RHS origin paths are blocked at compiler build, not merely at a source
location lookup. The old method-port-net/pin chain remains connectivity only.

Historical 0/8 storage sets, 0/22 outermost expression sites, 0/53 leaf causes
and 0/168 definition-alias causes remain unchanged. A successful patch
application, source study, dependency install or source-link count does not
increase any origin numerator. No removed/generated/shared/merged/clone event
is accepted without an actual supported transformation record.
