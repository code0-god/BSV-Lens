# G3 correspondence and origin report

G3-A product correspondence is complete in its verified scope. G3-B demonstrates
supported storage and RHS contributors through actual compiler and reader
stages to leaf cells. Complete origin sets and full original-cause coverage
remain unresolved. The independent gate's three blockers are closed by a
focused **APPROVE**. Both corrected actual archive replays pass; the final
sealed pair's exact hashes and execution results are its adjacent receipts.

## Baseline and work protection

Branch remains `feat/hardware-schematic`; HEAD and the recorded remote-main
baseline are `c6b9a5c642d105ad4117535c1d85366f1c02ec1c`.
Version remains `0.4.1`. That main SHA is not the G2 feature-content identity.
The 388-file pre-G3 content fingerprint is
`385696796e5e36e444b2c828ecfb4642b8945afb123ea8083fff899923bcfd44`;
the exact entries and dirty state are in `evidence/g3/BASELINE.json`.
Final content/protection comparison is in `evidence/g3/FINAL_TREE.json`.
Exactly seven pre-G3 files changed: five current-scope documents and the
packager/test. All 388 baseline files remain present; G2 product runtime,
original importer and original fixtures/evidence remain byte-identical.

Original fixtures, G0-G2 evidence and prior ZIPs are preserved. No repository
commit, push, reset, clean, stash, merge, version change, tag, Release or
Marketplace publication is authorized or performed by this G3 work.

## Product implementation and representative query

G2 still enters through `src/hardware/index.js`.
The stock overlay enters through `src/hardware/correspondence/index.js`;
source, stock adapter, build, schema and worker modules remain separate.
The instrumented overlay enters through `correspondence/origin.js`,
with `origin-data.js` and `origin-worker.js`.
Both reuse existing semantic records, registry authority and immutable G2 IDs.

Public APIs provide forward, reverse, explanation, coverage and freshness
queries, plus latest-request session publication and real worker cancellation.
Registered source/metadata/RTL/capture hashes, source revision, provider
implementation and target snapshot bind each analysis. Paths in evidence do
not grant host file access. The representative-chain file is an independent
oracle, never a product answer database.

```sh
node --no-global-search-paths experiments/hardware/g3/query.js A mkConnected.left get connectivity
node --no-global-search-paths experiments/hardware/g3/query.js A mkConnected.left get origin
node --no-global-search-paths experiments/hardware/g3/origin-query.js A mkConnected/left
node --no-global-search-paths experiments/hardware/g3/origin-query.js B mkControl
node --no-global-search-paths experiments/hardware/g3/origin-query.js C mkReuse/wide
```

The stock `left.get` query resolves compiler port `get`, ordered child bits
13-20 to parent bits 21-28 and actual same-net contacts. Its origin query still
returns no claims. The separate instrumented query proves two supported
contributors for each left/right occurrence:

- `state <- mkReg(0)` reaches actual `$procdff$10`.
- `value + 1` reaches `$add$A/rtl/mkStage.v:73$2`.

Each has 34 compiler-boundary captures and 13 reader-stage captures, and reverse
query returns its corresponding source token. A Q contact is only a consistency
check after process-origin transport, never the origin inference.

## Actual origin experiment

The first two isolated GHC 9.0.2 strategies failed with cgroup OOM at the parser.
The third used GHC 9.6.7's AArch64 native backend and completed baseline and
instrumented BSC builds, smoke tests, A/B/C compilation and reader captures.
The full loss map, exact recipe and identities are in
[G3_ORIGIN_EXPERIMENT](G3_ORIGIN_EXPERIMENT.md).

The final BSC patch is
`evidence/g3-origin-ghc96/patches/final-bsc-origin.patch`,
SHA-256 `d15955aceb355d0e2e19322a62a2f7928166ff15beb87ec286c44bf83931df85`.
Actual source pin:
`9bd39e6f3d54d314a94ce30339a224bb283cbade`.
Instrumented BSC SHA-256:
`74a8004efdd032860e788dac3ff2d182a62bb3f9f2f79f07314d4774e85d94de`.
Tokens are minted before provenance loss; source hash/path/span, typed root,
stage-local object and witnessed conversion records support accepted chains.

Control operand rewrites lack a supported `aopt` event; its storages lack
singleton-process attribution. Parameter-derived Biased objects lack independent
reader clone identity. These are partial/unresolved, not promoted by copied
tokens, names or containment. No actual remove event is asserted.
Narrow/wide queries preserve 8/12-bit contexts without inventing retained
inlined modules. Generated reset/enable/mux causes and general shared/merged
origin sets remain unsupported.

The resumed verifier exposed hash-seed-dependent ordering of an unordered
unresolved-token set. Sorting that enumeration fixes fresh-process replay;
four explicit Python seeds now pass. Original reducer/sidecar/identities remain
byte-preserved in `history/reducer-before-order-fix/`. Only offline reduction
was rerun; raw compiler/reader execution and compiler identities are unchanged.

## Noninterference and coverage

Actual baseline/instrumented/no-emission comparisons pass all three circuits.
Functional RTL excludes only timestamp and exact two-field metadata attributes.
Complete structural projection preserves ports/order, parameters, constants and
integer connectivity; explicit A/B/C cell-plus-alias bijections contain
39/75/113 objects. No-emission and expanded-proc whole-JSON comparisons pass.
This proves measured noninterference, not origin correctness.

[G3_COVERAGE.md](G3_COVERAGE.md) explains the fixed machine populations.
New instrumented definition leaves: 6/53 known contributor objects,
6 partial tagged objects, 41 without an accepted/tagged path, 0 complete sets.
Product occurrence leaves: A 4/11, B 0/26, C 4/21 known contributors.
Actual 168 definition aliases have enumerated tuples/hash and zero origin claims.
Historical 0/8, 0/22, 0/53 and 0/168 stay unchanged.

## Validation and remaining limits

Current executed workspace validation:

- `node scripts/check.js`: pass.
- `node --test test/*.test.js`: 389 pass, zero failures/skips.
- Hardware suite: 83 cases, including 12 actual-origin product cases.
  The standalone alias coverage test is counted separately.
- Actual captured-origin Python suite: 13 pass, including four hash seeds.
- First-attempt and second-attempt captured failure suites: 6 each pass.
- Original toolchain manifest verification: 110 hashes pass.
- Raw alias-population regression: pass after an observed missing-population failure.
- Strict author preservation with original companions: 11 checks pass.
- Existing and new packaging regressions: 18 pass, zero failures/skips.

Actual preflight review and Source ZIPs passed 25 commands each in distinct
fresh directories, including 132 relative runtime files byte-equal to the
workspace and each other. Both passed CRC/SHA, all captured inventories,
public queries and negative tests. Each bare author check exited 1 with exactly
14 missing companions. `evidence/g3/PREFLIGHT_REPLAY.json` preserves the initial
replay; `PREFLIGHT_RECHECK.json` records the corrected runtime. Final standard
dist seals have separate adjacent validation receipts.

Negative cases reject unrelated hash-valid source, forged exact claims, partial
promotion, wrong revisions/occurrences/parameters, swapped operands, copied
tokens on unrelated cells, multi-update storage and altered clock semantics.
G3-A separately covers Unicode/range/stale/path/symlink, order/width and mutable
envelope contradictions. Original G2 data survives failed/cancelled overlays.
Actual worker exits precede cancellation settlement; final-refresh cancellation
and request replacement cannot publish stale or foreign results.

The first independent final gate rejected three real defects: duplicate link/
claim identities, hostile/deep nested sidecars, and foreign-revision queries
reported as ordinary unmapped results. All three were reproduced through public
APIs before correction. Origin JSON now reuses bounded copying, rejects hostile
prototype payloads while retaining actual compiler constructor names, and checks
unique link/claim IDs. Revision queries validate SHA-256 shape and return an
explicit stale/revision-mismatch outcome. The 389-test run includes all three
regressions; the initial rejection remains in `evidence/g3/GATE_INITIAL.md`.
The focused independent recheck is **APPROVE**, with no remaining blockers,
in `evidence/g3/GATE_RECHECK.md`. It independently compared old/fixed public
behavior, ran seven targeted tests, checked corrected archive bytes and
verified correction receipts. The initial whole-contract audit and focused
closure are separate evidence, not a claim that every broad check ran twice.

The bounded author-runner deadline probe observed both parent and child
SIGTERM handlers, child exit 0, runner reason `deadline` and expected runner
exit 1. Both recorded PIDs were absent afterward. No task-labeled compiler
container remained. Limits did not modify host toolchains or Docker-wide settings.

Runtime JavaScript and edited Python LSP checks have no errors or warnings;
CommonJS conversion hints are non-error tooling advice. JSON LSP is unavailable
because Biome is not installed; executable parsing, hash and byte checks replace
no claimed JSON LSP result.

Shipped offline, strict author preservation and live compiler execution are
distinct. Fresh archive queries must run without compiler, node_modules,
workspace symlinks or global module search. Bare author checks must still fail
with the exact 14 missing companions. Captured replay is not live recompilation.
See [OFFLINE_REPRODUCIBILITY](OFFLINE_REPRODUCIBILITY.md).

## Delivery status

| Item | Status | Evidence/limit |
| --- | --- | --- |
| G2 invariants | pass | Existing raw-artifact and overlay lifecycle tests. |
| G3-A correspondence/queries | complete/pass | Independent checkpoint and actual public APIs. |
| G3-B storage/RHS chains | verified in supported contributor scope | No complete origin sets. |
| Compiler/reader noninterference | verified | Actual three-way paired output comparison. |
| Coverage correctness | pass | Fixed definition/occurrence/alias populations. |
| Fresh review and Source replay | pass | Corrected actual preflight plus adjacent final-seal validation receipts. |
| Author preservation | pass / expected-fail | Author workspace passes; bare archives fail with exactly 14 companions. |
| Live compiler/exporter execution | pass for recorded isolated run | Not rerun by offline checks. |
| Independent final gate | APPROVE after corrections | Initial whole-contract review plus focused closure of all three blockers. |
| Inspector/browser/editor/zoom | not-run | Backend/CLI scope only. |
| Production UI replacement | not-performed | No G4 or production integration. |
| User visual/design acceptance | pending | Not implied by test success. |
| Merge/release | not-authorized | Version remains 0.4.1. |

New outputs, separate from every prior ZIP:

- `dist/bsv-lens-hardware-g3-review.zip`
- `dist/bsv-lens-hardware-g3-source.zip`
- Adjacent `.sha256` and `.zip.validation.json` receipts.

Archive hashes remain outside their own archives to avoid self-reference.
The adjacent final receipts contain exact commands/exits/stdout/stderr, clean
extraction isolation, runtime byte equality and CRC/SHA checks.
Stop after the G3 result; G4-G7 and release require new authorization.
