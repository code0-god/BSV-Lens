# G5 query schema

This is the new G5 implementation contract, not a claim that these exports
existed in G2/G3/G4. Existing owners are listed in `G5_CONTRACT.md`.

## Product entry

`src/hardware/analysis/index.js` introduces `createAnalysisQuery` and
`createAnalysisSession`. A factory receives caller-owned validated
`importResult`, optional stock `analysis`, optional `originCase` and explicit
equal-revision `sourceBindings`, following the existing Scene Query boundary.
Source-only analysis may receive an existing `sourceModel` without hardware.
The browser never supplies models or registry policy.

The query object exposes:

- `getContext(provider)`: attached identity/capabilities, with unavailable data
  explicitly null/not-attached.
- `query(input, {signal, onProgress})`: bounded asynchronous analysis.

The session follows existing `getState`, latest-query publication, event
notification and cancellation-on-worker-exit patterns. Its public state retains
the last valid result when newer work fails, is cancelled or becomes stale.

## Input

```js
{
  kind: 'same-net', // or drivers-loads, dependencies, state-accesses,
                   // behavior, call-site, source-dependencies, correspondence
  analysisId: 'attached analysis identity',
  snapshotId: 'selected actual hardware snapshot identity',
  implementationProvider: 'stock', // or registered instrumented provider
  stage: null, // optional assertion; never invented when missing in snapshot
  ownerInstanceId: 'selected BSV owner, or null for hardware-only analysis',
  implementationOccurrenceId: 'actual selected RTL occurrence',
  seed: { entityId: 'canonical port/pin/alias/bit ID', indices: [0, 2, 1, 2] },
  scope: { kind: 'design', rootOccurrenceId: 'actual design root' },
  direction: 'backward',
  semanticsProfile: 'yosys-0.68-structural-v1',
  limits: {
    maxBits: 4096, maxPins: 8192, maxCells: 512, maxEdges: 16384,
    maxHierarchyDepth: 64, maxResultBytes: 4194304, timeoutMs: 30000
  },
  queryGeneration: 1
}
```

Alternative electrical seeds:

- `{entityId}` selects its entire ordered vector; a scalar bit has one position.
- `{entityId, slice:{start,end}}` selects a half-open positional slice.
- `{occurrenceId, bitIds:[...]}` selects an explicit ordered vector of canonical
  bits in that occurrence, including repeated positions.
- `indices` and `slice` are mutually exclusive. Empty/foreign/out-of-range
  selections reject. A cell without a selected pin offers pin candidates
  rather than merging its input/output vectors.

Source seeds use a canonical source/architecture entity ID and explicit owner
or verified helper call-site context. Provider and snapshot assertions are
checked against the attached context. Missing build provenance stays unknown.
Scope is `occurrence`, `subtree` or `design`, with a validated root. An actual
boundary beyond scope is a continuation, not silently included or discarded.

Dependency direction is `backward` or `forward`; connectivity does not acquire
a direction by pretending to propagate values. Unknown kinds, profiles, enum
values, fields, hostile keys, depths and sizes reject at the public boundary.
An unsupported request for exact dependencies cannot become a successful
conservative answer without an explicit status.

## Result

```js
{
  schemaVersion: 1,
  id: 'hash of semantic result, excluding execution metrics and generation',
  queryId: 'stable normalized query identity',
  kind: 'same-net',
  status: 'complete',
  availability: 'available',
  completeness: 'complete',
  context: { /* actual analysis/snapshot/provider/stage/source/RTL identity */ },
  seed: { /* normalized ordered positions and canonical IDs */ },
  objects: [],
  relations: [],
  boundaries: [],
  frontier: [],
  sourceRefs: [],
  evidenceRefs: [],
  candidates: [],
  limits: { /* applied limits and stop reasons */ },
  request: { queryGeneration: 1, snapshotId: 'echoed request identity' },
  metrics: { /* preparation/execution/cancellation time and visited counts */ }
}
```

Status distinguishes complete, empty, partial, unsupported, ambiguous and stale
results. Invalid identity/input and cancellation remain typed failures at the
execution boundary; the session records their status without publishing them
as new valid analysis. A resource-limited result has retained facts and
explicit frontier, never complete status. Status, completeness, freshness,
availability and mapping strength are independent concepts.

Sequential stopping is intentional completion of the supported combinational
scope. Unsupported semantics or unknown direction makes the relevant
interpretation partial. Same-net membership can be complete while driver/load
interpretation is partial. Boundaries record which aspect they limit.

## Typed relations and endpoints

Every endpoint is occurrence/pin-or-port/bit-position scoped and keeps its
canonical bit ID. Preserve:

- same-net incidence and hierarchy crossing;
- cell-internal data dependency;
- cell-internal control dependency;
- source read/write/call/argument/return/condition relationships;
- G3 correspondence claims, unchanged;
- separately supplied scheduling evidence.

The first four are not interchangeable edge families. A dependency result
does not add origin claims. Same-net results preserve ordered groups per seed
position, alias indices, boundary IDs and connection-local constants.

Driver/load output separates driver candidates, load candidates, boundary
contacts and unknown/bidirectional contacts. Intermediate module pin/formal
contacts do not count as additional physical drivers. Multiple candidates are
reported, not resolved arbitrarily or diagnosed as contention.

Boundary records include actual object/pin/bit, side, reason and next permitted
analysis. Reasons distinguish sequential, memory, blackbox, unsupported cell,
unsupported parameters, unknown direction, scope, cycle and resource limits.
Cycles are combinational traversal facts, not scheduling SCCs.

## Determinism, execution and projection

Stable ordering uses canonical IDs for unordered sets and original order for
vectors/mappings. Canonical input, deterministic work limits and supported
semantics produce stable semantic results; timing/memory/generation never
changes their IDs. Deadline/cancellation is separately reported execution
failure with the unresolved seed/frontier, not a fabricated complete cone.

No result depends on DOM order, viewport, collapsed objects or host filesystem
enumeration. Indexes are derived from immutable model incidence/boundary tables.
No canonical record is rewritten.

Display limits are separate from query limits. Projection reports visible,
hidden and off-scene objects while retaining the full query result. Reveal
resolves a result's real occurrence through existing Scene Query/navigation.
It does not mint a fake hardware occurrence for a source-only helper.

The host uses registered catalogs and existing source authority. Query inputs
never authorize arbitrary files, processes, external URLs or command URIs.
Public CLI and HTTP call the same product query; renderer work only projects
the returned canonical IDs.

## Implemented source result contract

Source kinds are `state-accesses`, `behavior`, `call-site`,
`source-dependencies`, and `correspondence`. Their seed is
`{entityId, sourceRevision?, entryCallSiteId?}`; electrical indices/slices are
rejected. `mode` is `build` or `current-source`. Source-only queries use
`snapshotId: null`, `implementationOccurrenceId: null`, and
`scope: {kind: 'source-only', rootOccurrenceId: null}`. An owner-qualified
helper requires its exact caller-owned `entryCallSiteId`.

The standard envelope retains `scope`, `direction`, and `semanticsProfile`;
source analyses do not borrow electrical cell semantics. Additional fields:

- `code.entity`, `owner`, `storage`, `behavior`, `functionDefinition`;
  `statements`, `expressions`, `bindings`, `dependencies`, and `stateEffects`.
- `readers` and `writers`: occurrence-specific source behavior records.
- `conditions.predicate` and signed `conditions.body`, separate from
  `code.assertions`, `code.readiness`, and `code.scheduling`.
- `callMappings`: caller, producer, consumer, callee, actual/formal records,
  return records, result binding, resolution, candidates, and scope limits.
- `correspondence.stock` and `.origin`: unchanged G3 query results and
  explanations. `completeOriginSet` stays false.
- `sourceRefs`: registered full-document revision/hash, exact UTF-16
  half-open range, original text, slice hash, source owner, and occurrence.

`code.freshness.status` uses G3's `current`, `captured`, or stale/unavailable
state, not the hardware snapshot's separate `fresh` label. Current-source
requests require actual registered freshness; captured source remains usable
as build source when the current file changes.

Formal parameter contracts currently expose names/types, not standalone
formal-token ranges. Generic `Bit#(width)` source contracts remain generic;
actual retained RTL vectors and their BSV wrapper occurrences carry verified
8/12-bit context separately. Unresolved method implementation joins remain
null rather than being filled by a matching method name. The existing C
capture supplies `mkWidth` contributors but no `mkBiased` RHS contributor.

Scene Query registers returned source references before `getSource(reference)`
can open them. Reference ID, revision, whole-file hash, range and slice hash
are checked through existing authority. The browser cannot supply a new
filesystem path or turn generated RTL into original BSV.
