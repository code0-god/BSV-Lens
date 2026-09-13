# Bounded orthogonal router: implementation contract

F2 uses `media/hardware-layout.js` only; no added browser asset or dependency.
The router does not edit canonical Source, Hardware, Correspondence, scene
members, ordering, aliases, directions, or literal sites. Renderer, selection,
export, source incidence projection, and browser acceptance belong to the lead.

## Canonical ownership and incidences

A route owner is exactly the input `connection.id`, scoped by the current scene.
No ownership is inferred from names, integer values, constant values, direction,
shared contacts, or partly overlapping vectors. Same-owner branches form a tree;
different owners cannot share positive-length segments, including escapes.

Real B has three distinct vectors terminating on one `B` contact and three on one
`S` contact. Real C/root has contacts carrying signal bits and separate constant
bits. Current scene grouping deliberately omits endpoint index from its grouping
key, so these connections may legitimately share a canonical vector contact.
Different escape distances from one common center would still share an initial
segment and would not fix this case.

The scene supplies exact presentation incidences:

```js
connection.incidences = [{
    contactId,
    // Optional stable presentation id; otherwise JSON.stringify([connection.id, contactId]).
    id,
    members: [{
        bitId, endpointId, index, contactIndex, boundaryId, formalBitId
    }]
}];
```

For direct contacts, member endpoint entity/index identify the contact index.
For child ports displayed instead of parent pins, Scene Builder uses the exact
G2 boundary `pinId`, `portId`, `index`, `actualBitId`, and `formalBitId`. Parent and
child bit IDs are not interchangeable scopes. Missing mapped projection is an
explicit error, not a name-based fallback. Existing direct endpoint members can
supply the projection when no explicit incidence array is present.

Each connection/contact incidence receives one separated geometric slot. A slot
can represent noncontiguous indices. Its `indices` and `bitIds` arrays are
parallel, in original projected member order, including repeated bit occurrences.
For example, members at indices `[1,0,2]` with bits `[y,x,x]` remain paired that
way; independently sorting indices would corrupt that representation. Slots are
ordered spatially by minimum index, then connection ID. Slot pitch is 12 units.
The canonical contact remains inspectable. Slots are sublocations of its vector
glyph, not new physical pins, new drivers, or a union of their connections.
Multiple-driver/inout facts are unchanged.

BSV incidence members are empty because these are semantic relations, not RTL
bits. Every original relation endpoint remains an attachment. Module/storage IDs
get boundary anchors without fabricated scene contacts. Source interface groups
are separate from typed method contacts; membership comes from
`scene.interfaceGroups[].memberContactIds`, never inferred wiring to methods.
The F1 layout cache must include `interfaceGroups` as well as the existing fields.

## Definitive geometry contract

The public function remains `layout(scene, size, options = {})`. Existing
`nodes`, `contacts`, `routes`, `bounds`, and `fitViewport` remain available.
Additional fields are presentation data:

```js
geometry = { nodes, contacts, groups, routes, labels, crossings, bounds, metrics };

contact = {
    id, ownerId, x, y, side: 'left' | 'right', boundary,
    markBounds: { x, y, width, height },
    slots: [{ id, connectionId, contactId, x, y, indices, bitIds }]
};

group = {
    id, ownerId, x, y, side, boundary, memberContactIds, labelBounds,
    slots: [/* same incidence shape, but semantic group anchors, NOT physical marks */]
};

attachment = {
    id,                 // original canonical endpoint ID
    ownerId, contactId, // contactId only for contact endpoints
    groupId,            // groupId only for interface group endpoints
    slotId, side, boundary, x, y, indices, bitIds, escapeX
};

route = {
    id, points, attachments, // points and attachments contain the same records
    segments,               // [x1,y1,x2,y2], nonzero orthogonal world coordinates
    junctions,              // {x,y}, physical same-owner degree >= 3 only
    path,                   // generated directly from canonical segments
    unconnected,
    labelX, labelY, labelAnchor, labelBounds, label
};

label = {
    id, ownerId, role, text, fullText, textWidth,
    x, y, anchor: 'start' | 'end', bounds: { x, y, width, height }
};
// Roles: node-title, node-detail, contact-label, contact-detail,
//        interface-group, connection.

crossing = { x, y, connectionIds: [horizontalOwnerId, verticalOwnerId] };
metrics = { bounds, totalRouteLength, bends, crossings, segments,
            expansions, checks, passes };
```

`geometry.labels` is authoritative for display text and placement. Keep full text
in accessible names/inspection. Render `textWidth` using SVG `textLength` and
`lengthAdjust="spacingAndGlyphs"` or equivalent bounded painting; an unrelated
font-width assumption cannot establish obstacle clearance. Group headers/brackets
are not `.mark` physical contacts. A single-contact vector is an owned stub; a
zero-contact vector is an explicit detached glyph with no invented attachment.

Crossings remain proper point intersections without dots. The lead's centralized
screen-distance hit test must return one exact connection or an explicit candidate
chooser; SVG stacking order is not a valid ambiguity resolver. Keyboard-focused
routes and original contact/group inspection retain their own identities.

## Placement, obstacles, reservations, and search

Placement retains the row/column hardware structure. Dimensions account for
actual bounded labels and slot counts. Contact rows are at least 48 units. Bodies
use actual label widths, not an unconditional large width. Initial inter-block
gutters and outer routing margins are 120 units for BSV and 192 for RTL. There
are at most three complete passes: add 48 units to gutters, and 48 (BSV) or 24
(RTL) to margins on each retry. Bottom padding outside the shell is 24 for BSV
and 36 for RTL. This is bounded spacing relaxation, not a global lane per net.

A 12-unit rectilinear grid covers the shell interior. Inflate static obstacles by
6 units: child/storage bodies, contact marks, all node/contact/group labels, and
the reserved shell header. The shell is an enclosure, never a filled body.
Perimeter traversal is forbidden except a declared terminal attachment.

Labels are placed before maze search, with deterministic candidates at offsets
36/60/84 from each attachment and baselines -12/+26/-36/+50 from its row. BSV
also permits a -84 baseline candidate above the blocks for compact gutters. Reserve
clearance beyond every escape so a label cannot seal a middle shared-vector slot's
only exit. All label rectangles remain obstacles even when zoom hides the text;
selection/highlight does not change wiring. Detached glyphs occupy a reserved
header strip separate from node titles.

Reserve each 24-unit terminal escape before routing trunks. Child escapes point
outward, shell escapes inward. Only the escape tip participates in maze search;
entering an escape midway would leave an unevidenced dangling tip. Foreign routes
cannot cross escapes. Own contact/body exemptions apply only locally to terminal
attachment, not to arbitrary route segments.

Horizontal and vertical interval tables store occupied `[lo,hi]` intervals and
owner indices referencing unchanged connection IDs. Different-owner positive
length overlap is rejected. Disjoint intervals reuse coordinates. Grid edge and
vertex occupancy accelerate reservation queries; the grid pitch supplies parallel
clearance. Foreign T-touches, bends, terminal touches, and turns at crossings are
rejected. A proper crossing must continue straight and stay outside protected
escapes and junctions.

Route high-fanout connections first, with stable-ID tie breaks. For each owner,
attach remaining tips to its existing tree using A* states `(vertex, incomingAxis)`.
Costs are length plus 18 per bend and 24 per crossing; the heuristic is minimum
Manhattan distance to the existing tree. Another owner's route is never a target.
Canonicalize same-owner collinear intervals, derive branch dots from actual grid
degree, and generate SVG solely from final segments. A failed pass is discarded
entirely; partial geometry is never returned.

Before returning, product validation checks finite orthogonal segments, bounds,
body/contact/label/header collisions, shell perimeter, route connectivity,
permitted endpoints, supported dots, different-owner overlap/touches, and exact
crossing metadata. The independent oracle uses separate predicates and real
Hardware/Source membership, not the product validator's conclusion.

## Exported, testable limits

`ROUTING_LIMITS` is frozen. `layout(scene, size, {limits:{...}})` permits lowering
known limits for tests, not silently raising them. Current ceilings:

| Limit | Ceiling |
| --- | ---: |
| Internal nodes | 256 |
| Contacts / interface groups | 2048 / 512 |
| Connections / incidences | 512 / 2048 |
| Projected member-index entries | 16384 |
| Grid vertices per pass | 250000 |
| A* expansions, cumulative across passes | 2000000 |
| Counted checks, cumulative across passes | 50000000 |
| Live heap entries | 1000000 |
| Provisional segments per pass | 65536 |
| World width or height | 8192 |
| Complete placement/routing passes | 3 |
| Label candidate attempts per route/pass | 2048 |

Each grid vertex has two axis states. Grid products are checked before allocation.
Oversized input/search/candidate budgets raise `ROUTING_BUDGET_EXCEEDED` with the
budget name and counters. Invalid identity/projection raises
`INVALID_ROUTING_INPUT`; exhausted geometric alternatives raise `ROUTING_BLOCKED`
with connection identity. Final validation errors are `INVALID_ROUTING_GEOMETRY`.
F1 handles failure before atomic publication, retaining the previous valid scene.
There is no wall-clock deadline or claim of arbitrary-large-design scalability.

## Verification and measured limits

All receipts are under fresh `.build/hardware/runs/` directories. This child edited
only `media/hardware-layout.js`, new `test/hardware-router.test.js`, and this note.
Scene/renderer and independent-oracle changes were separate agents' work.
The original reconstructed two-test oracle remains unchanged; its SHA256 is
`a11b4c9b2e93019e68900574c54e583110ae7a4c641c646f43df1719861c4ac5`.

Red tests preceded implementation (`g4-fix-router-red-Ic0JDJ`); additional red
cases exposed dangling tips and reordered-index corruption
(`g4-fix-router-red-topology-qqkq5H`) and the label-budget error classification
(`g4-fix-router-budget-red-z931TM`). None was deleted or skipped to go green.

Initial integrated verification: 15/15 targeted tests, including all 18 RTL and
11 BSV scenes and the unchanged frozen oracle:

```sh
node experiments/hardware/g4-fix/run.cjs router-integrated-corpus node --test \
  test/hardware-router.test.js test/hardware-layout.test.js \
  experiments/hardware/g4-fix/oracle/regressions.test.cjs
```

Receipt: `g4-fix-router-integrated-corpus-7n424g/receipt.json`.
`npm run check` passed (`g4-fix-router-check-xXbOI3/receipt.json`). The affected
runnable product probe also passed with 29 complete scenes and zero overlap pairs:
`g4-fix-router-product-metrics-u5nJmv/receipt.json`; full geometry is in
`g4-fix-product-probe-Tn3iQl/product-probe.json`.

Instrumented before/after at 1100x650 (before source:
`g4-fix-product-probe-2DDy2p/product-probe.json`):

| Scene | Bounds before -> after | Length before -> after | Bends | Crossings | Overlap pairs |
| --- | --- | --- | --- | --- | --- |
| A/left | 1178x670 -> 1848x1164 | 7336 -> 12540 | 37 -> 37 | 29 -> 22 | 4 -> 0 |
| B/root | 2030x1386 -> 3432x2616 | 63232 -> 69708 | 136 -> 178 | 434 -> 162 | 74 -> 0 |
| C/root | 1178x784 -> 1992x1452 | 13624 -> 17892 | 46 -> 60 | 96 -> 40 | 8 -> 0 |

The geometry is larger and some routes are longer; the former coincident/obscured
segments are not a valid smaller-layout baseline. This is not a readability or
user-design approval. At 375x500 all 29 scenes also route successfully
(`g4-fix-router-compact-corpus-iijEHg/receipt.json`). B becomes 2472x3456, so Fit is
an overview and inspection requires zoom. Typical direct measured layouts in that
run were under 36 ms except B at about 90-93 ms on this arm64 workstation; these
are observations, not timing assertions or a general performance guarantee.

The reviewed independent report
`g4-fix-geometry-oracle-corpus-R9td1F/geometry-oracle.json` emitted all 58 layouts
and passed all 36 RTL checks. Its remaining 22 BSV failures were exclusively
missing source incidence projection and consequent coverage findings; no router
rewrite was made in response.

### Final source-projection replay: PASS

```sh
node experiments/hardware/g4-fix/run.cjs router-final-tests node --test \
  test/hardware-router.test.js test/hardware-layout.test.js \
  test/hardware-geometry-oracle.test.js \
  experiments/hardware/g4-fix/oracle/regressions.test.cjs

node experiments/hardware/g4-fix/run.cjs router-final-independent \
  node experiments/hardware/g4-fix/geometry-check.cjs
```

- **31/31 tests PASS**, zero failures/skips; 9 router, 4 original layout,
  16 independent oracle tests, and both frozen reported-defect regressions.
  Receipt: `g4-fix-router-final-tests-dnyqro/receipt.json`.
- **58/58 independent corpus layouts PASS**, covering 18 RTL and 11 BSV scenes
  at 1100x650 and 640x800, with zero findings and no concurrent runtime edits.
  Receipt: `g4-fix-router-final-independent-cvluQ2/receipt.json`.
  Full final scenes/geometry/membership checks:
  `g4-fix-geometry-oracle-corpus-Yz69Sx/geometry-oracle.json`.
- Router tests additionally check every scene at 375x500, canonical immutability,
  complete routes, topology, label/body/contact clearance and Fit bounds.
- Fresh diagnostics for both owned JavaScript files reported no diagnostics.
- Final test-side B layout-plus-assertion measurements were approximately
  100-112 ms while the separate independent run executed concurrently. Operation
  counts and geometry remain deterministic; elapsed time is not an assertion.

No unresolved routing or incidence failure remains in the verified corpus.

Browser/rendered text/hit ambiguity/export acceptance remains lead-owned and is
not claimed by these layout tests. Full repository regression, packaging, public
replay, and global preservation certification likewise remain lead-owned.


### Final scoped BSV readability increment: retained

A 96-unit start failed A caption clearance; adding the BSV-only above-block
candidate fixed A but still left B blocked within the three-pass budget. Bounded
spacing probes established 120 as the smallest tested successful A/B start.
No clearance predicate, frozen oracle, connection truth, renderer font, or RTL
routing policy was changed. The new source readability regression was red before
the increment and retains strict improvement assertions for both width/height
and route length; no assertion was relaxed.

At 1100x650:

| Source scene | Bounds before -> after | Route length before -> after | Bends | Crossings |
| --- | --- | --- | --- | --- |
| A overall | 1584x708 -> 1368x552 | 1464 -> 1176 | 8 -> 8 | 1 -> 1 |
| A left/right | 1080x684 -> 1080x528 | 1044 -> 924 | 6 -> 6 | 0 -> 1 |
| B overall | 1512x756 -> 1488x744 | 3840 -> 3768 | 22 -> 22 | 5 -> 5 |

A overall succeeds on pass one. Its shell changes from 1224x648 to 1008x504;
the two 324x180 nodes move from x=372/888,y=300 to x=300/744,y=228. At the fixed
1100x650 test viewport, Fit scale increases from 0.66414 to 0.76901 (15.8%), without
inflating text outside its geometry. B needs pass three; smaller is not guaranteed
to route on the first attempt.

Tradeoffs are explicit: C low/high require the last spacing pass, growing from
1080x684/length 432 to 1080x720/length 480. C overall at 640x800 has smaller bounds
(1596x1080 -> 1524x996) but longer routing (5868 -> 7056). All remain independently
valid. This increment targets the requested A/B readability, not universal
route-length minimization or a redesign.

Verification receipts, all relative to `.build/hardware/runs/`:

- `g4-fix-router-bsv-spacing-final-tests-OTGEGa/receipt.json`: **32/32 PASS**,
  including the strict A/B improvement regression, all actual scenes at 1100x650
  and 375x500, original layout tests, 16 independent oracle tests, and both frozen
  reported-defect regressions.
- `g4-fix-router-bsv-spacing-independent-bMfnHx/receipt.json`: **58/58 PASS**, zero
  independent findings; full report is
  `g4-fix-geometry-oracle-corpus-Hx9CDX/geometry-oracle.json`.
- `g4-fix-router-bsv-spacing-comparison-tKLDQ2/receipt.json`: full before/after
  comparison against `g4-fix-geometry-oracle-corpus-Yz69Sx/geometry-oracle.json`;
  **all 36 RTL geometry objects deep-equal their pre-increment values**.
- `g4-fix-router-bsv-spacing-check-BVceYv/receipt.json`: `npm run check` PASS.
- Fresh layout diagnostics: none; test diagnostics: CommonJS informational hint
  only, no errors or warnings.

The renderer contract and all exported resource ceilings remain unchanged.
