# Independent G4 F2 geometry oracle

## Outcome and scope

This deliverable adds only:

- `experiments/hardware/g4-fix/oracle/geometry.cjs`
- `test/hardware-geometry-oracle.test.js`
- `experiments/hardware/g4-fix/geometry-check.cjs`
- this document

It does not import the product validator or routing predicates, and never reads
`geometry.valid`. It does not change product layout, scene, view, navigation,
original captures, fixtures, or the frozen reconstructed regression oracle.
This is additional local independent validation, not external reviewer approval.

The final standalone suite passes 16 tests. The actual-corpus gate is **FAIL**:
18 RTL and 11 BSV scenes were queried, with 58 desktop/compact attempts. All 58
attempts emitted geometry. All 36 RTL attempts pass canonical membership and
geometry checks. All 22 BSV attempts fail only missing source incidence metadata
and dependent attachment coverage. There are no G01-G08 findings in the final
corpus. A successful RTL subset does not satisfy the complete gate.

## API and independence

`validateGeometry(scene, geometry, { selectedScene? })` returns
`{ valid, epsilon, findings, metrics }`. Findings have machine-readable `code`
and `kind`, with owner IDs, coordinates, and expected/actual membership where
applicable. EPS is `1e-7` diagram units.

`validateMembership(scene, { model, architecture })` independently checks the
scene against a genuine imported G2 implementation or source architecture. The
runner obtains these through `loadCapturedCase`, `loadOriginCase`, and
`createArchitecture`, separately from `createCatalog().getScene()`. It never
uses `rtlContent` or the product relation summarizer to construct expected
actual-corpus answers. The synthetic membership seam uses `rtlContent` as the
subject being checked, not as its expected answer.

RTL checks include exact occurrence/child/contact coverage, every occurrence bit
exactly once, full endpoint signatures, actual ordered alias vectors, repeated
bit positions, literal connection sites, and exact parent-pin/child-port boundary
records. Parent and child raw integers are never compared as canonical IDs.
Members retain every driver, load, inout role and endpoint index; RTL direction
must remain `net`. A partial alias or overlapping slice cannot merge independent
connections. Duplicate connection/route IDs are invalid.

BSV checks compare every relation with the canonical source architecture,
independently project relation endpoints, and require exact per-owner relation
coverage. Interface-group IDs remain legitimate source relation anchors, but
cannot occur in the physical contact list. Source child/storage IDs must match
source architecture; actual RTL children must match the imported implementation.
C's inlined source `implementation` children therefore cannot become fake RTL
modules.

## Required integration schema

Existing `nodes`, `contacts`, `routes`, `bounds` remain intact. Empty arrays below
are required when there are no records. Missing metadata produces findings; it
never switches off a check.

```js
scene.connections[i].incidences = [{
  contactId,
  members: [{ bitId, endpointId, index, contactIndex, boundaryId, formalBitId }]
}];
scene.interfaceGroups = []; // BSV groups, separate from physical contacts
geometry.contacts[i].slots = [{
  id, connectionId, contactId, x, y, indices, bitIds
}];
geometry.routes[i] = {
  id, points, attachments, segments, junctions, path, unconnected
};
geometry.groups = [{ id, ownerId, x, y, slots, labelBounds }];
geometry.labels = [{ ownerId, role, text, bounds: { x, y, width, height } }];
```

- Authoritative scene incidences contain only `contactId` and `members`. Their
  presentation slot identity is `JSON.stringify([connectionId, contactId])`,
  where ownership comes from the containing connection. An explicit incidence
  `id` remains supported; an explicit `connectionId`, if present, must agree.
- RTL incidence members preserve ordered member/endpoint multiplicity, including
  repeated bit IDs at distinct contact indices. Direct mappings explicitly use
  `boundaryId: null, formalBitId: null`. Hierarchy mappings retain the parent
  endpoint ID and actual occurrence bit ID plus the exact imported boundary ID,
  formal bit ID and contact index. Missing or substituted formal bit IDs fail.
- Slot `indices` and `bitIds` are parallel ordered member projections, preserving
  repeated positions and bit IDs, **not** sorted or deduplicated sets. This is
  the emitted router contract after the lead's schema update, superseding the
  preparation note's sorted index-set proposal. The earlier design spellings
  `incidenceId` and `memberIndices` are accepted aliases for slot references and
  indices. Optional redundant slot `members`, if supplied, must match the
  authoritative incidence exactly.
- Current route attachments use `{ id: endpointId, contactId?, groupId?, slotId,
  x, y, indices, bitIds }`. Ownership is supplied by the containing route ID;
  an explicit `connectionId`, if supplied, must agree. `slotId`, `incidenceId`,
  or a direct slot `id` is accepted. Points and attachments must agree exactly.
- BSV node/group anchors keep original source endpoint IDs. Their incidence
  `members`, slot `indices`, and slot `bitIds` may be empty, never invented RTL
  bit positions. Groups attach to real owner boundaries and their own slots.
- Contact `markBounds` is used when supplied, otherwise the renderer's 8x8 mark
  is checked. Slot marks are 8x8 unless explicit bounds are provided. Group
  `labelBounds` and all slot extents must be included in Fit/export bounds.
- Labels carry original owner identity, role, displayed text, and complete
  rectangles, including details. Nonempty node/contact title and detail fields
  need corresponding labels. Groups and connections need one label. Labels
  embedded in their own bodies are permitted; unrelated body and all wire/label,
  contact/label and label/label penetration remains forbidden.

The final recorded product revision emits authoritative RTL incidences and all
RTL checks pass, including exact A/C root child-port boundary translations. BSV
connections still lack `incidences`. Their presentation incidences need the
existing source endpoint IDs with empty RTL-member arrays, for example
`endpointIds.map(contactId => ({ contactId, members: [] }))`. The oracle does
not fabricate this missing scene metadata. Source interface group membership
is independently checked against source endpoint owner, interface definition,
and method **parent** path; geometry group member IDs must preserve it.

## G01-G11 / R01-R12 coverage

| Gate | Independent check / evidence |
| --- | --- |
| G01 / R01 | Every cross-owner segment pair, including escapes; original A/left four pairs reproduced. |
| G02 | Positive overlap differs from perpendicular point crossing. Foreign T-touches, endpoint touches and crossing dots fail. Straight crossings are counted without conductive junctions. |
| G03 / R03 | Same-owner shared trunks allowed; ray degree establishes true branches and supports every physical dot. |
| G04-G07 | Interior node, contact, slot and label penetration; shell perimeter crossings. Own-pin exceptions are local outward/inward terminal escapes, not owner-wide exemptions. |
| G08 | Same-owner segment connectivity and every dangling endpoint. Detached glyphs require zero canonical endpoints and exactly one segment; single-contact stubs allow exactly one free end and no branch dots. |
| G09 / R04-R08 | Exact route/contact/incidence coverage, slot and attachment coordinates/indices, SVG M/L path agreement, imported alias/slice/literal/multiple-driver/inout and boundary tests. |
| G10 / R10-R11 | Every node, contact, slot, group, route endpoint and label box is inside bounds. Actual Fit transforms are checked at 1100x650 and 640x800. |
| G11 | Every actual connection is selected through the product query and canonical ownership compared. The first selected connection per scene also executes layout and must preserve final geometry. Input truth and deterministic repeated layout are checked. |
| R02 | All 18 actual A/B/C stock/instrumented RTL root/descendant scenes and all 11 source scenes, including C source-only inlined descendants. Exact totals asserted. |
| R09 | Real B has 47 vectors, beyond old seven/five-period routing behavior; both providers and both sizes execute. |
| R12 | Negative-first standalone tests include false `valid:true`, renaming, point crossings, fanout, unrelated corridors/bodies, labels, bounds, dangling/shifted endpoints, wrong indices, duplicate owner IDs, path mismatch and missing metadata. |

## Commands and receipts

All paths below are relative to repository root. No monitor tool was available;
commands ran synchronously through the provided `run.cjs` receipt wrapper, with
no sleeps, waiting loops, polling, compiler, packaging, or browser execution.

```sh
node experiments/hardware/g4-fix/run.cjs geometry-oracle-schema-tests node --test test/hardware-geometry-oracle.test.js
node experiments/hardware/g4-fix/run.cjs geometry-oracle-before node experiments/hardware/g4-fix/geometry-check.cjs --before .build/hardware/runs/g4-fix-product-probe-2DDy2p/product-probe.json
node experiments/hardware/g4-fix/run.cjs geometry-oracle-schema-corpus node experiments/hardware/g4-fix/geometry-check.cjs
node experiments/hardware/g4-fix/run.cjs geometry-oracle-schema-check npm run check
```

Receipts under `.build/hardware/runs/`:

- `g4-fix-geometry-oracle-schema-tests-XiSslO/receipt.json`: exit 0,
  16/16 pass, zero skips.
- `g4-fix-geometry-oracle-before-6AB4o5/receipt.json`: exit 1, as expected;
  full before report `g4-fix-geometry-oracle-before-zazkJN/geometry-oracle.json`.
- `g4-fix-geometry-oracle-schema-corpus-hlqEK8/receipt.json`: exit 1;
  final report `g4-fix-geometry-oracle-corpus-R9td1F/geometry-oracle.json`.
- `g4-fix-geometry-oracle-schema-check-Yvsh1a/receipt.json`: exit 0;
  repository syntax, manifest, CSP, parser, graph-model and branding checks pass.

Final oracle SHA256:
`c6b49e72f6a0cdb8cfd03b0e4d20e5f288638b141e20e004e19dc6b00f073caf`.
The final report records loaded/final runtime fingerprints; no concurrent runtime
edit occurred during that execution. Reports are revision-specific snapshots,
not a claim about later router edits.

During development, an added duplicate-ID test exposed a finding-object bug:
evidence `kind` overwrote the diagnostic `kind`. It was fixed by reserving code
and kind after evidence fields; the failing receipt is preserved at
`g4-fix-geometry-oracle-final-negatives-9NkS0D/receipt.json` (13 pass, 1 fail).
No failing test was removed or skipped. Final CJS syntax checks pass. The CJS
language server initially reported no diagnostics, but timed out on subsequent final
refresh requests; final LSP freshness for `geometry.cjs` is unverified. Runner
LSP had no diagnostics; test LSP had only the CommonJS-to-ES-module suggestion.

## Concrete corpus findings and limits

Original instrumented A/left: 4 overlap pairs / 5 segment overlaps; B: 74 pairs /
87 segments. The original A/left spans include horizontal overlap length 18 at
y=90, overlap length 10 at y=96, and vertical overlaps 100, 108 and 120 units.
Original raw geometry is preserved, not rewritten for new metadata.

An intermediate actual run found unexpected escape tails, independent of missing
metadata: A/left `put_value` joined `[348,408,372,408]` at x=360, leaving an
unattached free end at `(348,408)`; `get` similarly ended at `(348,780)`. Full
segments are preserved in `g4-fix-geometry-oracle-corpus-oWsq0g/geometry-oracle.json`.
The final recorded product execution no longer emitted those G08 findings.

All 58 final emitted layouts have zero G01-G08 findings. The final 36 RTL
attempts pass every check. Remaining failures are BSV-only: 58 missing-source-
incidence findings across 22 size attempts, plus 58 missing-array, 58 incidence
endpoint coverage, 58 attachment incidence coverage and 62 orphan-slot findings.
Earlier A/C root `INVALID_ROUTING_INPUT: Missing canonical incidence projection`
failures no longer occur after the lead's authoritative RTL projection update.
An intermediate oracle group check compared a method's full path to an interface
path; source endpoint construction showed methods append their own name. The
oracle now checks the parent path, with a dedicated same-definition, different-
subinterface negative test. The final report has no source-group findings.

At desktop size, instrumented A/left changed from 1178x670 / route length 7336 /
37 bends to 1848x1164 / 12540 / 37 bends. Instrumented B changed from 2030x1386 /
63232 / 133 bends to 3432x2616 / 69708 / 178 bends. Reduced overlaps do not imply
better visual compactness; visual/design acceptance is not established.

This deliverable validates declared final geometry, public query/layout/Fit APIs,
and M/L path consistency. It does not establish actual browser glyph measurement,
CSS/font correspondence, pointer crossing chooser behavior, keyboard accessibility,
DOM resize/export behavior, navigation B01-B12, packaging, full repository test
acceptance, or user visual acceptance. Those remain the lead's separate lanes.
No product fixes are made by this oracle and no actual-corpus assertion is weakened.
