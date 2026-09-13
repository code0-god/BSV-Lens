# G6 workspace usability: UI and projection delta

## Scope and existing authority

The user requests a source-first, opt-in native workflow in the existing BSV
Lens extension. [G4 DESIGN](../g4/DESIGN.md),
[G5 readability DESIGN](../g5-readability/DESIGN.md), and
[G5 analysis UX](../g5/G5_ANALYSIS_UX.md) remain authoritative for theme tokens,
glyph sizes, hierarchy motion, source/query identity and panel/history behavior.
This delta changes information priority and disclosure, not the visual system.
It introduces no new framework, icon library, font, compiler or query engine.

The frontend design/redesign/perfection references were read. The relevant
mechanism is progressive disclosure with native controls in the existing bounded
canvas/Inspector shell. Marketing effects and site Lighthouse targets do not
replace installed Webview interaction and typography checks.

## Confirmed UI causes

The current native template presents manual source registration before a design
can open. Its primary navigation includes a disabled implementation action even
when no artifact exists. The Inspector renders every source/core-provided
section at the same level; its identity section repeats absent RTL path,
provider, stage and implementation. The view also repeats these technical facts
and hidden-label counts in normal status rows. These are confirmed UI causes;
the routing/projection cause and new summary schema are recorded by the core
projection lane before final acceptance.

## Primary native surface

The header shows BSV Lens, current workspace/design selection, and Settings.
Existing manual input, provider, export and build diagnostics remain inside the
native Settings disclosure. The command initiates bounded Host discovery; the
empty surface explains discovery, root selection, no modules or an actionable
failure instead of requiring an input name or manifest.

Back, Forward, Up, Fit structure, Fit selection and the Inspector toggle remain
native keyboard-accessible buttons. The committed module name and breadcrumb
identify the canvas. Requested/loading/failed targets are separate status; the
selector represents the committed design once a transition settles.

Two short first-use lines explain module entry and port/connection inspection.
No onboarding overlay covers routes. The caption explains overview disclosure;
numeric label omission counts remain diagnostics. Folded detail and routing
failure must use distinct messages.

Source-only state is one explanation: BSV source is available; connect a compiler
result to inspect RTL. The available Connect RTL action replaces a misleading
disabled primary RTL action. An attached but unmapped/stale/unsupported artifact
must retain its distinct status. Canonical provider/status values are unchanged.

## Inspector order and disclosure

For a module, show instance name, definition, current path, direct children and
interface groups before technical evidence. The module body/title enters once;
its separate information action inspects without entering. The Inspector can
enter a known child using the same navigation handler, and opens registered
source using the existing source request and actual-editor validation.
The Inspector title occupies the full pane width; Clear has its own following
row. Keep the existing 16px title token. Exact repetitions of the title in the
subtitle, definition or owner move out of the primary summary; distinct names
and paths stay visible, and canonical identity fields remain in diagnostics.

For storage, retain readers/writers and code actions. For an interface group,
retain exact path and membership with explicit member actions. For a connection,
retain relation family, endpoints, complete member IDs and source evidence.
Technical identity/provenance, compiler mapping and contributor scope remain in
collapsed native disclosures. Source-only absent RTL fields are not repeated in
the primary section. Critical partial/stale/unsupported status remains visible.
The module's Connections and code disclosure retains every canonical relation
member. Its buttons are created on first expansion and select the exact relation
ID; only selection requests the full relation/source evidence.

Disclosure uses existing visit state keys and callbacks. Scrolling, closing the
Inspector and showing technical details do not request a new analysis, change
scope or cancel a pending source read. Back restores explicit disclosures.

## Localization and accessibility

Use the Host's VS Code language for native `lang`; Korean major actions, empty
states and errors receive Korean text, with English fallback. A small shared
plain JavaScript dictionary provides UI strings only. BSV identifiers, types,
source text, canonical enums and raw diagnostics are never translated by text
replacement. Preview retains its existing English default.

All new controls are buttons, selects or details/summary. They retain existing
focus-visible and high-contrast theme variables. Labels and long identifiers use
existing 4/6/8/12/16/24 spacing and 10/11/12/13/16 type tokens; no new type scale.
Displayed schematic glyphs retain the 9 CSS px floor and selected/detail 12 CSS
px target. Canvas and Inspector preserve independent scroll ownership. Narrow
panes wrap controls and bound the Inspector without hiding required actions.

## Projection contract

The default BSV scene has `projection.kind: "bsv-overview"`, bound to its
canonical `ownerInstanceId` and captured `sourceRevision`. Shell, direct child
and direct storage membership is unchanged. No workspace parent or new hardware
net is introduced. The first named subinterface level forms boundary groups.
Nested groups and leaf methods remain canonical and are queried on selection.
An interface with at most four direct methods keeps those simple contacts
visible, including the captured A `put/get` interface; larger direct method sets
use their actual outer interface group. An outer group and a displayed child
group never claim the same folded leaf method.

`interfaceGroups` retain canonical IDs, owners and full `interfacePath`, with
`memberContactIds`, `childGroupIds`, `memberCount` and `membershipStatus`.
The selected Inspector returns immediate `interfaceMembers` with canonical IDs,
paths, type/category, source references and selection actions. An unresolved
interface remains explicit. An external endpoint used by a current-owner source
relation is represented by a current-shell continuation boundary containing its
original owner, path, interface path and exact `canonicalEndpointIds`. This is
scope projection, not a new instance or an inferred physical port.

Summary keys include current owner, relation family, both projected anchors,
both original owner/interface contexts, and original direction. Constructor
binding and interface forwarding use binding meaning, never payload arrows.
`memberRelationIds` and compact `members` retain each member's ID, kind, original
endpoints, behavior/expression IDs and source-reference IDs. Complete original
conditions, source text and provenance are read from the unchanged architecture
when the connection is selected. Initial scene payloads do not repeat that full
evidence for every summary member.

`canonicalRelationIds` is partitioned exactly once among `summaryRelationIds`,
`foldedRelationIds` and `scopeOutsideRelationIds`. The latter is currently empty:
supported external references have explicit continuation boundaries. The
`continuationRelationIds` array is a documented subset of summarized members,
not an additional partition. Same-anchor and current-owner method/implementation
relations are folded rather than drawn as shell self-loops. Module Inspector
`relationMembers` exposes every original local relation for selection and code.
`foldedContactIds` accounts for all non-displayed methods. Independent validation
checks canonical member contents, family, endpoint projection and exact coverage;
it does not take the renderer's counts as expected values.

Normal AQuA root and child overviews must include routed source-backed relations.
An injected secondary semantic route failure may defer that relation; invalid
source/occurrence/authority and RTL routing errors remain rejected. Final report
must distinguish routed summaries, folded details, deferred relations and source
facts. Routing acceptance and native usability evidence are recorded separately
from this display contract.

## Screen labels, hit targets and saved detail

BSV overview attachment lanes use 24px diagram-space incidence spacing; RTL
routing geometry keeps its previous rules. Optional connection text is folded
as `overview-detail`, with full names and canonical membership retained.
Child interface captions occupy an owner-relative boundary strip, at most 25%
of block width. They cannot cover the central body entry region or module title.
Insufficient captions fold as `interface-boundary-space`; markers, routes and
member access remain. A transparent bracket interior provides a real marker hit
area without adding a visible background or changing wire geometry.

A selected node's full 12 CSS px title first uses its own box. When that box is
too small, four deterministic adjacent positions are tested as a selected-title
callout. Each must remain inside the viewport/scene and avoid unrelated nodes,
wires, ports and labels. No opaque box or leader pretending to be a wire is added.
The semantic owner and click action stay attached to the original SVG group.
If no position fits, the native selected context remains readable at 12px and
selection fitting is explicit. This never changes the stored viewport or query.

Inspector titles use the full column width, with Clear on a separate row.
Current instance/definition text is not repeated when equal to the title.
Connection details put family, actual endpoints and original members first.
Native disclosure state uses the existing persisted boolean map. Empty missing
compiler/readiness metadata is folded; actual source conditions and evidence are
retained. A deferred-route notice links to its exact connections and source
members, and keeps raw diagnostics separate from the normal message.

SVG export names its BSV overview scope and includes source revision, projection
membership, routed/deferred status and full label metadata. It does not describe
folded semantic detail or missing routes as complete physical topology. RTL
export keeps the existing complete-current-scene contract.

## Required verification

Actual installed native journeys must exercise automatic first opening, both
AQuA roots, each real MemorySubsystem child, interface/source inspection and
Back. Capture committed owner/selection/revision and actual editor ranges.
Pointer body/title, port, wire and information actions are distinct. Keyboard,
narrow pane, high contrast and pending source disclosure/resize are exercised.
Measure actual glyph transforms and clipping; inspect real captures separately.
User visual/design acceptance remains PENDING until the user approves.
