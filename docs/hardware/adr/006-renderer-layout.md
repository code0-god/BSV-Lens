# ADR 006: retain SVG, isolate a bounded port-aware scene

Status: proposed for G1 approval, now backed by actual model and Chrome evidence.

Decision: retain SVG and the existing vanilla/CommonJS environment. Do not
reuse the legacy card/projection routing contract. The G1 experiment uses
`experiments/hardware/prototype/layout.js` and the policy
`measured-bounded-generic-lanes-v2`.

No renderer/layout dependency was installed. Actual cell/port labels determine
node size; stable artifact IDs determine ordering. A generic one-to-three-column
packing and unique orthogonal tracks route real endpoint groups. Track space
depends on actual route count. Constants are marked at their connection sites.
The algorithm is not a general SCC/rank/compound schematic optimizer.

## Why the current renderer contract cannot be reused

- `media/webview-layout.js:10` dispatches on legacy level/mode node/edge views.
- `media/webview.js:967` routes rectangle centers without actual pin anchors.
- `media/webview.js:1122` draws decorative midpoint ports rather than imported
  ordered hardware pins.
- `media/graph-view.js:385` packs semantic member panels and hierarchy buses,
  not implementation connectivity.

SVG itself supplies stable DOM shells, real hit paths, labels, theme support,
accessible controls and vector evidence export. It is not the source of the
current ownership or connectivity defects.

## Measured G1 result

Actual Chrome `152.0.7977.82` exercised all three compiled models.
The browser receipt is `.build/hardware/prototype/receipt.json`; build coverage
is `.build/hardware/prototype/build-receipt.json`.

- A top-scene pin text measures 12.84 CSS px at 1280 and 14.49 px at 1440.
  An initial overly wide layout produced about 8 px text with only four
  objects; real visual QA rejected it. Generic spacing/packing was corrected.
- B's expanded scene retains 27 shell/cell objects in
  `2568.72265625 x 2007` model bounds.
- C's expanded scene retains six shell/cell objects in
  `1757.1484375 x 694` model bounds.
- The same expanded shell DOM and ordered port/binding membership survive.
  Expanded boundary ports have pointer priority over route hit areas.
  The real `left.get` click originally failed because a route intercepted it;
  the normal, unforced pointer regression now passes.
- True same-net branches have junction dots; geometric crossings do not.
  Collocated hit candidates are disambiguated rather than changing net identity.
- Lead QA selected actual `left$get` ordered bits 21-28 through a real wire
  hit, inspected RTL/BSV context and verified exact source/bit/viewport recovery.

Selection does not create new hardware or rerank the canonical model.
Hidden parent surroundings use binding-backed presentation continuations.
The intermediate-expansion SVG is generated from actual model geometry;
it is explicitly a static design frame, not proof of time-based animation.
The interactive prototype proves immediate entry and endpoint continuity.

## Limits and alternative

Dense B and narrow-window Fit are overviews, not a claim that every label is
readable simultaneously. Detail zoom and evidence inspection remain necessary.
The full graph remains in the canonical model. No cells/nets are dropped to
meet a visual budget.

This evidence does not establish large crossbar/fanout routing, arbitrary deep
compound layout, obstacle-optimal routes, physical placement, timing, or a
production animation midpoint. G4 must implement the approved transition
policy; G6 must measure large/pinned integration scenes.

Rejected now: replacing SVG with Canvas/WebGL, several parallel renderers, or
introducing ELK before an actual measured need. At G4, compare an offline
specialized layout engine on these same complete models if the approved
readability/compound-routing criteria exceed the bounded algorithm. Record
actual license, bundle size, CSP/worker requirements and stability before
adopting it. This ADR approves an evidence-bound G1 choice, not permanent
commitment to the small-scene router.
