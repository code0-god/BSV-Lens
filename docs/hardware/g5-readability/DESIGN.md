# G5 Readability / Fit design contract

## 1. Authority and scope

Refine the existing BSV-first DOM/SVG engineering tool. The user's Readability
brief and the existing root/G4 design system govern this work. Keep VS Code
theme variables, native controls, current hardware silhouettes, actual routes,
selection patterns and existing 320ms hierarchy expansion. No new visual world,
dashboard, renderer framework, compiler, connectivity or query semantics.

The G4 contract requires overview hardware titles at least 9 rendered CSS px.
This follow-up does not lower that floor. Selected/detail names and core labels
target 12 CSS px. Twelve is a new design target, not a previous measurement.

The primary user is an engineer following module structure, one signal or one
source effect. Small windows, long names, keyboard navigation and high contrast
are first-class conditions. A readable Inspector complements the schematic; it
does not replace the primary module names in a simple overview.

## 2. State and responsibility

Canonical source/hardware IDs and analysis results remain authoritative.
Scene chooses semantic objects; existing layout owns node/contact/route geometry.
Display policy owns derived text, font size, placement, omission reasons and
level. Viewport owns pan/zoom and fitting. Navigation owns visits/restoration.
Existing semantic groups own hit testing; export owns its declared information
scope. A label must never become a new electrical or source identity.

Do not add derived level to visit identity. Store explicit fitting/panel intent
in presentation state. Keep numeric viewport x/y/scale compatible with existing
consumers. Presentation-only changes do not cancel pending analysis or source
reads. Selection/source identity changes retain their existing cancellation.

## 3. Typography and measurement

Reuse system UI and editor font families from existing theme tokens. All colors
remain theme variables. Reuse spacing 4/6/8/12/16/24px and control radius 4px.
Use the following display tokens (screen CSS px):

| Role | Target | Hard floor |
| --- | ---: | ---: |
| Major structure/current/selected title | 12 | 9 |
| Selected/detail core contact or signal | 12 | 9 |
| Displayed supplementary text | incumbent 10–12 | 9 |
| HTML context and analysis controls | incumbent 11–16 | 11 |

Effective font size is computed from the actual SVG screen transform and
computed font size. DPR never relaxes the CSS-pixel threshold. Record declared
size, effective size, transformed glyph/text bounds, clipping and the visible
string separately. Large containers/padding do not establish readable text.
No CSS-only, all-hidden, offscreen or screenshot-rescaling pass is valid.

## 4. Full structure and selection fitting

**Fit structure** reuses full layout bounds and shows every current node and
route. It does not clamp scale to crop topology. Its label projection prioritizes
the root, actual child modules, storage and relevant boundary contacts; optional
detail may fold. Fit padding includes displayed label extents or labels remain
inside the fitted bounds. State explicitly identifies the structure overview.

**Fit selection** frames the current selected object, contact, connection or
analysis reference using existing geometry and canonical analysis projection.
Target readable detail, preserving relevant relationships and boundary context.
When a large related range cannot fit at readable scale, prioritize the seed and
its local relations and explicitly count/name continuation outside the viewport.
It never promises the entire circuit is visible. Disable when no usable target
exists; no fallback mislabeled as a selection fit.

Repeated fit actions do not create hierarchy/analysis visits. Manual pan/zoom
marks manual viewport intent. Executing analysis preserves viewport; offscreen
results use explicit reveal or Fit selection. Neither fit changes query scope.

## 5. Label projection and access

Inputs: immutable scene, completed geometry, actual canvas size, viewport,
selection/analysis, explicit presentation state and actual font measurements.
Outputs retain owner ID, full and displayed strings, role/priority, screen font
size, bounds, anchor, folded/shortened reason and pointer policy.

Priority is semantic and deterministic: selected/current context; child modules;
storage; relevant boundary contacts; then non-selected types, aliases, repeated
pin detail, relation descriptions and full provenance paths. Never special-case
A/B/C names or screenshot coordinates. RTL cell instance names distinguish
objects; shared cell type alone is not a unique object name.

Keep the root and left/right names visible in A's simple overall schematic.
Inside left, identify left/mkStage, state and put/get. In B, show current owner,
selected object and dependency/source boundary. In C, narrow/wide, retained
occurrence and width context must remain distinguishable.

Measure available width with the actual font. Shorten at grapheme boundaries,
preserving distinguishing suffix/context; never orphan a final CJK glyph or
turn distinct visible objects into the same ellipsis-only name. Full names stay
in the existing semantic group's accessible name/title and Inspector. Optional
detail can fold with a reason and can be inspected by pointer or keyboard.

Labels have no opaque background over wires. Prefer existing anchor and owner
space, then a bounded set of nearby positions; reject overlaps with unrelated
nodes, displayed text, actual routes and port hit targets. Folding optional
detail does not remove routes, canonical objects or keyboard access. A label
must not capture a neighboring module or propagate a port click into entry.

## 6. Stability, panels and history

Derive detail levels with stable priority and hysteresis near zoom thresholds.
Cache font measurements by actual font/text; invalidate on font loading/theme
changes. Reuse scene candidates; no per-frame model analysis or layout loop.
Bound placement work and expose truthful folded counts/reasons.

Preserve the existing lower Inspector on compact windows; use an explicit
toggle if more canvas space is needed. Closing/reopening retains selection,
analysis, source, disclosure and scroll. Reserve a readable context summary
outside a closed panel. Panel/resize changes preserve the selected screen anchor
or semantic center and never silently Fit the whole scene.

Status and interaction instructions occupy a normal-flow caption row below the
SVG, never an overlay over wiring. The canvas container includes this row; the
drawable canvas, Fit, clipping and anchor calculations use `#viewport` itself.
Reserve two caption lines at normal canvas width and four at canvas widths up
to 640px, using existing 10px caption typography, 1.5 line-height and 8px block
padding (46px/76px). This prevents status updates from changing the initial Fit
area. Both status and instruction text participate in the independent oracle.

Back/Forward restore owner, actual RTL occurrence, provider/snapshot, result,
selection, viewport, panel/disclosure and fit meaning. When canvas size changed,
adapt the saved semantic anchor using current dimensions, not an old pixel reset.
Zoom-level detail changes alone create no history entry. Pending source and
query requests survive panel/disclosure/derived label updates.

## 7. Motion and export

Retain existing shell expansion. Labels remain attached during start/middle/end;
optional detail may fold temporarily, but settled mandatory labels meet the
contract. New intent cancels stale animation/label work. Reduced motion produces
the same settled semantic/display state without animation.

SVG export remains the complete canonical scene at declared intrinsic size,
with a fresh scale-1 label projection. Do not export inverse-scale screen fonts
as oversized diagram text. Include canonical connection metadata, full label
names and display-scope/omission metadata. A viewer resizing the exported image
is distinct from the intrinsic CSS-pixel guarantee. Compare exported bounds,
visible information and canonical metadata in J20.

## 8. Acceptance and limits

Independent browser oracle reads actual DOM transforms and glyph geometry;
mandatory expectations come from scenario semantics, never renderer visibility.
V01–V10 reject small transformed glyphs, hidden mandatory labels, padded boxes,
overlaps, clipped/offscreen labels, ambiguous names, fake Fit, changed canonical
nets, zoom-created history and snapshot/result drift. Existing F1/F2 apply.

J01–J20 exercise actual captured A/B/C; long/CJK mixed labels use a separately
labeled display-only fixture. Before/after images are original browser captures.
Record viewport, canvas, DPR, font, theme, panels, transform, identity and
typography/geometry results. Independent visual review follows measurements;
baseline pixel equality is not an acceptance criterion for this defect.

No accepted debt for the reported 420/J11 readability failures. Bounded large
designs may fold optional detail with explicit access; no arbitrary-scale or
native-editor certification. Human visual/design acceptance remains PENDING.
