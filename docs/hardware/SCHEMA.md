# Hardware Schematic schema contract

Status: G1 proposed application schema, not a BSC/Yosys exporter specification.
The actual experiment API is specified below. Production normalization may
change field spelling, not the invariants below.

## G2 contract refinement

### Executed product API

`require('./src/hardware')` exposes the product-owned import/lifecycle boundary.
It has no dependency on the experimental importer, compiler tools or renderer.
The original `experiments/hardware/importer.js` remains a byte-identical
historical reference for independent comparisons.

```js
const h = require('./src/hardware');
const registry = h.createArtifactRegistry({
    artifactRoots: [approvedArtifactRoot],
    sourceRoots: [approvedSourceRoot],
    workspaceTrusted: false
});
await registry.registerArtifact({ pathRef: 'design', path: artifactPath });
const result = await h.importArtifact({ registry, artifactRef: 'design', signal });
```

Manifest is optional. Omitted stage/tops/source/dependency/tool/pass/options/
parameter inputs remain `null`, appear in `unknownInputs`, and produce partial
input completeness. Inferred roots are separately recorded in `topSelection`
as artifact-derived, not falsely declared build inputs.

The deeply frozen result is `{snapshot, implementation, availability, contracts}`.
Snapshot and implementation share the same snapshot identity; the implementation
has its own model ID/schema version. `snapshot.structure` records structural
verification independently of `availability.status` (`ready/partial/stale`).
`availability.importStatus/importReason` preserve capability state across later
freshness checks. Opaque cells/memory, black boxes and unknown directions are
retained with explicit limitations. BSV/source/correspondence contracts say
`not-attached`; they are not empty synthetic models or inferred origin maps.

Registry source registration accepts a logical ref, approved path and exact
`contentHash`, with optional capture. `readSource({pathRef,contentHash,range})`
uses UTF-16 half-open offsets and returns `current/captured/stale/unavailable`.
Stale current text is never returned as a hash-matching old slice.
Captured original text is explicitly labeled captured. Private host paths
remain registry-owned; raw provider `src` metadata grants no file access.

`createImportSession()` publishes only the latest successful request.
`import(request)`, `cancel()`, `refresh(registry)` and immutable `getState()`
separate import attempts from the last valid current snapshot.
Real worker `importing/exited` events make cancellation observable.
Cancellation settles after termination; invalid, unsupported, stale and
superseded attempts retain the prior current result.

Failures use codes `INVALID_INPUT`, `UNSUPPORTED`, `LIMIT_EXCEEDED`,
`PATH_DENIED`, `ARTIFACT_HASH_MISMATCH`, `CANCELLED`, `SUPERSEDED`,
`STALE_SOURCE`, or an underlying filesystem error.
Codes are assigned at actual failure sites, never inferred from message text
or provider-controlled names. Malformed vectors are invalid input; exceeding
an actual vector limit is a distinct limit failure.
Only bounded UTF-8 Yosys JSON is supported. Raw behavioral processes are
unsupported, not silently omitted. The provider exports the preserved ordered
connectivity queries from `src/hardware/yosys-json.js`.

[G2_CONTRACT](G2_CONTRACT.md) now authorizes a product-owned importer and sealed
snapshot/lifecycle. Model ownership is explicit: BSV Architecture refs point
to source/semantic occurrences, Implementation refs point to artifact objects,
and Correspondence records link them with their own evidence/status.
An implementation import does not synthesize a BSV Architecture or exact
original-source correspondence record.

The result contract distinguishes valid supported import, partial capabilities,
unsupported representation, invalid input, cancellation and supersession.
Preserved unknown data is not the same as missing connectivity.
Unknown build inputs/stage/source provenance are not encoded as falsely known
empty inputs. A source freshness result is separate from immutable snapshot
identity and canonical artifact fidelity.

Publication is atomic. Snapshot/model collections exposed as canonical data
must not be mutable renderer state. Path refs are identifiers; host-owned
approved roots and current source hash determine whether file/range access
is permitted. Raw provider attributes remain lossless but untrusted.

Future summary connections are presentation records with snapshot/owner,
visible endpoint identity, direction, semantic family and complete member
relation IDs. They preserve each member's source/predicate/evidence scope.
They do not introduce a new physical net or aggregate confidence by selecting
the strongest member.

## Change history: G1-BSV model ownership

2026-09-06: the user selected BSV-native default architecture and on-demand
implementation detail. The existing Hardware IR schema/API below remains
unchanged and authoritative for its artifact. A BSV architecture adapter
references existing Source/Semantic IR instead of making those facts from
netlist cells. [ADR 008](adr/008-bsv-native-default.md) owns this distinction.

### Executed BSV adapter

`experiments/hardware/bsv-architecture.js` exports
`buildFromCatalog(build, {read?})` for the existing ready catalog entry and
`buildBsvArchitecture({parsedFiles, semanticModel?, compilerMetadata?,
compilerArtifact?, implementationModel?, correspondence?})` for its pure seam.
Compiler metadata is actual raw JSON text with a hashed artifact/source input
envelope. The original importer/model is not mutated.

The serialized view contains `snapshotId`, roots, dictionaries `occurrences`,
`storage`, `boundaries`, `behaviors`, `relations`, existing `sourceDocuments`,
`gaps` and `coverage`. Canonical source/semantic IDs are reused. The dictionaries
are a contextual adapter, not generic renderer nodes/edges.

Each entry's `sourceEvidence` has `sourceDocumentId`, `pathRef`, file `revision`,
UTF-16 half-open `range`, zero-based `sourceRange`, exact `text`, slice `sha256`
and `role`. File revision and slice hash are different values. Storage uses the
canonical state-declaration anchor as definition identity, not an invented
library module definition.

Queries: `getChildren`, `getPorts`, `getStorage`, `getBehavior`, `getRelations`,
`getSourceRefs`, `getRtlContext`. RTL context returns status
`verified/candidate/unknown`, BSV owner, actual implementation occurrence or
containing context, evidence and exact `highlightEntityIds`.
Inlined source occurrences have no owned RTL occurrence; a containing wrapper
may be a candidate context with no invented highlight.

Typed method contacts retain `methodKind`, typed arguments and result status
`typed/none/unknown`, alongside declared symbolic types and compiler concrete
types. Their `rtlSignals` array contains actual metadata only and is not a
default port list. The three-source view has 22 contextual contacts and 45
occurrence-level signal mappings; the original definition-level count is 40.

Relations retain separate `explicitPredicate` and `bodyPathConditions`.
Predicate text is source-exact but explicitly not evaluated, because the
existing mixed-operator predicate AST has known limits. Compiler confirmation
may establish method/state *use*, not an exact source statement, argument
expression or physical wire; its `scope` must remain visible.
Inline value methods and wrapper returns have declared bounded parser
limitations. Reused access evidence and bounded module-return analysis do not
pretend a missing expression AST or exact compiler body range exists.

The adapter's required contracts are:

| Record | Required identity/evidence |
| --- | --- |
| BSV module occurrence | Source definition ID, contextual occurrence path/parent, source range/revision, compiler occurrence confirmation or explicit unknown. |
| Storage occurrence | Actual source declaration/constructor/type, source definition anchor, owning occurrence, range/revision; implementation correspondence separate. |
| Interface/method contact | Actual interface/subinterface path, method definition identity, Action/Value/ActionValue, typed arguments/result, owner, range/revision. |
| Semantic relation | Kind, source statement/expression reference and exact slice, owner/callee occurrences, explicit predicate and body path, compiler confirmation, optional RTL refs. |
| Behavior overlay | Canonical rule/method/expression ID, source range/revision, using/writing/reading/calling relationships; never implicitly a hardware cell. |
| Implementation link | Snapshot-qualified hardware refs plus actual compiler/provider evidence and scope; exact, contextual, ambiguous or unmapped. |

Permitted semantic relation kinds include constructor interface binding,
interface forwarding, method invocation, argument/result flow and state
read/write. Their identity and evidence are separate from actual same-net
connectivity. Names/types alone cannot create an implementation link.

Every BSV scene object references canonical source/semantic IDs; every RTL
scene object references Hardware IR IDs. Scene-only containers are explicit.
The old `hardwareRefs` field is not sufficient for a BSV semantic scene:
projection records additionally identify scene/relation family and source/
semantic refs without turning them into physical cells or wires.

Navigation adds an explicit scene kind, BSV owner occurrence and retained
source context to snapshot/selection/viewport/history. Mode changes record one
distinct scene transition. Returning from implementation restores the complete
prior BSV location; an equal re-entry does not append history.

Coverage keeps the original 0/53 exact leaf causes and 0/168 exact netname
causes visible as a separate baseline. Instance, behavior, storage, method-port,
state/expression implementation and complete-chain categories each have their
own denominator. Netnames are aliases, not the count of normalized electrical
connectivity components.

## Executed G1 representation

`experiments/hardware/importer.js` exports CommonJS and browser
`globalThis.HardwareImporter`. Node performs import; the browser can query the
JSON-serialized result without Node or file access.

```js
const hardware = require('../../experiments/hardware/importer');
const model = hardware.importYosys(jsonText, {
    artifact: { hash: sha256OfOriginalUtf8Bytes, pathRef: logicalArtifactRef },
    stage,
    tops,
    toolchain: [{ name, version, identity }],
    passSequence,
    buildOptionsFingerprint,
    sourceInputs,
    dependencyFingerprint,
    concreteParameters
});
```

Text import independently checks original artifact bytes against the supplied
SHA256. Parsed-object import cannot recover original bytes; its artifact hash
is caller-attested and the host must check those bytes before calling.
Canonical content and snapshot metadata still participate in model identity.
Caller `id` and resource `limits` do not define identity.

The model is JSON-friendly: `raw`, `snapshot`, `roots`, `status`, `limitations`,
`limits`, and null-prototype ID tables `definitions`, `occurrences`, `cells`,
`ports`, `pins`, `bits`, `aliases`, `memories`, `boundaries`, `entities`.
Every entity has `providerRefs: [{artifactHash, pathRef, pointer}]`.
Definition dictionaries retain all provider definitions; materialized
occurrences are the selected-top reachable hierarchy. These are different
count denominators.

| Experiment field | Required meaning |
| --- | --- |
| occurrence `parentId`, `cellId`, `definitionId`, `path`, `children`, `cells` | Actual containment; `children` are module occurrences, `cells` include leaves. |
| cell `raw`, `type`, `parameters`, `attributes`, `pins`, `childOccurrenceId` | Lossless provider cell and instantiated child relationship. |
| port/pin `rawBits`, `bits`, `direction` | Original ordered vector, canonical bit IDs, and nullable unknown direction. |
| bit `value`, `occurrenceId`, `endpoints`, `aliases` | Local signal or connection-site constant, with endpoint roles and evidence. |
| alias `raw`, `rawBits`, `bits` | Raw offset/upto/signed metadata and ordered named view. |
| boundary `actualBitId`, `formalBitId`, `pinId`, `portId`, `index` | Exact declared parent/child binding at one ordered position. |

Queries implemented in G1:

```js
hardware.getChildren(model, occurrenceId);
hardware.getPorts(model, occurrenceId);
hardware.getNetEndpoints(model, occurrenceId, bitOrVector);
hardware.crossHierarchyBoundary(model, childOccurrenceId, portName, index, 'out');
hardware.getGeneratedEvidence(model, entityId);
```

`getNetEndpoints` returns an ordered array, not a deduplicated unordered set.
`crossHierarchyBoundary` uses `'into'` for the reverse direction; null means
no binding, including a provider's explicitly empty unconnected pin.
Constants require canonical connection-site IDs, not a numeric value lookup.
`getGeneratedEvidence` does not open files. Its RTL metadata is
`unvalidated-no-file-read`; BSV is unmapped until a separate evidence provider
adds a verified relation. An ancestor RTL range is context, not an exact bit
or expression origin.

The importer explicitly rejects raw processes. Memories remain lossless opaque
data with no invented traversal semantics. Default boundary limits: 16 MiB
text, JSON depth 64, 1,000,000 JSON nodes, hierarchy depth 64, 10,000 occurrences,
250,000 entities and vector width 65,536.
The independent test suite includes all three genuine compiled artifacts,
deterministic generated edge cases, provider-pointer resolution and browser
serialization. Its runtime receipt is `.build/hardware/importer/README.md`.

## Encoding and version ownership

Separate `snapshotSchemaVersion`, `hardwareSchemaVersion`,
`correspondenceSchemaVersion`, `sceneSchemaVersion` and `navigationVersion`.
Existing Architecture `schemaVersion: 3` and codeAnalysisVersion 1 are unrelated.

Canonical IDs encode tuples unambiguously (for example JSON arrays), including
model/snapshot context. Display paths are token arrays, not a slash/dot parser:
escaped RTL identifiers may contain punctuation.
Hash unordered dictionaries in stable key order. Never sort ordered vectors.
Untrusted dictionaries require own-key lookup or Map/null-prototype storage.

The following types define the proposed required semantics. `null` means
unknown where specified, never a false/empty fact.

```ts
type Hash = `sha256:${string}`;
type Ref = string;
type Constant = "0" | "1" | "x" | "z";
type Direction = "input" | "output" | "inout" | "unknown";
type Bit = { kind: "signal"; occurrenceId: Ref; providerBit: number }
         | { kind: "constant"; value: Constant };

interface ArtifactRef {
  id: Ref;
  kind: string;
  hash: Hash;
  pathRef: Ref;             // private host registry key, not an arbitrary URI
  displayPath: string;
}
interface InputRef {
  pathRef: Ref;
  contentHash: Hash;
  role: "source" | "library" | "include" | "configuration";
}
interface BuildSnapshot {
  snapshotSchemaVersion: 1;
  id: Ref;
  stage: string;
  tops: string[];
  concreteParameters: Record<string, string>;
  sourceInputs: InputRef[];
  dependencyFingerprint: Hash;
  toolchain: Array<{
    name: string;
    version: string;
    identity: Hash | string;
  }>;
  passSequence: string[];
  buildOptionsFingerprint: Hash;
  artifacts: ArtifactRef[];
  capabilities: Record<string, boolean>;
  structure: "verified" | "partial" | "unsupported" | "invalid";
}
interface SnapshotAvailability {
  snapshotId: Ref;
  status: "ready" | "partial" | "failed" | "stale";
  freshness: "fresh" | "stale" | "unknown";
  reason: string | null;
}
```

Build attempts additionally identify explicit executable/argv/cwd/output and
bounded process lifecycle, without dumping environment secrets. Sealed snapshot
identity is immutable; availability/staleness is not hashed back into it.
An import without known build inputs reports those inputs as unknown and
does not manufacture an input-complete manifest.

## Raw provider evidence and exact ranges

```ts
interface ProviderEvidence {
  id: Ref;
  artifactId: Ref;
  artifactHash: Hash;
  providerIdentity: string;
  jsonPointer?: string;
  rawField?: string;
  textRange?: SourceRange;
  role: "structure" | "generated-rtl" | "original-source" | "schedule";
}
interface SourceRange {
  pathRef: Ref;
  contentHash: Hash;
  startLine: number;        // 0-based
  endLine: number;          // 0-based
  startColumn: number | null;
  endColumn: number | null;
  convention: "utf16-half-open" | "utf8-byte" | "unicode-codepoint" | "line-only";
  precision: "range" | "line" | "file";
}
```

No conversion silently changes inclusive/exclusive endpoints. Missing provider
columns remain null. Before editor reveal, convert against the exact hashed
text and check the resulting slice. A Yosys `src` on generated Verilog is a
generated-RTL source range, not an original-source one.

## Definitions, occurrences and cells

```ts
interface HardwareModuleDefinition {
  id: Ref;
  providerKey: string;
  attributes: Record<string, unknown>;
  parameterDefaults: Record<string, unknown>;
  ports: HardwarePort[];
  cells: HardwareCellTemplate[];
  aliases: NetAliasTemplate[];
  memories: unknown[];      // raw supported memory representation, never dropped
  evidenceRefs: Ref[];
}
interface HardwareInstanceOccurrence {
  id: Ref;
  definitionId: Ref;
  parentOccurrenceId: Ref | null;
  instantiatingCellId: Ref | null;
  path: string[];
  parameters: Record<string, unknown>;
  blackBox: boolean;
  evidenceRefs: Ref[];
}
interface HardwareCellTemplate {
  id: Ref;
  name: string;
  rawType: string;
  parameters: Record<string, unknown>;
  attributes: Record<string, unknown>;
  pins: CellPinTemplate[];
  targetDefinitionId: Ref | null;
  semantics: { kind: string; evidenceRefs: Ref[] } | null;
  evidenceRefs: Ref[];
}
interface HardwareCell {
  id: Ref;
  occurrenceId: Ref;
  templateId: Ref;
  pins: CellPin[];
}
interface HardwarePort {
  id: Ref;
  name: string;
  direction: Direction;
  providerBits: Array<number | Constant>;
  offset: number | null;
  ascending: boolean | null;
  signed: boolean | null;
  attributes: Record<string, unknown>;
  evidenceRefs: Ref[];
}
interface CellPinTemplate {
  name: string;
  direction: Direction;
  providerBits: Array<number | Constant>;
  evidenceRefs: Ref[];
}
interface CellPin {
  id: Ref;
  cellId: Ref;
  name: string;
  direction: Direction;
  bits: Bit[];              // original order, repeats permitted
  evidenceRefs: Ref[];
}
```

Template port/cell bits materialize in an occurrence namespace. Their original
raw representation remains available. A cell targeting a module definition
provides the child's actual pin contract; its child occurrence provides the
formal context. Their counts are not summed as two independent resources.

Unknown raw cell types/parameters/attributes/pins survive. A known glyph requires
an explicit, versioned semantic mapping. Register/library semantics are not
inferred from an instance name. Memory/process capability must be declared:
an unsupported raw process is an import error/partial result, not an empty cell.

## Signal, alias and boundary model

```ts
interface PinBitRef {
  ownerId: Ref;
  portOrPinId: Ref;
  vectorPosition: number;
  bit: Bit;
  role: "driver" | "load" | "bidirectional" | "unknown";
  roleEvidenceRefs: Ref[];
}
interface NetSegment {
  id: Ref;                 // model + occurrence + local provider bit
  occurrenceId: Ref;
  providerBit: number;
  endpoints: PinBitRef[];
  aliasRefs: Ref[];
}
interface NetAliasTemplate {
  id: Ref;
  name: string;
  providerBits: Array<number | Constant>;
  offset: number | null;
  ascending: boolean | null;
  signed: boolean | null;
  attributes: Record<string, unknown>;
  evidenceRefs: Ref[];
}
interface HierarchyBoundaryBinding {
  id: Ref;
  childOccurrenceId: Ref;
  formalPortName: string;
  vectorPosition: number;
  parentActual: PinBitRef;
  childFormal: PinBitRef;
  evidenceRefs: Ref[];
}
```

An alias is an ordered named view, not a separate physical resource. Aliases
can overlap partially, reverse order, or contain constants. Bit-vector length
alone does not establish equality. Constant values do not imply a global
physical driver; visual constants are explicit connection-site presentation.

Boundary width/order must exactly match the reader's elaborated formal/actual
contract. No padding, truncation or inferred reversal. Hierarchical same-net
equivalence follows these bindings only, never cell input-to-output dependency.
Retain unknown direction, inout, multiple drivers, clock/reset association
evidence and unknown electrical behavior.

## Correspondence

```ts
interface Correspondence {
  id: Ref;
  snapshotId: Ref;
  hardwareModelId: Ref;
  hardwareRefs: Ref[];
  sourceRefs: SourceRange[];
  generatedRtlRefs: SourceRange[];
  relation: "implements" | "originates-from" | "port-binding"
    | "inlined-from" | "shared-from" | "generated-for"
    | "optimized-away" | "merged-into";
  status: "verified" | "partial" | "ambiguous" | "unmapped";
  evidenceRefs: Ref[];
  providerIdentity: string;
  grouping: "provider-explicit" | "user-defined" | "heuristic" | "unknown";
}
```

Structure status lives on the model/evidence, mapping status on correspondence,
grouping status on interpretation, freshness on snapshot/source availability.
These are independent. A missing `sourceRefs` array cannot justify
`optimized-away` or `generated-for`.

One source can implement many cells and one cell can have many sources.
Source logical regions may overlap; implementation containment does not.
Store actual source slices separately from analysis explanations.

## Query envelope

```ts
interface QueryResult<T> {
  queryId: Ref;
  snapshotId: Ref;
  hardwareModelId: Ref;
  evidenceRevision: Ref;
  value: T;
  complete: boolean;
  limit: number | null;
  stopReason: string | null;
}
```

Queries: children, ports, net endpoints, boundary crossing, combinational cone,
clock/reset associations, source correspondence, hardware for source with
occurrence context, generated RTL, related rules/methods, and separate code
dependencies. Collapse or viewport changes cannot change query meaning.

## Scene and navigation

```ts
interface SceneObject {
  id: Ref;
  parentSceneId: Ref | null;
  role: "module-shell" | "cell-symbol" | "port-anchor" | "net-route"
    | "bus-bundle" | "boundary-continuation" | "workspace";
  hardwareRefs: Ref[];
  presentationOnly: boolean;
  orderedMembers?: Bit[];
  boundaryBindingRefs?: Ref[];
}
interface NavigationLocation {
  snapshotId: Ref;
  hardwareModelId: Ref;
  stage: string;
  hierarchyPath: Ref[];
  sceneRoot: Ref;
  expandedOccurrences: Ref[];
  expandedBundles: Ref[];
  selection: { kind: string; id: Ref; bitPosition?: number } | null;
  sourceFocus: SourceRange | null;
  queryOptions: Record<string, unknown>;
  viewport: { x: number; y: number; scale: number };
  panels: { hierarchy: boolean; details: boolean; drawer: boolean };
}
interface NavigationState {
  navigationVersion: 1;
  current: NavigationLocation;
  back: NavigationLocation[];
  forward: NavigationLocation[];
  transitionId: number;
}
```

Scene IDs derive from role and hardware context, not screen coordinates.
Collapsing/expanding preserves the occurrence shell and formal anchors.
The equality key for entry excludes incidental hover/selection/pan; repeated
entry is no-op. Those incidental states still restore with their scene.
Back/Forward restore without Fit; Up/breadcrumb are separate navigations.

## Mandatory validation invariants

1. All hardware refs resolve in the correct model/snapshot.
2. Every raw definition/cell/port/pin vector/alias is retained or explicitly
   rejected by declared support limits; no silent drop.
3. Vector order, repetitions, constant values and HDL index metadata survive.
4. Definition/occurrence/local-bit namespaces cannot collide.
5. Formal/actual bindings resolve actual declared ports with equal widths.
6. Direction uncertainty and multiple drivers remain visible.
7. Every scene object has hardware refs or an explicit presentation-only role.
8. Collapsed/expanded ordered boundary membership equals canonical membership.
9. Verified source evidence reaches hash-matching text with correct coordinates.
10. Object-key reordering cannot change canonical hardware semantics.
11. Malformed/hostile JSON, depth/size/object limits and unsupported raw
    processes fail at the import boundary before publication.
12. Historical navigation cannot attach to a same-name object in another build.
