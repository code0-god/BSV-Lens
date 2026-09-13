# G4 Correctness Follow-up

This change corrects RTL visit identity and ambiguous wire geometry. It does not
replace the BSV-native product direction, production UI, or canonical G2/G3 data.
Version stays 0.4.1; no commit, push, merge, tag, Release, publish, or G5.

## Before evidence and provenance

The named independent review files were not available locally. The revised user
instruction permits reconstructing the reported regression when the original
oracle is unavailable. `experiments/hardware/g4-fix/oracle/regressions.test.cjs`
is therefore a **local oracle reconstructed from supplied findings**, not a
received external reviewer file or an independent review approval.

It imports the actual product query, navigation and layout, not fixtures of their
answers. Before any runtime change, both reported assertions failed and the
existing BSV-left/state/instrumented-RTL/Fit/Back smoke passed.

- Before regression: `.build/hardware/runs/g4-fix-before-regressions-5v24Nu/`.
- Before positive smoke: `.build/hardware/runs/g4-fix-before-positive-ZMPyys/`.
- Original runtime fingerprint:
  `e3ed0eb1eb60bd058287472a545ad1c27aeb6e1c98dbfdf1f993fba665820a07`.
- Expanded pre-edit preservation baseline: 2,718 files,
  `.build/hardware/runs/g4-fix-preservation-capture-647jUL/baseline.json`.
- Preservation fingerprint:
  `25622bb1a1376b4ab23a182b8a86878919142661a3559aeeb879f2a88e2387c8`.

The local oracle's SHA256 is recorded in the before receipt. Its assertions remain
unchanged through the fix. Before pointer and geometry probes use a fresh copy of
the original submitted source ZIP, so concurrent runtime edits cannot contaminate
the baseline. Existing submitted captures are distinct from this new execution.

## F1

BSV analysis identity includes source/build revision and source root/owner/path.
Actual RTL location includes the real hardware snapshot, provider, supplied stage,
implementation root, current occurrence, parent, and implementation path.
Two RTL descendants under the same BSV owner are distinct visits.

Stable location identity excludes generation, render ID, geometry, viewport,
hover, and incidental selection. Full restore snapshots retain selection,
source/implementation context, disclosure, viewport, inspector and metadata.
Explicit same-location analysis selection updates are not hierarchy visits.

Resolve authoritative target/context, prepare and validate geometry, reject stale
work, compare canonical identity, then commit atomically. Unchanged visits do not
add history or animation. Invalid targets preserve the last valid scene.
Boolean compatibility may remain, but diagnostics distinguish committed,
unchanged, unresolved, stale, cancelled, blocked, and error.

`contextOccurrenceId` and `implementationOccurrenceId` must have documented
separate roles if they differ. No priority fallback may hide a contradiction.
Request context never authorizes invented source correspondence.

Back/Forward restore visits. RTL Up and RTL breadcrumbs follow actual RTL
hierarchy; BSV Up and source breadcrumbs follow source hierarchy. An RTL root
does not silently return to BSV. Source return is explicit or through Back.
Header and inspector display both source owner and actual implementation path.

N01-N10 cover real A root/left/right, repeated definitions, dedup, history,
provider/snapshot changes, C 8/12-bit inlining, controlled races, failures and the
existing BSV roundtrip. Real data must complement nondegenerate unit fixtures.

## F2

Different canonical connections may not share a positive-length collinear segment.
Same-net fanout trunks are valid. Different-net proper point crossings are not
junctions and require unambiguous selection or an explicit candidate chooser.
No new global bundle mechanism is required.

Ownership comes from scene references to G2 occurrence-scoped connectivity and
ordered members. Never infer it from names, equal integer values across scopes,
constant value, cell input/output, or partial vector overlap.

The bounded router must reserve actual horizontal/vertical intervals and contact
escapes; non-overlapping intervals may reuse tracks. Obstacles include bodies,
contacts, labels, hierarchy boundaries and incompatible reserved routes.
Bounded alternate routes and spacing retries are allowed. Failure is explicit
and preserves the previous scene; routes are not silently dropped.

Multiple distinct vectors may use different bits of one canonical vector contact.
Any separate attachment slots must retain original contact ID, member bit IDs and
endpoint indices. They are presentation incidences, not fabricated physical pins,
global constant drivers or inferred unions.

## Independent geometry checks

The test oracle reads actual final segments and scene membership, not the router's
`valid` flag. Tolerance is `1e-7` diagram units unless a stricter check is possible.

- G01 cross-net positive-length overlap.
- G02 point crossing versus overlap.
- G03 genuine same-net fanout trunk and junction.
- G04 unrelated node-body penetration.
- G05 unrelated contact/slot penetration.
- G06 wire/node/label box collisions.
- G07 unauthorized shell-boundary crossing.
- G08 unexpected dangling endpoint.
- G09 attachment coordinates and canonical contact indices.
- G10 complete route/label Fit and export bounds.
- G11 unchanged ownership under selection/highlight.

Exceptions are local and evidenced: own pin attachment, same-net trunk, explicit
detached-vector glyph, or single-contact vector stub. First/last segments are
otherwise checked normally.

R01-R12 cover the four A/left instrumented pairs, every supported A/B/C RTL
root/descendant, fanout, repeated names across occurrences, aliases, ordered
slices, literal sites, inout/multiple drivers, congestion beyond old 7/5 periods,
long labels/dense contacts, Fit/resize/export, and negative oracle cases.

## Scoped presentation

Shorter routes and fewer bends are desirable but never replace correctness.
Record before/after bounds, route length, bends, crossings and collision counts.
Control label placement and interface grouping may be corrected; source names
and relation IDs remain available. An interface group header is not a physical
port. The inspector prioritizes source owner, implementation path and connectivity
separately from origin. BSV remains the default; RTL cells never become its blocks.

## Browser and regression gates

B01-B12 require real pointer/keyboard actions: RTL root/left/right, Back/Forward,
actual RTL Up/breadcrumb, duplicate/double clicks, pending races, all formerly
colliding signals, fanout/crossing selection, BSV contributor/Fit/Back and narrow
windows/themes/reduced motion/resize.

Assert scene kind, source owner, implementation occurrence, snapshot/provider/
stage, shell, selection, history, viewport, DOM path, actual geometry/hit target,
inspector identity and page errors. Subscribe to exact events before actions;
no timing sleeps. Browser policy errors are recorded, not bypassed.

Execution order: before evidence; F1 and real hierarchy API checks; F2 and geometry
checks; real browser journeys; G2/G3/G4 plus full repository regressions; packaging;
public-path replay from two separate empty extraction directories.

## Delivery

Use new `bsv-lens-hardware-g4-fix-review.zip` and
`bsv-lens-hardware-g4-fix-source.zip` with adjacent SHA256 and validation receipts.
Include before/after evidence, frozen oracle, new tests, original required A/B/C
capture closure, traces, screenshots, changed contracts and `G4_FIX_REPORT`.
Record commands, exit codes, stdout/stderr, environment, hashes and any blocked
scope. Archive hashes remain outside the archives.

Core replay must work without compiler/node_modules/global module search.
Browser dependencies are a separate lane. Missing 14 author companions must still
produce the expected explicit failure. Common runtime bytes and protected inputs
must remain verified. User visual/design acceptance stays PENDING.
