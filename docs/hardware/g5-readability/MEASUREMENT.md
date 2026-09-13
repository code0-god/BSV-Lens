# Independent readability measurement

## Units and separate observations

All acceptance thresholds use browser CSS px. DevicePixelRatio is reported as
an environment variable and never multiplies the font threshold. Each run uses
a fresh Playwright Chrome context; it records viewport dimensions, DPR, actual
canvas/Inspector/drawer rectangles, theme, font, source scroll and visual viewport
scale. Browser UI zoom is not inferred from DPR or visualViewport.scale: no
browser zoom command is issued, and that controlled-context fact is recorded.

`canvas` is the actual drawable `#viewport` SVG rectangle. `canvasContainer` is
the outer `#canvas`, including the separate caption row. They were coincident
in the original R0 captures; after the footer correction they differ in height.
Geometric anchor/clip/Fit checks always use the drawable rectangle. The caption
leaves `#display-status` and `#canvas-instructions` are measured separately to
avoid both omission and double-counting their parent text.

The independent oracle reads the actual DOM, not runtime `visibleLabels`,
`screenFontSize`, `readable` or a renderer success flag. For SVG text it records:

- Computed declared font size and full `getScreenCTM()` coefficients.
- Effective font size: declared size multiplied by the minimum singular value
  of the complete 2D screen transform. For uniform scale this is font × scale;
  the singular value is conservative for nonuniform/sheared transforms.
- Each character's `getExtentOfChar()` rectangle transformed into screen CSS
  coordinates, their union and line positions. These are text character-cell
  bounds, not an assertion that every pixel in the rectangle contains ink.
- Separate Canvas TextMetrics ink ascent/descent/width at the declared font.
  Ink metrics, character cells, effective font and outer element bounds are
  distinct fields. Padding and line-height cannot substitute for glyph size.

`getBBox()` alone does not apply the full parent transform; a screen-space
transform must be applied. See [SVG getScreenCTM](https://developer.mozilla.org/en-US/docs/Web/API/SVGGraphicsElement/getScreenCTM)
and [SVG getBBox](https://developer.mozilla.org/en-US/docs/Web/API/SVGGraphicsElement/getBBox).
Canvas measurements use [measureText](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/measureText).
[VisualViewport.scale](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport/scale)
describes visual viewport scaling, not an independent desktop browser-zoom meter.

HTML context labels use text-node Range rectangles and their ancestor transforms.
Original source `<pre>` regions are measured separately, including their own and
ancestor scrolling. A long source slice in an explicit scroll container is not
required to fit fully in the canvas label frame.

## Visibility, collisions and clipping

Enumerate every actual SVG text element, including unregistered origin labels,
plus current scene/path/selection/provider and explicit readability context.
Apply ancestor display, visibility and opacity, viewport/canvas clipping and
overflow clips. Record clipped fraction separately; mandatory text must be
substantially fully visible. Offscreen, transparent and hidden labels cannot
satisfy mandatory expectations. A `1e-6` numerical allowance handles floating
point arithmetic only; 8.99px and 8.995px fail the 9px floor.

Occlusion follows actual hit/paint order. An opaque node behind a foreground
contact label is not an occluder; an opaque object painted above it is. Separate
interference checks reject labels covering unrelated nodes, contact marks or
actual wires. A contact may label its own hardware owner. Geometry outside the
actual canvas clip cannot occlude HTML header text.

Displayed text character-cell rectangles are checked for collision conservatively.
Production placement therefore reserves font-cell ascent/descent as well as ink
metrics; the oracle is not relaxed to select whichever metric yields a pass.
Wire observations sample the real SVG path at approximately 2 CSS px intervals,
bounded at 4,096 samples per path. The independent G4 geometry/membership oracle
separately verifies exact canonical segment/net relationships. Browser pointer
tests and human inspection supplement these geometric observations.

## Mandatory expectations

Expectations come from the scenario and canonical roles, never from the measured
visible subset. Structure fitting requires the actual shell, child occurrences
and storage. A's simple overview requires mkConnected, left and right. Its left
interior requires left/mkStage context, state and put/get. Detail requires the
current owner/occurrence/provider/query context and selected object at the 12px
target. B requires its selected logic/behavior, boundary and source context;
C requires distinct narrow/wide occurrence and actual vector-width context.

All visible labels still satisfy the 9px floor even when not mandatory. Missing,
clipped or ambiguous mandatory names fail independently of the minimum font.
Display-only long/CJK cases are labeled synthetic and never reported as compiled
A/B/C evidence. Full-scene Fit is checked against every actual node and route;
selection fitting may leave explicit continuation outside the viewport.

## Negative cases and state invariants

Synthetic browser cases prove V01–V07: parent-scaled small fonts, hidden required
labels, padded containers, text/text/wire/contact/node interference, clipped or
offscreen text, ambiguous shortening and cropped topology disguised as Fit.
Controls distinguish foreground text from genuinely occluded text. V08 mutates
actual captured geometry/net membership and must fail the existing independent
G4 oracle. V09/V10 verify unchanged history and semantic identities, including
rendered snapshot/result consistency.

Real J01–J20 use pointer/keyboard input against the production experimental host.
After actions, wait for font readiness, navigation/layout completion and settled
animations. Delay barriers hold actual HTTP responses; no arbitrary sleep turns
a failure into a pass. Motion evidence records actual transition frames and raw
browser images. No screenshot is resized or edited to improve apparent text.

## Evidence and performance

Each capture saves raw PNG, measurement JSON and canonical scene/navigation
state. Run receipts bind renderer and driver hashes, browser environment, all
journeys, errors and original trace chunks. Final runs reject concurrent source
changes. Lower-level debug captures stay separate from final acceptance.

Record action-to-settled durations for fit/resize/selection, actual RAF intervals
during wheel zoom and the renderer's separately labeled preparation measurement.
RAF timing measures browser scheduling, not physical monitor presentation.
Candidate/visible/folded counts and reasons are useful display diagnostics, not
independent proof of correctness.

Automated typography/geometry PASS and visual inspection are separate verdicts.
Visual reviewers open all final captures and compare them with the before states
and the contract. User visual/design acceptance remains PENDING until the user
approves it.
