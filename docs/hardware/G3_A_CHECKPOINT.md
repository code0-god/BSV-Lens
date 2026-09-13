# G3-A internal checkpoint

Status: **complete in the verified declaration/contract/connectivity scope**.
This is not G3-B, full G3, final design or release approval.

## Checkpoint amendment after independent review

The first independent review rejected mutable nested input aliases and an
unchecked contradiction between declared G2 source hashes and attached evidence.
Both failures were reproduced before correction. Attachment now rejects
shallow-frozen lookalikes without mutating caller data and checks attached
source identity against explicit G2 inputs. Null/unknown input provenance is
still supported; known-empty or contradictory inputs cannot become exact maps.

The corrected source passed **70 hardware tests** (30 G2 plus 40 correspondence,
including nine independent cases) and all 70 again from a new compiler-free
extraction at `.build`-independent temp root
`/var/folders/6m/65prllx16pn1yq0bs0q_s5sc0000gn/T/bsv-g3a-recheck-Xc0keD/bsv-lens`.
Both modified files had zero LSP errors/warnings. The independent focused
recheck is **APPROVE**, with original rejection preserved in
`.omo/evidence/G3-A-gate-review.md` and recheck in
`.omo/evidence/G3-A-gate-recheck.md`.

The original 68-test evidence below remains historical, not a fresh claim
about the corrected bytes. The next G3-B attempt must record this amended
checkpoint hash. Its first paired baseline build was terminated by the 5 GiB
memory limit; no instrumented binary/origin was produced. A second bounded
attempt may reduce compiler-build concurrency and GHC allocation/heap settings
while keeping `-O2`, BSC generation policy and paired test options unchanged.
No Docker-wide memory increase or host toolchain modification is authorized.

The public entry is `src/hardware/correspondence/index.js`.
API and executable schema version 1 are documented in
`.build/hardware/g3-a/API.md` and `SCHEMA.md`.
The six product modules are `index`, `build`, `schema`, `source`, `stock`,
and `worker` under `src/hardware/correspondence/`.
G2 runtime files and immutable implementation data were not changed.

## Executed evidence

- `node --test test/hardware-*.test.js`: 68 passed, zero failures/skips;
  30 G2 cases plus 38 correspondence cases, including seven independent tests.
- Parent reran all seven independent cases after the invalid-envelope
  correction: all passed. Cases include raw/golden pairing, forward/reverse/
  explanation, left/right/width scope, stock-origin rejection, Unicode,
  wrong hashes, forged/cyclic claims, captured/current source, active worker
  cancellation, supersession and malformed attachment envelopes.
- `node scripts/check.js`: passed; runtime LSP errors/warnings were zero.
- Fresh compiler-free ZIP extraction ran all 68 hardware cases without
  node_modules; 49 runtime files were byte-identical.
- A/B/C product explorer commands resolve actual connectivity.
  A `left.get` origin request remains unmapped, with no origin claims.
- Parent's checked-in harness
  `node experiments/hardware/g3/query.js A mkConnected.left get connectivity`
  exited 0 with 34 scoped claims and the real ordered binding/contact chain.
- Active attachment cancellation observed actual worker exit before settling;
  measured cancellation 1.093 ms. This is a measurement, not a universal bound.

The fixed input-boundary defect is recorded in the independent test:
`attach(null)` no longer bypasses typed invalid-input handling through a
`signal` property TypeError. It preserves prior valid mapping/G2 state.

Machine checkpoint: `.build/hardware/g3-a/CHECKPOINT.json`, SHA256
`eec61949594bf0d80a9f28f485a14c17de6e67576f1805477e33ae93e566c845`.
Offline smoke archive: `.build/hardware/g3-a/offline-smoke-final.zip`, SHA256
`3bb60d53e474a3b1e3e8d1503550d40bff8bb3f50af756c0a08c49ece8d40403`.
Detailed commands and source/runtime inventories remain in that evidence directory.

## Scope and measured scale

Actual A/B/C attachment measurements were 67.85/52.69/125.01 ms.
An explicit synthetic 120-module, 7,558-byte source-parser corpus took
303.82 ms and used 52.75 MiB worker heap. It is not a large-netlist or
animation benchmark. Query p95 over 100 calls was below 0.05 ms in those runs.

Stock compiler metadata authority is caller-approved capture, not authenticated
compiler origin. Generated RTL support is the recorded non-ANSI BSC form;
stock compiler point columns beyond the verified ASCII/no-tab scope are
unsupported. Parser body ranges remain parser evidence, not compiler spans.
Forwarded/inlined contexts have no fabricated own bodies or cell ownership.

Historical exact-origin populations remain 0/53 leaf cells, 0/168 definition
aliases, 0/8 storage sets and 0/22 outermost expression sites.
G3-A changes no source-origin numerator.

## G3-B execution gate

The public API/oracle and G2 invariants passed; no current structural/security
blocker remains. Proceed to the already authorized isolated G3-B experiment
without asking for the same gate approval.

The source/tool plan is `.build/hardware/g3-origin/PREFLIGHT.md`, SHA256
`4bbabc84e9603a8b0643b6cbd903db3d6ce5748d91d37dfab70f18d548516eba`.
Actual limits: one task-owned container, at most four CPUs, 5 GiB memory,
512 PIDs, 30 minutes dependency provisioning and 90 minutes per paired build;
small compiler/reader calls are bounded separately. Keep input/output/patch
identities and process-exit receipts. Required log/ledger truncation is failure.

Task-owned storage/log limits must be explicitly recorded as hard or monitored;
do not falsely claim an aggregate filesystem quota. A new sparse-volume or
Docker-wide configuration is not a prerequisite invented by this checkpoint.
No host installation/PATH/toolchain replacement, user-container changes,
additional paid/account use or global resource change is authorized.

The experiment must actually trace storage and RHS origins through compiler
and reader creation/transform records and compare paired circuit outputs.
Partial/blocked outcomes remain acceptable only when supported by real attempts
and precise unresolved boundaries, not a repetition of stock metadata limits.
