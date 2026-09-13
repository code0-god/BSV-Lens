# G1-BSV amendment

Status: implementation/design amendment requested by the user; G2 is NOT
authorized. This supersedes the interpretation that the netlist is the sole
composition basis of the default scene. It does not discard the original
master's artifact fidelity, evidence, security, immutable snapshots,
occurrence identity, Back/Up separation, tests or approval gates.

## 1. Preserve G1

Keep the actual three compiled BSV designs, importer/Hardware IR, ordered
net/bit connectivity, snapshot, hashes, source ranges and renderer experiment.
The existing `$add/$mux/$eq/$dff` view is **RTL Implementation**, not an approved
BSV default. Preserve current branch/version and user changes. No reset/clean,
production replacement, commit/push, main merge, version change, tag, Release
or publish is authorized.

## 2. Default abstraction

Show BSV module occurrences, state/storage occurrences, interfaces/subinterfaces,
typed method boundaries and evidence-backed invocation/value/forwarding
relations. Do not default to Yosys cells, generated temporaries, generic pins,
ProtocolChannel cards or method/endpoint/type/file/directory buckets.
This is a hardware architecture view of the BSV design, not a Source Map.

## 3. Read the actual source

Use the unchanged `Connected.bsv`, `Control.bsv` and `Reuse.bsv` fixtures.
For `mkConnected/left`, `mkStage` actually declares
`Reg#(Bit#(8)) state <- mkReg(0)`, `Action put(Bit#(8) value)` assigning
`state <= value + 1`, and `Bit#(8) get = state`. No rule or child module is
declared there. Do not rename a `$dff` or `$mux` into these source objects.
Every displayed BSV-named object carries definition identity, occurrence
context, exact source range and source revision. Distinguish compiler-backed
facts from source-derived facts.

## 4. Default expansion

BSV System Architecture; click a BSV module occurrence; inspect its BSV child
instances/storage/typed boundaries; select a relation or storage; inspect the
using rule/method/expression; explicitly open RTL Implementation if wanted.
A module without child modules still exposes its state and behavior context.
Functions/expressions are semantic operations, never invented hardware modules.

## 5. Canvas and details

Module occurrences enclose children/storage. Interfaces/methods are boundary
contacts. Source names/types lead. Typed semantic relations connect actual
occurrences and boundaries. Selection shows the driving rule/method, explicit
predicate, body path condition, read/write/call relation and source evidence.
Rules/methods are behavior overlays, not unconditional physical blocks.
Storage internals do not automatically expand to generic RTL cells.
RTL detail preserves the selected BSV owner/build/source context and highlights
only verified correspondence, retaining unmatched cells honestly.

## 6. Method boundaries

Use BSV interface/subinterface/method names by default. Details show
Action/Value/ActionValue, typed arguments/result, connected occurrence,
source implementation, and confirmed readiness/enable mappings.
Show RDY/EN/argument/result RTL signals only after explicit disclosure.
Do not synthesize names or presence from method naming conventions.
Request/response grouping is auxiliary, not a block.
Unknown/composite/no-single-payload is not no-payload or control-only.

## 7. Relation families

BSV semantic facts: composition, forwarding, constructor interface bindings,
method invocation, argument/result flow and state read/write.
RTL facts: actual pins/ports, nets, ordered bits/slices, drivers/loads and fanout.
Each selected semantic line exposes relation kind, source statement/evidence,
compiler confirmation and whether an actual RTL correspondence exists.
Exact source invocation is not automatically an exact netlist wire.

## 8. Reuse model ownership

Source Model owns declarations, behavior, statements/expressions and source
ranges/revisions. BSV Architecture owns contextual hierarchy, typed interfaces,
storage and explicit bindings/behavior relationships with optional compiler
confirmation. Implementation Model owns generated RTL/netlist and stage.
Correspondence has separate Source-to-BSV, BSV-to-RTL and RTL-to-netlist links.
Reuse existing Source/Semantic/Hardware IR through an explicit ADR; do not
create overlapping truth models or use one generic nodes/edges array as truth.

## 9. BSC evidence first

Prioritize actual installed BSC/Bluetcl hierarchy, elaboration context,
interface/method/type, rule/schedule, source position and method-to-port output.
Do not assume a command, flag, field or exporter exists. Record versions and
actual examples. Source parsing supplements this evidence; LSP availability
has no bearing on compiler provenance completeness.
Missing information names the field, exporter/sidecar, proposed emission point
and actual prototype result.

## 10. Coverage and representative chain

Preserve the original exact-cause gaps: 0/53 leaf cells and 0/168 netnames.
Never replace them with declaration-link counts. Report separately:
BSV instance/source; method-rule/source; storage/source; method/generated ports;
state-expression/RTL; RTL/netlist cells-nets; and complete BSV-to-netlist chains.
Distinguish netname aliases, local scalar bits and canonical connectivity.
Demonstrate at least one actual BSV instance/state/method through compiler
metadata or generated RTL to a real cell/net. If a category fails, explain
why and plan exporter work. A declaration link is not cell-level cause mapping.
Full leaf-cause mapping across the three designs is not required in G1-BSV.

## 11. Inlining, sharing and generated circuitry

Separate source occurrence, compiler-confirmed occurrence, retained RTL
boundary, inlined implementation, shared implementation and compiler-generated
logic. Do not add synthesis boundaries or change source for a picture.
Retain many-to-many shared provenance. Do not assign unmatched cells to a BSV
block by an inferred role/name.

## 12. Navigation

Body click enters the same occurrence; port/relation click inspects code.
RTL detail is an explicit implementation-stage navigation. Back restores the
previous distinct analysis scene, Up its actual parent. Identical entry adds
no history. Mode changes preserve owner occurrence, immutable snapshot,
selection, source context and viewport. Static 50% frames remain separate
from proof of actual runtime interaction.

## 13. Delivery

Update PRODUCT_SPEC, FEASIBILITY, ARCHITECTURE, SCHEMA, UX_DESIGN,
VALIDATION_MATRIX and IMPLEMENTATION_PLAN with explicit amendment history.
Required ADR: **BSV-native default architecture; RTL implementation on demand**.
Required real-data executable states: A overall BSV structure; B BSV module
interior; C port/storage selection and behavior relations; D original source;
E same-context RTL Implementation; F Back to the prior BSV scene.
Neither static pictures nor label replacement qualifies.

## 14. Acceptance and stop

The evidence must answer all ten user questions: BSV-readable architecture
without RTL knowledge; real source names/types/occurrences; source statements
behind connections; no fake rule/method hardware blocks; explicit RTL detail;
distinct source versus RTL evidence; representative verified chain; visible
unmapped hardware without guesses; same occurrence through click/Back; and
preserved importer/connectivity fidelity.

Final report names reused work, default design change, actual tool evidence,
category coverage, representative chain, runtime results, blockers and revised
G2-G7 plan. Stop for user design approval; do not start G2.
