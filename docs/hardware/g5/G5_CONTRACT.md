# G5 Hardware / Code Analysis

## Authorization and baseline

The user authorizes G5-0, G5-A, G5-B, G5-C and G5-D on the existing
`feat/hardware-schematic` worktree. Version remains `0.4.1`. G6/G7,
production replacement/deletion, commits, pushes, merges and release actions
are not authorized. User visual/design acceptance remains PENDING.

The pre-G5 runtime is the delivered G4 fix, not merely Git HEAD. Its
258-file identity is
`7817fcefc809ac050cdd71ff4aa037824033e073c5c2f6a3c9cbd317c2db3601`.
Entry HEAD and locally known origin/main are
`c6b9a5c642d105ad4117535c1d85366f1c02ec1c`.
Existing tracked/untracked work is retained.

The initial preservation inventory contains 6,636 files and has identity
`0d603cfdc519ef8663c4df47254d13304a11296a662d79f7a9883f2c1be0775b`.
Its author path is
`.build/hardware/runs/g5-baseline-wJO0P1/g5/baseline.json`.
Every new execution uses a unique run directory with a `g5/` child.

`G4_FIX_REPORT`, `GATE_INITIAL` and `GATE_RECHECK` describe the actually
available G4 implementation and independent reviews. The separately named
`G4_FIX_BSV_INDEPENDENT_REVIEW.md` was not found in the project, Downloads,
Desktop or Documents, and has not been represented as read. Its path was
requested without blocking work supported by the supplied G5 contract.

## Existing owners reused

| Responsibility | Existing implementation |
| --- | --- |
| Source bytes, revisions and code records | `src/architecture/parser.js`, `code-analysis.js`, `behavior-analysis.js`, `semantic/` |
| Source query and callable resolution | `media/semantic-query.js` CommonJS API |
| BSV modules, storage, contacts and relationships | `src/hardware/architecture.js` |
| Immutable implementation and incidence | `src/hardware/index.js`, `yosys-json.js`, `snapshot.js` |
| Approved file authority and captured/current reads | `src/hardware/registry.js` |
| Stock contracts/connectivity and partial contributors | `src/hardware/correspondence/index.js`, `origin.js` |
| Range normalization and evidence identity | `src/hardware/correspondence/source.js`, `schema.js` |
| Scene and summary projection | `src/hardware/scene-query.js`, `scene.js`, `scene-summary.js` |
| Atomic occurrence navigation and restoration | `media/hardware-navigation.js` |
| Renderer, wire hit testing and Inspector | `media/hardware-view.js`, `hardware-inspector.js`, `hardware-layout.js` |
| Worker exit/cancellation and latest publication patterns | G2 import and G3 correspondence/origin sessions |
| Public experimental host and real captured catalog | `experiments/hardware/g4/server.js` |

G2 exposes local ordered incidence and explicit formal/actual crossings. It
does not expose a general same-net component query or cell semantics. G3
method-specific connectivity claims are evidence, not a substitute general
net API. Display `rtl-net-*` groups are not canonical component identities.

## New G5 responsibilities

1. A product-owned, immutable-input analysis query layer over the existing
   models, with explicit identity, ordered seeds, scope, limits and outcomes.
2. Derived boundary adjacency and terminal-role classification using only G2
   incidence and verified bindings. No replacement parser or connectivity truth.
3. A versioned, minimal cell-semantics profile for the actual captured corpus.
4. Bounded backward/forward dependency traversal with typed edges/frontiers.
5. Source-analysis joins for state access, method actual/formal context and
   code details using existing canonical source records.
6. Explicit G3 explanation actions, without adding or propagating claims.
7. Existing Inspector/code detail integration, canonical highlight projection,
   hidden-target reveal and history that restores complete analysis state.
8. Public CLI/HTTP access to the same product query and independent replay,
   reference, negative, geometry and real pointer/keyboard evidence.

## Relation families

Same-net equivalence, cell-internal possible dependency, BSV source
behavior/data flow, G3 correspondence/origin and scheduling remain separate
families. Containment is not payload connectivity. A cell's input and output
are never unioned. A cone does not increase source-origin coverage.

Same-net uses only canonical local bit identity and recorded boundary bindings.
Repeated selected positions and vector order survive result normalization.
Literal sites retain connection-local IDs, including when an actual constant
is connected to a formal bit through a real hierarchy binding.

Driver/load results distinguish leaf terminals, selected-root external
contacts, hierarchy pass-through, constants, inout, unknown directions and
opaque contracts. Multiple observed candidates are not a contention diagnosis.

## Cell dependency policy

The profile is `yosys-0.68-structural-v1`. It is a conservative structural
query, not simulation, an active path, timing, readiness or origin.
The official reader revision and exact reference bytes are recorded in
`G5_CELL_SEMANTICS.md`.

No two-state runtime assumption is made. In particular, add/sub dependencies
conservatively include all operand bits for each output bit: unknown values
can poison a word operation. This is an explicit supported-cell policy,
not an all-input/all-output fallback for unknown types.

Mux data is per-bit; select is separately typed control dependency. Parallel
mux multi-select behavior remains undefined, not priority semantics. No
constant or x/z branch pruning is performed. Widths, signedness, parameters
and actual pin directions/lengths must match the supported profile.

Default traversal stops at registers, latches, memories, blackboxes, unknown
cells/parameters/directions, scope boundaries and resource limits. D and Q
remain distinct. An explicit next-state query is a new analysis, not a hidden
time-boundary crossing. Forward consumers and backward dependencies preserve
their actual edges, cycles, reconvergence and stopping frontiers.

## Source/code and evidence policy

Storage declarations, types, initializers, reader/writer behaviors, predicates,
signed body path conditions, RHS expressions and calls use original source
records and exact ranges. Body conditions, explicit predicates, readiness,
scheduling, assertions and state effects are independent fields.

Method actual/formal context joins existing call-site expression IDs,
occurrence-specific bindings and endpoint formals; helper-function mappings
reuse existing semantic queries. Unresolved lexical/branch/specialization
cases remain explicit. Source-only helpers never acquire fake hardware.

Stock left.get remains method/port/net/pin connectivity. Only actual G3
instrumented query targets receive verified-known-contributor status.
Complete origin sets remain unestablished. Unmapped nodes stay in the result.
Generated RTL evidence paths grant no file-reading authority.

Original source hashes, normalized UTF-16 ranges and approved registered
references govern source opening. Captured and current source are labeled
separately. The experimental drawer is read-only source QA, not native editor
integration.

## Interaction, projection and history

Use contextual actions rather than one generic Trace button or new top-level
tabs. Keep the existing BSV-native scene and single-click hierarchy contract.
Analysis reads canonical models, never the DOM, viewport or collapsed objects.

The first implementation projects onto existing valid geometry and lists
off-scene results/frontiers with explicit reveal. It does not need a second
router or a new circuit model. Display limits and analysis scope are different
and separately counted. Seed, result and boundary have non-color markers.

An explicit analysis change records kind, normalized seed/order/slice, scope,
direction, semantics profile, result identity, selected source/call site,
Inspector/drawer/disclosure and viewport. Hover and progress do not create
history. Identical queries deduplicate. Back/Forward restore full frames;
Up follows actual current-surface hierarchy.

Resolve authority, execute bounded work, validate current generation/snapshot,
validate projection, then commit. Failure/cancellation/staleness/layout failure
leaves the previous scene, result and history intact. Worker cancellation
settles on exit, not merely a reported flag.

## Unsupported scope

No new compiler/exporter, origin coverage expansion, whole BSV compiler,
four-state value simulator, timing analysis, sensitized-path engine,
new scheduling compiler, general memory model or unbounded-scale promise.
No global installation, PATH/profile mutation or policy/CSP bypass.

Unavailable source, unknown semantic parameters, stale requests, ambiguity,
normal empty completion and explicit scope/resource frontiers have different
results. Existing G2/G3 truth, F1/F2 tests, inputs, historical evidence and
archives are preserved.

## Execution and evidence

Implement G5-0 contracts and failing seams, G5-A signals/Inspector, G5-B
dependencies, G5-C source/history, then G5-D real journeys and delivery.
Do not ask for the same authorization at each checkpoint.

Required automated cases are Q01-Q08, D01-D08, S01-S08 and X01-X06, plus the
ten hostile inputs and independent-oracle mutations in the user contract.
Actual A/B/C paths and J01-J15 use real product output and pointer/keyboard
actions. Synthetic edge cases are labeled separately.

Deliver six G5 documents, four ADRs, new review/source ZIPs, external checksums,
raw commands/receipts, traces/captures and complete indexed evidence closure.
Replay each ZIP in a distinct empty external directory without compiler,
node_modules, global module lookup or author-workspace symlinks. The existing
14 missing author companions must still fail explicitly. Final stage statuses,
performance, unsupported cases and unrun native/compiler checks remain honest.
