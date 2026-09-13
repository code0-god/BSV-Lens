# ADR 002: source and implementation hierarchies are separate

Status: proposed for G1 approval.

Decision: maintain source definition, elaborated occurrence, implementation
containment and presentation regions as separate identities. Hardware
occurrence IDs include snapshot and full occurrence context.

Implementation containment is single-owner. Source provenance may be
many-to-many, including inlining and sharing. A verified logical source
boundary may highlight a set; it may not duplicate shared hardware.

Rejected: merging equal local bit numbers across module instances; assuming
source instances always remain RTL modules; attaching every shared cell to
the first source parent; inventing one hardware top above unrelated roots.

Consequences: parent actual bits and child formal bits have explicit ordered
boundary bindings. Only those bindings cross occurrence namespaces.
Repeated parameterized uses are tested against actual elaborated artifacts.
Debug hierarchy-preserving builds, if needed, are distinct snapshots, never
silent source changes.
