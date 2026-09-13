# G6 validation matrix

Final runtime: `bsv-lens-0.4.1-568cd5d7de13990a.vsix`, 670,124 bytes, SHA-256
`f9d7a845aab91e366e85e5d73ec8cc04cf0e1f78586f3ef6c0ee8ad9d5b851d7`.
The [seven-run batch](../evidence/g6/run-TEmIQj/index.json)
uses those installed bytes. Earlier 9460/7da candidates remain historical and do
not substitute for final execution. Independent staged review/source core and installed native/editor replay passed. Final archive bytes receive the same checks; G6_REPORT links external final validation receipts.

## Installed native gates

[N01–N15 receipt](../evidence/g6/run-TEmIQj/native-n/native-acceptance.json) reports 15 executed PASS results. N06 compares actual
editor URI/text/range with the plain-JSON source-open acknowledgement and confirms
frontend `source: complete`; editor movement alone is insufficient.

| Gate | Required observation | Final result |
| --- | --- | --- |
| N01 | Explicit opt-in command and actual installed panel | PASS |
| N02 | No-input guidance, no demo/compiler | PASS |
| N03 | Native root/source/artifact and bundle approval | PASS |
| N04 | BSV overall and single-click left expansion | PASS |
| N05 | State writer/source analysis | PASS |
| N06 | Actual TextDocument/range plus source-open ACK and frontend complete | PASS |
| N07 | Editor instance declaration to actual occurrence | PASS |
| N08 | Stock ordered signal/net/pin result | PASS |
| N09 | Same-net versus dependency distinction | PASS |
| N10 | Sequential/unsupported boundary stop | PASS |
| N11 | Explicit instrumented partial contributor | PASS |
| N12 | RTL root/child/sibling and Back/Forward/Up | PASS |
| N13 | Wire target and canonical ordered membership | PASS |
| N14 | BSV/RTL/source/Back context restoration | PASS |
| N15 | C narrow/wide and inlined source/retained RTL | PASS |

[S01–S14 receipt](../evidence/g6/run-TEmIQj/native-s/native-security.json) reports 14 executed PASS results in Restricted Mode
with `workspace.isTrusted === false`. Every Code invocation has private user,
extension and shared-data stores; both product and observer are installed.

| Gate | Boundary | Final result |
| --- | --- | --- |
| S01 | Actual Restricted Mode; no executable native action | PASS |
| S02 | Outside-root source/artifact denied | PASS |
| S03 | Symlink escape/replacement denied | PASS |
| S04 | Foreign panel/session/snapshot/entity rejected | PASS |
| S05 | Invalid range and dirty revision handled | PASS |
| S06 | Oversized/deep/hostile native message rejected | PASS |
| S07 | Malicious text does not execute HTML/commands | PASS |
| S08 | Cancelled worker exits; no late success | PASS |
| S09 | Disposed panel work/listeners removed | PASS |
| S10 | Multiple panels keep isolated state | PASS |
| S11 | Panel recreation grants no automatic authority | PASS |
| S12 | Changed/moved/deleted source/artifact is stale | PASS |
| S13 | Build/protocol mismatch rejected | PASS |
| S14 | Failed refresh retains valid scene/history | PASS |

S06 message checks do not replace result-size/scale checks. S11 is actual panel
recreation; [full Code restart](../evidence/g6/run-TEmIQj/native-restart/native-restart.json)
separately PASSes with two processes and the same private stores. The second
process has no registered input until explicit selection; only then are saved
analysis and actual source editor restored.

## Lane results

| Lane | Actual result | Scope and limits |
| --- | --- | --- |
| [Frozen core](../evidence/g6/run-TEmIQj/core/core.json) | 725 tests: 722 pass, 0 fail, 3 skip, 0 cancelled | Exact copied source/input snapshot; no native/browser claim. |
| [G5 semantic replay](../evidence/g6/run-TEmIQj/semantic-75/semantic.json) | 75 public queries PASS | Same immutable requests, semantic comparison; no new origin claim. |
| [Preview browser](../evidence/g6/run-TEmIQj/preview-regression/browser/receipt.json) | J01–J20 PASS | Actual preview browser, separate from installed Webview. |
| Installed N/S | 15 + 14 PASS | Final VSIX and real editor/message/worker path above. |
| [Actual source](../evidence/g6/run-TEmIQj/native-source/actual-workspace.json) | PASS | Original 14 production files plus existing MemorySynthTop; explicit source-only bounded writer/editor roundtrip. |
| [Actual artifact](../evidence/g6/run-TEmIQj/native-artifact/actual-workspace.json) | PASS within retained occurrence | No source/RTL join; full Memory parent remains maxDimension-limited. |
| [Native typography](../evidence/g6/run-TEmIQj/native-typography/native-typography.json) | 18 automated capture verdicts PASS | Current window/panes, Inspector, 3 themes, UA reduced-motion, source delay and C widths. |
| OS whole-window resize | BLOCKED; final requested sizes NOT RUN | Electron CDP lacks Browser.getWindowForTarget and CUA application route became unavailable. |
| [Native scale](../evidence/g6/run-TEmIQj/native-scale/native-scale.json) | S-A/B/C/L PASS; M and aggregate FAIL | Only fixed M complete-cone expectation fails at unchanged 4 MiB cap. All installed execution/display and other budgets PASS. |
| Live compiler | [Scheduler PASS](../evidence/g6/run-TEmIQj/live-scheduler/live-compiler.json), [Memory PASS](../evidence/g6/run-TEmIQj/live-memory/live-compiler.json) | Existing bounded wrappers, isolated outputs, no whole-workspace synthesis claim. |
| [Preservation](../../../.build/hardware/runs/g6-preservation-delivery-final-rfIUyq/g6/preservation.json) | 148,815 checked; 148,797 unchanged; 18 approved changes; zero unauthorized | 20,849 prior-run metadata records unchanged; not a new prior-run content-hash claim. |
| Remote/virtual/web | Unsupported by current adapter; execution NOT RUN | Other desktop OS and minimum VS Code 1.90 runtime also NOT RUN. |
| Final archive/fresh replay | PASS for two staged extractions | Each has 422 core pass / zero fail / three separate skips, source/artifact queries, installed VSIX/editor replay and unchanged original inventory. Final-byte receipts remain external. |

Core skips are two external actual-workspace scene/membership cases and one
opt-in browser-negative case. The installed actual-workspace lanes test their
respective boundaries separately; the skipped cases are not counted as core
passes. Browser-negative results remain a separate explicit lane in the final
report, never inferred from 722 core passes.

T08-current-window measures a 1440×900 outer window, 396×808 Webview and
396×255.609375 drawable canvas. T09-wide-pane keeps that same outer window and
measures 1092×808 Webview with 792×566.5 canvas. These are not the unexecuted
1280×960/1600×1000 requests. DPR, zoom and outer-frame scale are 1. Minimum text
is 9.000311615 CSS px and minimum title 12.000000179 CSS px across the 18 native
typography captures. Native CJK fixture is NOT RUN. Source delay is test-only
delivery delay after real native IPC arrival, not a source/query mock or OS
latency measurement.

[Final AI visual review](../evidence/g6/run-TEmIQj/visual-review/visual-review.json)
opened nine current originals: native/typography/source representative PASS,
artifact PARTIAL. Selected D_IN is readable, but 13 blocks/33 route continuations
are outside and full parent rendering is limited. Long source lines need normal
editor horizontal scrolling. Prior broader 59-image coverage is explicitly
from another VSIX; [member lineage](../evidence/g6/run-TEmIQj/visual-review/runtime-lineage.json)
proves Host/functional media equality, not 59 fresh final captures. User visual/
design acceptance remains **PENDING**.

## Correctness contracts retained

Scene response is a pure candidate. Only canonical `persist {state, revision}`
confirms displayed Host current; positive session ordering, immediate semantic
commits, 200 ms display-only debounce and serialized saves prevent late current
overwrite. Reverse-source lookup survives geometry/disclosure but rejects changed
semantic context. Revival uses a unique Host workspace-state inputIdentity
envelope, followed by explicit registration, never raw Webview authority. Native
contexts load sequentially per build under the unchanged four-request cap.
Artifact-only BSV context stays null and says Not attached.

Interface membership is exact owner/definition/immediate interfacePath. Optional
wire label folding retains full name/anchor with null bounds and no pointer
interception; canonical wire members remain. Root choices stay true roots; the
128-entry RTL menu adds explicit immediate retained children without scope or
model truncation. Scheduler's 47,809,773-byte/537-connection root and Memory's
8592>8192 layout remain documented limits, not retroactively passing cases.

## Reproduction and delivery boundaries

From extracted `bsv-lens`, run
`node --no-global-search-paths experiments/hardware/g6/replay-input.cjs`
for captured public input replay. Explicit positional arguments are
`MANIFEST_RELATIVE_PATH SOURCE_ROOT_RELATIVE_PATH ARTIFACT_ROOT_RELATIVE_PATH`,
using `-` for absent roots. These are harness grants, not native dialog proof.

`node experiments/hardware/g6/validate-delivery.cjs REVIEW_ZIP SOURCE_ZIP`
performs two fresh core extractions and validates indexed native evidence. Native
launch is an explicit `nativeReplay` callback, not default behavior. Author
preservation without its 14 required companions must fail explicitly. Optional
historical QA companions, including the older 70-file supplement, are distinct;
shipped core replay does not require old ZIPs.

Full native journey interface is
`node experiments/hardware/g6/native-acceptance-run.cjs VSIX FIXTURES_JSON OBSERVER_VSIX`.
Use only isolated VS Code with all three private directory flags. Installed
bytes, input identities and captured acknowledgements must match.
`node experiments/hardware/g6/run.cjs LABEL EXECUTABLE [ARGUMENTS...]` records
new output under a unique `.build/hardware/runs/<id>/g6`. Final archive paths,
CRC/SHA and new extraction/native replay receipts are recorded only after actual
execution. No final packaging success is claimed by this document yet.
