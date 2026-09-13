# G2 authorized scope

The user adopted the BSV Architecture default and explicit RTL Implementation
abstraction. This is not final design approval, complete BSV cause mapping,
production UI replacement, merge or release approval.

## Offline prerequisite

Completed before product implementation: shipped-only validation is separate
from strict author preservation and live compiler metadata replay.
The original missing `Connected.bo` failure remains documented.
The corrected archive was extracted outside the workspace with no
`node_modules`, compiler directories, prior ZIP or workspace symlinks.
Ten shipped checks, 110 manifest hashes, 49 dependency-free experimental tests,
build validation and actual server HTTP source/model checks passed.

Author validation still requires all 13 `.bo/.ba` files and the prior G1 ZIP.
It fails in a bare extraction with all 14 missing companions listed.
Optional browser/full-suite dependencies are not silently treated as available:
the initial isolated full-suite trial failed on missing Playwright and is
explicitly not reported as PASS. See
[OFFLINE_REPRODUCIBILITY](OFFLINE_REPRODUCIBILITY.md).

## Product boundary

Promote the verified artifact reader into product-owned `src/hardware/`.
Keep the original experimental importer as a historical reference; do not
alter its captured checksum to disguise a migration. The product implementation
must independently preserve the same raw/provider semantics and ordered data.
Only one validated provider/backend is needed.

The product entry imports selected existing artifacts without BSC, Bluetcl,
Yosys, Make, Tcl, plugins or dependency installation. G2 does not execute a
compiler or change the production renderer. A standalone product module/CLI
is sufficient to exercise this backend boundary; native UI integration belongs
to later explicitly approved work.

## Truth contracts

- **Source / BSV Architecture:** existing Source/Semantic facts, source
  definitions, contextual occurrences, typed interfaces/storage and explicit
  semantic relations. No source name/type becomes a netlist wire.
- **Implementation:** the selected artifact's module/cell/port/pin/ordered-bit
  model, including aliases, constants, unknown cells and boundary bindings.
- **Correspondence:** evidence-bearing relations between those models and
  generated RTL. It neither changes containment/connectivity nor fills unknown
  source causes. G2 defines the boundary; G3 mapping work is not started.
- **Presentation:** scene nodes, routing and aggregates are views with original
  references. They are not canonical truth.

## Immutable snapshot and lifecycle

A sealed BuildSnapshot records actual artifact hashes, declared stage/tops,
source/dependency/tool/pass/options/parameter identity, with missing provenance
explicitly unknown rather than invented empty facts. Private host paths and
availability/freshness are not the immutable build identity.

Import reads/validates into staging, builds a canonical model, and publishes
only a successful current request atomically. Failed, unsupported, cancelled
and superseded attempts cannot destroy the last successful snapshot.
Cancellation must terminate active CPU import, not merely check a flag after
blocking synchronous work. Queries cannot observe a half-published model.

Source access is restricted to approved roots/registered refs and matching
hashes. A stale source must not open a shifted current range as old evidence.
It may expose verified captured source with an explicit stale status, or return
an explicit stale/unavailable result.

## Structural fidelity and unsupported data

Preserve ordered vectors, slices/reordering/repetition, aliases, signed/index
metadata, occurrence-local identities, constants and formal/actual mappings.
No global constant driver or cross-cell input/output net union.
Raw unknown cells retain types, parameters, attributes and pins.

Distinguish invalid/malformed input from a valid but unsupported representation.
Unsupported raw processes/formats must not silently yield an empty graph.
Opaque/missing-capability cases must be explicitly partial/unsupported where
the declared product scope cannot complete them. Unknown optional semantics
do not erase otherwise exact connectivity.

Validate malformed JSON/bit references/bindings, size/depth/resource limits,
hostile keys, path traversal/symlink escape, stale source, cancellation and
request supersession. Use event-driven tests and actual import surfaces.

## Design conditions, not a G4 implementation

Do not lock the current every-invocation/read/write-as-a-separate-line layout
as final. Preserve every canonical relation, then project summary connections
between real blocks/storage/typed contacts. A summary must retain ordered
member relation IDs, endpoint/context identity, relation families and evidence
status per member; selection reveals its exact underlying statements and
relations. It must not imply that different semantic relations form one
physical net or inherit each other's compiler confirmation.

Possible grouping key: snapshot, owning occurrence, visible boundary pair and
semantic family. Different direction, owner, branch condition or evidence scope
cannot be silently flattened into a stronger claim. Counts distinguish visible
summary routes from underlying relationships; expand/detail queries remain
independent of visibility. Large fanout stays inspectable.

Real modules, storage and typed contacts remain the visual center. Behavior
overlays explain a selection rather than becoming physical blocks.
Same-shell DOM identity proves object reuse, not a continuous semantic zoom
experience. A later runtime transition acceptance must inspect geometry,
port/connection continuity and interruption/reduced-motion behavior separately.
Static 50% frames are not runtime transition proof.

## Mapping and stop boundary

`left.get` remains a verified method-port-net/pin connectivity chain only.
Do not promote it to leaf/state/expression cause. Keep original cause gaps
**0/53 leaf cells** and **0/168 netnames** separate from source-link counts.

Deliver the G2 implementation, tests, compiler-free real-surface and fresh
offline ZIP evidence, exact supported/partial/unsupported scope and remaining
limitations. Stop after G2. Do not start G3, merge main, change version, create
tags/Releases or publish.
