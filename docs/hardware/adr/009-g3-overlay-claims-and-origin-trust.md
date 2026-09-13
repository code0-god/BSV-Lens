# ADR 009: immutable overlays, claim families and origin trust

Status: G3 contract decisions; executable provider scope is verified per gate.
Authority: [G3_CONTRACT](../G3_CONTRACT.md).

## Decision 1: attach evidence without mutating G2

Keep the imported ImplementationSnapshot/Model and its identity intact.
Source/compiler/RTL records are separately validated and content-identified.
CorrespondenceBundle owns claims and lineage; AnalysisBundle composes the
immutable inputs for queries. Its capabilities do not retroactively change
G2's `originalBsvCorrespondence=false` or unknown build inputs.

Rejected: adding mutable mappings to the old model, replacing object IDs for
easier matching, or using the historical main SHA as feature content identity.
Bundle identity includes actual input/ref/claim/provider content, not host
paths, timestamps or self-referential file hashes.

## Decision 2: connectivity is not source origin

Declaration, compiler method contract, generated location, ordered bit binding,
same-net contact and compiler-recorded origin are distinct claim families.
Composition is a small verified rule set. Graph reachability, equal names,
type compatibility, ancestor source spans and Q contact cannot create origin.

Typed source/target tuples preserve actual relationships; arrays do not imply
all pairings. Candidate premises cannot yield exact results. Known contributor
and complete supported contributor set are separate coverage measures.

Rejected: one confidence field combining structure/source/freshness/authority,
or raising the historical 0/53 and 0/168 causes using source-link counts.

## Decision 3: BSV-native stays primary

ADR 008 remains the product abstraction: BSV Architecture by default, explicit
RTL Implementation detail. G3 may expose a CLI/JSON evidence explorer or a
minimal inspector connection to the same product query, not a second mapper.

Rejected: making the netlist default, rebuilding production navigation/layout,
or treating stable shell DOM/static midpoint frames as continuous-zoom approval.
G4 and human design/visual acceptance remain separate.

## Decision 4: origin claims need scoped provider authority

An actual isolated compiler/reader experiment must define the supported origin
scope, token/source binding, transformation granularity, evidence and limits.
Only an observed preserve/clone/merge/shared/inline/generated/remove chain may
support its corresponding claim. A missing pass or coarse span is explicit,
not bypassed to obtain a complete result.

Schema/hash validity is necessary, not proof that an imported annotation is
semantically true. Manual/untrusted sidecars retain separate provenance and
cannot self-declare exact origin. Product validation must reject contradictory
refs/events and unrelated-source exact claims under the declared provider
rules. Captured evidence validation is not a new live compiler replay.

Rejected: printer-only name recovery, blanket propagation of all parent
origins, unrecorded optimized-away claims, or treating compiler noninterference
as proof that its origin records are correct.

Consequences: G3-B may honestly be partial/blocked. Full supported-scope G3
requires both representative storage and RHS paths to actual reader-stage
objects, noninterference, independent coverage and fresh archive replay.
