# G6 native acceptance and compact display contract

This document defines required native behavior and links actual executions; it
does not certify an unexecuted candidate. G5 readability and G4 routing contracts
remain authoritative. User visual/design acceptance remains **PENDING**.

## Current installed acceptance

Final native batch uses `bsv-lens-0.4.1-568cd5d7de13990a.vsix`,
SHA-256 `f9d7a845aab91e366e85e5d73ec8cc04cf0e1f78586f3ef6c0ee8ad9d5b851d7`.
The [batch receipt](../evidence/g6/run-TEmIQj/index.json)
binds all seven runs to the explicitly installed candidate. Delivery promotes
those exact bytes; no repackaged VSIX inherits these results. Two independent staged review/source extractions passed core and installed native/editor replay. Final-byte receipts are external and linked from G6_REPORT.

| Current installed gate | Result |
| --- | --- |
| [N01–N15](../evidence/g6/run-TEmIQj/native-n/native-acceptance.json) | 15/15 PASS, including actual editor range, source-open acknowledgement and frontend source completion. |
| [S01–S14](../evidence/g6/run-TEmIQj/native-s/native-security.json) | 14/14 PASS in actual Restricted Mode; session/input/worker and unchanged-result boundaries. |
| [Full process restart](../evidence/g6/run-TEmIQj/native-restart/native-restart.json) | PASS; second process has no authority until explicit registration, then restores analysis and source. |
| [Actual source](../evidence/g6/run-TEmIQj/native-source/actual-workspace.json) | PASS for original 14 files plus existing wrapper, bounded initialized/initialize editor roundtrip. |
| [Actual retained artifact](../evidence/g6/run-TEmIQj/native-artifact/actual-workspace.json) | PASS for explicit retained occurrence and queries; full parent remains limited. |
| [Native typography](../evidence/g6/run-TEmIQj/native-typography/native-typography.json) | 18 automated captures PASS within current-window/pane scope; OS whole-window resizing BLOCKED/NOT RUN. |
| [Native scale](../evidence/g6/run-TEmIQj/native-scale/native-scale.json) | S-A/B/C/L PASS; M and aggregate FAIL solely on unchanged default-budget complete-cone expectation. All cases execute/display within other budgets. |

N06 requires more than an editor side effect. The Host's successful source-open
response contains plain JSON position objects `{line, character}`, canonical
revision/range/URI and text. It does not send VS Code Position class instances
through the guarded message envelope. The actual editor observation matches that
acknowledgement, and the Webview source lifecycle ends in `complete` for the
same reference. A correct editor selection followed by a rejected response or
frontend source error cannot pass.

The [typography receipt](../evidence/g6/run-TEmIQj/native-typography/native-typography.json)
measures a 1440×900 outer Code window, DPR 1, zoom 1 and outer-frame scale 1.
T08-current-window has a 396×808 Webview and 396×255.609375 drawable canvas.
T09-wide-pane has a 1092×808 Webview and 792×566.5 canvas in that same window.
Inspector close/restore, actual Dark Modern/Light Modern/Dark High Contrast,
UA-emulated reduced-motion final state, delayed source response and C widths
8/12 pass. Minimum displayed text across these 18 captures is 9.000311615 CSS px;
minimum title is 12.000000179 CSS px. Hidden optional text is excluded; mandatory
names and geometry are checked independently.

Whole-window 1280×960 and 1600×1000 requests are NOT RUN in the final harness.
Electron CDP omits Browser.getWindowForTarget, and the CUA application route
became unavailable; OS resize is BLOCKED. Current pane observations are not
relabeled as those requested window sizes. Native CJK display fixture is NOT RUN.

[Final AI visual review](../evidence/g6/run-TEmIQj/visual-review/visual-review.json)
directly opened nine current originals: representative native/typography/source
PASS, artifact PARTIAL. Selected D_IN is readable; 13 blocks and 33 route
continuations remain outside Selection Fit. The actual writer range is correct
but long lines extend beyond the standard editor's right edge. Its prior broader
59-image review is a different VSIX; verified equal Host/functional media does
not make those images new final captures. User visual/design acceptance remains
**PENDING**.

## Historical native compact policy

The installed `b0d6350bb18378a8` candidate reproduced a native split-editor
failure: Webview 396×808 CSS px, drawable canvas 356×147.414 CSS px. The additional
40px horizontal padding came from the VS Code Webview default. Toolbar wrapping
reduced drawing height; root/left/right SVG names were hidden at scale 0.09797.
The actual native measurement and mandatory-label oracle failed. A declared
12px projected font did not make those hidden names readable.

The correction retains the existing controls and design tokens:

- Native body has zero extra padding. Existing panels retain their own spacing.
- Theme, implementation provider and SVG export move into the existing
  **Inputs and build** disclosure. Their IDs, labels and keyboard controls remain.
- Back/Forward/Up, explicit RTL entry, both Fit actions and Inspector toggle stay
  directly available. Input registration remains explicit.
- Native scene path wraps rather than clipping a second context line.
- Explicit desired RTL provider is stored in presentation disclosure, separately
  from the actual current provider/snapshot/query. Closing input controls or
  resizing preserves this choice. Only registered `stock`/`instrumented` choices
  are accepted; dedicated known-contributor actions retain their provider contract.
- Unselected overview titles try actual measured 12, 11, 10 and 9 CSS px, in that
  order. Full distinguishable names take priority over abbreviation. Every try
  must pass existing canvas/owner bounds and label/node/port/wire clearance.
- Selected and analysis-related primary labels retain the 12px target. Normal
  and detail views retain the prior 12px policy. No text falls below 9px.
- No viewport minimum is changed, no opaque label box is added, and no canonical
  node, route, ordered bit membership, source identity or query is changed.

The four font attempts are finite and deterministic. Existing zoom hysteresis
and font cache remain; display changes add no history visit or source/query
cancellation. Tiny combinations that still cannot fit are failures or explicit
limits, never a pass based on hidden labels. Installed after measurements are
required before accepting this correction or editing it again.

## Separate preservation correction

The renderer stores code scroll per reference as `{top, left}`, while the first
G6 state validator incorrectly expected a scalar number. The validator now
preserves the actual renderer shape, limits entries to 128, and accepts only
finite, nonnegative bounded coordinates with no extra fields. This repairs
native state persistence; it does not change source revision, query scope or
request cancellation. The unreleased scalar shape is not treated as a migrated
or silently accepted state.

## Preserved earlier executions

| Candidate/run | Observed outcome | Scope |
| --- | --- | --- |
| `97720dc4c19f4289`, `g6-installed-acceptance-jsBk8I` | N01/N02 passed; N03 failed | VS Code `extensionTestsPath` rejected a real modal; input stayed unpublished. |
| `b0d6350bb18378a8`, `g6-installed-acceptance-ordinary-mSvORi` | N01–N07 passed; N08 harness selector failed | Actual installed source/artifact approval, BSV expansion, writer query, exact editor range and editor-to-diagram reveal. |
| `g6-native-narrow-oracle-qgKCCS` | FAIL | Independent native root/left/right mandatory labels missing; scene-path clip fraction 0.812247. |

Each original run remains under `.build/hardware/runs/<run>/g6`; raw PNGs,
measurement JSON, DOM, native trace, protocol records and shutdown/runtime
identity receipts are preserved. None of these partial runs establishes complete
N01–N15, final native readability, remote support or user design approval.

## Input registration completion

A successful native input generation with a selected root closes the Inputs and
build disclosure before scene layout. This returns the editor pane to its drawing
area; registration does not try to lay out a zero-height canvas underneath the
expanded input controls. Failed or cancelled input registration keeps the prior
scene and disclosure. No source/query scope, Fit minimum, or model data changes.
The observed failure was a264px pane with two source editor columns and open
controls; it is recorded in g6-native-security-installed-vUIvBT/g6.
