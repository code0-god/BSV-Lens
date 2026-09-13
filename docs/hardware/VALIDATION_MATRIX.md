# G1 validation matrix

This matrix covers the complete supplied master contract. A later-gate row is
an explicit implementation obligation, not a G1 pass or a waiver.
Execution results and final file identities are consolidated in `G1_REPORT.md`.

## Current G3 validation contract

[G3_CONTRACT](G3_CONTRACT.md) and the complete supplied G3 master now govern
the new work. The G1/G2 tables below are retained historical scope.

| Layer | Required independent evidence |
| --- | --- |
| Baseline | Actual branch/HEAD plus full uncommitted content fingerprint and separate artifact hashes; no forced cleanup or overwritten history. |
| G3-A identity | New overlay identity; original G2 snapshot/model/ordered data unchanged before/after attach, failure and cancel. |
| Source | Full revision/slice checks; declared coordinate conventions; CRLF/tabs/Korean/non-BMP/combining/multiline and stale/captured cases. |
| Compiler/RTL contract | Actual stock metadata, source/type/occurrence and generated RTL identity; no inferred RDY/EN names or fabricated method bodies. |
| Connectivity | Raw ordered pairing and pin oracle; left/right, concrete widths, forwarding/inlined context distinct; no cell input/output union. |
| Claims | Typed tuples, explicit composition, non-dangling/non-cyclic premises, contradictory-data rejection and no untrusted exact promotion. |
| Queries/lifecycle | Forward/reverse/explain/coverage, ambiguity and limits, source-only/implementation-only behavior, atomic cancellation/supersession and measured stress. |
| G3-A checkpoint | Public API and independent oracle pass from a compiler-free extraction, plus preserved G2 invariants, before G3-B execution. |
| G3-B origin | Actual early compiler tokens, per-object/pass lineage, storage and RHS paths through emitted RTL and actual reader-stage objects. |
| Transformations | Clone/shared/merge/generated/inline/remove claims need actual recorded event scope; missing names are not removal. |
| Noninterference | Same source/dependencies/options/stage; functional bytes or narrowly normalized full connectivity/equivalence evidence. |
| Coverage | Historical denominators preserved; new corpus/snapshot/stage/provider populations, partial contributors and complete supported sets separate. |
| Delivery | New review and Source ZIPs, empty extractions, actual product queries, matching runtime bytes and CRC/SHA/command receipts. |
| Stop | A/B complete/partial/blocked separately; no unrun UI/editor/continuous-zoom PASS and no G4/release authorization. |

No G3 row is a PASS until its own executed evidence is recorded.

### G3 executed-evidence index

| Scope | Evidence and interpretation |
| --- | --- |
| G3-A checkpoint | `G3_A_CHECKPOINT.md`; independent rejection and corrected approval retained under `evidence/g3/`. |
| Product origin | `test/hardware-origin.test.js`; actual source/compiler/reader/G2 paths, reverse queries, occurrence/width scope and no complete-set promotion. |
| Independent origin | `experiments/hardware/g3-origin/ghc96-test.py`; raw captured transformations and explicit source/token/vector/process/parameter/clock negatives. |
| Noninterference | `evidence/g3-origin-ghc96/results/noninterference.json`; three paired circuits, full ordered projection and no-emission equality. |
| Origin coverage | `G3_COVERAGE.json`; definition and occurrence populations separated, historical origin gaps retained. |
| Lifecycle | Real worker start/exit, cancellation during final refresh, immutable initial request and latest-request ownership tests. |
| Offline/author/live | `OFFLINE_REPRODUCIBILITY.md` and final `G3_REPORT.md`; three scopes cannot be merged into one PASS. |
| Final archive/gate | Final report and adjacent ZIP receipts are authoritative; pending work is never inferred from this index. |
| UI/editor/zoom | Not exercised for G3; backend/CLI evidence is not a visual PASS. |

## Historical G2 scope and validation

The latest user authorization is [G2_CONTRACT](G2_CONTRACT.md), after actual
standalone ZIP verification. Final design, G3 and release remain unapproved.

| G2 requirement | Required proof |
| --- | --- |
| Truly shipped offline checks | New extraction without compiler metadata directories, prior ZIP, node_modules or workspace symlinks; documented commands and actual exits. |
| Strict author preservation/replay separation | Exact 14 companions listed; author check fails without them, shipped missing/tampered inputs also fail; no skipped required checks. |
| Product-owned verified reader | Product source path plus independent old/new/raw artifact comparison for all three preserved designs. |
| Separate truth owners | BSV/source, Implementation and Correspondence refs cannot be exchanged or inferred from presentation nodes/edges. |
| Immutable snapshot identity | Actual artifact and declared build inputs determine identity; ordering invariance, unknown provenance and immutable exposed data checked. |
| Ordered connectivity | Vectors, aliases, constants, occurrence namespaces and formal/actual mappings equal independent reference data, not just counts. |
| Compiler-free product use | Real module/CLI import with no BSC/Yosys execution or hidden installation. |
| Invalid/unsupported/partial | Malformed syntax/refs/limits reject; unsupported process/format is explicit; opaque data retained with scoped limitations. |
| Paths and source freshness | Traversal and symlink escape reject; artifact attrs grant no path authority; stale hashes cannot reveal shifted current ranges. |
| Cancellation and atomic publication | Pre-abort, active CPU cancellation and superseded replies cannot publish partial/stale results or destroy last valid snapshot; worker termination observed. |
| Later summarized design | Member relations/conditions/evidence preserved in a projection contract, not a G2 UI rewrite; DOM identity distinguished from continuous zoom. |
| Mapping scope | `left.get` stays a method-port-net/pin chain; 0/53 and 0/168 cause gaps remain visible. |
| Stop boundary | G2 report, fresh archive/CRC/SHA evidence and unchanged version/main/release state; no automatic G3. |

The actual product API/test receipts and supported scope are recorded in
`G2_REPORT.md` when this gate is complete.

## Change history: G1-BSV

2026-09-06: the user's G1-BSV amendment changes the default abstraction to BSV
hardware composition, with RTL Implementation on demand. Original G1 proof
remains valid for its declared scope but does not approve the old `$cell`
default. G2 remains unapproved. Amendment results are reported separately in
`G1_BSV_REPORT.md`; rows below are requirements until their actual receipts pass.

| User section | G1-BSV requirement | Proof |
| --- | --- | --- |
| 1 | Preserve importer, artifact/bit truth, snapshot/source and original evidence | Before/after importer, toolchain manifest and original review ZIP hashes; existing fidelity tests retained. |
| 2 | Default real BSV instances/storage/typed contacts, not RTL cells or buckets | Actual A/B/C default-scene object IDs/types and Chrome captures. |
| 3 | Names/types/declarations come from actual source with definition/context/range/revision | Source/Semantic adapter tests compare every referenced slice and revision to the original file. |
| 4 | Body click first opens BSV hardware composition | Actual pointer path from BSV overview into child/storage interior. |
| 5 | Selection exposes behavior/conditions/read-write-call evidence without fake physical methods/rules | Scene-kind assertions, selected relation/storage details and source overlays. |
| 6 | BSV method names/types first; actual RTL signals only on explicit disclosure | Action/Value/type tests; metadata-bound signal disclosure; unknown/composite negative cases. |
| 7 | Semantic relations and RTL wires are separate evidence families | Every semantic line has source statement, kind, compiler status and optional RTL refs; implementation pins/bits remain independently verified. |
| 8 | Reuse Source/Semantic/Hardware IR, no duplicated truth graph | ADR 008, actual adapter imports and distinct scene/model references. |
| 9 | BSC/Bluetcl evidence before reverse inference | Actual tool output/version/query records and explicit missing-field/exporter result. |
| 10 | Preserve old cause gaps, measure categories, prove a representative chain | Category denominators; actual BSV-to-metadata-to-RTL/netlist example; aliases versus normalized scalar connectivity. |
| 11 | Inlined/shared/source/implementation boundaries remain distinct | Repeated C occurrences and `mkWidth` source inlining; no invented cell ownership. |
| 12 | Same occurrence, explicit mode switch, Back/Up distinction and exact restore | Browser/controller assertions over owner, snapshot, selected entity, source and viewport; repeated entry is no-op. |
| 13 | Seven document histories, ADR and six live states | Updated document set, ADR 008, A-F interaction receipts/screenshots. |
| 14 | Stop for user approval before G2 | Final scope/branch/version and release boundary; user acceptance remains pending. |

### Required live states

- A: BSV overall occurrence structure.
- B: BSV module interior, with actual children/storage and typed contacts.
- C: Port/storage/semantic relation selection plus rule/method/expression context.
- D: Actual original-source navigation, range and content revision.
- E: Explicit RTL Implementation for the same BSV owner/snapshot.
- F: Back restores the prior BSV selection/source/viewport.

Static midpoint SVGs are not evidence for these runtime actions.

### Ten approval questions

1. Can a BSV author read composition/behavior without recognizing Yosys cells?
2. Do all default names/types/instances reach their actual BSV records?
3. Does each semantic connection reach its originating source statement?
4. Are rules/methods overlays or boundaries rather than fake physical blocks?
5. Does the generic cell/net canvas require explicit implementation entry?
6. Are source relation certainty and RTL connectivity certainty distinguishable?
7. Is the representative complete correspondence chain grounded in real outputs?
8. Are unmatched circuits visible without guessed BSV allocation?
9. Do entry and Back preserve the actual occurrence and build context?
10. Do original importer/connectivity assertions and artifact hashes still hold?

The final report records the answer and evidence for every question, not only
test totals. Full leaf-cell cause mapping remains explicitly unclaimed.

Status vocabulary:

- **Evidence:** actual artifact/runtime evidence is part of this G1 delivery;
  consult the named receipt for the measured outcome and limits.
- **Design:** contract is specified, production implementation remains gated.
- **User:** only the user can approve this decision or visual result.

## Contract coverage

| Master section | Requirement / failure prevented | G1 contract or evidence | Production gate |
| --- | --- | --- | --- |
| 01 | Actual local/remote baseline, version, identity; preserve user changes | BASELINE; final Git/package receipt | Every gate preflight |
| 02 | Product becomes compiled hardware plus source analysis, not card polish | PRODUCT_SPEC; actual artifact-backed interactive experiment | G2-G7 |
| 03 | Compiled truth and exact source evidence are separate goals | PRODUCT_SPEC; ADR 001/004; FEASIBILITY coverage denominator | G2/G3 |
| 04 | Separate source definition, elaboration, implementation and logical regions | SCHEMA; ADR 002; actual repeated/numeric instances | G2/G3 |
| 05 | Audit available material and reproduce each current defect | G0_AUDIT; isolated expected-failure harness | G4 retains regressions |
| 06 | Actual compiler/reader feasibility and missing-metadata investigation | FEASIBILITY; real help/output/logs; executed conservative sidecar | G3 compiler exporter study |
| 07 | Submit all approval documents, seven ADRs and data-based visual candidate | G1_REPORT document index; UX_DESIGN | User before G2 |
| 08 | Plan dependency-ordered G2-G7 with changed areas and completion criteria | IMPLEMENTATION_PLAN | G2-G7 |
| 09 | Declare exact transform stage; no hidden optimize/flatten for display | Recipe JSON; pre/post RTLIL; ADR 003 | G2 additional stages |
| 10 | Keep artifact, BSC evidence and source-analysis providers separate | ARCHITECTURE; importer and real metadata sidecar | G2/G3 |
| 11 | Immutable inputs/tools/dependencies/options/artifacts and stale state | SCHEMA; manifest; tested prototype snapshot identity | G2/G6 lifecycle |
| 12 | Definitions, occurrences, concrete parameters, cells and unknowns | Three artifacts; independent importer; SCHEMA | G2 |
| 13 | Ordered bits, aliases, slices, constants, fanout and inout | Independent importer reference/negative tests | G2/G5 |
| 14 | Actual containment and explicit ordered formal/actual crossings | 122 materialized bindings; same-shell port membership checks | G2/G4 |
| 15 | Many-to-many correspondence with inspectable source/evidence ranges | FEASIBILITY coverage; SCHEMA; ADR 004 | G3 |
| 16 | Generated/inlined/shared/removed hardware needs positive evidence | Compiler loss study; unmapped labels; separate debug snapshot | G3 |
| 17 | Hardware queries independent of scene and source/code queries | Importer queries; ARCHITECTURE and SCHEMA | G2/G5 full cones |
| 18 | Clear build/top/path/canvas/details/code information structure | DESIGN; UX_DESIGN; actual wide/narrow screens | G4 |
| 19 | Primary vocabulary is block, port and signal, not legacy channel buckets | PRODUCT_SPEC; actual schematic | G4 |
| 20 | Single-click entry, explicit inspection, keyboard and nonbubbling hits | Actual Chrome pointer/keyboard tests, including expanded get port | G4 |
| 21 | Same boundary expansion and connection continuity, not unrelated replacement | Stable DOM shell and ordered members; intermediate model SVG | G4 runtime motion |
| 22 | Distinct Back/Forward/Up, exact restored state, no duplicate visits | Navigation tests; actual source/selection/viewport restoration | G4 |
| 23 | Engineering schematic visual grammar, uncertainty and readable symbols | DESIGN; ADR 006; theme/geometry/visual evidence | G4 |
| 24 | Port direction, bus/bit membership, junctions, crossings and hit areas | Real route/bit selection; geometry and ordinary pointer tests | G4/G5 |
| 25 | Pure scene, deterministic port-aware layout, reversible bundles | SCHEMA; prototype layout/build receipts; ADR 006 | G4/G6 |
| 26 | Inspector answers real connectivity then source/evidence questions | Actual port/wire/cell details and source-context labels | G5 full analysis |
| 27 | Module/port/wire/cell/RTL/BSV round trip with context retained | Prototype source drawer and Back; exact hashed-slice tests | G5/G6 editor |
| 28 | Rules/methods/scheduling explain hardware, not speculative execution order | G0 source-flow audit; actual guarded control and debug artifact | G5 |
| 29 | No-tool source-preview/import fallback and honest black boxes | ADR 007; initial/error screens; unknown/black-box tests | G2/G6 host |
| 30 | Complete canonical data with bounded materialization, cache and transport | ARCHITECTURE budgets; measured G1 counts/timings | G6 S/M/L |
| 31 | Trust, command/process, path/symlink/JSON/CSP/security boundaries | PRODUCT_SPEC/SCHEMA; actual server/importer negatives | G2/G6 full host |
| 32 | All existing semantic/source/evidence/navigation regressions retained | G0_AUDIT; unchanged default test suite | G2-G6 |
| 33 | Independent importer oracle compares identities and ordered connections | 14 tests, deterministic cases and three real artifact comparisons | G2 broader stage matrix |
| 34 | Mapping ranges, negative cases, stale and ambiguous source evidence | Hashed source/server tests; measured missing origins | G3 complete mapping matrix |
| 35 | Three real compiler fixtures: connection, guarded control, parameter reuse | A/B/C compiler/import logs and artifacts | G6 larger fixtures |
| 36 | Pinned external integration remains read-only and separately qualified | BASELINE/G0 identity; IMPLEMENTATION_PLAN | G6 actual compiled use |
| 37 | Ten screens, including intermediate expansion; static is not interaction proof | UX_DESIGN, actual-model intermediate SVG and browser receipts | G4/G6 full states |
| 38 | Actual intent journey and performance, not click counts | Pointer journey + exact state/membership assertions | G4/G5/G6 |
| 39 | Native host and installed VSIX checks are distinct from a local browser | G0 read-only installed bytes; package verification; explicit not-run hardware host | G6 native/remote |
| 40 | Reuse CommonJS/style with minimal clear ownership, no gratuitous layers | Isolated experiment; ARCHITECTURE; proposed changed files | G2-G7 |
| 41 | Preserve identity/commands/export/schema migration and gated release | Production paths unchanged; package and final Git receipt | G6 and separate authorization |
| 42 | Report independent completion axes and unresolved evidence | G1_REPORT; user approval remains pending | G7 |

## G0 reproduction matrix

G0_AUDIT gives exact source locations, steps, captured states and classification.
The experiment must not silently fix production while producing the audit.

| Regression | Required observation | Next owner |
| --- | --- | --- |
| Duplicate Focus | Identical target appends history or is proven idempotent | Navigation |
| Breadcrumb residual focus | Ancestor path plus stale hidden focus/candidate filter | Navigation + Scene |
| Header/location disagreement | Header/path agree or diverge from actual scene context | Navigation transaction |
| Internal dimming | Entered parent selection wrongly dims children or not | Renderer emphasis only |
| Unknown payload | Null/composite/absent cases retain distinct meaning or not | Source contract + details |
| Visible count mismatch | Count equals final visible IDs, not candidate count | Scene projection |
| Fake delegation | `value = 42` is not a delegated callee; negative still holds | Source analyzer |
| Source-flow scope | Guard/body/write/RHS and original text remain distinct | Source queries/evidence |

## Artifact fidelity tests

Independent reference logic reads original provider dictionaries rather than
reusing importer indexes. Compare exact ordered members and object identities.

| Case | Assertion |
| --- | --- |
| All three real designs | Every supported definition, cell/pin, port, alias, bit and selected-top occurrence is accounted for with a denominator. |
| Parameterized reuse | Distinct occurrences stay distinct; actual parameters and numeric specialization follow emitted definitions. |
| Shared guarded state | Actual generated control is visible; missing fire signals remain missing; optional debug outputs are a different build. |
| Aliases/slices/reorder/concat/repeated bits | Raw ordered vectors and HDL index metadata equal imported vectors. |
| Constants | Values 0/1/x/z survive; unrelated equal values do not create global physical drivers. |
| Hierarchical boundary | Parent actual and child formal ordered positions match; no width repair. |
| Unknown/inout/multiple drivers | Endpoints survive with honest direction/electrical limits. |
| Unknown cells/black boxes/memory/process | Preserve declared semantics/raw data, or reject unsupported stage explicitly. |
| Object-key permutations | Canonical results are unchanged. |
| Malformed references/hostile names/limits | Reject before publication, no prototype-key pollution or silent truncation. |

## Browser and source tests

| Action | Semantic assertion | Geometric/accessibility assertion |
| --- | --- | --- |
| Select real build | Correct snapshot, top, stage and actual artifact hash | Actual root visible after Fit; no blank inspector dominates |
| Click block body once | Correct occurrence, one new history entry | Same shell/anchor identity; visible internal circuit |
| Select port/bus/bit | Correct ordered bits/endpoints/bindings; no hierarchy change | Nonzero hit area, selected route distinguishable |
| Select leaf/black box | Known ports/details; no fake zero-node entry | Focus visible; Enter/Space behavior explicit |
| Open RTL/BSV | Real hashed text and honest range/context status | Code drawer readable, source role labeled |
| Back/Forward | Prior/next distinct scene, selection/viewport/panels restored | No automatic Fit overwrites restoration |
| Up/breadcrumb | Actual parent; stale local focus removed | Header/path and scene agree |
| Repeated/double activation | No duplicate visit or accidental grandchild entry | Pointer target remains predictable |
| Drag/wheel | No accidental entry/history append | Pan/zoom work; nodes not buried after Fit |
| Narrow/light/high contrast/reduced motion | Same hardware meaning | No document overflow, hidden controls or color-only meaning |

No fixed sleeps, polling delays, screenshot pixel counts or pure-controller
calls substitute for the actual pointer flow. Synchronize on precise state,
response or animation events with bounded failure time.

## G1 support is not future acceptance

G1 establishes the measured compiler/reader stage and isolated preview on this
host. It does not establish large-design routing, remote execution, production
Workspace Trust, all semantic cones, full original BSV mapping, VS Code editor
reveal, or installed hardware UI behavior. These remain explicit G2-G7 gates.

Human design and visual approval remain **User**, even when automated evidence
passes. Main integration and publication remain separate decisions.
