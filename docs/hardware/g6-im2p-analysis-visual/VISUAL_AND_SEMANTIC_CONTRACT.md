# Visual and Semantic Contract

## Semantic certainty

1. `exact` requires supported syntax, exact child expressions, and confirmed binding.
2. `unresolved` retains identity and source evidence when a target or binding is unknown.
3. `unsupported` retains raw text, range, and reason when syntax is outside the supported subset.
4. Source-derived operation nodes never imply physical RTL cells.
5. BSV relations, RTL nets, known contributors, and complete origin sets stay distinct.

## Expression subset

- Binary operators follow official BSV precedence; supported binary tiers associate left.
- Parentheses, unary forms, calls, member selection, and indexing bind structurally.
- Comments and strings are masked for scanning but raw text and UTF-16 ranges remain unchanged.
- Case selector, arms, labels/patterns, default, body IDs, and source ranges remain separate.
- Unsupported pattern binding never becomes an exact Boolean predicate.

## Family model

Every repeated family carries source declaration identity, parent occurrence, declared aggregate type, ordered dimensions, leaf type, generator expression, confirmed leaf constructor when available, parameter status, source range, and lazy expansion policy.

Family aggregate and element identity differ. Symbolic dimensions display `[*]` and their expression. No arbitrary tile count is presented as concrete hardware.

## Visual roles

| Object | Required visual cue |
| --- | --- |
| Module | boundary, title region, enter affordance |
| Register | compact storage glyph |
| Register family | one register glyph, repeated boundary, and a readable count or dimension/status label |
| FIFO/FIFOF | queue glyph without invented occupancy/depth |
| Memory/bank | memory glyph using only confirmed banks/ports |
| Module family | one module glyph, repeated boundary, and a readable dimension/status label |
| BSV operation | operation glyph and source label; never RTL-cell styling |
| Unresolved | placeholder, reason, source access |

Kind and repetition never share one icon position. The canvas label separates array rank from exact, symbolic, or unresolved status; the Inspector retains the full type and dimension expressions.
At low overview scale the tiny kind icon is folded to protect mandatory names. A family summary is shown when it fits; narrow labels retain rank and certainty together (for example `2D · symbolic`), or at the smallest widths retain the hardware kind and defer remaining detail to the Inspector.

## Interaction states

- Hover: temporary outline/contact emphasis.
- Selected: persistent outline and related endpoint emphasis.
- Keyboard focus: independent focus ring.
- Analysis seed/result/boundary: distinct markers tied to returned query IDs.
- Unresolved/partial: badge and text with evidence access.

Selection styling cannot move nodes, reroute wires, change hit targets, or capture pointer events through an overlay.

## Zoom and navigation

- Wheel/pinch changes geometry only and creates no hierarchy visit.
- Module entry uses explicit activation and preserves occurrence identity.
- Fit structure contains current projection bounds.
- Fit selection centers selected object and declared related scope.
- Back/Forward restores committed owner, selection, query context, disclosure, viewport, and panel state.
- Derived label detail is recomputed deterministically and does not create history.

## Readability

- Visible text floor: 9 CSS px after all transforms.
- Selected/detail title target: 12 CSS px.
- Hidden text is excluded from font-size success metrics and checked separately against mandatory labels.
- Screen-space labels remain anchored, noninteractive, clip-aware, and collision-checked.

## Motion

Motion is limited to hover/selection feedback, hierarchy entry/return, and disclosure. No activity, occupancy, clock, or signal flow is implied. Reduced-motion mode returns the same final semantic state.
