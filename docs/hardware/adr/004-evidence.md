# ADR 004: evidence is a graph, not one confidence score

Status: proposed for G1 approval.

Decision: store hardware, generated RTL and original BSV references as
many-to-many relations with provider identity and inspectable evidence.
Keep four dimensions separate: structure verification, original-source
mapping status, semantic-grouping inference and source freshness.

Relations include implements, originates-from, port-binding, inlined-from,
shared-from, generated-for, optimized-away and merged-into. Relation names
are application schema, not claims about an existing compiler exporter.

Rejected: elevating Yosys `src` directly to BSV; equal-name or first-candidate
mapping; one numeric confidence concealing stale source or missing evidence;
claiming compiler generation or optimization from an unavailable mapping.

Consequences: a source ref contains content hash and actual coordinate
convention. Missing columns remain missing. Verified evidence must reach a
matching source slice. Multiple origins are shown, not arbitrarily reduced.
Coverage denominators include unmapped objects and distinguish aliases,
signal bits, ports, pins, cells, definitions and occurrences.
