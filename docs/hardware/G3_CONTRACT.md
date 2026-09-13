# G3-A / G3-B execution contract

Authority: the complete user-supplied
`BSV_Lens_G3_Correspondence_Master_Prompt.md`, SHA256
`c728eb15e4abdf6271fcb1988bbc282cd6a1d51ae5f59644fcaf134f500468f5`.
All 34 numbered sections and the final provenance notes were read.
This document records the controlling scope; it is not a claim of implementation.

## Scope, order and stop

Preserve G2; establish contracts; implement/verify G3-A through the public
product API; record an internal checkpoint; then execute the bounded isolated
G3-B compiler/reader experiment; replay both new archives; report and stop.
G3-A success alone is not G3 completion.

The user authorized both A and B without a repeated design approval question.
Additional paid/account/global installation or replacement of the user's
toolchain requires permission only for that operation. Existing isolated
Docker/local experiment capability may be used within recorded limits.
No G4, production UI replacement/redesign, user visual acceptance, repository
commit/push, merge, version change, tag, Release or publish is authorized.

## Baseline and protected work

Branch: `feat/hardware-schematic`; HEAD/remote main:
`c6b9a5c642d105ad4117535c1d85366f1c02ec1c`; version `0.4.1`.
HEAD is NOT the identity of the uncommitted G2 content.
The pre-G3 source fingerprint is
`385696796e5e36e444b2c828ecfb4642b8945afb123ea8083fff899923bcfd44`,
over 388 sorted tracked/nonignored files excluding generated `dist` outputs.
The complete per-file ledger is `.build/hardware/g3/baseline.json`.

Preserve all dirty work, original fixtures, compiled artifacts, hash ledgers,
G0-G2 evidence and ZIPs. No reset, clean, stash or overwrite of historical data.
All G3 captures, builds and ledgers get new paths. End-state reporting compares
actual file/content fingerprints, not the old main SHA alone.

## G3-A: product correspondence

Reuse `src/hardware` and its immutable snapshot/model. Reuse Source/Semantic
declarations, contextual occurrences and source ranges; do not create a competing
name-only parser. The new product layer must not depend on a fixture answer DB.
`representative-chain.json` is an independent test oracle only.

Register/validate source, stock BSC metadata and generated RTL through approved
G2 registry paths and hashes. Create a separately identified immutable
CorrespondenceBundle and AnalysisBundle; do not mutate the existing snapshot,
retrofill unknown build inputs or toggle its original-correspondence capability.

Required public queries: source-to-implementation, implementation-to-source,
explain claim/premise/evidence chain, category coverage/unresolved reasons,
freshness and cancellation. Requests preserve snapshot/source revision,
occurrence, target kind and requested claim family. Missing context must return
candidates/ambiguity, not the first same-name occurrence.

Reproduce `left.get` from actual source/compiler/RTL/G2 data, including ordered
formal/actual bits and actual pin contacts. Do not hardcode names, bits, line
numbers, hashes or cell identifiers in product code. Keep left/right, concrete
widths, wrapper forwarding and inlined containing contexts separate.

## Claims, identity and validation

Declaration, compiler contract, generated location, ordered binding,
same-net contact and source-origin are different claim meanings.
Validation, resolution, provider authority, scope, freshness and coverage are
independent axes. Source/target arrays do not imply Cartesian correspondence:
use actual tuples or explicit contributor sets.

Bundle identity includes implementation snapshot/model and actual artifact
hash, source identities/revisions, compiler/RTL evidence hashes, provider/schema/
implementation identity, applicable compiler/patch/pass identities and canonical
claim/ref content. Exclude host absolute paths, timestamps and log ordering.
Preserve meaningful bit and pass order; avoid hash self-reference.

An executable schema/validator enforces versions, size/depth/count limits,
typed refs, uniqueness, non-dangling/cyclic premises, ranges, bits and explicit
contradictions. A wrong explicit claim is not swallowed as unknown success.
Untrusted imported sidecars/manual annotations cannot self-declare exactness.
A valid hash/schema does not establish an unrelated source location as origin.

Source validation covers exact full bytes and slices, revisions, half-open
offsets, UTF-8/code-point/UTF-16 conventions, CRLF/LF, tabs, Korean/non-BMP/
combining characters and multiline spans. Unsupported conventions remain
unsupported. Compiler module-header points are not method bodies.
Changed current source never receives old coordinates; verified captured
source is explicitly historical, otherwise stale/unavailable.

Composition is a small explicit rule set, not general reachability:
method contract + RTL port + ordered binding yields connectivity;
same-net equivalence yields pin contacts, never input/output equivalence;
source + actual origin token + supported transformation chain may yield a
scoped contributor, not exclusive sufficient behavioral cause.
Candidate/unsupported premises cannot yield exact composed claims.

Attachment follows staging/validation/atomic publication. Failure, cancellation,
supersession and stale evidence preserve original G2 and prior valid mapping.
Indexes are bound to snapshot/source/evidence identities, independent of UI.
Measure real A/B/C and an explicit stress corpus; do not infer large-design
or animation acceptance from these measurements.

## G3-A internal checkpoint

Pass the public API against independent source/raw-artifact/metadata/RTL
oracles, not the mapper against its own output. Keep G2 identity, ordered
connectivity, lifecycle and security invariants. Demonstrate fresh extraction
without compiler or node_modules. Record exact APIs/schemas, tests, commands
and limits, then continue G3-B without asking the same authorization again.

## G3-B: actual origins, not another metadata lookup

Re-read the actual pinned compiler sources and outputs at the recorded version.
Historical clues: BSC `2026.01`, source
`9bd39e6f3d54d314a94ce30339a224bb283cbade`, Yosys `0.68` / `38e001a6f`.
Verify actual executable/source/patch identity; do not automatically upgrade.

Map source/typed/elaborated/scheduled/inlined/optimized/emitted/reader boundaries
and locate where actual IDs/spans survive, become coarse, or disappear.
Bind tokens at the earliest valid representation or preserved source identity;
a printer-only reconstruction from names is not origin transport.
Record storage/RHS source identity/span, enclosing behavior, occurrence/parameters,
compiler-owned token, stage and transformation lineage.

Preserve, clone, merge, share, generate, inline and remove events need actual
input/output object/origin refs, pass identity, reason, evidence and supported
scope/completeness. No blanket parent-origin propagation; no optimized-away
claim from a missing name; no jump over an unsupported pass.

Execute the smallest isolated compiler/exporter/reader experiment needed.
Do not modify installed compilers/PATH/global config, user source, synthesis
boundaries or original artifacts. No keep/dont_touch/new optimization disabling
to make a cell or mapping appear. Use a separate real corpus if needed.
Record CPU/memory/process/output/time bounds and real cancellation cleanup.

Required representative chains:

- Storage declaration, actual compiler storage origin, emitted storage object,
  reader creation/transport and an actual register/storage implementation.
- RHS expression, actual compiler expression origin, emitted operation,
  reader transport and a real cell/net or separately verified removal event.

Q contact alone is not storage cause. A plus sign near an add cell is not
expression origin. Keep generated reset/enable/arbitration context separate.
Record contributor versus complete supported contributor set.

Compare unpatched and instrumented builds with the same source/dependencies,
parameters/tops/options/passes. Prefer functional RTL byte identity; tightly
enumerate metadata-only exclusions. Compare full normalized structural ports,
cells and ordered connectivity, not counts. If actual equivalence/simulation
is needed, report only its tested assumptions/scope. Noninterference does not
prove the origin record's correctness.

## Coverage and completion

Preserve historical 0/8 storage origins, 0/22 outermost expression-site origins,
0/53 leaf causes and 0/168 definition-alias causes. New results have independent
corpus/snapshot/stage/provider/run ledgers with fixed populations/IDs, exclusions,
known-contributor counts and complete-supported-origin-set counts.
Do not combine aliases, occurrence cells, scalar components, source links,
queries and origin numerators.

G3 is supported-scope complete only if G3-A passes and both storage and RHS
origins reach actual reader-stage implementation with verified noninterference
and coverage. Source-to-RTL-only is G3-B partial, not full completion.
If required evidence cannot be obtained, report A/B complete/partial/blocked
separately with actual attempts, failure boundary and minimal follow-up.

## Delivery

Deliver G3_CONTRACT, G3_ARCHITECTURE, G3_CORRESPONDENCE_SCHEMA,
G3_ORIGIN_EXPERIMENT, machine/human G3_COVERAGE and G3_REPORT plus four scoped
ADRs. Update current plan/feasibility/validation/offline scope while preserving
historical results. Include actual patches/recipes, sidecars/ledgers, negative
tests, compiler/reader comparison and command/exit/stdout/stderr receipts.

Shipped offline, strict author preservation and live compiler/exporter replay
are separate. Bare author checks still fail with the exact 14 companions listed.
Captured-sidecar verification is not live exporter replay.
Extract both new review and Source ZIPs into empty directories, run actual
product entry/query commands, compare relative runtime bytes and verify CRC/SHA.
Do not bundle tool installations, profiles, credentials or irrelevant caches.
Checksums/validation receipts remain outside their own ZIPs.

CLI/JSON exploration or minimal existing inspector integration is optional;
no browser/editor/continuous-zoom PASS without actually exercising it.
Stop after the explicit G3 result. G4-G7 and release require new authorization.
