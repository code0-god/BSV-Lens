# G0 - Existing BSV Lens audit

Date: 2026-09-06. Scope: the existing source-derived product, not a hardware implementation. **G0 defects remain in production.** This report and the isolated reproduction harness are the only authored changes in this audit's owned paths.

## Outcome

The repeated Focus/entry, breadcrumb residual focus, header/scene mismatch, occurrence-parent dimming, null/composite/unknown payload labeling, and final member-count defects reproduce at `c6b9a5c`. The fabricated constant-return delegation does **not** reproduce: it was already fixed before this audit. Root/child occurrence entry and canonical hidden-implementation tracing also work in the exercised cases. Build mismatch reporting works when both identities arrive, but refresh drops host build information and a missing host can be displayed as a match.

The right migration is to **keep Source IR and source/code queries as evidence providers, isolate source-derived semantic inference, and give compiled hardware, correspondence, scenes, and navigation separate ownership**. Existing presentation `nodes/edges` cannot become netlist truth.

## Baseline, inputs, and limits of verification

- Local HEAD and end HEAD: `c6b9a5c642d105ad4117535c1d85366f1c02ec1c`; branch `feat/hardware-schematic`; package `0.4.1`; identity `code0-god.bsv-lens`; namespace `bsvArchitecture.*` unchanged.
- Clean baseline, remote/main equality, and main CI `33977415375` success were supplied by the lead's verified handoff. This child independently checked local HEAD/branch/version and runtime artifact bytes, not that remote CI run. The shared working tree now contains the lead's other G1 documents/experiments as well as this audit; none was reset, stashed, committed, pushed, or versioned here.
- Read the complete 999-line hardware master prompt, including sections 05 and 32; read project architecture/design, packaging/CI, relevant source/tests, graphify and frontend-audit skills.
- Runtime: macOS arm64, Node `v26.7.0`, Chrome `152.0.7977.82`; CI is configured for Node 22/Linux. This is local Chrome evidence, not native editor or remote-host acceptance.
- Browser runs use the unchanged production HTML/CSP/scripts/styles through `scripts/preview-webview.js`, a real loopback server and pointer interactions. Only the VS Code message host is simulated. Fresh source fixtures use the real parser and model builder. Nothing here is compiler integration evidence.
- New fixtures are source-analysis counterexamples, including intentional unresolved interfaces/vendor definitions. No production source, user profile, global tool configuration, or external fixture source was changed.
- No new VSIX was built or installed: packaging would regenerate `media/build-metadata.js`. The existing VSIX was independently verified read-only. An installed-directory match does not prove which version a running VS Code process activated.

## Reproduce and inspect the evidence

From the repository root:

```sh
node experiments/hardware/g0/run.cjs
python3 experiments/hardware/g0/inventory.py
node scripts/verify-package.js
node --check experiments/hardware/g0/run.cjs
node scripts/check.js
npm test
node --test test/navigation.test.js test/state-filter-visibility.test.js test/semantic-delegation.test.js test/semantic-query.test.js test/source-revision.test.js test/panel-sync.test.js test/build-info.test.js test/source-resolution.test.js test/semantic-protocols.test.js
```

Prerequisites and isolated-host details are in `experiments/hardware/g0/README.md`. `run.cjs` exits zero only if all expected failures still fail and all fixed/working cases pass. `EXPECTED-FAILURE` is not a skipped test: `results.json` stores the actual failing assertion and stack. Unexpected passes and errors fail the harness. It is outside `test/*.test.js`; the default suite is not deliberately left red. There are no fixed sleeps or polling loops; subscriptions precede actions and have bounded failure timeouts.

Evidence under `.build/hardware/g0/`:

| Evidence | What it establishes |
| --- | --- |
| `baseline.json` | Local commit/branch, runtime versions, host/installed identity, pinned source fingerprint |
| `identity.json` | ZIP hashes/member manifests, missing archives, VSIX CRC, per-file installed/checkout equality |
| `results.json`, `run.log` | Individual assertions, values, fixed-vs-reproduced status; no unexpected results |
| `browser-runtime.json` | Named interaction snapshots with history, subject, effective filter, DOM IDs, labels, counts, and page errors |
| `parent-dimming.png`, `count-mismatch.png`, `breadcrumb-mismatch.png` | Visually inspected actual renderer output for the navigation/count defects |
| `composite-null-payload.png`, `unknown-payload.png` | Visually inspected contradictory payload details |
| `delegation-model.json`, `payload-model.json` | Actual source-derived canonical facts behind the counterexamples |
| `related-tests.log`, `default-tests.log`, `package-verification.log`, `check.log` | Related/default validators and read-only package verification |
| `pinned-fixture.json` | Existing integration source revision/fingerprint and two independent root declarations |
| `graphify.log`, `graphify-query.txt`, `graphify-diagnostics.json` | Local AST extraction/query and its explicitly limited integrity |
| `design-detector.json` | Existing canvas-background advisory; triaged below |

## G0 defect table

Paths/lines below refer to the unchanged baseline. A row's expectation belongs to future gates, not a repair made during G0.

| Case and severity | Status and actual reproduction | Causal path and location | Expected outcome; new owner |
| --- | --- | --- | --- |
| G0-01, P1: identical Focus | **Reproduced**: double-click `scheduler`; click `Set as focus` twice. Back history grows on both clicks. `G0-01-repeated-focus` compares consecutive lengths; Back then restores the same occurrence path (`G0-01-back-revisits-same-scene`). | Inspector button `media/webview.js:1625` -> `setFocus:2289` -> `media/navigation.js:199` -> `transition:183` -> `applyCandidate:169`. Any accepted `history:true` pushes a snapshot; no semantic-state equality check. | Same scene/target is a no-op; Back reaches a distinct scene. Navigation transaction controller owns deduplication and snapshot comparison. |
| G0-01, P1: literal behavior Focus | **Reproduced separately**: enter `scheduler`, expand Methods, select `currentWork`, click the literal `Focus` button twice. Behavior level, selection and occurrence path stay the same while history grows (`G0-01-repeated-behavior-focus`). This is distinct from `Set as focus`. | `webview.js:2237-2238` -> `navigation.js:245-260` -> unconditional `applyCandidate:169`. | Same behavior scene is a no-op. The navigation controller deduplicates both activation routes. |
| G0-01, P1: identical entry | **Reproduced independently**: enter `scheduler`, then click `Enter scheduler` again; history grows despite already being inside that occurrence. | `webview.js:2214,2236` -> `navigation.js:210` -> unconditional history append at `169-175`. | Current-shell activation is inspect/no-op; hierarchy entry is deduplicated by occurrence and transition identity. Navigation controller, not click timing. |
| G0-02, P1: breadcrumb retains method filter | **Reproduced**: expand Methods, select `currentWork`, Set as focus, switch Data Flow, click `mkFlowTop` breadcrumb. `focusStack` becomes the root but `projectionFocusId` remains the scheduler method ID. History length is unchanged by ascent. | `webview.js:1329` -> `navigation.js:347-354`: candidate changes only path/selection, records `false`; `candidateFor:157` clones every other field including `projectionFocusId`. | Ascent clears method/source/cone filters outside the new scene, records the prior scene, and supports Back to it. Navigation controller owns hierarchy/history separation. |
| G0-03, P1: header and scene disagree | **Reproduced**: after that breadcrumb, header says `Focus: mkFlowTop`; actual DOM has only `currentWork` plus scheduler member groups; selection is cleared. | `navigationProjectionIsValid`, `webview.js:369`, validates `Graph.visible()` using `focusStack`. `deriveVisibleGraph:637-659` instead passes `projectionFocusId` first; `updateHeader:2928-2937` reads only `focusStack`. `render:560-564` then clears the root selection absent from the final graph. | Validate exactly the scene that is committed, then derive header/breadcrumb/selection from that scene. SceneProjector + atomic navigation commit own consistency. |
| G0-04, P1: entering parent dims its contents | **Reproduced**: fresh `scheduler` entry leaves all five visible channel children `selection-dimmed`; trace/search are empty. Screenshot confirms severely reduced contrast. | `enterInstance` selects the parent. `Graph.moduleStructureEdges`, `media/graph-view.js:1266`, inserts group intermediates. `applySelectionHighlight`, `webview.js:2826-2875`, highlights one-hop neighbors; the direct-child exception at `2848` applies only to `kind === 'module'`, not `architectureInstance` nodes (`kind:'instance'`). | Normal contrast inside the current occurrence. Inspection selection is not a cone filter. Scene selection/highlight policy owns containment-aware emphasis; renderer only applies styles. |
| G0-05a, P1: null composite becomes absent/control | **Reproduced** with `payload.bsv`: request `Bit#(8)` and response `Bit#(16)` exist in canonical nested endpoints; channel direction is `request-response`, scalar `payloadType:null`. Inspector says `No payload`; both subinterface members say `control`. Failing assertion compares displayed payload field to actual HDL types, not explanatory prose. | `semantic/protocol-channels.js:69-90` deliberately creates a composite with null scalar; `media/semantic-query.js:57` returns only immediate subinterface members; `webview.js:1701,1710-1712` uses falsy fallbacks instead of traversing typed legs. | Composite payload with distinct request/response legs; never collapse an unavailable scalar into absence. Source semantic metadata provider supplies tagged payload states; inspector consumes them. Hardware port bundles use verified correspondence, not inferred channel wiring. |
| G0-05b, P1: unknown payload becomes absent | **Reproduced separately** with `unknown.bsv`: `VendorIfc opaque` is an unresolved subinterface (`interfaceDefinitionId:null`); Inspector still says `No payload`. | `semantic/endpoints.js:107-116` preserves unresolved interface type; `webview.js:1765` ignores kind/resolution and falls through from missing result/parameters to absence. | Show unknown payload for the unresolved `VendorIfc` contract, not zero payload. Source evidence/query DTO owns unknown/composite/absent distinction; inspector formats it. |
| G0-06, P1: final visibility count lies | **Reproduced** in the `currentWork` Data Flow scene: Methods reports **12 visible, 1 actually present**; Protocol Channels **5 vs 0**; Ungrouped Endpoints **1 vs 0**. DOM IDs are compared to each group's source membership. | `graph-view.js:memberBuckets` (`978-1046`) computes `visibleCount` before focus/scoping; `moduleLevelNodes:1221` copies it into groups. `visible:1110-1164` then removes members by neighborhood but retains all synthetic groups; `webview.js:637` adds another filtering stage. Counts are never recomputed after final membership. | Counts derive from final Scene object membership; canonical totals and collapsed/hidden counts remain separate. SceneProjector owns counts, renderer does not reconstruct truth. |
| G0-07, P0 regression risk: fabricated delegation | **Preexisting fixed / not reproduced**: `delegation.bsv` returns literal `42`; proxy has zero behavior-access bindings and zero incoming returns, while one exact constructor binding and the real implementation-return link remain. Model contains no invented `return upstream.value;`. | Parser actual access extraction -> `semantic/behavior-bindings.js:25-33` iterates only actual callable accesses. Formal-to-actual context at `20-24` resolves accesses that exist; no same-method-name delegation fallback remains. `semantic-flow.js:22-45` can emit returns only from supplied access bindings. | Preserve this negative regression and actual source slices. SourceAnalysisProvider and CorrespondenceBuilder must never create call/net evidence from matching names or compatible types. |

Additional payload boundary: true ack-only channels also legitimately carry a null scalar (`protocol-channels.js:61-64`; existing `Done` fixture test). Therefore changing every null to one different string is not a fix. The owning schema must encode absent, unknown, and composite separately.

## Master section 32 regression seams

| Section 32 requirement | Existing seam and audit result | Carry into new design |
| --- | --- | --- |
| 1 repeated focus/entry | `test/navigation.test.js` tests snapshot restore, but not idempotence. G0-01 expected failures reproduce through real buttons. | Keep ordinary snapshot tests; add transaction identity/no-op guarantees. |
| 2 parent breadcrumb | Existing navigation tests omit residual projection focus/history behavior. G0-02 reproduces both. | Up/breadcrumb must commit one coherent scene and a reversible history entry. |
| 3 header/root/selection | Validation and rendering use different focus sources. G0-03 reproduces root selection disappearing. | One immutable committed scene supplies all UI context. |
| 4 leaf/black box | **Not reproduced in exercised cases**: `loose` unresolved implementation enters a valid endpoint scene; isolated `mkVendor` missing-definition occurrence stays visible as a single unresolved block. This does not prove compiled black-box port fidelity. | Preserve explicit unresolved detail, never fabricate interiors. Test real compiled black boxes in hardware gates. |
| 5 null/unknown/composite | G0-05a/b reproduce independently with real parsed source. Existing protocol tests already preserve null composite semantics but do not exercise Inspector output. | Tagged payload/port-bundle status; separate source interface facts from hardware pin facts. |
| 6 final visible count | Existing `state-filter-visibility.test.js` **passes**: primitive filter off/on yields 0/7 correctly. It covers early primitive filtering, not late focus/scoping. G0-06 remains. | Final-scene denominator and membership assertions; do not retire existing early-filter test. |
| 7 fabricated calls | Existing `semantic-delegation.test.js` passes real/constant/multiple-formal/inline/malformed cases. G0-07 independently proves literal-42 behavior. Older ZIP evidence is not a present regression. | Retain negatives before importer/correspondence work. |
| 8 hidden implementation links | **Working at canonical query seam**: `S32-08-hidden-implementation-trace` sees zero presentation edges for a real implementation link yet `traceSemanticFlow({kinds:['return']})` returns its exact flow ID. Default query is payload-only (`semantic-query.js:8`); the general UI trace path at `webview.js:2681` does not explicitly request return/invoke. | Canonical query remains independent of visibility. Expose relation-family selection for source explanation; do not count calls as hardware nets. No claim that every existing UI trace button reveals every relation family. |
| 9 definition/occurrence | **Preexisting fixed in root/child entry**: root and scheduler double-clicks retain `instance:` paths and nonempty scenes. `navigation.js:210`, `webview.js:2236` now enter occurrences, not `details.targetId`. `source-resolution.js:35-58` still intentionally supports secondary definition views. | Keep explicit source-only definition mode; no accidental fallback from compiled occurrence to legacy source graph. |
| 10 mixed builds | **Partial existing fix, current hole reproduced**: mismatched supplied host/webview IDs produce `data-status:mismatch`. `ArchitecturePanel.refresh` (`architecture-panel.js:185`) omits `buildInfo`, unlike `ready` (`249`). Browser receiving a subsequent model without host identity reports `matched` (`webview.js:420-427`). `S32-10-*` stores both host envelopes and browser statuses. | Host envelope always includes build/snapshot identity; missing is unknown, not matched. Runtime fingerprints and HDL BuildSnapshot are separate identities. |

## Traced architecture and disposition

`WorkspaceAnalyzer.analyze -> parseBsvFile -> buildArchitectureModel -> buildSemanticModel -> projectSemanticModel -> ArchitecturePanel -> GraphViewModel/semantic queries -> navigation candidate -> webview final projection -> layout -> SVG/inspector`. Source echo follows the reverse evidence path, not geometry.

| Disposition | Existing code and responsibility | Boundary/causal observations | New owning layer |
| --- | --- | --- | --- |
| **Keep, with explicit source scope** | `src/architecture/parser.js:61-151`, `source-utils.js`; `semantic/definitions.js:11-76` | Masked declaration discovery preserves positions. Source document content and SHA-256 revision are retained; definitions preserve module formals, methods, instances, interfaces. This is not preprocessing/elaboration. | SourceAnalysisProvider / SourceModel. Preserve incomplete parse diagnostics and original documents. |
| **Keep/modify** | `src/architecture/code-analysis.js:10-32,153-208,230-331`; `behavior-analysis.js:49-80,209-259` | Statements/expressions/calls/environments retain source ranges, source revision, actual text, branch conditions and assignment RHS. Primitive method-name maps classify source behavior, not cell/pin semantics. Operators and grammar are intentionally bounded. | Source/code query provider. Broaden parsing only with evidence; do not reuse source operators as artifact cells. |
| **Isolate** | `semantic/model.js:30-133`, `instances.js:8-129,133-185`, `constructor-bindings.js:7-51`, `endpoints.js:12-155` | Source occurrences are synthetic root projections and bounded source expansion. Definition/occurrence are distinct, constructor binding resolves sibling identifiers, unresolved formals remain metadata. No compiler instance identity or concrete specialization proof. | SourceModel occurrence context; BscEvidenceProvider supplies separate elaborated evidence. HardwareArtifactProvider owns implementation occurrences. |
| **Keep/modify** | `semantic/indexes.js:3-86`; `media/semantic-query.js:10-145,199-265,461-516` | Host indexes are non-enumerable; browser rebuilds from serialized canonical arrays. Queries read canonical flow/model, not display edges; several composition/flow operations still scan full arrays. | Source query service remains reusable. HardwareQueryService gets pin/net/occurrence indexes and snapshot-scoped limits; no renderer-derived query results. |
| **Keep/modify** | `semantic/source-references.js:5-85,257-303,342-351`; `symbol-index.js:16-40`; `media/source-resolution.js:17-85` | Canonical references index definitions and occurrence presentations; ambiguity is preserved rather than picking first match. Semantic range containment uses exclusive ends. The legacy smallest-node helper uses inclusive end (`symbol-index.js:49`). Current reference keys do not include a build snapshot. | CorrespondenceBuilder + SourceResolutionService with hashed documents and explicit offset conventions. Normalize legacy range boundaries when migrating, not in G0. |
| **Keep negative guarantees; isolate inference** | `semantic/behavior-bindings.js:7-81`, `semantic/semantic-flow.js:8-97,172-213`, `semantic/provenance.js:3-72` | Actual access/constructor evidence produces potential source transfer relations. Payload combines producer/consumer snippets with separate evidence refs. `exact` may mean name/type/source resolution; it is not exact physical connectivity. Provenance fallback locations are representative, not new declarations. | Source evidence graph and correspondence inputs. Separate structure fidelity, source mapping, heuristic grouping and staleness rather than one confidence string. |
| **Isolate/modify** | `semantic/protocol-channels.js:8-90`, `semantic/boundaries.js`; `media/semantic-query.js:57-64` | Method conventions and sibling names create helpful source summaries. Composite payload is null; it is not absent. These channels must not become the primary hardware objects. | Optional source/interface metadata with tagged payload legs; verified correspondence may explain real port bundles. |
| **Keep/modify provider** | `src/compiler/bsc-schedule-provider.js:26-96,195-298,413-426,493-533`; `analyzer.js:175-238` | Report-first, trust gating, help capability probe, argv execution, temporary output and cancellation exist. Temp reports are removed after reading; some cleanup/read errors are swallowed. Spawn cancellation resolves immediately after SIGTERM, not after confirmed descendant termination. Schedule availability is not hardware import or source mapping completeness. | BscEvidenceProvider + process/snapshot owner. Preserve report bytes/tool/version/hash and confirm process lifecycle; keep source scheduling distinct. |
| **Isolate** | `src/architecture/graph-builder.js:10-17,462-532`; `semantic/projection.js:8-181` | Builds legacy graph and canonical source model, appends occurrence projection, then applies graph limits. Implementation links deliberately omitted from presentation (`projection.js:30,85`), payload also aggregated to owner edges. Canonical and display multiplicities differ by design. | Legacy/source preview adapter and exports; a separate Hardware IR must not inherit these display budgets or edge aggregation rules. |
| **Modify, retire duplicated responsibility** | `media/navigation.js:9-14,169-219,245-260,347-375`; `webview.js:369-387,637-709` | Snapshot state includes viewport, trace, filters and analysis context, but no hardware snapshot/stage; history push lacks equality; semantic-parent hidden snapshot alters Back; candidate validation differs from final scene. | One snapshot-aware navigation controller and SceneProjector. Retire hidden semantic-parent Back rules and residual `projectionFocusId` coupling in hardware mode. |
| **Keep renderer technology candidate; replace scene semantics** | `media/graph-view.js:95-155,978-1046,1110-1383`; `webview-layout.js:10-29,32-144`; `webview.js:556-735,1015-1095,2826-2875` | Indexed graph, deterministic module grouping/forest/rank/SCC layout, SVG accessibility and theme tokens are useful. Module bus is group containment, ports are node glyph circles, routes are two-terminal edges; not bit/pin/fanout/compound circuit truth. Current renderer rebuilds DOM on navigation. | Hardware SceneProjector supplies nested shells, real port anchors and net routes; layout/renderer own geometry only. Keep SVG unless G1 measurements justify a bounded change. |
| **Retire as primary hardware UX** | `webview.js:1200-1240,1622-1635,1692-1779,2199-2263` | Double-click drilling, `Focus` versus `Set as focus`, card category switching, immediate-neighbor dimming and payload falsy fallbacks implement the old analysis model. | Single-click semantic zoom with explicit inspect action; source/code/rule analysis stays secondary. Inspector consumes known/unknown/composite facts without inference. |
| **Keep security/source checks; modify transport** | `src/panel/architecture-panel.js:155-207,242-341,401-430`; `src/panel/html.js:3-23`; `src/build-info.js:6-25` | Host owns I/O, source ranges, refresh revision, source-content equality before selection, and model-owned location validation. Webview has nonce CSP/local media. Refresh/model identity omission defeats part of the existing mismatch UI. | Snapshot-bound host query/message boundary; source navigation opens immutable source or rejects stale mapping. Runtime extension identity remains distinct from HDL build identity. |
| **Keep packaging identity; isolate release operations** | `scripts/build-metadata.js:7-35`, `package-vsix.js:13-25`, `verify-package.js:16-103`; `.github/workflows/ci.yml`, `publish.yml` | Build ID hashes commit/dirty plus manifest/src/media, excluding generated metadata itself. Package verification recomputes actual VSIX digest. CI runs on pushes/PRs; publishing is tag-only after reusable CI. | Packaging/release layer, unchanged during G0/G1. Add hardware provider/schema files to verified artifact inclusion only when implemented. |

## Archive and installed identity audit

Both supplied system-code audit ZIP copies have SHA-256:

`e5210ce46284675be3bee308d051ad48f6655216be3524e4d7428eed60fc181d`

Their metadata identifies **older commit** `6587cfb98e09aaf31e3138fbe93154cf91a2e06a`, version `0.4.1`, CI `33951288467`, artifact `9964926260`. Same version is not same implementation. Read `README-audit.md`, `audit-metadata.json`, and both probe scripts after isolated extraction. The old Python probe disables CSP and uses fixed sleeps; it was not rerun or treated as current native-host evidence. The old negative semantic probe is reproduced instead with the new literal-42 fixture and the actual current code.

`bsv-lens-c6b9a5c-focus-review.zip` and `bsv-lens-c6b9a5c-independent-check.zip` were not present among the supplied Downloads ZIPs. No inaccessible material is claimed as read.

Existing `dist/bsv-lens-0.4.1.vsix` SHA-256:

`f9a9436ee518602c829ad70412dc99e5fb8aed87332a1984e427856a73fb7cef`

- ZIP CRC valid; `scripts/verify-package.js` additionally verified package identity, required files, recomputed runtime build digest, repository archive, and checksums.
- All **49 runtime files** under installed 0.4.1 `src/` and `media/` match that VSIX, and all VSIX runtime files match the checkout. This is a byte equality assertion, not merely a test count.
- Installed 0.4.1 metadata: source commit `c6b9a5c642d105ad4117535c1d85366f1c02ec1c`, `dirty:false`, build ID `sha256:7c25fcb3a57a94416100c6ffd9e5fccc6214caaf3de9c663653e4588210587d2`.
- Installed 0.4.0 directory also exists, has no `media/build-metadata.js`, and differs from the 0.4.1 VSIX on 19 of its 40 runtime files. This is expected version difference, not proof of mixed activation.
- Active installed extension selection, fresh isolated install, native editor round trip, and native-host/webview fingerprint handshake were **not rerun** in G0. Do not label packaged extension acceptance complete based on this inventory.

## Pinned external integration fixture (read-only)

CI `.github/workflows/ci.yml:18` and `scripts/aqua-fixture.js:8-9` pin revision `6692a52973fbb487a421b07fc8cd881d0542e964` and BSV source fingerprint `dae0bb0cd7cbb77857b5bac36565a40a43e4bc5d9333e275d7cf3be459767475`. The local `.build/aqua-041-pinned` is detached HEAD at that revision, clean, with 14 source files matching the fingerprint. No branch was changed.

`test/aqua-semantic-fixture.js` explicitly configures roots `mkAquaLoopMatmul` and `mkAquaMemorySubsystem`. Running that existing semantic builder produced two configured roots with `parentInstanceId:null` (`pinned-fixture.json`). They are independent source roots, not a single compiled chip or permission to invent a connecting top. No compiler or production wrapper was changed or run for G0.

Recheck command:

```sh
AQUA_WORKSPACE="$PWD/.build/aqua-041-pinned" node -e "console.log(require('./test/aqua-semantic-fixture').buildAquaSemanticModel().model.roots)"
```

## Graph, UI review, and verification qualifications

No project `graphify-out/graph.json` existed. The installed graphify CLI was used in code-only mode on an isolated copy of production JS, with four AST workers and no model API calls:

```sh
graphify extract .build/hardware/g0/graphify-input --code-only --max-workers 4 --no-cluster --out .build/hardware/g0/graphify
graphify query 'navigation focusEntity applyCandidate navigateBreadcrumb projectionFocusId' --graph .build/hardware/g0/graphify/graphify-out/graph.json --budget 1500
graphify diagnose multigraph --graph .build/hardware/g0/graphify/graphify-out/graph.json --json
```

Extraction recorded 45 code files, 1019 declared nodes and 2872 raw relations. **Integrity warning:** 18 dangling relation endpoints and 144 same-endpoint directed relation variants; query loading reports 1033 nodes after its own normalization. Graph output is corroborating navigation assistance, not an authoritative model of every call. The causal claims above were checked against actual source and runtime assertions. No clustering/semantic labeling completeness is claimed.

The frontend detector command was:

```sh
node ~/.agents/skills/impeccable/scripts/detect.mjs --json media/webview.js media/webview.css
```

It exited **2**, emitting one advisory at `media/webview.css:572` about a tiled decorative grid. Read context shows `.canvas-shell` is the actual diagram canvas with a dot background, explicitly an allowed exception in that advisory. It is **not** counted as a confirmed defect or silently suppressed. Actual screenshots confirm the dimming/count/payload findings; no numerical contrast, full accessibility, performance-tier, narrow/theme matrix or WCAG certification is claimed.

The isolated browser harness completed with no unexpected outcomes or browser exceptions. Both the related test command and `npm test` passed in one run each; the default suite reported 306 passed, zero failed/skipped. `scripts/check.js` passed its syntax, parser/model, CSP and branding checks without modifying the checker. The tests' meaningful guarantees include: literal 42 creates no delegation, real upstream accesses retain exact evidence; hidden canonical links remain queryable; source changes before/during editor opening reject old ranges; duplicate source occurrences remain ambiguous; ordinary Back/Forward restores context/viewport; early primitive filtering reports correct counts. Those guarantees coexist with the isolated expected-failure cases above.

Language-server diagnostics initially returned no diagnostics for `run.cjs`; fresh requests after later edits timed out and are **not** represented as fresh clean diagnostics. Fresh Python diagnostics for `inventory.py` are clean after fixing dictionary inference errors in the audit script. Markdown/BSV have no configured language server. `node --check` and executed harness/related validators provide syntax/runtime verification. BSV fixtures are parser inputs only. No production build/package regeneration was performed; read-only existing-package validation was used instead.

## Files authored by this audit

- `docs/hardware/G0_AUDIT.md`
- `experiments/hardware/g0/README.md`
- `experiments/hardware/g0/run.cjs`
- `experiments/hardware/g0/inventory.py`
- `experiments/hardware/g0/{delegation,payload,unknown,blackbox}.bsv`
- Generated local evidence only under `.build/hardware/g0/`.

Final `git diff --name-only` is empty for tracked files; `git status --short` reports the shared untracked `docs/hardware/` and `experiments/` trees. Other files there belong to peer/lead work, not this audit.

## Gate disposition

- **G0 audit/reproduction:** delivered, with explicit unfixed failures and ownership mapping.
- **Production navigation/UI repair:** not performed; retained for approved implementation gates.
- **Hardware artifact fidelity, compiler correspondence, semantic zoom and performance/security acceptance:** outside this G0 evidence; owned by later gates and the lead's G1 work.
- **Native packaged extension acceptance:** not established by file identity alone.
- **User visual/design acceptance:** pending. **Release authorization:** not granted; no commit/push/tag/publish/version change by this audit.
