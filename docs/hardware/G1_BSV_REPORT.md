# G1-BSV approval candidate

Status: G1-BSV implementation/evidence candidate submitted. Independent review:
**APPROVE**, no blockers. Human design/visual approval remains pending.
**G2 remains unapproved.**
The current contract is [G1_BSV_CONTRACT](G1_BSV_CONTRACT.md).

Independent review scope and limitations:
[gate summary](evidence/bsv/GATE_REVIEW.md).
Lead's exact source identity and live A-F checks:
[runtime receipt](evidence/bsv/lead-runtime.json).

## Outcome and reused work

BSV Architecture is now the prototype's default. A BSV module body opens its
source/compiler-backed children, storage and typed interface contacts.
The original Yosys cell schematic is explicit **RTL Implementation** detail,
not the default BSV interior and not a production replacement.

Reused without changing their truth contracts:

- The three original compiled sources and their RTL/RTLIL/Yosys artifacts.
- Existing Hardware IR/importer, ordered bits, aliases, formal/actual bindings,
  immutable snapshot, hashes and source-range validation.
- Existing parser, Source/Semantic IR, canonical IDs, source documents,
  behavior/access analysis and source-reference indexes.
- The SVG renderer and RTL layout, behind an explicit scene-kind boundary.
- The existing navigation controller, extended for BSV owner/context and
  distinct BSV/RTL visits.
- All original RTL and importer assertions, with explicit RTL entry.

The original G1 approval ZIP remains unchanged:
`624d301fff515fdc368a437b5c2a0c34d810e844a3c875910b25a0edf033fb7c`.
New evidence and the amended bundle use separate paths.

## Default screen design

For actual `mkConnected/left`, body click shows `mkStage` with
`state: Reg#(Bit#(8))`, `Action put(Bit#(8) value)` and
`Value get: Bit#(8)`. The state name/type comes from the unchanged BSV
declaration, not from relabeling `$dff`. That module declares no child module
or rule.

State selection shows `put` writing `state <= value + 1` and `get` reading
state, with exact source text, source predicate and body-path information.
The control design shows `count`, `phase`, and the actual `decrement`,
`increment`, `tick`, `inject` and `read` behavior. Rules and methods are
overlays/boundaries, not new physical modules.

Source semantic lines are dashed and explicitly labeled as not netlist wires.
Each exposes source statement, relation kind, scoped compiler confirmation and
RTL mapping status. Compiler confirmation of method/state *use* is not a
claim of exact source statement, argument expression or physical wiring.

Default method contacts show BSV names/categories/types. **Expand RTL signals**
is required before seeing actual RDY/EN/argument/result names and bit mappings.
Unknown or composite type information is not reduced to no-payload/control-only.
There is no Source Map or ProtocolChannel/Methods/Endpoints bucket default.

## Documents and model ownership

All seven requested documents contain explicit G1-BSV amendment history:

- [PRODUCT_SPEC](PRODUCT_SPEC.md)
- [FEASIBILITY](FEASIBILITY.md)
- [ARCHITECTURE](ARCHITECTURE.md)
- [SCHEMA](SCHEMA.md)
- [UX_DESIGN](UX_DESIGN.md)
- [VALIDATION_MATRIX](VALIDATION_MATRIX.md)
- [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md)

Decision: [ADR 008: BSV-native default architecture; RTL implementation on demand](adr/008-bsv-native-default.md).
The original seven ADRs remain the implementation/evidence history, subject
to this explicit default-abstraction amendment.

`experiments/hardware/bsv-architecture.js` is a contextual adapter/index over
existing Source/Semantic records plus actual BSC metadata. Its occurrence,
storage, boundary, behavior and relation tables are not a duplicate parser or
one generic graph replacing the three truth models. Hardware IR remains the
Implementation Model. Scene nodes/routes reference the appropriate model.

All 121 adapter entities/relations have definition identity, owner occurrence
and source evidence. Lead verification independently matched all **129 source
references** to file revision, exact slice and UTF-16 start/end positions.

## Actual toolchain evidence

The original BSC/Bluetcl `2026.01 (9bd39e6f3)` and isolated Yosys
`0.68 (38e001a6f)` evidence is retained. This amendment replayed installed
BSC/Bluetcl metadata queries; all A/B/C normalized outputs equal the original
captured metadata. It did not recompile or change the fixture sources.

Fresh records and nine runnable checks:
[evidence report](evidence/bsv/README.md),
[verification](evidence/bsv/verification.json),
[source populations](evidence/bsv/source-populations.json),
[exporter gaps](evidence/bsv/EXPORTER_GAPS.md).

Source/compiler context has **11 module occurrences and eight storage
occurrences**. The implementation has nine module occurrences.
The two extra source modules are `mkWidth` occurrences under `narrow`/`wide`.
They remain source inlined contexts, not invented retained RTL boundaries.
Their explicit implementation entry shows the candidate containing wrapper,
with no guessed exact cell highlights.

## Coverage by category

These are different populations, not one combined confidence percentage.

| Category | Measured result | Exact limit |
| --- | --- | --- |
| BSV module/source | 11 contextual modules; 8/8 nonroot occurrences source-matched: six retained, two inlined | Three compiled roots are a separate population. |
| BSV method/rule/source | 12/12 lexical method implementations, 3/3 lexical rule ranges; 18 contextual own methods plus three rules | Compiler has 14 method entries but zero exact method-body spans. |
| BSV storage/source | 8/8 contextual storage declarations from five lexical declarations | Source/type/position evidence is not a generated-cell origin set. |
| Typed method contacts | 22 contacts, including forwarded wrapper contacts | A wrapper contact is not an invented own method body. |
| Method/generated RTL ports | 40/40 definition-level contracts; 45 occurrence-level mappings | Parameter derivation and repeated `mkStage` use explain the distinct denominators. |
| BSV state/expression/RTL cause | 0/8 storage origin sets, 0/22 enumerated outermost behavior-expression sites | Not all AST subexpressions; source-reviewed expression text does not fill this gap. |
| RTL/netlist | 59/59 cells have generated RTL `src`; 136/168 netname aliases have `src` | The other 32 aliases remain preserved without precise RTL origin attributes. |
| Complete representative chain | 1/1 audited method-result vector, eight ordered bits | Selected chain only, not all paths or leaf causes. |
| Exact BSV leaf-cell cause | **0/53** | Preserved original gap. |
| Exact BSV netname cause | **0/168** | Preserved original gap, not replaced with declaration-link counts. |

There are 48 source semantic relations: invocation, argument/result flow,
state read/write and explicit forwarding. Their data never becomes canonical
RTL connectivity merely because it is drawn as a line.

Net census: **168 definition aliases**, 185 occurrence-expanded aliases,
457 occurrence-local integer bits and **339 hierarchy-normalized integer
connectivity components**. There are 122 formal/actual scalar bindings:
118 integer/integer and four constant-bound integer components.
There are 220 connection-local literal sites; four are already connected to
integer components, so the combined component/site total is 555.
Only actual hierarchy bindings are unioned, never a cell's input/output pins.

## Representative BSV-to-implementation chain

[Machine-readable chain](evidence/bsv/representative-chain.json):

1. Actual `mkStage.get` implementation is `method Bit#(8) get = state;`.
   Occurrence is `mkConnected/left`, identified independently by source and
   Bluetcl hierarchy/position data.
2. Bluetcl's method result port is `get`; its ready port is `RDY_get`, with
   no invented enable port.
3. Generated RTL contains `output [7 : 0] get;` and the parent instance's
   `.get(left$get)` connection.
4. Child formal bits 13-20 map in order to parent bits 21-28.
5. Actual child `$procdff$10.Q` and `$procmux$5.A` share the child bits.
   The parent's actual `$add$...mkConnected.v:97$1.A` shares the parent vector.
6. The prototype displays this after selecting BSV `left.get` and explicitly
   expanding RTL signals, while staying in the same BSV occurrence.

This proves method/compiler-port/net/pin connectivity. The machine evidence
explicitly retains `exactInvocationToWire=false` and `exactLeafCellCause=false`.
It does not assign a mux, register cell or arithmetic cell to an unproved BSV
cause. Actual source implementation and interface declaration refs are distinct.

## Runtime interaction results

Run:

```sh
node experiments/hardware/prototype/build.js
node experiments/hardware/prototype/server.js
# Open http://127.0.0.1:4178
```

The six required live states are in `.build/hardware/bsv-ui/` and the lead's
`.build/hardware/lead-bsv-final-{A,B,C,D,E,F}.png`:

| State | Actual action and assertion |
| --- | --- |
| A BSV overall | Import A/B/C; BSV scene kind by default, actual names/types, no visible RTL cell nodes. |
| B BSV interior | Ordinary module body click; `left` keeps the same shell DOM and reveals actual Reg storage and typed contacts. |
| C Port/storage/behavior | Select storage or a semantic relation; source statement, read/write/call and explicit/body conditions are inspectable. |
| D Original source | Open the indexed source ref; whole-file revision, slice hash and half-open range match actual BSV. |
| E RTL Implementation | Explicit entry preserves BSV owner/build/source selection; actual hardware model is reused. Only verified mapping is highlighted. |
| F Back | Exact BSV source/selection/disclosure/viewport restored; Forward and explicit Return to BSV remain reversible. |

Lead real Chrome `152.0.7977.82` additionally verified:

- Ordinary get-port selection and explicit actual bit/pin chain disclosure.
- Control guards `count > 0 && phase`, `count < 8`, `count < 4`.
- Inlined `mkReuse.wide.implementation` opens candidate RTL `mkReuse/wide`,
  not an invented owned module or selected cell; Back restores it exactly.
- Zero page errors in the completed journeys.

Lead QA found a real viewport defect: carrying BSV coordinates into the larger
RTL scene clipped `$dff` outside the canvas. The common entry controller now
saves BSV viewport in return context and requests an independent RTL Fit.
A failing controller test captured the regression; actual Chrome now checks
all RTL nodes before manual Fit. Back/Forward preservation assertions remain.

Static 50% images from original G1 remain static design evidence. This report's
runtime claims come from actual pointer/keyboard actions, not those images.
Source opens in the prototype's read-only drawer, not a production VS Code
editor integration.

## Acceptance questions

| User question | Evidence-backed answer |
| --- | --- |
| BSV readable without RTL knowledge? | Source-named modules/storage/typed contacts and source behaviors lead. Human design/visual acceptance remains pending. |
| Names/types/instances match BSV? | All 121 records/129 refs independently checked; actual concrete versus declared symbolic types remain distinct. |
| Source statement behind each line? | Every semantic relation has actual source evidence; selected examples and source slice API are exercised. |
| Rules/methods not fake hardware blocks? | Default node kinds are module/storage; methods are contacts and behaviors overlays. |
| Generic cells require explicit detail? | Default `sceneKind=bsv`; explicit RTL action and preserved legacy `/?mode=rtl` entry tested. |
| Source versus wire evidence distinct? | Separate line families, compiler-confirmation scope and RTL mapping status; no source relation promoted to wire. |
| Representative chain demonstrated? | `left.get` metadata/RTL/ordered bits/actual cell pins, with explicit causality exclusions. |
| Unmapped circuits visible without guesses? | Actual RTL remains intact; no source-origin highlight for unmapped state/expression or inlined ownership. |
| Same occurrence through entry/Back? | Same shell DOM, BSV owner, snapshot and exact restored scene state checked. |
| Importer accuracy preserved? | Original importer tests retained; protected input/artifact hashes and original review ZIP remain unchanged. |

## Verification and limits

The integrated command passed **43 experimental tests**, **306 existing
default tests**, and **nine evidence checks**, with no skipped tests.
After the viewport correction, all **12 prototype tests** and the ten-file
runtime build validation passed again. The source identity check covers all
129 refs, not one representative label.

Reproduce shipped-data checks from an extracted `bsv-lens/` root using Python 3
and Node.js (no `npm install`, compiler tools or author companions):

```sh
node scripts/check.js
node --test experiments/hardware/*.test.js experiments/hardware/prototype/bsv-navigation.test.js experiments/hardware/prototype/bsv.test.js experiments/hardware/prototype/navigation.test.js experiments/hardware/prototype/server.test.js
node experiments/hardware/prototype/build.js
PYTHONDONTWRITEBYTECODE=1 python3 experiments/hardware/bsv-evidence/check.py
PYTHONDONTWRITEBYTECODE=1 python3 experiments/hardware/toolchain/run.py --verify-evidence
```

The ten shipped checks compare captured compiler output; they do not replay
compiler tools. Full 128-input author preservation is separately runnable as
`PYTHONDONTWRITEBYTECODE=1 python3 experiments/hardware/bsv-evidence/check_author.py`
and intentionally fails without the 14 exact companions. The optional browser
tests additionally require `@playwright/test` 1.62.1 and installed Google Chrome;
they are not part of the dependency-free command above. See
[OFFLINE_REPRODUCIBILITY](OFFLINE_REPRODUCIBILITY.md) for the complete split.
The historical full `npm test` / `node --test test/*.test.js` suite additionally
imports `playwright` 1.62.1 and `@vscode/test-electron` 3.1.0. Its fresh-extraction
trial failed to load `test/vsix-smoke.test.js` without those packages (302 pass,
one failed test file); this is not a standalone full-suite PASS.

Known limits: exact original state/expression causes remain unavailable;
inline value-method expression AST and module-return handling are bounded;
mixed-operator predicates are shown as exact text, not evaluated.
Constructor-interface binding, FIFO/memory, nested ActionValue and broader
generation cases have no actual compiler example in these three designs.
Dense C/narrow Fit is an overview requiring detail zoom.
Production host/editor, large designs, remote tool execution and full runtime
animation remain later gates. Current navigation LSP requests timed out;
syntax and behavior checks passed. Earlier complete runtime and adapter
diagnostics were clean; unavailable tooling is not provenance evidence.

## Delivery and next gate

The original G1 and G1-BSV ZIPs are preserved. Build the separately named
offline-corrected artifact without overwriting either:

```sh
node experiments/hardware/package-review.js --bsv --offline
(cd dist && shasum -a 256 -c bsv-lens-hardware-g1-bsv-offline-review.zip.sha256)
```

It includes the amended source/docs and current BSV, RTL and compiler evidence,
excluding tool installations and browser profiles. It contains local path
identifiers and fixture source; it is not a redacted public release.

Branch remains `feat/hardware-schematic`, HEAD/remote main
`c6b9a5c642d105ad4117535c1d85366f1c02ec1c`, package `0.4.1`.
No production replacement, repository commit/push, merge, version change, tag,
Release or publish was performed.

The revised G2-G7 plan is in IMPLEMENTATION_PLAN. **Only user approval after
this G1-BSV review permits G2; no such approval is inferred.**
