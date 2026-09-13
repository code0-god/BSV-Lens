# ADR 005: single-click semantic zoom is separate from inspection

Status: proposed for G1 approval.

Decision: expandable block body performs one atomic hierarchy-entry action.
Info/Space inspect without entry. Ports, wires, leaf cells and black boxes
inspect without bubbling. Wheel/pan change geometry only.

Navigation owns snapshot/stage, occurrence path, expanded shells, scene root,
selection, viewport, panel/source state and Back/Forward stacks. Prepare
model, boundary bindings and valid geometry before committing the scene.
An identical destination/state is a no-op. Target/transaction deduplication
prevents accidental second entry on repeated/double activation.

Back/Forward restore previous/next distinct scenes; Up navigates to the actual
parent. Breadcrumbs are navigation transactions and remove stale hidden
focus/filter state. Current selection does not define containment.

Rejected: double-click-only entry; two different Focus buttons; history from
every selection/pan frame; Back secretly interpreted as parent; swapping a
block for an unrelated list; delayed empty graph on failed child load.

Consequences: the same shell/port IDs survive expansion. Context continuations
retain real bit refs. Browser tests check actual pointer and keyboard paths,
not just reducer calls, and assert both membership and restored viewport.
