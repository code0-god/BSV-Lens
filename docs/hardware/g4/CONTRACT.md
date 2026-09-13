# G4 execution contract

This is the isolated G4 implementation and acceptance contract, not a change to
the historical G0/G1/G1-BSV/G2/G3 contracts or a production replacement.

## Boundary

- Branch: `feat/hardware-schematic`.
- Entry HEAD and `origin/main`: `c6b9a5c642d105ad4117535c1d85366f1c02ec1c`.
- Package version stays `0.4.1`. Existing commands, production webview, workflows,
  all historical evidence, archives and history stay unchanged.
- No merge, commit, push, tag, Release, Marketplace publish, G5, or old UI deletion.
- G4-0 has passed before G4 implementation. Its frozen baseline and repeatability
  receipts are under `docs/hardware/evidence/g4/g4-0/`.
- New test/replay output uses `.build/hardware/runs/<unique-run>/`.
- User visual/design acceptance remains PENDING, irrespective of automated checks.

## Product

Default scene is BSV hardware: actual source module occurrences, child instances,
storage, typed interface and method contacts, and meaningful source relations.
Rules, methods and functions are behavior explanations, not physical blocks.
Protocol channels, endpoints, file/package objects and Yosys primitives are not
default hardware blocks. Typed endpoints are projected onto block boundaries.

Single clicking a child module enters its interior through the same occurrence
shell. Storage, contacts, connections and behavior overlays select for inspection.
Only the explicit RTL Implementation action enters actual implementation details.
RTL preserves unmapped hardware, actual names, pins, aliases, constants and
ordered bits. BSV names never replace arbitrary RTL cell names.

## Ownership and module interfaces

```text
Source/Semantic + immutable G2 Implementation
                    + separate G3 Correspondence
                              |
                   BSV Architecture queries
                              |
                         Scene Builder
                              |
                         Scene Model
                              |
                    Navigation Controller
                              |
                       Geometry Layout
                              |
                          Renderer
```

Product code belongs in new `src/hardware/architecture.js`, `scene.js`,
`scene-query.js`, and small adjacent modules where needed. It consumes genuine
G2/G3 product objects and `analysis.sourceModel`; it never imports the historical
experimental importer/BSV adapter. Reuse SourceModel indexes, AST statements,
expressions, bindings, flows and bounded module-return supplements.

New browser code belongs in `media/hardware-*.js` / `media/hardware.css`.
The separate development/review host is `experiments/hardware/g4/server.js`.
It serves new G4 HTML and assets without changing any existing default command.

The host keeps genuine product analysis objects: JSON copies cannot stand in for
the private G3 query context. Catalog loaders may reuse the read-only G3 capture
loaders. Dataset labels A/B/C are catalog configuration, never scene answers.

Scene queries accept intent with build identity, current `snapshotId`,
`queryGeneration`, scene kind, root and owner instance IDs, semantic selection,
detail/disclosure state, and explicit implementation provider. Every response
echoes `requestSnapshotId` and `queryGeneration`. Actual scene snapshot identity
and implementation context identify the selected provider's actual model.
The host rejects foreign snapshot/build/entity identities rather than guessing.

## Scene contract

Every scene contains:

```js
{
    id, snapshotId, sourceRevision, sceneKind,
    rootInstanceId, ownerInstanceId, occurrencePath,
    shell, children, storages, contacts, connections,
    correspondence, capabilities, selection, disclosureState,
    provenance, header, breadcrumb, implementationContext, inspector
}
```

- `sceneKind` is `bsv` by default or explicitly `rtl`.
- `shell.id` is the actual occurrence identity. Children retain that identity when
  promoted to the expanded shell. Source occurrence IDs survive RTL excursions.
- Presentation records carry `id`, object `kind`, display labels, source evidence,
  semantic references, and explicit interaction intent. Geometry is separate.
- Contacts carry owner, direction, category, declared/concrete types and verified
  metadata. EN/RDY/Verilog names appear only in explicit signal disclosure or RTL.
- Storage carries actual declaration, constructor/default expression, readers,
  writers, relevant behavior and implementation status.
- Connections aggregate losslessly. Each retains canonical `memberRelationIds`,
  member records, source refs, conditions, direction, payload/type and confirmation
  scope. Aggregation never promotes source-derived relations into physical nets.
- The canonical architecture keeps all facts even when labels are hidden by
  geometric zoom. No inference occurs in layout or renderer.
- Inspector is a semantic description with nonempty sections, source evidence,
  behavior references and exact status, not a raw generic field dump.

## Correspondence

Stock connectivity and instrumented origin use different snapshots and claims.
Source bindings between captures name both document paths and exact revisions;
equal file names or similar text are insufficient. Storage origin range must lie
inside the verified declaration. RHS origins match existing expression ranges
and callable context, not surrounding expressions or neighboring cells.

Stock `left.get` proves result port, ordered bits and connected actual net/pin
contacts. It does not prove a register or mux was caused by `get`.

Instrumented state and selected binary RHS claims may highlight only returned
verified contributor cells in the instrumented model. The UI exposes:

- Verified implementation contributor.
- Partial origin.
- Complete origin set: not established.

Provider capabilities distinguish source ranges, method port connectivity,
selected storage/binary contributors, complete sets, unsupported reset/mux and
shared/merged causes. Control remains zero claims where unsupported. Aliases gain
no inferred origin. Unknown, Unmapped, Unresolved, Unsupported, Not applicable,
Not present, None, Partial and Ambiguous retain distinct meanings.

C's source `narrow/wide.implementation` is not an invented RTL box. The actual
containing retained module is named separately from BSV hierarchy. Stock source
contexts do not authorize copying stock entity IDs into instrumented snapshots.

## Navigation transaction

Visits contain `snapshotId`, `sceneId`, `sceneKind`, build/provider identity,
root/owner/path, selected entity/relation, source/implementation contexts,
viewport, disclosure state, active panel and query generation.

Navigation order is intent, resolve, query, build, geometry validation, atomic
commit, transition render. Failed or stale queries retain the previous valid
scene. Any newer intent or Back invalidates pending work. Resize uses current
geometry dimensions and cannot let an older response overwrite current state.

Back/Forward restore full distinct visits, including source detail, disclosure,
selection and viewport. Up follows actual source hierarchy, not history.
Breadcrumbs follow BSV hierarchy; RTL implementation path stays separate.
Repeated identical visits do not add history. Selection, pan, wheel and Fit update
the current visit without fabricating scene visits.

BSV and RTL viewports are separate. RTL Fit cannot alter saved BSV viewport.
Resize preserves selected anchor or semantic center. Fit contains the complete
scene and all actual nodes remain visible.

Single-click is the default enter action. Keyboard Enter/Space performs the same
action. Double-click never performs a second-level navigation. Escape clears
selection/transient detail. Alt+Left and explicit Back traverse history.

## Browser and data acceptance

All journeys inspect scene kind, owner, selection, viewport, history, visible
semantic IDs, geometry and provider/correspondence status, not DOM counts alone:

- J01 overall to left by single click.
- J02 state selection and writer/readers.
- J03 put/get typed contacts.
- J04 semantic connection source evidence.
- J05 state to explicit RTL.
- J06 verified contributor selection.
- J07 unmapped neighboring actual cell.
- J08 RTL Back exactly restores selected state.
- J09 Back to overall.
- J10 Forward restores left.
- J11 Up follows hierarchy.
- J12 breadcrumb parent.
- J13 repeated entry leaves history unchanged.
- J14 accidental double-click never enters two levels.
- J15 pan then Back.
- J16 zoom, RTL, Back.
- J17 resize during transition.
- J18 rapid left/right with stale query.
- J19 Back during pending build.
- J20 light theme.
- J21 dark theme.
- J22 high contrast.
- J23 reduced motion with identical semantic result.

Run actual compiled A/B/C through product queries. A includes stock get and
instrumented state/RHS. B includes actual storage/method/rule and unsupported
zero-origin behavior. C includes 8/12-bit contexts, inlining and retained hierarchy.

Transition evidence is actual runtime geometry at before, intermediate fractions
and after (at least three intermediate observations). Record selected shell
continuity, boundary contact continuity, visible nodes and stable inspector bounds.
Static design frames and same DOM identity alone do not establish continuity.

Regression gates preserve G2/G3 ordered bits, alias/constants, occurrence identity,
snapshot immutability, source revision, stale rejection, authorization, hostile
JSON rejection, worker cancellation/latest-request behavior and origin limits.

## Delivery and stop

Separate G4 review/source ZIPs each receive adjacent SHA256 and validation JSON.
Fresh empty-directory extraction runs shipped offline core without compiler,
node_modules or global module search. Browser dependency checks stay separate.
Strict author preservation must still report exactly 14 missing companions in
the portable package as expected-fail.

The G4 report contains sections A through J from the user request, explicit
COMPLETE/PARTIAL/BLOCKED/NOT RUN states, J01-J23 evidence and Q01-Q20 answers.
Deliver actual overall, expanded, semantic detail, RTL and Back-restored images
plus transition frame sequence. Stop for human visual/design approval.
