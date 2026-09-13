# ADR G5-001: Separate analysis relation families

Status: accepted for the explicitly authorized G5 implementation.

G2 equivalence, cell-internal possible dependency, BSV behavior/data flow,
G3 correspondence/origin and scheduling answer different questions.
A shared untyped graph would permit containment-only payload paths, cell
input/output net union and origin propagation through ordinary connectivity.

Each query names one analysis family. Explicit actions connect results by
canonical references, but do not promote evidence strength. Same-net traverses
only recorded local incidence and formal/actual bindings. Dependency adds only
supported typed cell edges. Source analysis uses existing semantic records.
Correspondence explanations return existing G3 claims unchanged.

This preserves current truth and allows independent oracles for each family.
It deliberately does not offer an all-relations shortest-path operation.
