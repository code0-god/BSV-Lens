# Hardware Schematic experiment design system

Scope: `experiments/hardware/prototype/`, G1 and G1-BSV only.
This extends the existing root `DESIGN.md`'s VS Code-native engineering-tool
identity. It does not change the production source-derived renderer.
Product contract: [PRODUCT_SPEC.md](PRODUCT_SPEC.md).

## G1-BSV amendment history

2026-09-06: the user rejected the RTL-cell schematic as the default BSV
architecture. [G1_BSV_CONTRACT](G1_BSV_CONTRACT.md) now owns the default
abstraction. The existing schematic remains **RTL Implementation** on demand.
This amendment reuses the visual tokens below; it does not authorize G2.

The initial post-import scene is **BSV Architecture**. Actual BSV module
occurrences are enclosing blocks; declared children and storage are inside.
Typed interface/method contacts lie on the boundary. Their source names/types
are primary labels. `state: Reg#(Bit#(8))` is a source storage instance, not a
renamed `$dff`. A module with only state and behavior remains a useful interior.

Default contacts show `put`, `get`, interface paths, Action/Value/ActionValue
and actual argument/result types. RDY/EN/generated signals are hidden until
**Expand RTL signals**. No generic A/B/Y/D/Q contacts, generated temporary names,
channel cards or per-kind method/endpoint buckets appear in the BSV canvas.

BSV semantic relations use labeled, distinguishable strokes and source
evidence. The legend explicitly says they are not verified netlist wires.
Selection reveals a driving rule/method overlay, explicit predicate, body path
condition, reads/writes/calls and a hash-checked source slice. These behavior
objects are not physical blocks. Missing guard or payload information is
unknown, not unconditional or control-only.

**Open RTL Implementation** is an explicit analysis navigation, not body click.
The implementation scene retains the BSV owner/build/source context, shows real
provider cell/port/net names and highlights only proved mappings. Unmapped
storage/expression implementation stays visible as unresolved context.
Back restores the previous BSV scene, selection, source and viewport exactly.
Up remains hierarchy navigation; identical entry adds no history.

Required real-data states: BSV overall, BSV interior, typed port/storage and
behavior selection, original source, same-context RTL detail, Back to BSV.
Use the existing readable type scale, exterior port-label rails, ordinary
pointer hit priority, light/high-contrast and reduced-motion rules.
The old static 50% geometry images remain separately labeled historical design
evidence; they do not establish new BSV runtime zoom.

## Direction and reference

Operate mode: hardware is the work surface; chrome is quiet and compact.
The authoritative layout reference is the master's canvas, hierarchy,
conditional details and code drawer, amended to BSV-first ownership above.
No marketing imagery or fake
schematic illustration is needed. Existing source-derived cards and channel
buckets are not the visual model for this experiment.

Reference mechanisms: existing root design uses the StyleGallery panel-layout
shell (canvas owns pan/zoom; details owns scrolling), and the beui accordion
mechanism for accessible disclosure. Hardware expansion adds one deliberate
mechanism: the occurrence shell keeps identity while its child scene expands.
No animation dependency is justified for G1.

## Color and contrast

Use VS Code variables with standalone defaults when hosted outside VS Code:

| Token | VS Code source | Standalone dark / light |
| --- | --- | --- |
| canvas | editor background | `#1e1e1e` / `#ffffff` |
| panel | side bar background | `#252526` / `#f3f3f3` |
| text | foreground | `#d4d4d4` / `#242424` |
| secondary | description foreground | `#b5b5b5` / `#555555` |
| border | panel border | `#686868` / `#767676` |
| focus | focus border | `#75beff` / `#005fb8` |
| selected | list active selection background | `#094771` / `#cce6ff` |
| warning | editor warning foreground | `#cca700` / `#795e00` |

High contrast uses explicit foreground-colored borders and a strong focus
stroke. Shape, pin label, direction, and junction/bridge marks carry meaning
without color. Entry never dims every child because its parent is selected.
Only an explicit related-logic query may reduce unrelated emphasis.

## Type and spacing

UI uses VS Code/system sans; identifiers/evidence use VS Code/system monospace.
Hardware titles: 14px. Body/pins: 12px. Supporting metadata: 11px.
Controls: at least 28px high. Main targets: at least 24px where spacing permits.
Wire hit strokes: 10 CSS px independent of visible stroke. Visible strokes:
1.5px ordinary, 2.5px selected, 2px boundary. Focus outline: 2px.

Spacing scale: 4, 6, 8, 12, 16, 24px, following the root design.
Control radius: 4px. Module corner radius: 4px, not a dashboard card pill.
Cell title/port rows determine bounds; coordinates derive from the input model.
Long identifiers may truncate with a complete tooltip and inspector label;
they must not create a final one-character wrapped line.

## Shell and scroll ownership

Top row: BSV Lens, G1 experiment marker, build selector, real top, stage,
Back/Forward/Up. Second row: hierarchy path and Fit.
Left hierarchy is optional. Canvas takes the available center space.
Right details appears on selection, rather than reserving a large empty panel.
Source/RTL drawer is closed by default and owns its own scrolling.

At narrow widths, hierarchy/details use disclosure or overlay so one utility
pane at most competes with the canvas. The document must not horizontally
scroll. At overview scale, unreadable label size must be called out with a
detail-zoom action instead of claiming a readable fit.

## Reusable primitives and states

- **Build control:** unselected, loading, ready, partial, failed. Mode and
  stage are textual, not just a colored badge.
- **Occurrence shell:** collapsed, expanded, keyboard-focused, inspected,
  black-box, loading/error. The same occurrence ID owns both shell states.
  A real port list and bit membership survive expansion.
- **Cell symbol:** known primitive glyph or generic raw type; selected/focused.
  State/memory/operator symbols require actual type evidence.
- **Port anchor:** input/output/inout/unknown labels, actual ordered bit
  membership, selected/focused. An information action does not enter a block.
- **Net route:** trunk/branches with real bit references, selected, partially
  visible boundary continuation. True branches have junction dots; geometric
  crossings do not imply electrical connection.
- **Boundary continuation:** explicitly presentation-only, retains its binding
  and hardware bit references; never counted as a new cell.
- **Evidence detail:** artifact pointer, driver/load, RTL, BSV verified/partial/
  ambiguous/unmapped. Unknown is a meaningful result, not an empty value.
- **Code drawer:** actual hashed text with range highlight and source role;
  multiple verified origins offer a list rather than choosing the first.
- **Feedback:** polite status for action completion; explicit error keeps the
  last valid scene; no generic zero-node failure for leaves or black boxes.

All primitives can be exercised through the compiled fixtures/state harness.
Rendered SVG is interactive content, not an `img` hiding its descendants.

## Interaction and motion

Single-click expandable body enters. Info/Space inspect. Enter performs the
primary action. Leaf/port/wire/background never bubble into hierarchy entry.
Mouse drag suppresses subsequent activation. Repeated/double activations are
deduplicated by target and navigation transaction, not timing luck.

Geometry changes and state/history commit are one transaction. The proposed
production transition is 180ms; G1 may use immediate, deterministic commits
while retaining shell and anchors. Reduced motion always commits immediately.
Wheel zoom is geometric only. Back/Forward restore state; Up changes parent.

## Required states and acceptance debt

Capture build-before-selection, compiled overview, expanded child, bus/bit
selection, cell selection, partial mapping, actual source drawer, Back/Up
restoration, narrow layout, light/high contrast, and reduced motion.
Real pointer/keyboard evidence plus semantic and geometry assertions is
required; screenshots alone cannot verify membership.

G1 does not promise large-design layout throughput or production VS Code
embedding. Its layout ceiling and any unreadable overview must be measured
and reported, not concealed by dropping cells or connections.
No raster drawing, fixed per-design coordinates, or fabricated nets qualify.
