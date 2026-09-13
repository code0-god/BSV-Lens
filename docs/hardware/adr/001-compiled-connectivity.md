# ADR 001: compiled artifacts own hardware connectivity

Status: proposed for G1 approval.

Decision: Hardware IR is imported from a named immutable compiler/reader
artifact stage. Every connection retains its ordered provider bit identities
and object pointer. Source IR and Semantic IR cannot create canonical wires.

Reason: source names, compatible types, method calls and directory placement
do not establish elaborated, optimized hardware connectivity. A source
expression may implement several cells or no independently retained cell.

Rejected: reusing legacy semantic nodes/edges as the circuit truth; rendering
source call graphs with wire glyphs; layout-time optimization of the hardware.
These cannot establish the core artifact membership contract.

Consequences: scene aggregation has reversible hardware references; different
transforms create distinct stages. Structure fidelity and original-source
mapping are measured independently. Missing correspondence stays explicit.

Evidence: actual reader output and independent comparison in FEASIBILITY;
existing source-derived model ownership in G0_AUDIT.
