# ADR 008: BSV-native default architecture; RTL implementation on demand

Status: G1-BSV user-requested design amendment, awaiting final design approval.
Date: 2026-09-06. G2 is not authorized.

## Decision

The default canvas describes the actual BSV design's hardware composition:
module/storage occurrences and typed interface/method boundaries. Explicit
source/compiler relationships connect them. Rules/methods explain selected
hardware and relations; expressions/functions are semantic operations, not
automatically physical cells.

The existing Yosys schematic remains **RTL Implementation** on demand.
Its importer, Hardware IR, stage, bit connectivity and evidence are preserved.
Its correctness does not make it an appropriate BSV author's default view.

## Reuse and ownership

Reuse `src/architecture/parser.js`, source documents/ranges and
`src/architecture/semantic/model.js` plus canonical indexes/behavior bindings.
The BSV architecture adapter selects contextual instances, declared storage,
typed boundaries and explicit relations from those records and joins actual
BSC evidence. It does not duplicate parsing, create another generic truth graph,
or promote legacy ProtocolChannel heuristics to wiring.

Existing Hardware IR remains the Implementation Model. Correspondence separates
Source-to-BSV identities, BSV-to-RTL compiler relationships and RTL-to-netlist
provider pointers. Shared/inlined source contexts may refer to one implementation
scope without owning all cells in it. Unmapped cells are not assigned by name.

Generic nodes/edges are permitted only as renderer projection objects with
explicit source/semantic or hardware references and relation family.
The canonical models and their evidence do not depend on the visible scene.

## Source and compiler facts

An actual source method invocation can be exact source evidence without being
a verified RTL wire. Every relation exposes its source statement, kind,
compiler confirmation and optional implementation mapping.
Source type, behavior predicate, body path and read/write/call context remain
separate from scheduling/readiness. Missing evidence is not absence.

BSV names must originate in source/compiler records, not by relabeling `$dff`
to a register or `$mux` to a rule. In `mkConnected/left`, `state`, `put`, `get`
and their types come from the unchanged `mkStage` source. There is no declared
child module or rule in that definition.

Default method contacts use BSV names/categories/types. Confirmed generated
RDY/EN/argument/result ports are a secondary explicit disclosure, never
synthesized from naming conventions.

## Interaction

Single-click body enters the same BSV occurrence's composition. Selecting
port/storage/relation reveals behavior and source. Explicit implementation
entry preserves BSV owner, immutable snapshot, selection, source and viewport.
The BSV viewport is saved in its return context; a newly opened RTL scene is
fitted to its different geometry. Back restores the saved viewport without
refitting. Preserving context does not mean clipping RTL with BSV coordinates.
Back restores the prior distinct scene; Up follows actual containment; equal
entry adds no history. Verified correspondence alone controls exact RTL
highlighting; otherwise the UI labels containing implementation context.

## Rejected alternatives

- Netlist-only default: valid implementation data but loses BSV-level ownership,
  names, types and intent and exposes generic compiler temporaries too early.
- Rename `$cells` into BSV objects: invents unsupported causality/ownership.
- Restore channel/method/endpoint buckets or Source Map: does not show BSV
  hardware composition and repeats the rejected information architecture.
- New independent parser or generic graph for all models: duplicates existing
  source facts and erases distinctions between semantic and electrical links.
- Discard G1: destroys useful verified importer/snapshot/connectivity work.

## Acceptance and consequences

Actual three-design runtime scenes must show BSV overview/interior,
port-storage-behavior selection, exact source, same-context RTL and Back.
Preserve importer fidelity and report mapping coverage by category, retaining
the original 0/53 leaf and 0/168 netname cause gaps as a separate baseline.
A verified method-boundary chain is not all leaf causes.

The old static 50% frames remain static design evidence; new runtime navigation
has its own tests. Only user approval after G1-BSV permits G2.
