# G4 hardware scene design contract

## 1. Identity and authority

Operate mode: a precise EDA schematic inside a VS Code-native engineering tool.
The user's G4 brief is the primary visual authority. Existing root `DESIGN.md`
supplies theme tokens and compact engineering typography, not the old
Protocol Channel card hierarchy. Historical hardware design files stay intact.

The signature interaction is a child hardware shell expanding into its interior
while keeping occurrence identity and boundary contacts. No decorative motion,
card wall, fake physical behavior blocks, arbitrary subsystem grouping or 3D.

## 2. Theme and states

Use VS Code variables for editor/sidebar/widget surfaces, foreground, description,
border, contrast, focus, selection and semantic chart/symbol accents.
Standalone host defines light, dark and high-contrast values for those variables.
BSV relations use dashes and a visible semantic label; compiler confirmation adds
a badge/double emphasis; RTL nets are solid. Contributor highlights have distinct
outline and partial-origin text. Color never carries state alone.

## 3. Typography

System UI uses `--vscode-font-family`; BSV types, statements and RTL identifiers
use `--vscode-editor-font-family`. Scale: 10px caption, 11px control, 12px body,
13px hardware title, 16px inspector title. No display/marketing fonts.
Long identifiers truncate only in geometry; title and inspector retain full text.

## 4. Layout

Bounded viewport shell: header and toolbar are content-sized; canvas and inspector
share the remaining area; legend/status stays fixed. Body never scrolls.
Canvas owns geometric pan/zoom; inspector owns detail scrolling.
Desktop inspector reserves 300px whether empty or selected, preventing canvas jump.
At narrow widths it becomes a bounded lower pane; no document horizontal overflow.
All grid/flex scroll children have zero minimum block/inline size.

Spacing follows the incumbent 4, 6, 8, 12, 16, 24px tokens.
Controls use 4px radius; hardware shells use 7px radius; storage is compact.
Canvas padding is 24px; enclosing shell header reserves 56px; contact row pitch
is 30px; module minimum width is 210px; storage minimum width is 160px.
Layout can increase measured dimensions for typed contacts and real names.
Selection outline does not change layout measurements.

## 5. Primitives

- Current shell: enclosing block, strongest structural outline, top-left instance
  label and secondary actual definition. Same object becomes expanded.
- Child module: enclosing hardware block with actual contacts on its boundary;
  whole body enters. Separate small inspect action can select its module details.
- Storage: compact rectangular glyph with two internal storage lines, source name
  and declared type. Never enter on click.
- Typed contact: boundary-attached mark with method, category, arguments or result.
  Interface/subinterface contact remains a boundary, not a channel card.
- Connection: orthogonal route, semantic/physical label, exact member detail.
  Actual RTL junctions have dots; a crossing alone never gets a junction dot.
- Inspector section: heading, meaningful rows, exact source snippets, native
  disclosures and lightweight behavior actions. Empty sections are omitted.
- Breadcrumb: native keyboard-accessible hierarchy buttons, with separate RTL
  implementation suffix/path.

All primitives cover default, hover, focus-visible, selected, pending/error and
disabled where applicable. Selection outlines stay legible in high contrast.
Inside an entered module all internal hardware starts at full brightness.

## 6. Interaction and motion

Use native DOM/SVG and Web Animations API; no new runtime dependency.
Expansion uses measured shared-identity geometry (FLIP-style transforms) over
320ms, easing `cubic-bezier(0.2, 0, 0, 1)`. Descendant appearance is anchored within
the enlarged shell. Old unrelated context can fade, but not replace the expanded
shell with an unrelated page. Contact IDs and meaning remain stable.
Retarget or cancel stale animations on newer intent; never queue navigation.
Final geometry must validate before visit commit.

Reduced motion removes expansion animation entirely and shows the same final
semantic result. Wheel only zooms. Drag only pans. Double-click does not navigate
again. Keyboard Enter/Space matches each object's single-click action.

Mechanism references read: beui.dev `morphing-modal` shared layout/presence and
reduced-motion behavior; adapt the mechanism, not its modal appearance or React
dependency. Existing StyleGallery `panel-layout` supplies main/utility adjacency;
bounded scroll ownership above is G4-specific.

## 7. Detail and resize

At overview scale preserve module labels and summary relations; normal scale adds
typed contact/storage detail; high scale exposes connection detail labels.
Canonical scene facts never change with zoom. Hidden labels remain inspectable.
Overview keeps hardware titles at a minimum rendered 9px and hides secondary
labels rather than changing canonical scene facts. Full identifiers remain in
accessible names and inspection. Non-selected RTL bus labels are disclosed at
detail zoom; compact constant labels stay next to their actual contacts.
Resize preserves selected-object anchor or semantic center. Fit includes every
current scene node. BSV/RTL viewports remain independently restorable.

## 8. Accessibility and acceptance

Native toolbar/disclosure controls, SVG interactive descendants, descriptive
aria-labels with name/kind/state/expandability, stable Tab order and visible focus.
Escape clears selection; Alt+Left traverses history. Evidence status has text,
line pattern and outline, not only color. Source text is selectable.

Actual Chrome at desktop, medium and compact widths, light/dark/high contrast and
reduced motion is required. Capture real transition frames, not generated mockups.
No accepted accessibility debt. Large-model scale and unrun native VS Code
integration must be reported explicitly. Human visual/design acceptance: PENDING.
