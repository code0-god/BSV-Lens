# ADR G5-003: Analysis belongs to the existing navigation frame

Status: accepted for the explicitly authorized G5 implementation.

G4 already distinguishes BSV owner from actual RTL occurrence and restores
scene, geometry, viewport, selection and disclosure atomically. A separate
analysis-history controller would create races and inconsistent Back/Up.

An explicit analysis is a new frame in that same controller, keyed by stable
normalized query identity. The frame retains the submitted request and
complete result. Existing disclosures hold renderer-local code/result/detail
state. Progress, hover and metrics are not locations.

All analysis and hierarchy work share one generation/abort owner.
Validate result echoes and current context before committing. Failures,
cancellation, stale responses and invalid projection leave the last valid
frame untouched. Back/Forward restore saved frames; Up follows hierarchy.

Projection uses the existing canonical scene/geometry and does not become
another hardware model or router.
