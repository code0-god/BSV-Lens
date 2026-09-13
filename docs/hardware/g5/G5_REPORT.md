# G5 Hardware / Code Analysis report

Implementation, real-browser regression acceptance and fresh review/source archive replay pass for the declared captured A/B/C scope. Human visual/design acceptance remains PENDING; an inherited overview-title readability defect is recorded below.

## A. Baseline and change scope

- Branch: feat/hardware-schematic. HEAD and locally recorded origin/main: c6b9a5c642d105ad4117535c1d85366f1c02ec1c. Both package versions remain 0.4.1.
- Git HEAD is not the feature content identity: the working tree includes the existing uncommitted G2-G4 implementation and the G5 increment.
- Delivered G4 runtime identity: 7817fcefc809ac050cdd71ff4aa037824033e073c5c2f6a3c9cbd317c2db3601.
- Current 298-file runtime/test/tool identity in sorted path order: e6d7404f107482d3ac45fe39797379a92ea40958b72a90236fa5390461767c6d. Archive receipts hash their extraction traversal order as 6aaa9c9cd270a038aa9237bfdecd41c418a4cbeef631c336fe30ee4e7cadebcf. All 298 path/size/SHA records are identical after path sorting; the two hashes describe different list orders, not different file bytes. Forty runtime/test/tool files are new relative to the 258-file G4 delivery.
- Latest preservation rehashed all 6,636 baseline files: 6,625 unchanged; ten product/document paths changed, plus the session-start `.gitignore` addition for local `.omx/` state. Every historical fixture, compiler capture, evidence file, ZIP and receipt in that baseline is unchanged.
- [Portable evidence index](../evidence/g5/run-zAkL5y/index.json) contains 277 hash/size-checked files, 12 actual CLI queries, 25 PNG captures and the real Chrome trace. [Baseline](../evidence/g5/run-zAkL5y/baseline.json) and [preservation receipt](../evidence/g5/run-zAkL5y/checks/preservation/receipt.json) retain the complete inventory and changes.

Modified pre-existing files:

- docs/hardware/IMPLEMENTATION_PLAN.md
- experiments/hardware/g4/index.html
- experiments/hardware/g4/package.js
- experiments/hardware/g4/server.js
- media/hardware-inspector.js
- media/hardware-navigation.js
- media/hardware-view.js
- media/hardware.css
- src/hardware/index.js
- src/hardware/scene-query.js

New implementation ownership is src/hardware/analysis/ and media/hardware-analysis.js. Public Scene Query, the existing navigation controller, Inspector, renderer and registered G4 experimental host remain the integration owners. G5 tools and tests are listed in the runtime inventory in each delivery receipt.

The [resume evidence index](../evidence/g5/run-YTGBZS/index.json) adds 69 hash/size-checked files: a fresh 25-capture Chrome run, current checks and regression receipts, independent reviews, and explicitly labeled intermediate archive results. The earlier 277-file index remains unchanged. The [current preservation receipt](../evidence/g5/run-YTGBZS/checks/preservation/receipt.json) identifies all eleven baseline differences; `.gitignore` is session metadata, not a product change.

Resumed delivery corrections are confined to `experiments/hardware/g4/package.js`, `experiments/hardware/g5/package-review.cjs`, `experiments/hardware/g5/validate-review.cjs` and `test/hardware-analysis-delivery.test.js`. The inherited G4 collector now excludes G5-owned evidence, which G5 already collects separately; its original 512 MiB test remains unchanged. G5 extraction keeps a 64 MiB per-member and 768 MiB aggregate budget, with metadata-only negative tests for both limits. Local `.omx` and `.codegraph` contents are excluded and independently rejected by validation. Initial archives reject replay-only `.build/hardware/runs/` contents; after execution, fresh test outputs in that exact directory are separately hashed while the entire original inventory, including historical `.build` evidence, is compared. No new dependency was added.

Resume corrections fixed the missing registered-source HTTP route, source reads being cancelled by Inspector disclosure/scroll updates, original source appearing after the code-selection list, and relative trace references being rejected before resolution under the permitted G5 evidence root. Independent source-oracle expectations were corrected against actual contracts: current versus hardware-fresh status, null-prototype JSON records, generic C types, unresolved method implementation joins, missing formal-token ranges and absent mkBiased contributors. No compiler result or origin claim was changed to satisfy a test.

## B. Product queries

The public entry is createAnalysisQuery/createAnalysisSession exported by src/hardware. The same query implementation serves the CLI, registered localhost HTTP host and browser.

- same-net preserves ordered/repeated seed positions, aliases, connection-local literals and verified hierarchy crossings. It never unions cell inputs/outputs or unrelated instances.
- drivers-loads separates physical leaf terminals, selected-root external contacts, hierarchy pass-through, constants, unknown directions and bidirectional contacts. Multiple candidates are not diagnosed as contention.
- dependencies performs bounded backward/forward traversal with separate same-net, data, control and hierarchy relations. Results retain edges, frontiers, scope and resource stop reasons.
- state-accesses, behavior, call-site and source-dependencies reuse the existing source model for declarations, readers/writers, predicates, signed body conditions, RHS, calls, actual/formal mappings and lexical uncertainty.
- correspondence calls unchanged G3 stock and instrumented queries. Connectivity, verified known contributors, unmapped results and unestablished complete-origin sets remain separate.
- Reveal resolves a real occurrence through Scene Query. It may explicitly broaden source-owner context; Back restores the previous source owner, actual RTL occurrence, result, code state, disclosure and viewport.

Results bind analysis/snapshot/provider/stage/source/owner/actual-occurrence identities. Invalid, stale, cancelled, unsupported, empty, partial and complete outcomes are not one success flag. A display limit is independent of query scope. Metrics/generation do not change semantic result identity.

[Query schema](G5_QUERY_SCHEMA.md) describes exact fields. [Interaction contract](G5_ANALYSIS_UX.md) describes actions and history. Registered source reads use /api/source; the host still rejects foreign Host/Origin, non-GET requests, oversized or hostile JSON, foreign builds/references, altered ranges and paths. Browser file paths grant no filesystem authority.

Reproduce the indexed public queries and source opening after extraction:

```bash
node --no-global-search-paths experiments/hardware/g5/delivery-replay.cjs --replay
```

Start the actual preview surface, with installed browser-test dependencies used only for browser QA:

```bash
node experiments/hardware/g4/server.js
node experiments/hardware/g5/run.cjs browser node experiments/hardware/g5/browser.cjs
```

## C. Supported semantics

Profile: yosys-0.68-structural-v1. Supported combinational types are $add, $sub, $eq, $ne, $lt, $logic_and, $logic_or, $logic_not, $mux and $pmux. The exact parameter sets, width/sign rules, pinned official bytes and observed variants are in [G5_CELL_SEMANTICS](G5_CELL_SEMANTICS.md).

Arithmetic uses a conservative all-operand-bit dependency per output, including four-state poisoning. Comparisons/logical operations affect their Boolean output bit; upper output bits do not gain false dependencies. Mux data is positional; select operands are control. No x/z or constant branch pruning, active-path, timing, simulation or source-cause claim is made.

$dff is a recognized state boundary, not a combinational transfer. Other registers/latches, memory, blackboxes, unsupported types/parameters/directions, scope, cycles and resource limits have explicit stopping records. Unknown cells have no generic all-input-to-all-output fallback. No general memory model, sequential traversal, compiler exporter or scheduling compiler was added.

The independent reference exercised 101 small domains, 104,432 assignments, 1,049,076 transitions and 1,153,508 evaluations; it witnessed 565 required dependencies and rejected 514 mutations. Larger pmux cases are targeted rather than falsely called exhaustive. These are independent-reference executions, not a new native compiler/simulator run.

## D. Actual A/B/C journeys

Every browser journey records the exact seed, snapshot/provider/stage, source owner, actual occurrence, query scope, result, history, viewport, DOM path and canonical membership in the [browser receipt](../evidence/g5/run-zAkL5y/browser/receipt.json). Each CLI request/result/command receipt is separately indexed under queries/.

### A: connections, storage and partial contributors

J01-J02 enter mkConnected.left, select get and open its stock 8-bit result port. Positions 0 through 7 each retain hierarchy crossings, a driver and loads. J04-J05 hit-test a real wire, check its canonical Inspector identity, preserve the repeated order [0,2,1,2], then select the positional slice [1,3).

J06 checks the Q-side sequential stop, then actual $add backward data dependencies. J07 checks forward consumers and the sequential boundary. J08 opens put's exact state update through the registered read-only source HTTP path while a deliberately held response survives an Inspector disclosure update. J09 follows actual RHS/call data. J10 opens the verified RHS contributor in the instrumented occurrence, analyzes a real pin, and restores contributor and BSV code frames through Back.

J03 independently exercises distinct RTL root/left/right visits and Up. J11-J13 hold real responses across provider changes, newer seeds, hierarchy navigation and Back, then verify duplicate-query history suppression. Stock connectivity never becomes an origin claim.

### B: control without invented origins

The actual count/phase source model remains analyzable. The increment predicate is count < 8 and its original update is count <= count + 2. Compiler scheduling remains not attached rather than no constraints. The browser analyzes a real $add in the dense 26-cell RTL scene; explicit Fit leaves the selected logic visible. [Code](../evidence/g5/run-zAkL5y/browser/B-code.png) and [dependency view](../evidence/g5/run-zAkL5y/browser/B-dependencies.png) are captured. Zero attached B origin claims do not disable source analysis.

### C: reuse, width and inlining

The actual narrow/wide source owners remain mkReuse.narrow.implementation and mkReuse.wide.implementation, while their retained RTL paths are mkReuse/narrow and mkReuse/wide. The real result vectors have 8 and 12 bits respectively. Generic source types remain generic; they are not rewritten into fabricated formal specialization metadata.

J14 reveals an off-scene instrumented parent result through the authoritative resolver and restores the exact previous frame. Stock/instrumented snapshots are not mixed. Original mkWidth storage/RHS contributors remain partial; mkBiased RHS claims remain absent. Synthetic helper, Unicode, shadowing, reassignment and branch-merge checks are labeled source-only and are not claimed as A/B/C compiler evidence.

## E. Verification

| Check | Observed result | Evidence |
| --- | --- | --- |
| Current default suite | 586 passed, 0 failed; final strengthened delivery checks 8/8 | [Full receipt](../evidence/g5/run-YTGBZS/checks/final-full/receipt.json), [delivery receipt](../evidence/g5/run-YTGBZS/checks/delivery-final/receipt.json) |
| Independent G5 source integration | 7 cases, 57 public source queries, 8 rejected mutations, 8 preserved documents | [Source evidence](../evidence/g5/run-zAkL5y/checks/source/source-integration-evidence.json) |
| Source HTTP and source navigation | 6 passed | [Receipt](../evidence/g5/run-zAkL5y/checks/http/receipt.json) |
| Final Inspector/projection regression | 12 passed | [Receipt](../evidence/g5/run-zAkL5y/checks/inspector/receipt.json) |
| Unmodified F1/F2 and geometry regressions | 18 passed | [Receipt](../evidence/g5/run-zAkL5y/checks/f1f2/receipt.json) |
| Actual canonical geometry corpus | 58 size cases valid, no concurrent runtime edits | [Oracle output](../evidence/g5/run-zAkL5y/checks/geometry/geometry-oracle.json) |
| Fresh real Chrome | J01-J15 passed, 25 actual PNGs, no page errors | [Browser receipt](../evidence/g5/run-YTGBZS/browser/receipt.json) |
| Independent visual review | Both reviewers directly inspected all 25 captures; G5 regression PASS; inherited full visual contract REVISE | [Review record](../evidence/g5/run-YTGBZS/reviews.json) |
| Unchanged electrical highlight pixels | J05 dimensions match, diff ratio 0, similarity 100; all 25 PNGs byte-identical to prior baseline | [Image comparison](../evidence/g5/run-YTGBZS/checks/visual-diff/stdout.log) and review record |
| Static checks / UI detector | Exit 0; detector returned no findings | [Checker](../evidence/g5/run-zAkL5y/checks/check/receipt.json), [detector](../evidence/g5/run-zAkL5y/checks/detector/stdout.log) |
| Historical input preservation | 6,636 checked, 6,625 unchanged, 10 product/document changes plus session `.gitignore`; protected evidence unchanged | [Receipt](../evidence/g5/run-YTGBZS/checks/preservation/receipt.json) |
| Fresh review/source extraction | PASS: 287 commands, 286 tests, 12 public queries per archive; complete original inventory unchanged; 8 generated outputs separately hashed | Author checkpoint `.build/hardware/runs/g5-package-review-YRlLPa/g5/summary.json`; final archive-specific raw commands and hashes are in adjacent `.zip.validation.json` receipts |
| Independent archive audit | PASS after replay-output separation and complete original-inventory comparison | [Review record](../evidence/g5/run-YTGBZS/reviews.json) |

[Validation matrix](G5_VALIDATION_MATRIX.md) maps Q01-Q08, D01-D08, S01-S08, X01-X06, J01-J15 and A01-A15 to these executable checks. Negative inputs and oracle mutations remain runnable tests, not prose assertions. Original G2/G3/G4 regressions remain part of the default/offline delivery lanes.

The original browser trace is 42,805,465 bytes with SHA256 94efb03e2bc27f55a1ed4617becf42187d6f1bbe9e4bcb24d9b4c4d6678bd5d1. The fresh trace is 42,736,559 bytes; its exact SHA256 is recorded in the resume index. Only exact indexed G5 run-*/browser/trace.zip paths may pass the archive filter. Every indexed attachment is checked by size/hash before packing and after extracted execution.

The successful checkpoint extracted review and source ZIPs into distinct empty external directories with runtime-only PATH, empty HOME, no node_modules/global module lookup, and no author-workspace symlinks. Both produced identical ordered public results, verified worker cancellation, and retained the expected explicit failure for exactly fourteen unavailable author companions. Failed intermediate receipts remain labeled historical observations in the resume index; they are not the final archive verdict. Final publication repeats the full checkpoint against the report-bearing bytes, then exclusively links the validated files into `dist/` without replacing earlier artifacts.

## F. Performance and limits

Recorded host: Node v26.7.0, darwin arm64, Apple M5 Pro, 18 CPUs, 48 GiB RAM. The [performance run](../evidence/g5/run-zAkL5y/checks/performance/performance.json) measured 12 actual queries, 359.923 ms catalog preparation, and 3.053/3.733/4.519 ms A/B/C BSV layout samples. Process maximum RSS was 378,192 KiB; this is process RSS, not per-query peak memory.

Cancellation observed ready, worker exit, then settlement: 0.539 ms to exit and 1.091 ms to settle. The previous valid result remained identical. The real-browser run records 86 action/display timings, 21.490-792.173 ms; hierarchy transitions and HTTP/worker startup are included, so these are not isolated query microbenchmarks. Per-query preparation, execution, worker startup, visited counts and response sizes are retained in the individual result files.

Defaults are 4,096 bits, 8,192 pins, 512 cells, 16,384 edges, hierarchy depth 64, result size 4 MiB and deadline 30 seconds; callers may lower them. Query limits do not delete canonical data. Display paging/hidden references remain separate from these budgets.

Known limitations: no complete origin sets, no origin expansion, unestablished generic method implementation joins stay null, formal parameters expose existing names/types rather than standalone formal-token ranges, and unresolved lexical/branch/specialization cases stay explicit. The read-only source drawer is not native VS Code editor integration. Live compiler, native installed VSIX, remote-platform and large-design certification were NOT RUN. Fresh LSP diagnostics succeeded on the G4 collector and delivery test, but the two G5 packaging CJS files subsequently timed out after 3000 ms; executed syntax/check/tests and actual archive replay provide fallback evidence. No type or test failure was suppressed.

Independent visual review found an inherited G4 contract shortfall: at Fit/overview scale, some canvas titles render around 4.13px at 420px width and approximately 6px high in J11, below `docs/hardware/g4/DESIGN.md:91`'s 9px minimum. The same pixels exist in the prior regression baseline; the resumed task does not change renderer/CSS. Controls, selected diagrams and source excerpts remain usable, but this report does not claim full visual-contract acceptance. CJK UI coverage was not exercised. Human visual/design acceptance remains PENDING.

## G. Exit state

- G5-0: COMPLETE in declared scope.
- G5-A: COMPLETE in declared scope.
- G5-B: COMPLETE in declared semantics profile.
- G5-C: COMPLETE in declared source capability.
- G5-D: COMPLETE for functional verification and reproducible delivery; full inherited visual-contract acceptance remains open as described above.
- User visual/design acceptance: PENDING.
- G6/G7: NOT STARTED.
- Production default replacement: NOT PERFORMED.
- Commit/push/merge: NOT PERFORMED.
- Version change: NOT PERFORMED.
- Tag/Release/Marketplace publish: NOT PERFORMED.

Final names are bsv-lens-hardware-g5-review.zip and bsv-lens-hardware-g5-source.zip. Their own SHA256 files and .zip.validation.json receipts belong outside the archives. A passing shipped/core replay never substitutes for the author-preservation check: the existing fourteen unavailable companions must still fail explicitly.
