# G3 product architecture

Current implemented scope: G3-A and supported G3-B contributor APIs, version 1.
Stock correspondence and instrumented origin remain separate analysis bundles.
Authority: [G3_CONTRACT](G3_CONTRACT.md).

## G3-B product amendment

`src/hardware/correspondence/origin.js` is the separate public origin entry.
`origin-data.js` validates actual source mints, ordered compiler transformations,
emitted objects, every supported reader stage and final G2 leaf tuples.
`origin-worker.js` runs that CPU validation with memory/deadline bounds.
The original G2 snapshot and the stock correspondence schema are unchanged.

`attachOrigins({ registry, importResult, sidecar, files, authority, signal,
onProgress })` accepts registry-approved, hash-bound capture descriptors.
`files` maps logical `captureRef` to registered `pathRef`, `contentHash` and
`kind` (`source` or `artifact`). Authority explicitly binds the supported
provider, source pin, compiler binary, patch and exporter implementation.
The runnable descriptor assembly is
`experiments/hardware/g3/origin-query.js:loadOriginCase`.

```js
const origin = require('./src/hardware/correspondence/origin');
const analysis = await origin.attachOrigins(request);
const result = origin.sourceToImplementation(analysis, {
    occurrencePath: ['mkConnected', 'left'], contribution: 'known'
});
origin.implementationToSource(analysis, { entityId });
origin.explainMapping(analysis, claimId);
origin.getCoverage(analysis);
await origin.refreshFreshness(analysis, registry);
```

`contribution:'complete'` returns no claims: complete origin sets are not
supported. Product queries expose only verified leaf contributors; partial
Control/parameter-derived traces remain unresolved. Forward/reverse IDs retain
snapshot and occurrence context. `createOriginSession()` provides
`attach`, `cancel`, `refresh` and state/worker events. Cancel waits for real
worker exit; failed, stale or superseded work preserves the prior valid result.
Attachment captures the initial request and rechecks evidence before publication.

```sh
node experiments/hardware/g3/origin-query.js A mkConnected/left
node experiments/hardware/g3/origin-query.js B mkControl
node experiments/hardware/g3/origin-query.js C mkReuse/wide
```

G3-B uses its actual instrumented artifacts, never relabeled stock snapshot IDs.
Caller-approved capture is not arbitrary-sidecar authentication. No compiler,
Tcl, plugin or UI code runs inside product attachment/query.

## Actual modules and ownership

| Module | Responsibility |
| --- | --- |
| `src/hardware/index.js` and G2 modules | Existing immutable import, registry, ordered connectivity and lifecycle; unchanged by G3-A. |
| `correspondence/source.js` | Reuse Source/Semantic records; normalize exact Unicode/range conventions; bounded explicit wrapper-return supplementation. |
| `correspondence/stock.js` | Read captured stock Tcl metadata as data, cross-check raw/normalized records and supported generated RTL declarations/bindings. |
| `correspondence/build.js` | Construct typed source/target claims, exact evidence/premise links, contexts and fixed coverage populations from validated inputs. |
| `correspondence/schema.js` | Executable schema 1, identity sealing, supported providers/composition rules and structural/semantic rejection. |
| `correspondence/worker.js` | CPU attachment worker, with no compiler/Tcl/plugin execution. |
| `correspondence/index.js` | Public registration/attachment boundary, forward/reverse/explain/coverage, freshness and latest-request publication. |

Paths in the last six rows are under `src/hardware/`.
Neither `representative-chain.json` nor the prototype's answer rendering is a
product mapper. The representative file is an independent acceptance oracle.

## Data path

```text
G2 registry-approved source/metadata/RTL bytes
        + existing immutable G2 import result
        |
staged copy, hashes, source revisions and input limits
        |
resource-limited correspondence worker
        |
Source/Semantic records + captured compiler contract + actual RTL/G2 structure
        |
typed claims / evidence / premise validation / fixed coverage populations
        |
immutable CorrespondenceBundle + AnalysisBundle
        |
source-to-implementation / reverse / explanation / coverage queries
```

The worker rederives the G2 model from registered artifact bytes to reject
modified lookalike import results. It does not replace or mutate the caller's
snapshot, object IDs, vectors, aliases, bindings or capabilities.
The old `originalBsvCorrespondence=false` remains unchanged. The analysis
envelope reports its own supported claims.

Source parser ranges establish source declarations/implementations.
Stock compiler module-header points establish only their recorded points.
Method ports, generated RTL objects and actual G2 vectors establish contract
and connectivity claims; none is implicitly a source-origin claim.

## Public use

```js
const hardware = require('./src/hardware');
const mapping = require('./src/hardware/correspondence');

// registry/importResult are obtained from the unchanged G2 API.
const analysis = await mapping.attachCorrespondence({
    registry, importResult,
    sources: [{ pathRef: sourceRef, contentHash: sourceHash, revision: sourceHash }],
    metadata: {
        pathRef: metadataRef, contentHash: metadataHash, provider: 'stock-bluetcl-v1',
        sourceInputs: [{ pathRef: sourceRef, contentHash: sourceHash }]
    },
    generatedRtl: [{ pathRef: rtlRef, contentHash: rtlHash }],
    signal
});
```

Sources are registered with G2 `registerSource` and expected hashes; metadata
and generated RTL use registered artifact refs. Logical provider paths never
grant file authority. Captures are not cryptographic compiler authentication:
stock authority means caller-approved capture plus semantic cross-checking of
source/type/occurrence/RTL/bit relationships.

Queries:

```js
mapping.sourceToImplementation(analysis, {
    occurrencePath: sourceOccurrencePath, method: methodName,
    role: 'result', family: 'connectivity'
});
mapping.implementationToSource(analysis, { entityId, family: 'connectivity' });
mapping.explainMapping(analysis, claimId);
mapping.getCoverage(analysis);
await mapping.refreshFreshness(analysis, registry);
mapping.validateBundle(serializedBundle, analysis);
```

The runnable corpus explorer uses these same APIs:

```sh
node experiments/hardware/g3/query.js A mkConnected.left get connectivity
node experiments/hardware/g3/query.js A mkConnected.left get origin
node experiments/hardware/g3/query.js C mkReuse.wide get connectivity
```

It reads actual corpus recipes and validates bytes against the preserved input
manifest. Names are CLI selection arguments, not product mapping special cases.
Origin requests on stock-only evidence return unmapped, not nearby cells.

## Context and lifecycle

Forward/reverse filters include snapshot, source revision/logical path,
semantic ID, occurrence ID/path, method, role, target kind and claim family.
Missing occurrence context yields explicit ambiguity or fully scoped multiple
results, never first-match selection. Inlined contexts may refer to a containing
implementation scope but own no fabricated cell subset.

Queries are index operations over immutable identities, not canvas visibility.
`createCorrespondenceSession()` stages attachment and publishes only the newest
valid current result. Failure, cancellation, supersession and stale source
preserve the prior valid analysis and original G2 data. Workers settle after
actual exit; cancellation is not a flag checked after blocking work.

Captured old source remains available for build queries. `mode:'current-source'`
rejects captured/stale coordinates. Freshness refresh returns a new envelope;
it does not change correspondence content identity.

The measured A/B/C and explicit 120-module source-parser stress scope is in
[G3_A_CHECKPOINT](G3_A_CHECKPOINT.md). No large-netlist, browser/editor or
continuous-zoom performance claim follows from those measurements.

## Historical G3-A boundary before origin integration

An actual origin provider must consume the separate experiment snapshot,
compiler-owned tokens and supported reader/pass lineage. It must not relabel
new instrumented data with the original baseline snapshot ID.
Stock schema 1 has no transformation events or trusted origin numerator.
Adding that capability requires real captured inputs and the separately
documented G3-B validation scope, not a placeholder adapter or manual answer.
