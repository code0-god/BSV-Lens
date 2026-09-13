# G0/G1 approval candidate

Status: G0/G1 approval candidate submitted. Design and user visual approval
remain pending. This is not the production conversion or permission to begin G2.

## Decision requested

Review the compiled-truth model boundaries, same-shell single-click expansion,
port/net evidence interaction, source uncertainty language, and G2-G7 plan.
The exact original-BSV mapping gap below is part of this decision, not hidden
behind a general confidence score.

| Required document | Review entry |
| --- | --- |
| Product | [PRODUCT_SPEC](PRODUCT_SPEC.md) |
| Tool feasibility | [FEASIBILITY](FEASIBILITY.md) |
| Architecture | [ARCHITECTURE](ARCHITECTURE.md) |
| Concrete schema and actual experiment API | [SCHEMA](SCHEMA.md) |
| Interaction and screens | [UX_DESIGN](UX_DESIGN.md) |
| Whole-contract coverage and tests | [VALIDATION_MATRIX](VALIDATION_MATRIX.md) |
| Subsequent gate plan | [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md) |
| Baseline and G0 | [BASELINE](BASELINE.md), [G0_AUDIT](G0_AUDIT.md) |
| Experiment design system | [DESIGN](DESIGN.md) |
| ADRs | [001 truth](adr/001-compiled-connectivity.md), [002 hierarchy](adr/002-hierarchy.md), [003 reader](adr/003-reader-stage.md), [004 evidence](adr/004-evidence.md), [005 navigation](adr/005-navigation.md), [006 renderer](adr/006-renderer-layout.md), [007 no tools](adr/007-no-tool-fallback.md) |

## What was actually done

The complete 999-line master was read and fingerprinted. Initial local/remote
main were both `c6b9a5c642d105ad4117535c1d85366f1c02ec1c`, package `0.4.1`,
with a clean worktree and exact-SHA CI success. Work is isolated on
`feat/hardware-schematic`; no user changes were reverted.

G0 produced a reproducible audit with 21 explicit runtime assertions:
8 PASS and 13 EXPECTED-FAILURE records. The expected failures preserve evidence
of existing defects; they are not skipped tests or new production fixes.
Repeated Focus, breadcrumb residual focus/history, location mismatch, internal
dimming, unknown/composite payload display, and visible-count defects reproduce.
The constant-return fabricated-delegation regression is already fixed.

G1 compiled three real BSV sources with BSC and read the emitted RTL using actual
Yosys, retaining hierarchy and lowering processes with `proc -noopt`.
Original generated RTL, pre/post-lowering RTLIL, JSON, Bluetcl metadata,
correspondence, coverage, tool help, install/license evidence and commands are
retained in `evidence/toolchain/`. A separate debug build is not the baseline.

The isolated importer and interactive experiment are under
`experiments/hardware/`. Production `src/` and `media/` are not replaced.
All 42 numbered master sections are mapped to their actual section numbers in
VALIDATION_MATRIX; later-gate obligations are explicitly distinguished from G1.

## Exact experiment scope

Host: Darwin 25.5.0 arm64, Apple M5 Pro, 18 cores.
BSC/Bluetcl: `2026.01`, build `9bd39e6f3`.
Reader: isolated `yowasp-yosys==0.68.0.0.post1208`, actual
Yosys `0.68`, git `38e001a6f`; dependency identities/licenses are recorded.
Stage: `bsc-generated-rtl/yosys-hierarchy-proc-noopt`.

| Fixture | Actual top | Purpose | Provider definitions / cells / netnames / pin-bit slots |
| --- | --- | --- | --- |
| A | `mkConnected` | Two real children, methods, state, arithmetic and fanout | 2 / 8 / 31 / 156 |
| B | `mkControl` | Three guarded rules sharing state and generated control | 1 / 26 / 49 / 258 |
| C | `mkReuse` | Two biased occurrences and distinct concrete numeric widths | 5 / 25 / 88 / 540 |
| Total | Three separate builds | Not one fabricated super-top | 8 / 59 / 168 / 954 |

These are **definition-level provider counts**. The independent importer also
materializes selected-top occurrences, so repeated definitions contribute more
than once: 64/64 occurrence cells, 1,249/1,249 ordered port/pin connection slots,
793/793 alias-bit slots, 122/122 formal/actual boundary bindings and
1,357/1,357 entities with resolving provider pointers were checked.
These denominators must not be mixed.

The importer additionally exercises constants, reorder/slice/alias overlap,
unknown directions/cells, hostile names, malformed bindings, identity and
size/depth limits through independent deterministic cases. Raw processes
reject explicitly; memory is lossless opaque data, not a proven memory-flow
implementation. The compiler fixtures do not prove external Verilog libraries,
technology mapping, or arbitrary SystemVerilog coverage.

## One concrete hardware/evidence chain

Actual A artifact: `evidence/toolchain/A/design.json`.

1. `/modules/mkConnected/cells/left` is a real cell of type `mkStage`.
   Generated RTL evidence is `mkConnected.v:75.11-81.20`.
2. Parent `left.connections.get` is ordered
   `[21,22,23,24,25,26,27,28]`.
   Child `mkStage.ports.get.bits` is ordered
   `[13,14,15,16,17,18,19,20]`.
3. Formal/actual bindings pair these positions across the `left` occurrence.
   Equal local numbers in `right` are not the same hardware net.
4. Parent bit 21 connects `left.get[0]` to the real `$add` cell's `A[0]`.
   Alias `left$get` names that vector. The adder output is a different signal;
   same-net tracing does not cross the operator.
5. Bluetcl independently identifies instance `left`, definition `mkStage`,
   and `experiments/hardware/fixtures/Connected.bsv:20:10`.
   That is verified declaration evidence, not an exact BSV origin for every
   internal operator/net.
6. Top `RDY_put` is literal `["1"]`, while
   `left.connections.RDY_put` is `[]`, explicitly unconnected. Neither becomes
   a guessed missing wire.

Every rendered shell/port/route has model-qualified IDs and provider pointers.
The browser can expose ordered members and the boundary bindings before and
after expansion. Visual continuation markers are presentation-only.

## Source mapping: measured result and unresolved work

| Population / relation | Result | What it does not prove |
| --- | --- | --- |
| Provider cells to generated RTL attributes | 59/59 | Original BSV expression origins |
| Provider netnames with generated RTL attributes | 136/168 | Every bit has a precise origin range |
| Hierarchical instance declarations to BSV positions | 6/6 | All cells within an instance map to that line |
| Compiler method-to-RTL-port bindings | 40 | Every implementing net/expression is exact |
| Leaf cells with exact original BSV origin | 0/53 | Missing is not proof of compiler generation |
| Netnames with exact original BSV origin | 0/168 | Name similarity cannot upgrade this count |

At the normalized entity level, direct RTL attributes cover 230/1,357;
1,127/1,357 have only ancestor RTL context in the raw importer. The raw importer
alone has 0/1,357 verified BSV origins; the separate conservative sidecar adds
only the demonstrated declaration and method-port relations.

Actual compiler-source study located ID/position loss at A-to-Verilog
conversion and printing: some `VExpr` cases discard IDs; `VId` can retain an
`Id`/position but printing emits its string without provenance. Yosys creates
new generated-RTL positions while parsing. A late pretty-print-only map cannot
recover all earlier origins.

The executed `metadata.tcl` plus `run.py` sidecar emits actual public metadata
with source/artifact hashes. Its schema is a project experiment, not an
existing BSC exporter. An isolated pinned compiler-side provenance patch is
planned in FEASIBILITY but was not built: this host lacks GHC/Cabal. That work
must preserve origins through transformations and independently prove unchanged
hardware. Full original-BSV correspondence remains a G3 research/implementation
obligation, not a G1 success claim.

## Run the experiment

No compiler is needed to inspect the retained, hash-checked artifacts:

```sh
node experiments/hardware/prototype/server.js
# Open http://127.0.0.1:4178
```

Choose a compiled build, import it, click the top body, then a child body.
Inspect a port or net, select an ordered bit and follow the available RTL/BSV
evidence. Back restores the previous distinct scene; Up navigates to the real
parent. RTL/BSV opens in the local read-only source drawer, not the VS Code
editor. Production editor reveal is deliberately a later host gate.

Tool reproduction and explicit isolated install are described in
`experiments/hardware/toolchain/README.md`. The default recipe does not silently
install a tool. Existing evidence can be verified independently:

```sh
python3 experiments/hardware/toolchain/run.py --verify-evidence
node --test experiments/hardware/importer.test.js
node experiments/hardware/g0/run.cjs
```

Generate the separately labeled static intermediate-expansion design frames:

```sh
node experiments/hardware/prototype/intermediate.js
```

This uses real collapsed/expanded model geometry, not fixed design coordinates.
A's intermediate frame retains seven external ports, 21 ordered port bits and
19 actual boundary bindings. SVG/PNG files for A/B/C and a geometry/membership
receipt are in `.build/hardware/prototype/intermediate-*`.
The frame is not runtime animation; the real single-click endpoints and
connection continuity were tested separately.

## Portable approval bundle

`dist/bsv-lens-hardware-g1-review.zip` includes repository sources, all approval
documents, compile/import artifacts, G0 and importer receipts, prototype
screenshots, intermediate SVGs and the lead's final pointer/visual evidence.
It preserves their repository-relative paths under `bsv-lens/`.
It excludes tool installations, browser profiles, dependencies and Git state.
It contains the small test-design source files and recorded local path
identifiers; it is not a redacted public release.

Rebuild and validate:

```sh
node experiments/hardware/package-review.js
(cd dist && shasum -a 256 -c bsv-lens-hardware-g1-review.zip.sha256)
```

The script checks required evidence membership, validates ZIP CRCs and writes
an adjacent SHA256 sidecar. The standard VSIX/repository archives and
`dist/SHA256SUMS.txt` remain separate; this review ZIP is not a VSIX or a publish.

## Verification ledger

| Evidence | Outcome / location |
| --- | --- |
| Toolchain evidence hashes | Lead independently checked all 110 manifest entries with `shasum -a 256`; zero mismatches. |
| Importer regression/reference suite | 14/14 pass; 40 deterministic cases plus all three actual compiler fixtures. `.build/hardware/importer/04-final-tests.tap` and README. |
| G0 reproduction | 21 assertions: 8 PASS, 13 EXPECTED-FAILURE; `.build/hardware/g0/results.json`, browser runtime/screenshots and G0_AUDIT. |
| Baseline compatibility tests | Final integrated `npm run package` reran all 306 default tests: pass, zero failures/skips. |
| Prototype pointer/state/geometry | Seven focused tests plus 14 importer tests passed together: 21/21, zero failures/skips. Actual Chrome `152.0.7977.82`; receipt and 26 screen captures in `.build/hardware/prototype/`. |
| Lead Chrome visual/source/Back | Final ordinary expanded-port and actual-wire clicks passed. Same DOM/seven ordered port memberships; selected bit, source, viewport and original top scene restored exactly. Zero page errors. `evidence/lead-qa.json` and `.build/hardware/lead-final-*.png`. |
| Intermediate state | A/B/C actual-model SVG/PNG; Chrome DOM, ordered memberships, midpoint geometry and repeat-generation SVG hashes verified. Explicitly static, not runtime animation. |
| Final syntax/tests/build | Prototype build validation and the complete integrated command below exited 0. New intermediate generator and delivery script receive their own syntax/entry-point checks. |
| Archives/checksums | Full package command passed ZIP CRC and checksum verification. Final document/source/evidence refresh uses the commands below; SHA256 values are external to their own archives. |

Executed integrated command, exit 0:

```sh
node experiments/hardware/prototype/build.js &&
node --test experiments/hardware/importer.test.js \
  experiments/hardware/prototype/navigation.test.js \
  experiments/hardware/prototype/server.test.js \
  experiments/hardware/prototype/browser.test.js &&
npm run package
```

Final documentation/source/evidence refresh:

```sh
npm run check
npm run package:repo
npm run checksums
npm run verify:package
node experiments/hardware/package-review.js
(cd dist && shasum -a 256 -c bsv-lens-hardware-g1-review.zip.sha256)
```

The prototype JS directory, new intermediate generator and delivery script
had zero LSP errors. Markdown/HTML/CSS have no configured LSP here. Fresh
importer diagnostics timed out; its syntax and full independent tests passed.
JSON LSP also could not run because Biome is not installed; the new receipt
was parsed successfully with Node. This is not universal language-server clearance.

Exact remaining limits: small process-lowered BSC RTL stage only; raw processes
reject, memory semantics remain opaque, and black-box behavior is unit-only.
Dense/narrow Fit is an overview requiring detail zoom. Full original BSV
expression/net mapping, runtime animation, large-design performance, production
VS Code host/editor integration and native/remote hardware UI acceptance are
not claimed. The original installed extension was checked read-only; the new
hardware experiment is not in that installed production UI.

## Remaining gates and release boundary

G2-G7 are fully specified in IMPLEMENTATION_PLAN. They include production
snapshot/host integration, exact correspondence research, robust compound
layout/navigation, cones/source analysis, scale/security/remote-host work,
pinned external-design use, installed VSIX behavior and user visual acceptance.
Only G0/G1 was authorized here.

No production hardware UI replacement, version change, commit, push, main
merge, tag, GitHub Release or Marketplace publication is part of this delivery.
The existing whitelist excludes experiment/docs from the production VSIX.
Rebuilding local archives is verification, not a release.

**Human approval remains pending.** Automated checks do not grant design
approval, visual acceptance, permission for G2, or publication authorization.
