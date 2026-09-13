# Hardware Schematic gate plan

Status: G5 Hardware / Code Analysis explicitly authorized on 2026-09-08.
G4 correctness follow-up is delivered; its bounded technical approval is not
universal platform/scale certification or user visual approval. G6/G7,
production replacement, final design approval and release remain unapproved.
Gates execute in order.
The feature branch remains `feat/hardware-schematic`, package `0.4.1`.
No gate implicitly authorizes commits, remote writes, merge, or release.

## Current gate: G5 Hardware / Code Analysis

The user authorizes G5-0/A/B/C/D through the result, without repeated approval
requests between its internal checkpoints. The controlling implementation
contract is [G5_CONTRACT](g5/G5_CONTRACT.md), with query, cell-semantics and
analysis-UX contracts alongside it.

Reuse G2 immutable incidence/authority, G3 correspondence and source evidence,
and G4 scene/navigation/router. Separate same-net, possible cell dependency,
BSV behavior/data, correspondence/origin and scheduling. Preserve ordered
bits, local constants, actual RTL occurrence, source/call context, history and
the last valid result under cancellation/failure/staleness.

Cones stop at sequential, memory, blackbox, unsupported, scope and resource
boundaries. No compiler/exporter or origin-coverage expansion is part of G5.
Deliver real A/B/C query/CLI/browser evidence and fresh review/source archives,
including complete trace/index closure. Stop after G5 delivery; visual/design
acceptance remains PENDING.

## Change history: completed G4 and G4 correctness follow-up

G4 introduced BSV-native nested scenes and explicit RTL detail. Its follow-up
fixed actual RTL visit identity and cross-net coincident segments. Independent
review and corrected-package recheck are preserved in
`g4-fix/GATE_INITIAL.md` and `g4-fix/GATE_RECHECK.md`; final delivery details are
in `g4-fix/G4_FIX_REPORT.md`. Existing delivered ZIPs/evidence remain immutable.

## Executed G3 amendment

G3-A passed its independent checkpoint, including the corrected mutable-input
and declared-source-hash cases. G3-B's third isolated strategy built the actual
instrumented compiler and verified storage/RHS contributor chains to reader
leaf objects. Six of 53 instrumented definition leaves have known contributors;
zero complete origin sets are asserted. Control and derived/shared/removal
gaps remain explicit. See `G3_ORIGIN_EXPERIMENT.md` and `G3_COVERAGE.json`.

Delivery closes only with the final evidence gate and both fresh archive
replays in `G3_REPORT.md`; earlier passing tests are not archive approval.
No additional origin transformation support, G4 work or production integration
is implicitly authorized by the representative successes.

## Historical authorization: G3-A then G3-B

[G3_CONTRACT](G3_CONTRACT.md) supersedes the historical G2 stop boundary below.
G3-A adds a validated, immutable correspondence/analysis overlay and product
queries over existing G2 and Source/Semantic records. Its independent
API/negative/identity/security checkpoint must pass before G3-B execution.

G3-B then performs the permitted bounded, isolated compiler/reader origin
experiment for actual storage and RHS expression contributors, including
lineage and noninterference. Tool/source preflight may be read-only in parallel;
no compiler instrumentation/build is treated as started before the checkpoint.
Additional cost/accounts/global installation/user toolchain replacement needs
permission only for that operation, not a repeated G3 authorization question.

Source-to-RTL-only transport is G3-B partial, not G3 complete. Every declared
origin scope needs actual compiler/reader evidence and distinct population
coverage. Captured offline validation, strict author preservation and live
replay remain separate. Both new review and Source ZIPs must execute product
entries/queries from empty extractions.

Stop at the separate G3-A/B result; G4 continuous zoom/final layout, G5 full
behavior/cones, G6 broad/native integration and G7/release do not begin here.

## Historical authorization: G2 only

The user adopted the BSV-native default/on-demand RTL abstraction, not final
design or full correspondence. [G2_CONTRACT](G2_CONTRACT.md) is now controlling.
The shipped ZIP prerequisite has been reproduced and corrected; standalone
checks, strict author preservation and live compiler replay are separate.

G2 promotes the verified importer, immutable snapshot and atomic/cancellable
artifact lifecycle into product-owned code. It does not run compilers, replace
the production UI or implement G3 source-cause mapping.
The original experimental importer and captured artifacts remain historical
reference evidence; active product ownership is explicit.

G4 must design summary connections over preserved canonical relations rather
than assume the current every-relation line rendering is final. Selection must
reveal each member's source/condition/evidence. Same-shell DOM tests remain
necessary identity checks, not sufficient continuous-zoom UX proof.

After G2 evidence and a fresh extracted-bundle check, stop for the next user
decision. Do not automatically begin G3 or any release operation.

## Change history: G1-BSV before G2

2026-09-06 user correction: G2 is still NOT approved. Complete the
[G1-BSV amendment](G1_BSV_CONTRACT.md) first. Preserve existing G1 artifacts,
importer, canonical connectivity and proof; classify its renderer as explicit
RTL Implementation detail rather than approved default architecture.

Amendment work:

1. Reuse Source/Semantic IR and actual BSC metadata for contextual BSV modules,
   typed boundaries, storage and source behavior relationships.
2. Keep Hardware IR intact; add separate correspondence and measured category
   coverage, including one actual BSV-metadata-RTL-netlist path.
3. Implement BSV-first body entry, semantic port/storage/relation details,
   exact source, explicit same-context implementation and Back restoration.
4. Run all six real-data scenes and ten user acceptance questions; retain
   prior importer/connection tests and original evidence.
5. Update all seven documents, ADR 008, evidence and a separate approval bundle.
   Stop for user design approval.

The subsequent gates are refined, not started:

- **G2:** production snapshot/import boundary plus the approved Source/Semantic
  adapter contract. No production netlist-only default.
- **G3:** BSV-source identities, method-port chains and then source-state/
  expression implementation provenance. Report each category; compiler-side
  origin export remains separate research, not an LSP installation task.
- **G4:** BSV-native nesting/typed relations first, explicit RTL detail second,
  one occurrence-preserving history across both.
- **G5:** rule/method/condition/read-write-call overlays and source-analysis
  round trips; physical net traversal remains its own operation.
- **G6:** scale/security/remote/native-package verification for both surfaces,
  including inlined/shared implementations and honest unresolved mappings.
- **G7:** integrated candidate only after every gate's evidence and user visual
  acceptance; merge/version/release remain separately authorized.

The original gate details below retain their fidelity/security requirements.
References there to hardware scene/rendering include both explicitly distinct
surfaces, not automatic `$cell` entry from a BSV module.

## G0: audit and baseline

Inputs: current repository, actual remote state, available supplied audits,
installed package identity, pinned external integration configuration.
Deliverable: [G0_AUDIT.md](G0_AUDIT.md), reproducible behavior evidence, baseline.
Completion: each named defect is reproduced or explicitly classified as not
reproduced with evidence; its cause and new owner are identified.
Do not repair cards as a substitute for the hardware product.

## G1: feasibility and approval candidate

Dependencies: G0 baseline and ownership findings.
Changed area: `docs/hardware/`, `experiments/hardware/`, isolated generated
evidence. Production `src/`/`media/` remain separate.
Completion:

- Three actual BSV designs compile and are read by one actual reader.
- Tool help, commands, versions, source/library/artifact hashes and pass stage
  are recorded. Parameterized reuse and generated control have real examples.
- Independent artifact comparison checks ordered connectivity and hierarchy,
  not just totals. BSV correspondence denominator and remaining loss are explicit.
- A data-driven interactive experiment preserves block/port/net references
  before and after expansion and exposes source/RTL evidence.
- Pointer and keyboard journeys exercise entry, inspection, Back/Forward/Up,
  repeated activation and source context; browser geometry is inspected.
- Product, feasibility, architecture, schema, UX, validation, plan and all
  seven ADRs are available for review.

Human gate: approve the design and click contract, or identify changes.
G1 ends here. Production migration does not begin while approval is pending.

## G2: snapshot and artifact fidelity

Dependencies: approved G1 provider/stage/schema.
Candidate files: `src/hardware/providers/yosys-json.js`,
`src/hardware/model.js`, `src/hardware/snapshot.js`, host import boundary,
focused importer tests and pinned compiler integration recipe.
Port the proven experiment only where it meets production contracts.

Completion:

- One real provider imports selected existing artifacts without compiler tools.
- Immutable snapshot covers all build-affecting inputs, dependencies, concrete
  parameters, tool identities, pass/options and artifact hashes.
- Definitions/occurrences/cells/ports/memory/unknown cells and ordered pins
  round-trip against an independent reference.
- Numeric bits are occurrence-scoped; aliases, constants, slices, reorder,
  fanout, inout and multiple drivers are retained with explicit semantics.
- Formal/actual crossings are exact and are the only hierarchical equivalences.
- Limits, malformed inputs, path/symlink escape and hostile JSON tests pass.
- Cancellation/failure cannot destroy the last valid snapshot; stale status is
  driven by actual source identity. No compiler runs in Restricted Mode.

Human check: unknown/unsupported/partial states are understandable.
Risk: raw process or memory semantics must be supported or rejected explicitly.
If too large, first ship a vertical slice for the measured process-lowered
artifact stage, not empty adapters for other stages.

## G3: correspondence

Dependencies: stable G2 IDs and provider evidence.
Candidate files: `src/hardware/correspondence.js`, BSC evidence provider,
existing source documents/range utilities, source resolution boundary.

Completion:

- Artifact-to-generated-RTL evidence includes correct hash/range semantics.
- Original BSV mapping uses a demonstrated compiler/metadata path, never names
  or type equality as exact proof.
- Direct, many-to-many, generated-for, inlined, shared, merged/removed and
  unknown are separately tested, with explicit evidence for removal claims.
- Source slices exactly match recorded text; Unicode byte/character/UTF-16
  conversion, stale buffers, approved libraries and external paths are tested.
- Both hardware-to-source and source-to-hardware require occurrence context;
  ambiguity offers candidates. Coverage includes all relevant hardware objects.
- If stock metadata is insufficient, evaluate the isolated exporter experiment
  described in feasibility, report the measured gain, and retain unmapped data.

Human check: a user can explain why each mapping has its status.
Risk: compiler-version-specific provenance; no upstream or user tool mutation.

## G4: nested scene and navigation

Dependencies: G2 hardware queries; G3 evidence attachment.
Candidate files: `src/hardware/scene.js`, `media/hardware-navigation.js`,
`media/hardware-view.js`, `media/hardware-layout.js`, host message contracts.

Completion:

- Single-click entry expands the same shell, with identical external ordered
  port/net membership and explicit continuation for hidden context.
- Canonical queries do not depend on collapsed state or viewport.
- Build/stage/occurrence, path, scene, selection, viewport and panels commit
  atomically after geometry/boundary validation.
- Back/Forward restore distinct scenes; Up and breadcrumbs navigate hierarchy.
  Repeated entry, double-click, dragging, stale async replies and cancellation
  cannot corrupt history or change two levels accidentally.
- Port/cell/wire inspection does not trigger parent entry; leaf and black box
  keep valid scenes. Header/path/actual scene agree after every action.
- All G0 navigation/count/unknown regressions remain covered.
- Actual browser pointer, keyboard, theme, narrow and reduced-motion tests pass.

Human check: readable same-boundary expansion, not a replacement card list.
Risk: crossing/overlap ambiguity and large fanout; compare a specialized layout
engine only if measured fixtures exceed the current renderer's supported ceiling.

## G5: hardware and code analysis

Dependencies: G3 correspondence and G4 interaction.
Candidate files: hardware query indexes/cone traversal, inspector, code drawer,
existing code-analysis queries and scheduling evidence integration.

Completion:

- Module-to-port-to-wire-to-cell-to-RTL-to-BSV and return works end to end.
- Same-net trace and cell-dependency/cone traversal are separate queries.
- Cones stop at sequential/unknown/memory/black-box boundaries by default.
- Driver/load, bit order, aliasing and hierarchy crossings are inspectable.
- Rule/method/source potential dependencies and scheduling remain separate
  relation families; no missing fire/readiness signals are invented.
- Predicates, body conditions, actual/formal arguments, writes and RHS
  dependencies retain their actual scope and evidence.
- Hidden results can be revealed; source-only helpers remain analyzable without
  claiming independent hardware cells.

Human check: evidence and source explanations help rather than replace hardware.

## G6: scale, security, compatibility and installed extension

Dependencies: complete G2-G5 vertical slice.
Candidate files: import/query workers, cancellation/limits, transport/cache,
VS Code host integration, browser/native tests, package inventory and CI.
Existing extension ID, commands, config namespace, source-only navigation,
exports and schedule provenance are preserved or explicitly migrated.

Completion:

- S/M/L fixtures measure import time, memory, expand/detail latency and frame
  delay on a recorded host. No object is dropped to meet the budget.
- Query ID/snapshot ID prevent stale results; partial/limited replies state
  limits and stop reason. Cancellation terminates child processes.
- Workspace Trust, executable/argv, approved source roots, zip/symlink/JSON
  input limits, CSP, text rendering and command/URL rejection pass real tests.
- Local/remote host tool identity and no-compiler import behavior are exercised.
- Official VSIX contains matching host/webview/schema/provider fingerprints.
  CRC/SHA256 and a clean isolated installed Extension Host smoke pass.
- Current pinned external-design revision/profile is recorded. Production
  sources are read-only; any separate wrapper/parameters are disclosed.
  Source/implementation hierarchy differences and true root independence
  survive the actual integration journey.
- Build-mismatch and legacy navigation migration/recovery are explicit.

Human check: actual integration design visual acceptance, not a small-fixture
or headless count substitute.

## G7: integrated candidate and separate release decisions

Dependencies: evidence for every earlier gate and resolution of blockers.
Completion: current candidate passes the complete evidence ledger, real
installed use, source/RTL correspondence measurements, compatibility and
security checks. Remaining limitations are specific and approved.

Report separately:

- design reviewed;
- toolchain feasibility demonstrated;
- artifact fidelity verified for the declared stage;
- original BSV/RTL mapping coverage;
- semantic zoom/navigation verified;
- packaged extension verified;
- user visual acceptance;
- release authorization.

Ask for main integration separately. Confirm the exact clean branch/HEAD/version
before any approved integration/release step; never force-reset a mismatch.
Version candidate, tag, GitHub Release and Marketplace publication each remain
outside implementation authorization. Do not broaden existing release triggers.

## Test allocation

Fast default suite: pure importer, snapshot, source evidence and navigation
regressions. Real-tool integration: pinned BSC/reader and reproducible artifacts.
Browser: actual pointer/keyboard plus semantic and geometry assertions.
Native: actual isolated installed VSIX and editor/source synchronization.
Large tier: recorded resources, cancellation and limits.

No timed sleeps, prose-pinning tests, skipped required release integrations,
or harness that calls only the semantic controller can replace these layers.
Each behavioral increment begins with a failing seam test that exposes it.
