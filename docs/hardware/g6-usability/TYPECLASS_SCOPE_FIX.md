# G6 usability: IM2P selection and typeclass follow-up

**Final installed candidate: PASS within the limits below. User visual/design acceptance: PENDING.**

## A. Baseline and preservation

Branch feat/hardware-schematic; HEAD c6b9a5c642d105ad4117535c1d85366f1c02ec1c; package and lockfile version 0.4.1 remain unchanged. HEAD does not identify the uncommitted feature.

Starting product inventory fingerprint: 389e5321c044c75dfd87fcbbe222b4ea1793596ccf2ec1f1326c6a1685d70c4d

Final product inventory fingerprint: effdd2d0690578d5b7c5680b8a0a4510516c2a34e8d76afb3964452f0e994390

Native build fingerprints use their own runtime file set and are reported separately below. Actual workspace: `$HOME/aisa-lab/DynDNN/IM2P/IM2P.sim`. Its 67 BSV files and 66 selectable definitions were measured, not hardcoded as general expectations. Original source/settings, compiler evidence, traces and full G6 archives remain unchanged.

Changed product files:

- media/hardware-layout.js
- media/hardware-native.html
- media/hardware-navigation.js
- media/hardware-readability.js
- media/hardware-strings.js
- media/hardware-view.js
- src/architecture/graph-builder.js
- src/architecture/parser.js
- src/architecture/semantic/definitions.js
- src/architecture/semantic/model.js
- src/hardware/analysis/source-calls.js
- src/hardware/analysis/source.js
- src/hardware/correspondence/build.js
- src/hardware/correspondence/generated-bundle.js
- src/hardware/correspondence/index.js
- src/hardware/correspondence/source.js
- src/hardware/scene-query.js
- src/hardware/scene-summary.js
- src/hardware/scene.js
- src/panel/hardware-session.js

## B. Before / after

| Problem | Correction / measured result |
|---|---|
| Selection stays empty with duplicate semantic definition error | Typeclass prototypes stop at their semicolon; implementations retain lexical scope identities. No duplicate IDs in any of 66 selected dependency scopes. |
| Arithmetic / Scale functions disappear or collide | Arithmetic retains 5 prototypes + 10 implementations; Scale 2 + 4. Ordinary function IDs stay unchanged. |
| Overload incorrectly appears exact | Single/multiple typeclass candidates stay unresolved in canonical analysis, the legacy graph and builtin-named public calls. Declaration-only behavior is partial. |
| Full-core expanded JSON exceeds limit | Complete generated values use bounded shared serialization; external limits stay unchanged. |
| Full-core loading takes 45–49 seconds | One exact-text coordinate index, bounded to 256 Ki UTF-16 code units. Recorded loader time becomes 2.76–2.94 seconds, not a compiler/frame-time claim. |
| Main blocks vanish in dense overview | More than 16 direct registers triggers compact register display, with child modules and memory/FIFO in the primary area. Only nonselected register state relations fold; memory/FIFO relations remain. |
| Back drifts 7.5px | ResizeObserver watches the actual SVG drawable, including footer-induced changes within an unchanged outer container. |
| Prepared history is full | Explicit Open … in a new history action commits the requested design before replacing prior history. The cap is unchanged. |

The parser follows the [BSV prototype grammar](https://raw.githubusercontent.com/B-Lang-org/bsc/main/doc/BSV_ref_guide/BSV_lang.tex), without implementing a compiler or typeclass solver. Original failures remain recorded: a228 duplicate error; c23c hidden Core names; 9004 viewport drift; 0dfa history limit; e50b disappearing recovery; ef24 Dense typography. None was relabeled PASS.

Core keeps 6 children, 165 storage identities and 1,287 canonical relations. Overview draws 14 summary routes containing 119 original relations, with 1,053 register-state and 115 internal relations folded. commandReg/state-summary selection draws 16 routes with stable geometry. These are display-scope counts, not deleted facts or physical nets.

## C. Final installed Native verification

Artifact: bsv-lens-0.4.1-3cba1c6f429c1029.vsix

SHA-256: 7fa7b6aa16d3321dfa1d5d5af13d77cb9ccf5306cfdff1b808ec10c6038d24d1

- Runtime: 3cba1c6f429c10292aee5a3245958d074f119324cf86b8cf5ce42402a04636a3
- Host: a3a2088a17e72498ce60651837bc96abbb8d2935bc42c5a9fd6f8ccc9e5b73b1
- Webview: f8f04d19c6f2ce6bb6a98c612fa5482530f250e4454beb63c2bcbe869e13c05d
- Extension code0-god.bsv-lens, protocol 1, package 0.4.1.
- VS Code 1.136.1 / Node 24.18.1 / Electron 42.10.0 / Chromium 148.0.7778.280 / macOS arm64, local host, Restricted Mode.

The [native receipt](../../../.build/hardware/runs/g6-typeclass-native-after-LpGLjE/g6/native-receipt.json) records the private installation path, runtime/archive byte equality and shutdown. The ordinary user profile was not modified.

The [final Native journey](../../../.build/hardware/runs/g6-typeclass-native-after-LpGLjE/g6/validation.json) opens all eight actual roots: mkPE, mkSystolicArrayA16W16D64, mkVectorUnit, mkIM2PCore, mkDensePipeline, mkFullReplay, mkSynthA8W8D16 and mkExecuteController. Three explicit history resets occur in the same panel/session. This proves bounded recovery, not simultaneous retention of eight large models.

Core commandReg → writers → startPendingExecution opens the actual TextDocument at UTF-16 **[37425, 39022)**, lines 902–947 of IM2PCore.bsv. Source SHA: 8613eb740ceb58758c168a613ab4c1846302341014b91abaed39bafc81fff9f2. Back restores query/result, selection, occurrence and selection-Fit viewport; module Back restores the structure viewport. Dense BRAM selection displays its full name at 12 CSS px and an actual hit-testable local wire, with explicit continuations.

All **25 original PNGs** were directly reviewed; 22 states have typography measurements. Core's seven principal names are 10–11 CSS px; selected commandReg/activations meet 12 CSS px. Normal Dense/FullReplay root, child and BRAM names remain visible. Measurements use CSS px and observed transforms; physical DPR is not multiplied into font size. Original captures are 2880×1800, with actual per-state window/pane/canvas dimensions recorded.

[Visual integrity PASS](../../../.build/hardware/runs/g6-typeclass-integrity-final-IjdIgE/g6/visual-integrity-audit.json) · [Visual readability PASS](../../../.build/hardware/runs/g6-typeclass-native-after-LpGLjE/g6/visual-readability-pass-b-LpGLjE.md). These are AI reviews, not user approval. Error states retain readable owner context and a recovery action; Outside notices describe prior geometry clipped by the error banner. Normal overview mandatory-label requirements remain unchanged.

The [same-VSIX negative Native journey](../../../.build/hardware/runs/g6-typeclass-native-limit-uiqYuA/g6/validation.json) proves initial oversized input → retry → PE, then committed PE → oversized input rejected → preserved identity/history with measured anchor adaptation → ExecuteController.

## D. Correctness and support limits

| Lane | Actual result |
|---|---|
| Final full suite | **865 tests: 862 passed, 0 failed, 3 separately scoped skips, 0 cancelled**; check/core/semantic exit 0; [runtime unchanged](../../../.build/hardware/runs/g6-typeclass-final-3cba-checks-VXDb7k/g6/receipt.json) |
| G5 semantics | [75 query/result records match](../../../.build/hardware/runs/g6-typeclass-final-3cba-checks-VXDb7k/g6/semantic/semantic.json) after verified build-identity rebasing; original strict byte-identity failure remains separately recorded |
| Final workspace sweep | [64/66 loads; 19/19 scene/source/geometry checks](../../../.build/hardware/runs/g6-duplicate-definition-workspace-3cba-rqZOVs/g6/summary.json); no duplicate IDs; 67 files unchanged; overall failure/exit 1 retained because two inputs exceed budget |
| Installed Native | 8 roots PASS; 3 explicit new histories; source/Fit/Back and individual-size recovery PASS |

mkTbIM2PCoreMatrix and mkTbIM2PCoreMultiwidth remain limited by the individual generated-bundle budget. New history cannot bypass it.

Generated data uses an explicit **64 MiB expanded JSON / 16 MiB final frozen V8 serialization** budget, retaining depth/node limits and reserving seal overhead. External/untrusted JSON stays at **16 MiB**. Complete claims/ranges/IDs and public format remain unchanged. V8 size is a runtime measurement, not a content hash or whole worker-envelope size ([Node documentation](https://raw.githubusercontent.com/nodejs/node/v24.x/doc/api/v8.md)).

Prepared history remains **8 entries / 64 MiB**. A new-history candidate must fit by itself. Old authority is released at commit; ACK-pending navigation/input replacement is gated and source changes coalesce until afterward. Precommit failure restores prior state; committed-but-unsaved state remains displayed with a warning. [Independent transaction review](../../../.build/hardware/runs/g6-history-terminal-review-Xz8Frz/g6/review.json).

Source/hardware membership, G4 routing invariants and G5 incomplete-origin boundaries remain. Synthetic tests are not compiler captures. LSP freshness checks timed out; syntax, executable regressions and installed Native checks are recorded. Generic implementation join, full typeclass inference, large RTL/cone coverage, remote/virtual and other OS support were not expanded.

## E. Delivery and short usage

In Extensions → … → **Install from VSIX…**, choose the final VSIX, then run **Developer: Reload Window**. Open the BSV workspace and run **BSV Lens: Open Hardware Schematic (Experimental)**. Choose a design; no source-directory, manifest or compiler setup is required. Click a block to enter, select storage/connection for code, and use Fit selection for local detail. When history fills, click **Open … in a new history**; the explanation states Back/Forward replacement. Existing Architecture/Source commands remain available.

Source/review ZIPs are **scoped repair packages**, named bsv-lens-hardware-g6-typeclass-3cba1c6f429c1029-source.zip and …-review.zip. They contain common runtime bytes, self-contained synthetic core regressions, measurement/reproduction tools and indexed current evidence. Fresh extraction and outer CRC/SHA receipts accompany them. They do not replace or weaken earlier full G6 shipped/core replay, optional historical companions or required 14-author-companion contracts. Full historical archives stay unchanged. Native replay additionally needs the recorded VS Code/observer tooling and actual workspace; portable core replay requires neither compiler nor historical ZIP.

Final artifact receipts beside the ZIPs record fresh extraction and hashes without circular self-hashing.

## F. End state

- Duplicate-definition defect: **FIXED**.
- Supported Native user paths / typography / geometry / query regressions: **PASS in recorded scope**.
- All workspace inputs: **64 loaded, 2 large TBs limited**, not silently passed.
- User visual/design acceptance: **PENDING**.
- Live compiler, remote/virtual, other OS: **NOT RUN / not newly claimed**.
- G7: **NOT STARTED**.
- Production default replacement; commit/push/merge/version/tag/release: **NOT PERFORMED**.
