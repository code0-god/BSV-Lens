# G5 analysis interaction contract

## Existing visual authority

This extends the existing engineering surface, not its visual world.
Root `DESIGN.md` and `docs/hardware/g4/DESIGN.md` remain the token, typography,
theme and scroll-ownership references. G4's BSV-native structure and explicit
RTL surface remain separate. No card wall, new circuit renderer, global dimming
or forced whole-design Fit is introduced.

The canvas retains geometric pan/zoom; the existing Inspector owns vertical
detail scrolling. Native buttons, selects, disclosures and source text use the
current VS Code variables and compact sizes. At narrow widths the existing
bounded lower Inspector remains usable without document overflow.

The existing panel-layout reference supplies canvas/utility adjacency:
<https://github.com/changeroa/StyleGallery/blob/main/patterns/viewport-shell/panel-layout.md>.
The beui action-swap implementation was inspected for distinct action/loading
state and reduced-motion behavior: <https://beui.dev/r/action-swap/raw>.
Only those mechanisms are relevant; no React dependency, decorative blur,
spring, brand palette or upstream component is copied.

## Contextual actions

An electrical port/pin/vector offers Same net, Drivers / loads, Input
dependencies and Output dependents when the corresponding product capability
exists. The selected vector offers a labeled positional bit/slice control.
Bounds and repeated order come from the canonical vector, not displayed text.

A BSV contact first exposes the verified actual RTL signal choices. Choosing
one is an explicit source-contract-to-connectivity action, not proof of origin.
A source storage offers Readers / writers, Update code and Verified
implementation. A BSV connection offers its actual caller, producer, consumer
and argument/formal mapping. A cell offers its real pins, supported semantics,
boundary explanation and available RTL/BSV evidence.

No generic Trace action combines these meanings. There are no additional
top-level tabs. Unsupported capabilities have an explanation, not fabricated
empty results or guesses based on labels.

## Result presentation

The Inspector first shows analysis kind, seed, actual source/RTL context,
completeness and stopping reason. Then it shows ordered positions and useful
terminal/dependency/source facts. Raw IDs remain available in details without
pushing the primary explanation off-screen.

Driver candidates, loads, boundary contacts and unknown/bidirectional contacts
are separate. Multiple candidates are observations, not contention warnings.
Source dependencies, readiness evidence and scheduling remain distinct.

On the canvas, project result canonical IDs onto already validated G4 objects,
contacts and routes. Existing route ownership/path geometry is unchanged.
Emphasis and seed/boundary labels use non-color distinctions and never capture
pointer events. There are no extra temporary SVG wires or cone-origin halos.
Unrelated hardware remains readable.

The result list reports returned, displayed, hidden/off-scene and frontier
counts separately. A display limit is not an analysis limit. Off-scene objects
remain in the canonical result and offer explicit Reveal where a verified
actual target exists. Unknown source correspondence is not repaired by opening
a similar name.

An explicit analysis slice is not necessary for this first G5 surface: current
scene emphasis, bounded result lists and occurrence-correct Reveal satisfy the
projection contract without another layout algorithm.

## Canonical contact versus presentation incidence

G4 may draw a child's formal port in the parent scene. When analysis starts in
the parent, its exact recorded incidence maps that contact position to the
parent actual pin/bit. Never pass a child's formal ID while asserting that it
belongs to the parent occurrence, and never parse an ID or label to guess it.
An open actual vector stays unconnected; entering the child's actual occurrence
is a separate explicit reveal if the user wants to analyze the formal port.

Grouped route IDs are display identities. Analysis seeds use their ordered
canonical bit references. Result membership comes from G2, not the group path,
rendered bounds, collapsed state or SVG order.

## Source drawer

Code analysis uses the existing Inspector region. Show actual callable or
expression, occurrence/call context, exact original slice, conditions, inputs
and result/effects before provenance details. Native disclosures hold longer
IDs and transport traces.

Calls, arguments, local definitions/uses, writes, returns and conditions open
explicit source analyses. Source-only functions are not hardware nodes.
Else polarity remains present in body conditions. Unknown branch merges and
unsupported syntax stay unresolved rather than receiving a guessed origin.

Every original/generated reference is explicitly labeled, hashed and
range-validated. Captured source and current-source freshness are independent.
This experimental read-only drawer is not a native VS Code editor integration.

## Navigation and asynchronous state

The existing Navigation Controller accepts an optional
`queryAnalysis(request, {signal, onProgress})` callback. `analyze(input)` derives
the current canonical context, owns query generation and uses the same abort
owner as hierarchy navigation.

`current.analysis = {request, result}` is a complete detached frame. Stable
analysis identity is `result.queryId`; metrics and generation do not add
history. Renderer selection/source/scroll/disclosure values live under existing
`disclosureState`, merged rather than replacing unrelated disclosures.

Back/Forward restore the complete scene, analysis, source, provider, viewport
and detail state without re-querying. Repeating the same query adds no visit.
Ordinary selection retains analysis without fabricating a hierarchy visit.
Up and breadcrumbs still follow the current surface's actual hierarchy.

Pending, error, unavailable, empty, partial and complete feedback have distinct
text. Busy state retains the previous hardware/result. No modal, overlay,
loading animation or disable rule blocks Back or cancellation.

The late-A / newer-B / hierarchy / Back race must not replace the restored
selection, source drawer or highlight. Subscribe to query/layout/navigation
completion events before actions; arbitrary sleeps are not acceptance evidence.

Approved source reads use `/api/source` on the same bounded, registered host.
They are bound to the semantic visit, selected entity/relation, code selection,
and source mode. Inspector scroll and disclosure updates do not cancel a read;
a new pending analysis, changed source selection, or different visit does.
Cancellation events include the reference ID. The browser regression holds a
real source response while a pointer-triggered Inspector disclosure changes,
then checks that the exact approved slice still opens.

## Acceptance

J01-J15 exercise real pointer/keyboard actions on actual A/B/C queries. Check
canonical IDs, ordered seeds, context, stop reasons, code text, history,
viewport and errors, not button counts. Test narrow/medium/wide, dark/light/high
contrast and reduced motion. F1/F2 and the independent geometry oracle apply
to the final emphasized surface. User visual/design acceptance stays PENDING.
