# Executable UX history: G1-BSV default and retained G1 RTL detail

## G2 design conditions: direction adopted, final design pending

The user adopted BSV Architecture by default and explicit RTL Implementation.
G2 backend work is authorized after the corrected offline prerequisite; this
is not approval of the current detailed line layout or production UI.

For later design/implementation, project summary connections over original
semantic relations. Candidate grouping is by snapshot, owner occurrence,
visible typed-contact pair, direction and semantic family. Preserve all member
relation IDs and their individual source statements, conditions and evidence.
The summary may say that several source relations connect the same visible
subjects; it must not say they are one physical net or all compiler-confirmed.

Select a summary to reveal its members, actual source/behavior and individual
implementation mapping. Expand only the needed detail; collapse changes
visibility, never relation membership or query results. Different branch
conditions/evidence scopes remain explicit rather than merged into an
unconditional connection. Counts distinguish summaries from underlying facts.
The center of the canvas stays actual modules/storage/typed contacts, not
lists of every invocation or read/write event.

Same-shell DOM tests establish stable object identity. Continuous zoom UX
needs separate actual before/mid/after geometry and port/connection continuity,
interruption and reduced-motion evidence. Neither an identical DOM node nor
the original static 50% drawing establishes that experience.
These are design obligations for later gates, not a G2 renderer rewrite.

## 2026-09-06 amendment: BSV-native default

The user-authorized [G1-BSV contract](G1_BSV_CONTRACT.md) replaces the former
RTL-cell default, not the actual importer or hardware model. The amended
[design system](DESIGN.md) and ADR 008 preceded these visual changes. This is
an isolated executable candidate, **not G1-overall approval or G2 authorization**.
The original G1 account below is retained as historical evidence, not the
description of the new default.

```sh
node experiments/hardware/prototype/build.js
node experiments/hardware/prototype/server.js
node --test experiments/hardware/prototype/*.test.js
node --test experiments/hardware/importer.test.js
```

Open `http://127.0.0.1:4178`, select A/B/C, and Import build. The initial scene
is **BSV Architecture**. `/?mode=rtl` explicitly opens the retained RTL-only
entry used by the original tests. The server does not compile or edit files.
The original seven RTL tests retain every assertion; only their explicit mode
and evidence destination changed. The integrated focused run passes **12 tests**.
The unchanged importer separately passes **14 exhaustive fidelity tests**.

### What the default actually contains

- Three actual selected builds, with the exact existing Hardware IR snapshots.
  The peer `bsv-architecture.js` adapter reuses the existing Source/Semantic IR;
  `buildFromCatalog(build)` supplies keyed tables, never generic graph truth.
- **11 source module occurrences**, including two inlined `mkWidth`
  occurrences, **8 storage occurrences**, **22 typed method contacts**,
  **21 contextual own behaviors**, and **48 source semantic relations**.
  The separate implementation tree has nine retained module occurrences.
- Module bodies enclose actual child occurrences or storage. A single click on
  `mkConnected/left` opens its actual `mkStage` interior: source
  `state: Reg#(Bit#(8))`, Action `put(Bit#(8) value)` and Value `get: Bit#(8)`.
  The using put expression/write and get read appear on selection as behavior,
  not `$dff`, `$mux`, rule cards, method cards, buckets or invented modules.
- Actual source interface specializations remain visible, including
  `Sample#(8)` / `Sample#(12)`. Source `let` inference and compiler concrete
  types are distinguished. Pure helpers remain semantic expressions, not
  hardware module occurrences.
- Dashed directional semantic routes preserve every local relation. Actual
  runtime families are invocation, argument-flow, result-flow, state-read,
  state-write and forwarding. The three fixtures have no constructor-interface
  argument binding to demonstrate on the runtime surface.
- Every visible BSV object exposes definition/occurrence IDs, exact source
  ranges, revision and slice hashes, compiler status and RTL mapping status.
  Selection leads with the source statement, explicit predicate and body path;
  full IDs and evidence are accessible disclosures rather than a wall of IDs.

### BSV/RTL boundary and the representative chain

**Expand RTL signals** is an explicit per-selection disclosure. It shows only
compiler-supplied ready/enable/argument/result records, their ordered vectors,
actual pin endpoints and formal/actual boundary crossings. Changing selection
closes this disclosure. The ordinary `left.get` port-label click is tested
without forced clicks and never enters the enclosing module.

The UI's actual result-port data is independently compared with
`evidence/bsv/representative-chain.json`: `left.get` formal bits **13-20**,
parent bits **21-28**, real child `$procdff$10.Q`, and real parent
`$add$...mkConnected.v:97$1.A`. These are method/compiler-port/netlist-pin
**connectivity** facts. The displayed machine data explicitly retains
`exactInvocationToWire=false` and `exactLeafCellCause=false`. No expression or
source register is assigned a guessed generated-cell cause. Original exact
cause gaps remain **0/53 leaf cells** and **0/168 netname aliases**.

**Open RTL Implementation** uses the same imported Hardware IR and the retained
SVG/layout renderer. It preserves snapshot, selected source entity, source
drawer, BSV owner and viewport. Only verified method-port correspondence is
highlighted; other actual cells remain visible with unresolved source cause.
For inlined source occurrences, the UI states that there is no owned retained
RTL boundary and opens only the candidate containing-wrapper context.

Viewport preservation is scene-specific: the complete BSV viewport is saved
in the return context; the new RTL scene gets its own measured Fit. Lead
pointer QA found that reusing BSV coordinates clipped the real `$dff` outside
the canvas. The corrected entry now fits before any manual Fit, while
Back/Forward still restore each scene's exact source/selection/viewport.
Both controller and actual Chrome assertions cover this correction.

Back/Forward restore distinct BSV and RTL scenes, including source, selection,
disclosure and viewport. Return to BSV is reversible. Up follows the active
tree's actual parent; identical entry adds no history. Inspection and geometric
pan/zoom do not create history entries. BSV shells and contacts are keyed by
source occurrence identity; real Chrome checks reuse of the same shell DOM.

### Fresh runtime evidence and verification limits

All new evidence is under **`.build/hardware/bsv-ui/`**:

| Evidence | Contents |
| --- | --- |
| `tests.txt`, `navigation-red.txt` | 12 passing focused tests; original missing scene-kind seam before implementation |
| `importer-tests.txt` | 14 unchanged importer tests, including all three independent raw-artifact comparisons |
| `receipt.json` | Chrome version, three snapshots, 73 actual runtime PNG captures, source slices, six relation families and measured responsive typography |
| `{A,B,C}-A-overall.png` through `-F-back.png` | Six real runtime states on each dataset: overall, interior, state/behavior, exact original source, explicit same-owner RTL, Back |
| `{A,B,C}-C-typed-port-disclosure.png`, `-D-method-implementation.png` | Real compiler connectivity disclosure and exact selected method-body source |
| `{A,B,C}-{375,768,1280,1440}-{dark,light,hc}-reduced-motion.png` | All three datasets at four widths and three themes |
| `{A,B,C}-{375,768,1280,1440}-port-pointer-hc.png` | Ordinary pointer contact selection at every width, including narrow overlays |
| `rtl-regression/` | All original RTL assertions and 26 freshly generated RTL screenshots, without overwriting historical evidence |
| `build-receipt.json`, `entrypoint-smoke.json` | Ten syntax-validated unbundled runtime files; actual `server.js` process and all three source/hardware HTTP snapshots |
| `preserved-review-zip.txt` | Original review ZIP remains SHA-256 `624d301fff515fdc368a437b5c2a0c34d810e844a3c875910b25a0edf033fb7c` |

The runtime tests use actual Chrome pointer and keyboard input, subscribe to
exact commit events before actions, and use bounded failure timeouts without
sleeps or polling. They visit all 11 source module occurrences, inspect all
48 local relations, compare 129 exact source slices with the unchanged files,
exercise both inlined contexts, and verify no generic cells or rule/method
blocks exist in default scenes. Source/security and original RTL membership,
navigation, source, pointer, geometry and loading-failure assertions remain.

At desktop overview Fit, minimum contact text measures A **12.16/14.34px**, B
**11.44/13.49px**, and C **7.44/8.78px**, at 1280/1440 respectively. At 375px,
the whole-scene fits are about **5.47px**, not readable detail. C is still a
dense overview; Detail zoom, occurrence entry and the normal-size inspector
are necessary. No objects or relations are dropped to make these numbers look
better. Document overflow is absent in every captured viewport. Reduced motion
uses immediate runtime commits, not an animated expansion claim.

Initial JavaScript LSP diagnostics were clean; fresh diagnostics for several
updated runtime files subsequently timed out. Final syntax/build validation
and real Chrome execution pass. HTML/CSS LSP requires unavailable Biome; Markdown
has no configured LSP. Lighthouse packages are also unavailable. No dependency
was installed and no Lighthouse score or complete accessibility audit is claimed.
The child inspected rendered captures, but has no delegation tool for an
independent visual oracle; parent/user independent visual acceptance remains
separate from the executed runtime assertions.

The old static 50% frames below remain historical model-derived design
evidence. They are not evidence for BSV runtime transitions. Black boxes are
still unit-only, larger-layout performance is unproven, source-parser/exporter
gaps remain explicit in the model/evidence reports, and VS Code source reveal,
production integration, G2-G7, merge and publication remain out of scope.

## Historical G1 RTL-only candidate (retained account)

Status: isolated prototype delivered; human design/visual acceptance pending.
This is not a G1-overall pass, a production integration, or G2-G7 completion.
The product contract is [PRODUCT_SPEC.md](PRODUCT_SPEC.md); the design system
[DESIGN.md](DESIGN.md) existed before this UI. Root `DESIGN.md` remains unchanged.

## Run and evidence

From the repository root:

```sh
node experiments/hardware/prototype/build.js
node experiments/hardware/prototype/server.js
node --test experiments/hardware/prototype/navigation.test.js experiments/hardware/prototype/server.test.js experiments/hardware/prototype/browser.test.js
```

Open `http://127.0.0.1:4178`. `PORT=0` selects an ephemeral port and prints the
actual URL. Only the exact `127.0.0.1:<port>` Host is accepted. The server is
read-only and never launches a compiler. It consumes the three real compiled
artifacts in `docs/hardware/evidence/toolchain/{A,B,C}/design.json`, their recipes,
hashed RTL, compiler correspondence, and installation inventories.

Evidence directory: `.build/hardware/prototype/`.

- `tests.txt`: final focused run, 7 tests passed, zero failed/skipped.
- `navigation-red.txt`: the initial missing-navigation seam failure, before logic.
- `receipt.json`: actual Chrome version, snapshot/artifact IDs, measured timings,
  geometry/readability assertions, and final screenshot inventory.
- `build-receipt.json`: hashes and syntax validation of the seven unbundled
  runtime files. There is no bundler or framework dependency.
- `entrypoint-smoke.txt`: actual `server.js` process execution and three ready
  builds through its real HTTP surface.
- `design-detector.json`: mechanical design scan, empty findings. This scan
  preceded the lead-requested compactness/hit-target corrections; final visual
  checks and browser assertions cover those corrections.
- `contact-sheet.png`: final captured-state overview. `initial-top.png` is
  pre-correction exploratory evidence, not an acceptance screenshot.

JavaScript diagnostics report no errors. HTML/CSS language-server diagnostics
were unavailable because the configured Biome executable is not installed.
No dependency was installed to hide that limitation; Chrome parsed/rendered the
actual HTML/CSS and the mechanical detector ran.

## One work surface

The initial canvas says `Source-derived preview - compiled wiring unavailable`.
It does not invent source-derived circuit wiring. Three build choices are
available before import: `mkConnected`, `mkControl`, and `mkReuse`. There is one
actual selected top/stage per artifact, not an invented stage selector.

The compact header names the selected compiled top, immutable snapshot, and
`bsc-generated-rtl/yosys-hierarchy-proc-noopt` stage. Build evidence in the
inspector exposes tools, declared dependencies, emitted parameter dictionaries,
and artifact pointers. Independent roots, when supplied, are separate blocks
in Overall; the workspace is not a synthetic hardware parent.

Hierarchy is optional. Details exists only on inspection. Source is a separately
scrolling, initially closed drawer. At 375px the hierarchy/details panes are
mutually exclusive overlays; document width does not overflow. The hardware
canvas owns pan/zoom, not document scrolling.

## Same-shell expansion and input ownership

| Target/action | Implemented result |
| --- | --- |
| Expandable body, one click | The same occurrence DOM shell expands; children are nested inside it. |
| Info or Space | Inspect the occurrence, without entry. |
| Enter | Primary action; leaves inspect, expandable occurrences enter. |
| Current expanded boundary | Inspect; never enter itself again. |
| Port, complete visible label, bus, bit, leaf | Inspect and stop bubbling. |
| Ambiguous wire hit | Offer real-net choices; overlapping hit areas do not imply a connection. |
| Double activation | Initial click is immediate; subsequent pointer detail/activation is deduplicated. |
| Drag | Pan, then suppress click-through entry. |
| Background | Clear selection only. |
| Wheel | Change geometry only; no containment/history change. |

Shells and port groups are keyed by the opaque occurrence/port IDs. Entering a
child reparents the **existing** shell and port DOM objects, rather than replacing
them with an equivalent drawing. All ordered formal bit memberships and
formal/actual binding records survive. Unconnected formal ports have empty
binding lists; no parent net is fabricated for them.

The full visible port label and anchor have one transparent hit region, painted
above internal routes. The exact expanded `mkConnected/left.get` normal locator
click is exercised in Chrome without `force`. Its RTL and compiler-backed BSV
context actions and subsequent Back restoration are asserted.

Outside the expanded boundary, short dashed presentation-only stubs retain
actual binding IDs and parent/formal bit identities. Their geometry never owns
port input. Hidden surroundings remain in the canonical model.

G1 uses immediate atomic commits, including under reduced motion. It does not
claim an animated intermediate interpolation. A 180ms production transition
remains a G4 design decision, not an animation dependency in this experiment.

### Static 50% intermediate (master screen 3)

```sh
node experiments/hardware/prototype/intermediate.js
```

This isolated generator reads the same verified importer catalog and measures
actual collapsed/expanded layout scenes in installed Chrome. It selects an
expandable occurrence generically (a descendant when available, otherwise a
real root), without fixture-specific names or coordinates. It produces
`intermediate-50-{a,b,c}.svg` and matching PNGs in the evidence directory.

The shell bounds and every external port anchor are exactly halfway between
the measured endpoint scenes. An affine X / monotonic, port-constrained
piecewise-linear Y transform moves the internal nodes, pin anchors, route
segments, junctions, constants, and real-net continuations coherently. Original
shell/port IDs, ordered bit vectors, provider references, and formal/actual
bindings are preserved. Internal geometry is transformed from the real expanded
scene; no hypothetical collapsed wiring is added.

The SVG title, description, visible caption, and metadata explicitly say
**static model-derived intermediate, not runtime animation**. This supplies the
permitted actual-model SVG for screen 3; it is not interactive-completion proof.
`03-same-shell-top-expansion.png` and the existing pointer tests remain the
separate evidence for the real single-click endpoint. Runtime behavior is unchanged.

`intermediate-receipt.json` and `receipt.json.staticIntermediate` record the
command, fraction `0.5`, artifact/snapshot identity, endpoint/midpoint bounds,
script/layout hashes, membership counts, SVG/PNG hashes, and Chrome assertions.
The generator verifies provider pointers against the real hashed artifact,
ordered port/bit and binding membership, deterministic SVG output, exact
midpoint coordinates, and rendered SVG DOM/route/anchor equivalence. The three
rendered PNGs were opened for visual inspection. The representative A child
retains 7 external ports / 21 ordered external bits / 19 formal-actual bindings;
all its displayed anchors retain 115 ordered bit memberships. B is a real root
with zero parent bindings; no artificial parent is introduced.

Only this generator's syntax, diagnostics, artifact assertions, and Chrome
rendering were rerun for this addition; no app behavior or broad suite changed.

## Navigation transaction

The independent navigation seam stores snapshot/stage, current occurrence,
expanded containment path, selected entity/bit, source focus and text/range,
viewport, panel disclosure, and trace state. History and containment are separate.

- Back/Forward restore the previous/next distinct analysis state exactly,
  including selection, viewport, and the open source drawer.
- Up follows the actual occurrence parent; root Up returns to Overall.
- Breadcrumb movement appends navigation and clears stale inspection/source.
- Repeated entry to the current destination is a no-op.
- Inspection, bit selection, and pan frames do not append history entries.
- Cached evidence choices are immutable per entity and survive history restore.
- Loading holds the previous valid scene. A controlled delayed response and a
  failed import are exercised without fixed sleeps. Failure does not clear it.

A new successful build atomically replaces the model and starts a new history.
Cross-build history recovery, stale editor buffers, cancellation, and packaged
host/webview version negotiation remain production work.

## Generic layout and electrical notation

The experiment deliberately does not use the legacy source-edge layout. That
layout routes rectangle centers, not actual ordered pin connections.

`layout.js` is a deterministic, data-driven bounded orthogonal lane algorithm:

1. Sort actual subjects by opaque identity; retain every cell/occurrence.
2. Measure pin text using the browser's real canvas text metrics. Node widths
   derive from the input/output label widths, not design names or fixed answers.
3. Use a bounded square-root column count and measured row/column extents.
   The three-object top naturally uses two columns; larger scenes use up to three.
4. Assign unique tracks/escape lanes to actual connected bit groups. Feedback
   is retained without assuming a primitive transfer function or changing nets.
5. Reserve exterior boundary-label rails, entirely outside the routed interior.
   Fit includes those rails, the shell, and final child/routing extents.
6. Draw dots only at same-net branch junctions. Other-net geometric crossings
   do not receive junction dots. Real Chrome checks both geometry and DOM dots.
7. Keep constants at their actual connection site with a small value marker:
   `0`, `1`, `x`, `z`, or explicit multi-bit value membership. Reserve a separate
   constant annotation lane so the marker cannot look connected to a nearby net.
   It is presentation-only, never a global or physical constant-driver cell.

Bus groups preserve actual bit IDs. A matching alias uses its original ordered
vector. A unique-bit presentation group is labeled as presentation order, not
misrepresented as an original HDL vector. Ports/pins keep their full original
ordered arrays, including replication, and endpoint indices remain inspectable.
The canonical model is unchanged by layout or visibility; all represented
endpoint-bearing bits are checked against it independently of the DOM.

Primitive labels show their raw artifact type (`$add`, `$mux`, `$dff`, etc.) and
retain the complete cell identifier in tooltip/details. Unknown cell behavior
is not inferred from a name. No memory, timing, resource, or pipeline semantics
are fabricated. Long names are measured/truncated, not wrapped into a dangling
last character.

### Measured readability and remaining ceiling

At desktop Fit, the real small top's minimum pin-label size was **12.84 CSS px
at 1280x900** and **14.49px at 1440x1000**, in dark/light/high contrast. A browser
assertion requires at least 11.5px for these small-top desktop surfaces.

At 768px the same whole-top overview measured 7.57px, and at 375px 3.53px. These
are explicitly labeled overviews, not readable detail modes. Detail zoom/wheel
and optional hierarchy provide entry. Narrow whole-circuit reading is still
limited; this is not mobile visual acceptance.

The control fixture contains 26 immediate cells and 44 bus groups; its fitted
overview remains dense. Small-fixture lane routing is demonstrated, not a
production large-netlist layout solution. This prototype does not claim S/M/L
throughput, virtualized DOM, route minimization, or all-design readability.

## Source correspondence is not one confidence flag

Every block, port, and route exposes snapshot and artifact JSON pointer/hash.
The inspector lists actual ordered bits, aliases, endpoint driver/load roles,
and formal/actual crossings. Directions and roles come from the imported
artifact, not UI heuristics.

Generated RTL `src` is resolved only against manifest-allowlisted cached RTL.
The server verifies hashes and ranges before returning the actual text slice.
A source attribute on an enclosing module is labeled **generated RTL context**,
not an exact selected-net origin. ASCII, 1-based, end-exclusive Yosys ranges are
used for these actual fixtures; non-ASCII range conversion is not silently guessed.

BSV actions have two distinct supported evidence scopes:

- **Verified compiler instance declaration:** sidecar module/cell identity,
  compiler evidence, source hash, and actual whole line agree. The line is shown;
  an exact column range is not invented.
- **Compiler-verified method-port contract / BSV module context only:** exact
  module/port identity and ordered bits match the sidecar. The hashed compiler
  module-context line may open, while the exact method source range remains
  visibly unknown. This is not an exact method implementation mapping.

Other BSV mappings remain unknown. No first-name source match, fabricated
scheduler relation, or wire-to-BSV exactness is used. Prototype support must not
be substituted for the full correspondence coverage denominator reported by
the toolchain/importer tracks.

The drawer is an actual hashed source browser, **not VS Code editor reveal**.
Production editor selections, UTF-16 conversion, current-buffer comparison,
and two-way source/hardware host integration belong to G3/G6.

## Snapshot and security

Snapshot identity derives from the selected artifact, recipe, source,
installation inventory hashes, declared BSC package/RTL library inputs, and
selected generated RTL inputs. Unrelated A/B/C artifacts, debug logs, and
correspondence evidence do not perturb another selected snapshot. Regression
checks change unrelated manifest entries and installation identity separately.

All emitted definition-default/cell parameter dictionaries are preserved under
their artifact JSON pointers. Fixture C's `bias` dictionaries are retained.
Unspecified top overrides are `not-supplied-by-recipe`, not falsely empty/known.
Installation identities are recorded inventory hashes, not version-text hashes.

The local server binds only `127.0.0.1`, validates exact Host and Origin, permits
GET only, and serves only explicit static routes and selected entity/evidence
APIs. There is no arbitrary file/path endpoint. Source paths must be local,
non-symlink-escaped, size-bounded, allowlisted and hash-matched. Text uses
`textContent`; CSP forbids external resources, inline script, frames, and forms.
Source/artifact strings are never executable commands. No download, global
profile/PATH mutation, production file edit, package edit, commit, or push is
part of this prototype.

## Required screen-state evidence

All paths below are relative to `.build/hardware/prototype/`.

| Master state | Actual capture |
| --- | --- |
| 1. Before build | `01-before-build.png` |
| 2. Compiled overall | `02-compiled-overall.png`; `design-b-compiled.png`; `design-c-compiled.png` |
| 3. Same-shell expansion | `intermediate-50-a.svg` / `intermediate-50-a.png`: static actual-model 50% geometry, not runtime animation; `03-same-shell-top-expansion.png`: separately verified real-click endpoint |
| 4. Child internals | `04-child-internal-cells.png` |
| 5. Bus/bit/fanout | `05-bus-ordered-bit-and-fanout.png` |
| 6. Cell selection | `06-cell-evidence.png` |
| 7. Partial/unmapped original source | `07-original-mapping-unknown.png` |
| 8. Hashed source and circuit selection | `08-hashed-source-range.png`; `verified-bsv-instance-line.png`; `expanded-get-port-source-back.png` |
| 9. Exact restoration | `09-back-restores-selection-viewport-source.png` |
| 10. Responsive/themes/reduced motion | `10-{375,768,1280,1440}-{dark,light,hc}-reduced-motion.png` |

The actual pointer journey includes build, top, child, bus/bit, ordinary
expanded output-port click, RTL/BSV context, cell/RTL, Back/Forward/Up, breadcrumb,
and Overall. It also checks normal and reduced motion, Info/Space/Enter,
double-click deduplication, drag suppression, wheel-only geometry, source range
text/hash equality, deterministic geometry, constants, true junctions, label
rails, fit containment, and failure/delayed-load retention.

Measured on macOS arm64 with installed Chrome 152.0.7977.82: final receipt import
samples 0.87-1.80ms, browser load 18.7-40.2ms, enter 1.7-8.3ms, inspection
4.4-16.1ms. These are observations, not flaky timing pass thresholds or a
large-design benchmark. The receipt is authoritative for rerun values.

## Review and gate boundary

Visual inspection opened the actual generated screenshots, including desktop,
375/768 layouts, high contrast, source ranges, constants, and the dense control
design. Lead-reported small-top readability, route-over-label, and normal
expanded-port hit failures were corrected and regression-tested. With no
subagent tool in this child session, the final design review was performed
in-thread; it is not independent user visual acceptance.

Remaining concrete limits:

- None of the three real compiled artifacts contains a black box. Black-box
  stopping is unit-tested, not claimed as actual compiled Chrome coverage.
- No runtime animated expansion midpoint; the static model-derived 50% SVG is
  separate screen-3 design evidence, not an animation or interactive-completion claim.
- No complete original BSV expression/rule/scheduler mapping or code-to-hardware
  round trip. Module-context evidence is explicitly weaker than a method range.
- No large-layout performance, route-quality proof for arbitrary artifacts,
  CJK source-range conversion, or full accessibility audit.
- No production Workspace Trust, compiler lifecycle/cancellation, source staleness,
  VS Code host integration, packaged VSIX validation, or external large-fixture
  visual acceptance. Those remain G2-G7 work under the master contract.

The recommendation is to review this working model/interaction candidate before
production integration. Neither these passing focused tests nor this document
authorizes G1 overall approval, G2 implementation, merge, release, or publication.
