# Hardware Schematic architecture

Status: proposed G1 contract. The experiment is separate from production.
Evidence-conditioned provider/layout decisions are recorded in ADR 003/006.
See G0_AUDIT for runtime reproductions rather than inferring defects from
the structural survey below.

## G2 product boundary

Implemented product ownership:

- `src/hardware/yosys-json.js`: validated provider data and connectivity queries.
- `src/hardware/json.js`: bounded JSON copy, safe dictionaries and sealing.
- `src/hardware/snapshot.js`: unknown-aware manifest, content identity and
  capability/freshness envelopes.
- `src/hardware/registry.js`: caller-owned path authority and source hash access.
- `src/hardware/import-worker.js`: cancellable CPU import in a real Node worker.
- `src/hardware/index.js`: public import and latest-request atomic publication.

No compiler or experimental source parser is imported by this product module.
The original experimental provider remains a historical comparison, not an
active product dependency. No extension UI or compiler command is hooked up.

The approved [G2 contract](G2_CONTRACT.md) promotes the verified artifact reader
and immutable, atomic import lifecycle into product-owned `src/hardware/`.
The original experimental importer remains a historical comparison artifact;
its checksum is not quietly replaced with the product version.

Source/Semantic IR continues to own BSV declarations/occurrences/relations.
The product importer owns the Implementation model only. Correspondence remains
a separate evidence relation with model/snapshot-qualified refs; importing
`src` attributes does not create original BSV causes or a BSV hierarchy.
No shared generic drawing graph substitutes for these three truth owners.

The host boundary reads approved files, checks hashes/limits/paths, stages
CPU import in a cancellable owned execution context, seals the result and
publishes only the current successful attempt. A failure, unsupported input,
abort or superseded result cannot replace a valid current snapshot.
Freshness is an observation about sources relative to a sealed snapshot,
not mutation of historical build identity.

Compiler execution and production UI integration are not part of G2.
Artifact-only provenance is explicitly unknown where no build manifest exists.
Private host path authority is not inferred from raw provider source attributes.

## Change history: BSV-native default

2026-09-06: [ADR 008](adr/008-bsv-native-default.md) and
[G1_BSV_CONTRACT](G1_BSV_CONTRACT.md) amend default presentation, not artifact
truth. G2 remains gated. The eight implementation/evidence boundaries below
remain useful, with these explicit ownership refinements:

- **Source Model:** reuse parser source documents, canonical declarations,
  rule/method/function definitions, statements/expressions and UTF-16
  ranges/revisions. Do not build another BSV parser.
- **BSV Architecture:** a contextual adapter/index over existing Semantic IR
  instances, endpoints, state behaviors and explicit bindings, joined with
  actual BSC hierarchy/type/port evidence. It owns source hardware composition
  and typed semantic relations, not a second netlist or a renamed `$cell` list.
- **Implementation Model:** existing Hardware IR/importer and immutable
  compiled snapshot, unchanged. It alone owns RTL pin/net/bit connectivity.
- **Correspondence:** separate Source-to-BSV identity/source evidence,
  BSV-to-RTL compiler relationships, and RTL-to-netlist provider references.
  A complete method-boundary chain does not imply leaf-expression cause.
- **Scene/renderer:** choose `BSV Architecture` or `RTL Implementation`
  explicitly. Generic drawing nodes/routes are projections with references,
  never the canonical truth for all three models.
- **Navigation:** one analysis history preserves BSV owner and snapshot across
  mode changes. Source selection/viewport are restored with the scene; Up
  follows the active hierarchy rather than pretending to be Back.

The default data path is Source Model plus BSC evidence into the BSV adapter,
then BSV scene/layout. Implementation selection follows only a verified
occurrence/port mapping or explicitly labeled containing implementation scope.
An inlined BSV occurrence may share a preserved RTL owner with other source
regions. That relation is not permission to assign all of its cells to the
source occurrence or to duplicate shared hardware.

## Current ownership and reuse

| Current path | Current responsibility | Treatment |
| --- | --- | --- |
| `src/architecture/analyzer.js:68` | Source loading/parsing, schedule collection, model assembly | Keep as source analysis; no compiled wiring claim. |
| `src/architecture/parser.js:63` | Content revision and parsed source document | Reuse immutable text/hash and source ranges. |
| `src/architecture/source-utils.js:3` | UTF-16 offsets and positions | Reuse after explicit compiler-coordinate conversion. |
| `src/architecture/semantic/model.js:30` | Definitions, source-derived occurrences, statements, expressions, bindings, flows and indexes | Keep Source/Semantic IR separate from Hardware IR. |
| `src/architecture/graph-builder.js:11` | Semantic model plus legacy presentation nodes/edges | Isolate from hardware truth; do not add pin-bit semantics here. |
| `media/semantic-query.js:10` | Queries over source semantic objects | Retain source/code queries; do not use as net traversal. |
| `src/compiler/bsc-schedule-provider.js:192` | Injected report/process I/O and schedule evidence | Reuse trust/capability concepts and actual schedule parser. |
| `media/navigation.js:168` | State application/history and semantic navigation | Keep for compatibility; new hardware controller owns compiled state. |
| `media/webview-layout.js:10` | Legacy level/mode node/edge layout | Not an electrical pin-aware layout. |
| `media/webview.js` | Legacy presentation, routing, selection, dimming and actions | Production remains intact during G1. |
| `src/panel/architecture-panel.js:296` | Source ownership, revision/text check, editor reveal | Reuse validation boundary, extend to historical compiled text. |
| `src/security/workspace-boundary.js:15` | Canonical path/symlink containment | Reuse principles; trust is not unrestricted artifact path authority. |
| `src/build-info.js:6` | Extension runtime/package identity | Keep separate from HDL BuildSnapshot. |

The existing SVG technology is reusable. Existing decorative port circles,
rectangle-center routes and card/member layouts are not compiled pin semantics.

## Data flow

```text
SourceAnalysisProvider ----- SourceModel -------- Source/code queries
                                     \               /
BscEvidenceProvider ---------- Evidence records ----/
                                      |
Build input manifest -> actual compile -> generated RTL
                                      |
                         one verified RTL/netlist reader
                                      |
                       immutable BuildSnapshot + artifacts
                                      |
                     HardwareArtifactProvider / validation
                                      |
                              HardwareModel
                                      |
                  CorrespondenceBuilder + evidence indexes
                                      |
                             Hardware queries
                                      |
                   Navigation intent -> Nested Scene
                                      |
                        Layout -> SVG renderer
                                      |
                    selection/evidence/source requests
```

The arrows above describe data flow, not hardware wires. Only the imported
ordered bit and formal/actual relations define circuit connectivity.

## Eight boundaries

### BuildSnapshot

Owns one sealed build/stage's inputs, dependencies, parameters, options,
tool identities, pass sequence, artifact hashes and capability declarations.
A build attempt is not a successful snapshot. Failure/cancellation does not
erase the last successful result.

`buildInputFingerprint` identifies relevant inputs. `snapshotId` also includes
output artifact hashes and stage. `hardwareModelId` adds importer/schema identity.
Timestamp and absolute display paths are not cache identity.

Freshness is a separate envelope over an immutable snapshot. A changed editor
buffer makes correspondence to the current editor stale, not the compiled
hardware wrong. Missing original inputs yield unknown build provenance, even
when a pure imported artifact has verified structure.

### Hardware IR

Owns lossless definitions, occurrences, cells, ports/pins, local signal bits,
net aliases, memories, constants, raw attributes and hierarchy bindings.
Identity is qualified by model and occurrence. Definition-local bit `7`
materialized under two instances is two signals.

A module-instantiating cell and its child occurrence refer to one actual
instantiation, not two resources. Count cell templates and occurrences
separately. Shared logical source membership does not change hardware ownership.

### Source IR

Owns declarations, syntax, statements, expressions, calls, bindings, predicates,
source references and source-derived semantics. Source-only queries remain
useful without a compiler, under an explicit preview mode.
Source definition and compiler occurrence are not interchangeable IDs.

### Correspondence IR

Owns evidence-bearing many-to-many links among hardware, generated RTL and BSV.
It neither creates connections nor resolves uncertain matches by name.
Different evidence revisions may enrich the same immutable hardware model.
Coverage uses the entire scoped hardware population, not only successful links.

### Analysis Query

Read-only indexes expose children, ports, same-net endpoints, boundary crossing,
cell-dependent cones and correspondence. Queries cannot depend on layout,
selection, collapsed state, or currently mounted DOM.
Net continuation does not cross cell input-to-output. Cone traversal may do so
only under a verified cell-semantics contract and stops at sequential/unknown
boundaries by default. Schedule and potential source dependencies stay distinct.

### Nested Scene

A pure projection selects materialized hierarchy depth and visible detail.
Every object carries `hardwareRefs` or an explicit presentation-only role.
Collapsed/unloaded is not absent. Shell, anchor and bit membership remain
stable across expansion; portals are not hardware cells.

### Layout / Renderer

Layout owns measured bounds, ranks/SCCs, channels and routing geometry.
Renderer owns SVG nodes, hit targets, labels, accessibility and emitted intents.
Neither resolves source, wires ports by names, decides history, nor alters
canonical objects to improve a picture.
Routing failure preserves inspectable endpoints and the last valid scene.

### Navigation State

Owns snapshot/model, hierarchy path, scene root/expansions, analysis location,
selection, source drawer, cone options, viewport and history.
Selection is not containment. History records distinct semantic locations;
incidental pan/hover/inspection state is saved with the current location.

## Two transactions

**Build/import:** stage input; enforce limits and hashes; import and index;
validate canonical structure and evidence; prepare initial scene; atomically
publish model/scene/context. A failed stage cannot replace a successful one.

**Entry:** validate target/model; prepare child data and actual boundary bindings;
project stable shell/anchors; compute and validate geometry; save current scene;
commit next scene/path/history/viewport together. Motion visualizes an already
valid transition and cannot determine its result.

Async requests carry query/transition ID, model ID and expected scene revision.
Late replies are ignored. Cancellation includes child-process termination;
a pending process exit is not proof of successful cleanup.

## Host, worker and browser

Production host/worker owns I/O, compiler/reader execution, path allowlists,
schema validation, snapshots and expensive queries. Webview receives bounded
read-only scene/evidence payloads and emits typed intents. It cannot execute
Tcl/Make/plugins or read an arbitrary artifact-supplied `src` path.

The G1 loopback experiment exercises pure import, scene and UI responsibilities.
It has explicit source/artifact allowlists and no browser compiler execution.
It is not proof of Workspace Trust, remote host support or VS Code editor
selection. Those require actual host/installed-package gates.

## Performance and growth

Do not equate complete model with complete DOM. G2 indexes enable per-occurrence
materialization, bounded fanout replies and independently versioned evidence.
Only one provider and one renderer need production paths.

Proposed acceptance budgets, to be recalibrated by G1 measurements on the
recorded Apple M5 Pro/18-core host:

| Tier | Model/scene | Proposed G6 budget |
| --- | --- | --- |
| S | About 100 visible objects | Cold import under 1 s; ready-model detail under 100 ms; expansion under 250 ms. |
| M | About 1,000 visible objects, larger hidden model | Import under 5 s; detail under 150 ms; expansion under 500 ms. |
| L | At least 10,000 cells and full pin-bit connectivity | Import under 30 s with progress/cancellation; bounded first scene under 1 s after import. |

Record peak memory and pan/zoom frame delay rather than inventing achieved
limits. Proposed interaction budget is p95 frame delay under 32 ms for S/M on
the recorded host; L uses explicit materialization limits, not discarded nets.
These are future acceptance targets, not G1 pass claims. G1 measurements
and the tested layout ceiling appear in the evidence report.

## Migration boundary

Existing Architecture schema 3, codeAnalysisVersion 1, navigation version 2,
extension build identity, and new hardware schemas are independent versions.
Keep compatibility exports and source commands while compiled mode is added.
Legacy state migrates explicitly or starts with a stated recovery; object names
cannot reattach a historical selection to a different snapshot.

The current feature branch contains an experiment and design package.
Only approval authorizes the G2 production paths in IMPLEMENTATION_PLAN.
