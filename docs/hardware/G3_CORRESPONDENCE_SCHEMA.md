# G3 correspondence schema and composition

Implemented G3-A schema: **1**.
Executable validators: `src/hardware/correspondence/schema.js` and public
`validateBundle(bundle, productAnalysis)`. Source, compiler contract,
connectivity and origin are not one confidence axis.

## G3-B supported-origin schema amendment

The separate public entry is `src/hardware/correspondence/origin.js`.
Its immutable `OriginBundle` has `schemaVersion:1`, implementation snapshot/model
IDs, caller-approved provider identity, product adapter/evidence identities,
claims, unresolved records and occurrence-leaf coverage. `AnalysisBundle`
adds source freshness. It does not mutate or relabel the stock bundle below.

Input sidecar schema `g3-supported-root-origin-v1` is independently reconstructed
from raw captures. Unknown top-level fields, invented exact states, wrong hashes,
unrelated source mints, wrong occurrences and promoted partial paths reject.
All sidecar/capture JSON crosses bounded copy validation before semantic
traversal: 64 levels, 1,000,000 nodes and the existing 16 MiB JSON budget.
`__proto__`, `prototype` and object-valued constructor payloads reject;
actual compiler constructor names/null remain data. Imported link IDs and
generated claim IDs must each be unique.
The caller must approve `isolated-bsc-ghc96-root-observer-v1` and the exact
compiler binary/patch/exporter/source pin. Hashes bind bytes, not universal
semantic trust. See the [captured schema](evidence/g3-origin-ghc96/ORIGIN_SCHEMA.md).

Each `compiler-recorded-contributor` claim relates one existing semantic source
record/token to one G2 cell/snapshot/occurrence. `compilerRootId` and `linkId`
reference the explanation's compiler and reader tuples. All accepted claims
have `status:'verified-known-contributor'` and `completeOriginSet:false`.
They establish a supported recorded contribution, not exclusive cause,
complete contributor sets or origins of connected nets.

Compiler records identify actual stage/module/local-node tuples. Ordered
transformation edges have input/output objects and origin refs, pass/action,
capture IDs and branch observations. Reader tuples carry stage, module,
object kind/name, line and complete capture hash. Exact supported transport
requires every boundary; unsupported rewrites cannot be skipped.

Source coordinates currently supported by this experimental compiler provider
are directly captured ASCII/LF without tabs, with equal original/preprocessed
bytes and parser-minted half-open spans. Product source ranges also retain the
existing semantic ID and UTF-16/UTF-8 conversion. G3-A's wider Unicode support
does not expand this compiler provider's supported coordinate scope.

Origin queries accept `contribution`, `snapshotId`, `mode`, `limit`,
`semanticId`, `token`, `sourceRevision`, tokenized `occurrencePath`,
`entityId` and `family:'origin'`. Reverse queries require `entityId`.
Results distinguish resolved, ambiguous, unmapped and stale current-source
requests; truncation is explicit. `contribution:'complete'` yields no claims.
`validateBundle(serialized, analysis)` requires equality to product-validated
content, rather than trusting serialized claims.
Malformed `sourceRevision` values reject with `INVALID_INPUT`. A well-formed
revision outside the attached source set returns `resolution:'stale'` with
`source-revision-not-in-build`, never an ordinary unmapped result.
The accompanying `freshness` still describes the attached documents; the
explicit resolution/reason describes the requested foreign revision.

Coverage distinguishes actual instrumented definition populations from
occurrence-expanded leaves. Known-contributor objects and complete sets have
separate numerators; aliases never inherit cell origins.

## Immutable identities

The correspondence payload excludes its own `id`, is canonically keyed and
SHA256 identified. Analysis identity separately binds implementation snapshot/
model, correspondence ID and Source/Semantic identity.
Provider implementation identity hashes actual loaded product/Source/Semantic
runtime files by relative path. Source/RTL descriptors are logical-path sorted.
Ordered bit bindings, vector repetitions, occurrence paths and pass order are
not reordered. Host paths, timing/memory observations, freshness and session
publication counters are excluded.

```text
CorrespondenceBundle
  schemaVersion, id
  implementationSnapshotId, implementationModelId, targetArtifactHash
  sourceModelIdentity, evidenceSetIdentity, evidenceSet
  providers, claims, evidence, transformations, unresolved
  coverage, validationSummary, contexts, methods
```

Stock `transformations` is empty. It is not a compiler transformation ledger.
The existing G2 input/capability fields are not backfilled by this overlay.

## Typed claims

Each claim has ONE actual tuple:

```text
id, relationKind, scope
tuple: { source, target }
premises[], evidenceRefs[], providerId
validation, resolution, freshness
proves, doesNotProve
optional orderedBindings / connectivityPath / boundaryIds
```

Source refs bind logical path, file hash/revision, semantic/definition ID,
source kind, occurrence ID/path, exact half-open UTF-16 range, translated
UTF-8/codepoint offsets and slice hash.
Implementation refs bind snapshot/model, canonical entity kind/ID, occurrence
and optional pin/vector index.
Other targets are explicit source-range, compiler-method or compiler-occurrence
records. Multiple source/target arrays cannot imply Cartesian relationships.

| Relation kind | Scope | Required composition |
| --- | --- | --- |
| `source-declaration` | declaration | Actual Source/Semantic range and revision. |
| `source-occurrence` | contract | Actual compiler/source/RTL/G2 occurrence evidence. |
| `containing-context` | context | Containing occurrence evidence; no owned cells. |
| `method-port-contract` | contract | Source occurrence plus stock method contract. |
| `generated-port` | contract | Method-port contract and registered RTL. |
| `ordered-port-binding` | connectivity | Method contract, generated port and source occurrence. |
| `same-net-contact` | connectivity | Ordered binding and actual G2 boundary traversal/pin attachment. |

Binding entries preserve index, formal/actual bit IDs and values and exact
boundary ID. Explicit unconnected actuals are null, not invented wires.
Contact claims retain a source vector index, actual target pin/index, bit ID,
contiguous path and boundary IDs. No traversal crosses a cell input/output.

`proves` names the actual scope. `doesNotProve` excludes origin, exclusive
cause and behavioral equivalence for stock contract/connectivity.
A candidate premise cannot produce an exact composed relation.

## Independent axes and authority

- Record validation: valid data/refs/ranges/hashes, or explicit rejection.
- Resolution: resolved, ambiguous, unmapped, unsupported or stale query result.
- Provider authority: source parser, caller-approved stock capture, registered
  generated RTL, artifact reader or validated premise composition.
- Claim scope: declaration, contract, connectivity, context; stock origin remains
  unmapped/unsupported.
- Freshness: current, captured, stale or not-attached at analysis/query level.
- Coverage: explicit fixed populations/IDs/hashes and unresolved counts.

A valid hash/schema does not prove arbitrary sidecar meaning. Product context
is registered privately; `validateBundle` revalidates typed structure and requires
the payload to match claims rederived from actual registered source/compiler/
RTL/G2 evidence. A forged lookalike context or self-declared exact origin is
not trusted. `attachCorrespondence({...request,bundle})` validates imported
payloads through that same boundary.

Raw Tcl text is never evaluated. Normalized stock rows are cross-checked
against actual captured command records; source declaration/type/occurrence,
generated RTL identity and ordered bits complete the checked scope.
This is not a signature or independent proof of live compiler execution.

## Ranges, negatives and limits

`normalizeRange` supports half-open UTF-16, UTF-8-byte and Unicode-codepoint
offsets, and positions with explicit encoding and 0/1 base.
It rejects reversed/out-of-bounds/split-scalar and unsupported conventions.
Source tests cover CRLF, tabs, Korean, combining and non-BMP characters.
Stock compiler point columns are empirically supported only for ASCII without
tabs; no invented Unicode compiler-column conversion is performed.

Reject wrong versions/providers, duplicate/dangling/cyclic/contradictory refs,
wrong hash/revision/snapshot/occurrence/width/order, unrelated source claims,
hostile keys and unregistered/path-escaped evidence. Compiler header points
remain point evidence, not parser method body spans.

Bounds: 16 MiB input/output JSON, depth 64, 1,000,000 JSON nodes, 256 source
and 256 RTL documents, 30,000 claims, 60,000 evidence records, premise depth 64,
query limit 1-30,000 and inherited G2 vector bounds.
Worker limits are 512 MiB old generation, 4 MiB stack and a 30-second deadline.
These are rejection limits, not throughput certification.

## Coverage and G3-B extension boundary

G3-A categories have explicit fixed source/target populations and hashes.
Do not substitute query counts or successful source links for historical
0/53 leaf, 0/168 alias, 0/8 storage or 0/22 expression origin denominators.

Actual G3-B origin support must separately define provider authority, compiler
tokens, transformation tuples, contributor completeness, unsupported passes
and experiment snapshot/stage identity. A source-to-RTL chain that stops at
reader lowering remains partial. It cannot be smuggled into a stock
`same-net-contact` or `generated-port` claim.
