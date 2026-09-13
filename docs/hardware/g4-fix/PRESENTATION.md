# G4 correctness presentation changes

The BSV-first product and incumbent VS Code theme remain. These changes address
wire ownership, label obstacles, interface grouping and exact navigation only.

## Stable navigation chrome

The scene header reserves 41px whether a source breadcrumb is present or absent.
The Return BSV control retains its layout space while hidden. Hierarchy
breadcrumbs use a bounded horizontal scroller rather than changing their row
height as descendants are added. The implementation path's full text is retained
in its tooltip and inspector when the narrow header truncates it.

This fixes the browser-observed five-pixel Back viewport drift: previously the
BSV-to-RTL header grew by ten pixels after geometry preparation, triggering a
second center-preserving ResizeObserver update.

## Authoritative geometry labels

The renderer consumes the router's label text, positions, anchors and bounds.
It does not independently shorten a second copy of each label. Diagram labels
use fixed monospace sizes within those bounds. Geometric zoom scales them;
the old viewport-dependent title font inflation is removed because it could
exceed declared label obstacles.

Overview still suppresses secondary/pin details without removing scene facts.
Full names remain in hover/inspection and SVG metadata. Dense RTL overview
requires zoom; this is not a claim that every pin is readable at every scale.

## Groups and incidence slots

`scene.interfaceGroups` contains source interface identities and exact
`memberContactIds`. Its brace/header is not a physical port mark. Hovering it
identifies its actual method members; selecting it explains source grouping.
Actual typed method contacts stay on hardware boundaries.

A vector contact with several distinct connected bit groups has separate
attachment marks. Each retains original contact ID, connection ID and exact
indices/bit IDs. There is no drawn conductor joining unrelated slots and no
new canonical port or global constant driver.

## Wire selection

Hit resolution measures screen-space distance to actual transformed segments.
It is independent of SVG paint order and names. The hit radius is 6 CSS pixels.
If the best candidates are within 1.5 CSS pixels of one another, a native-button
chooser identifies the connections by label, ordered bits and endpoint context.
Otherwise the uniquely nearest connection is selected. These are pointer
thresholds, not the geometric collision oracle's `1e-7` tolerance.

Hover uses the same candidates, while keyboard activation selects the explicitly
focused connection. A label click selects its named connection. Wire actions
never enter a module. Selection changes stroke/mark styling, not the route path.

The inspector exposes vector ID, hardware snapshot, actual occurrence, ordered
bits and contact indices. Its machine-readable connectivity record also retains
canonical bit IDs, incidences, original members and aliases.

## Complete SVG export

Export SVG serializes the current validated scene after settlement. It removes
the viewport transform and uses the complete geometry bounds as `viewBox`.
Resolved theme styles and canonical connection metadata travel with the SVG.
Export does not mutate current selection, viewport, hardware or geometry.

User visual/design acceptance remains PENDING. Native production integration
and VS Code Extension Host operation are separate gates, not implied here.
