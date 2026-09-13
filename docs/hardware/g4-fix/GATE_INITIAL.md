# G4 Correctness Follow-up: independent gate review

- recommendation: **REJECT**: one demonstrated packaging evidence-closure blocker; product/checker correctness passes.
- blockers:
  - id: B-PKG-01
    violatedCriterion: Original amended request section 20 (review ZIP includes browser captures/trace); `docs/hardware/g4-fix/CONTRACT.md#delivery` (include traces and evidence).
    observation: Both tested candidate ZIPs omit the required browser trace while shipping an index that references its exact bytes/hash.
    evidencePointer: `.build/hardware/runs/g4-fix-package-yZAo9R/{review,source}.zip` missing member `bsv-lens/docs/hardware/evidence/g4-fix/run-lopNF5/browser/trace.zip`; shipped `bsv-lens/docs/hardware/evidence/g4-fix/run-lopNF5/index.json#/files` still references it.
- goalId: G4-fix
- reviewerTask: st_01a07ed4
- reviewedFeatureIdentity: `b2b8ce6d9f7bfdcd5435bcc190fb01dc84f7b764cd76e0a10884495591f2b179`
- deliveryGate: **REJECTED CANDIDATE EVIDENCE CLOSURE**. Both current-feature isolated replay receipts pass, but neither candidate contains the required browser trace. Final filename promotion is not the blocker.
- userVisualDesignAcceptance: **PENDING**.

`omo-agent-toolkit ulw-loop status --json` returned `ULW_LOOP_PLAN_MISSING` for this reviewer session. This report therefore uses the requested fallback evidence path. No implementation, historical evidence, archive, or distribution file was edited by this reviewer. No additional reviewer was started.

## Original intent and desired outcome

originalIntent: Fix the two demonstrated G4 correctness defects without replacing the BSV-native product: actual RTL descendants under the same BSV owner must be different visits, and different canonical nets must not share positive-length segments. Preserve the existing BSV analysis roundtrip and G2/G3 truth, prove behavior through real product queries and pointer/keyboard actions, preserve historical inputs, and deliver reproducible new archives.

desiredOutcome: A user can enter RTL left/right, use actual RTL Up/breadcrumbs and exact Back/Forward restoration, and independently select the formerly colliding nets with the correct inspector identity and ordered bits. BSV remains the default; known contributors remain partial rather than complete origin sets.

The original amended request was read directly from raw transcript line 402, not the initial G4 request at line 8:
`~/.omo/agent/sessions/<workspace-session>/2026-09-07T20-40-11-380Z_01a07d99-9174-725b-81a4-76a611198152.jsonl:402`.
Its sections 3-18 and final criteria 22.1-22.15 agree with the scoped contracts inspected below. The recovered-session helper's earlier claim that line 8 was the latest substantive request is not relied upon.

## User outcome review and goal breakdown

| Goal / criterion | Verdict | Evidence and observation |
| --- | --- | --- |
| F1; N01-N07; original 22.1-22.4 | PASS | Fresh real-catalog tests distinguish root/left/right with unchanged BSV owner, including repeated RTL definitions, stock/instrumented snapshots and C 8/12-bit containing-only inlining. `media/hardware-navigation.js:21-40,259-376`; `test/hardware-navigation-context.test.js`. |
| Exact restoration, dedup, race/failure; N02/N03/N08-N10; original 22.2/22.3/22.11 | PASS | Fresh tests exercise full frame equality, selection/disclosure/viewport restoration without re-query, deferred obsolete successes/failures, cancellation, invalid geometry and stale echoes. Browser B02/B06-B08/B11 uses real actions and exact frame comparisons. |
| F2; R01-R03/R09/R10; original 22.5/22.6/22.12 | PASS | Bounded interval and escape reservation replaces modulo reuse. Fresh corpus emitted every required scene; no blocked-scene success substitution. All 58 geometry objects reproduce the recorded final corpus exactly. |
| Canonical truth; R04-R08/R11; original 22.7/22.9/22.10/22.15 | PASS | Independently compared all 29 before/after scenes: connection IDs, ordered bits, full members, memberRelationIds and aliases unchanged. Original G2/G3 runtime and inputs match the preserved archive/baseline. Interface headers are separate presentation groups; slots retain canonical contact and ordered indices. |
| Independent oracle; G01-G11/R12 | PASS | Read the complete independent geometry implementation and negative tests. It checks actual segments, incidence membership, local contact exceptions, bodies, labels, boundaries, endpoints, bounds and ownership, not `geometry.valid`. Re-executed corpus and independently revalidated stored segments. |
| Pointer/keyboard, B01-B12; original 22.8/22.13 | PASS | Hash-matching captured runtime, real-action trace, all journey records, seven wire selections, crossing chooser, fanout, keyboard and export evidence checked. Captures are not stale merely because the session resumed. |
| Scoped presentation | PASS within correctness scope | Opened A/B/C source and RTL scenes plus dark/light/narrow high-contrast captures. Dense RTL Fit is an overview requiring zoom, explicitly disclosed rather than presented as visual-design approval. BSV storage/modules and semantic dashed relations remain distinct from physical RTL. |
| Resumed branding checker fix | PASS | Re-ran the real isolated checker regression: 15 passed, zero failed/skipped. Exemption is limited to `stdout.log`/`stderr.log` under `docs/hardware/evidence/`; authored docs, source, tests, adjacent evidence-copy paths and evidence JavaScript remain rejected. Evidence JavaScript syntax failure remains rejected. |
| Repository regressions | PASS, fresh lead receipts audited | Fresh check exit 0, default suite 472/472, package guards/host/output 4/4. Portable receipts/logs match their raw run artifacts. Reviewer separately executed targeted tests, corpus and real checker as recorded below. |
| New ZIPs / fresh isolated replay; original 19/20/22.14 | Replay PASS; delivery closure FAIL | Current candidate receipts and hashes verified for both isolated replays; all 257 runtime files match workspace/archive/receipt. However both archives omit the required browser trace referenced by their shipped evidence index. B-PKG-01 is a demonstrated omission in built artifacts, not a pending filename promotion. |

No requested product correctness failure was reproduced in the supported actual corpus or inspected user journeys. A required delivery artifact is missing from both completed candidate ZIPs; see B-PKG-01.

## Independent execution and artifact audit

Commands executed once by this reviewer:

```sh
node --no-global-search-paths --test test/check.test.js
# 15 passed, 0 failed, 0 skipped; exit 0

node --no-global-search-paths --test \
  test/hardware-navigation.test.js \
  test/hardware-navigation-context.test.js \
  test/hardware-router.test.js \
  test/hardware-geometry-oracle.test.js \
  test/hardware-interaction.test.js \
  experiments/hardware/g4-fix/oracle/regressions.test.cjs
# 55 passed, 0 failed, 0 skipped; exit 0

node --no-global-search-paths scripts/check.js
# exit 0: 8 example BSV files, 141 nodes, 316 edges

git diff --check
# exit 0
```

Additional read-only Node/Python checks executed through the shell (complete commands and outputs are in this reviewer session):

- Called exported `runCorpus()` from `experiments/hardware/g4-fix/geometry-check.cjs` without its artifact-writing CLI. **58/58 PASS**, 18 RTL and 11 BSV scenes at two sizes, no concurrent runtime changes. Every fresh geometry deep-equals its counterpart in `g4-fix-geometry-oracle-corpus-Hx9CDX/geometry-oracle.json`. Independently ran `validateGeometry` over every saved scene/segment set as well.
- Compared complete canonical connection projections and aliases between `before-geometry/product-probe.json` and `after-geometry/product-probe.json` for all 29 scenes. Independently recomputed cross-owner positive-length overlap pairs: **233 -> 0**.
- Rehashed all **102** files referenced by `run-lopNF5/index.json`: zero mismatches. Of its old 256 runtime entries, only the declared `scripts/check.js` and `experiments/hardware/g4-fix/package.cjs` differ now; the added checker test is new, not a replaced historical entry.
- Rehashed all **257** runtime entries in `resume-01a07ec8/index.json`: zero mismatches. Recomputed the aggregate JSON inventory hash and obtained the reviewed feature identity above.
- Rehashed all **12** portable resume files, compared copied run receipts and output streams to their raw sources, and verified explicit empty-stream bytes/hashes. All match.
- Rehashed all **11** browser runtime inputs: zero mismatches. Rechecked B01-B12 DOM path equality and overflow records, **597** visible label bounding boxes and **254** slot positions/IDs/indices against recorded geometry. Zero findings.
- Rechecked all seven selected-wire inspector IDs, ordered raw bits and canonical bits. Parsed `actual-export.svg` directly: 16 route paths, metadata equality, complete 1848x1164 bounds, and no world viewport transform.
- Opened the Playwright trace ZIP and parsed its trace entries. It contains actual clicks, mouse down/up/move, keyboard presses, viewport/theme actions and held-response routing, not controller-only calls masquerading as pointer evidence. It contains 485 ZIP entries; counts alone were not used to judge behavior.
- Compared all **1,111** original source ZIP members to the workspace: none missing, only the 11 authorized existing-code changes differ. Rehashed the expanded **2,718** preservation entries: **2,707 unchanged**, exactly the old ten feature edits plus `scripts/check.js` changed, none missing.
- Rehashed original G4 archives: source `605c10c13026d085748f5414cf99fd5b9d9225c147e5b227d308f402bfc0aec3`; review `1253e9a4d4baaa2fb93fb4a6e409017e25a257e792319290f9f1c70e52ef9052`.
- Rehashed the frozen local F1/F2 oracle and compared its digest to the before receipt: `a11b4c9b2e93019e68900574c54e583110ae7a4c641c646f43df1719861c4ac5`, unchanged. Read original red output showing both reported failures and the preserved positive smoke output. This oracle is locally reconstructed, not the unavailable external review.

Fresh lead execution receipts inspected directly, with stdout/stderr:

- `.build/hardware/runs/g4-fix-resume-check-G70wFV/receipt.json`: exit 0.
- `.build/hardware/runs/g4-fix-resume-full-suite-OqOsol/receipt.json`: exit 0, 472 passed, zero failures/skips.
- `.build/hardware/runs/g4-fix-resume-package-regressions-3XUSIo/receipt.json`: exit 0, 4 passed, zero failures/skips.
- Portable counterparts: `docs/hardware/evidence/g4-fix/resume-01a07ec8/{check,fullSuite,packaging,preservation}/`.

Historical red failures are expected before-fix evidence, not current failing tests. `/tmp/st_01a07ece-check-QrdEf4/red.stdout.log` shows the archival log rejection, 13 passed / 2 failed including the enclosing parent test. Its portable counterpart and the green output were checked. No failure was deleted or skipped by this reviewer.

## Visual and QA audit

Opened and inspected:

- `docs/hardware/evidence/g4-fix/run-lopNF5/browser/B01.png`: actual RTL left shell, breadcrumb and inspector implementation path under BSV mkConnected.
- `.../B09.png`: selected actual RTL vector with ordered bit 29 and matching inspector identity.
- `.../B11.png`: restored BSV left analysis, source expression, partial contributor language and complete-origin-not-established status.
- `.../crossing-candidates.png`: explicit two-connection chooser with signal names and ordered bits, rather than paint-order selection.
- `.../{A,B,C}-{BSV,RTL}.png`: all six actual source/implementation scenes.
- `.../variant-1440-dark.png`, `.../variant-960-light.png`, `.../variant-420-high-contrast.png`: usable controls and retained hierarchy presentation; narrow Fit is an overview, not pin-level readability.

The evidence matrix is `browser/browser.json` plus the B01-B12 assertions in `experiments/hardware/g4-fix/browser.cjs`. The browser harness uses pointer and keyboard actions, event/state completion subscriptions and bounded rejection timeouts. Deferred query tests subscribe before triggering. No fixed timing sleep was found in the reviewed tests. Page errors are empty. Keyboard/export are separately recorded PASS. This reviewer audited the current hash-matching captures and trace rather than generating a second browser run.

The DOM audit's 0.75px tolerance is distinct from the geometry oracle's `1e-7` diagram-unit tolerance. Neither substitutes for the other.

## Direct programming and remove-ai-slops review

Loaded and consulted:

- `/opt/homebrew/lib/node_modules/omo-ai/plugin/skills/remove-ai-slops/SKILL.md`
- `/opt/homebrew/lib/node_modules/omo-ai/plugin/skills/programming/SKILL.md`

Applied their review criteria directly to the actual original-archive diff, current runtime, new tools and tests. No cleanup/refactor was authorized or performed. Existing project JavaScript/Node conventions were retained; a language/toolchain migration is not a criterion of this gate.

Coverage of the explicit overfit/slop classes:

- **Excessive/useless tests:** Checker cases exercise distinct real classification boundaries. Router, navigation, independent oracle and browser tests have different failure surfaces. Counts were corroborated by assertions, raw artifacts and independent execution.
- **Deletion-only / requested-removal-only tests:** Missing metadata and negative overlap cases test actual validator behavior. They are not prose/removal pins. Existing navigation assertions were changed to make RTL fixtures nondegenerate, not deleted to make the suite green.
- **Tautologies / implementation mirroring:** Direct-query versus controller comparison is paired with an independently identified actual child and unchanged BSV owner. Full restoration compares saved pre-action frames. Geometry validation reads final segments, and its negative tests ignore deliberately supplied `valid:true`. SVG path/segment equality is a shipped representation consistency check, not sole routing proof.
- **Prose pinning:** No new prompt/doc wording tests were found. Brand tokens are machine-consumed checker rules, and their acceptance/rejection is genuine runtime behavior.
- **Unnecessary production extraction/parsing/normalization:** Canonical visit normalization, exact G2 incidence projection, screen-coordinate hit testing and SVG serialization serve requested behavior. The checker fix adds one narrow predicate; it does not parse/rewrite captures or introduce a generalized exemption mechanism.
- **Error and boundary discipline:** Routing failures are typed by code/budget and retained atomically by navigation; superseded work cannot overwrite newer state/diagnostics. Package command failures are recorded and fail explicitly. No broad production suppression flag or test skip was introduced.
- **Scope drift:** No bundle framework, G5 surface, production UI replacement, new compiler workflow or dependency was introduced by the reviewed fix.

Nonblocking maintenance findings:

1. Several modules exceed the skills' size guidance: measured pure-line counts include navigation 417, layout 483, view 642, scene-query 347, independent oracle 362 and browser harness 417. The router also has a large nested stateful routing pass. This is real maintenance burden, but a split/refactor is not part of the stated correctness acceptance and would expand this narrowly bounded handoff.
2. `media/hardware-view.js` still performs older `shortened(...)` label writes before `drawLabels(geometry)` overwrites them. The final renderer uses authoritative labels, but these redundant intermediate writes obscure that contract. The reviewed DOM bounds pass; this is not a corpus correctness blocker.
3. The imported synthetic membership test in `test/hardware-geometry-oracle.test.js` rebuilds incidences before invoking the independent membership oracle. It is useful oracle-negative coverage, but must not be advertised as proof of the product's incidence projection for every synthetic variant. Unmodified real product incidence projections are separately exercised by the full corpus and interaction test.

### Separate code-review report coverage

No completed separate G4-fix code-review report was supplied or found in the inspected `.omo/evidence/` and G4-fix documentation. The navigation/router/oracle documents are executor reports, not a final independent code-review approval, and do not explicitly enumerate all the same skill/overfit checks. Therefore a claim that an earlier code-review report explicitly covered both skills **cannot be confirmed**. This is an exact report-coverage gap, not substituted by executor success prose. The direct code/skill review above is this reviewer's own check. The scoped acceptance contract does not require a separately named completed code-review artifact, so this gap is a NOTE rather than a manufactured product blocker. Earlier usage-limited reviewers are not treated as approvals.

## Constraint check

- Branch is `feat/hardware-schematic`; HEAD and local `origin/main` are `c6b9a5c642d105ad4117535c1d85366f1c02ec1c`.
- Manifest and lockfile remain `0.4.1`; tags remain v0.3.0, v0.3.1, v0.3.2 and v0.4.0; staged diff is empty.
- Feature files are untracked. Review was against the preserved source archive and current files, not merely tracked `git diff`.
- Original source/compiler/reader/evidence/archive preservation was independently checked as above. The original G4 validator remains byte-identical to its original archive member.
- `experiments/hardware/g4-fix/package.cjs:39-44,76-81` requires and executes the new checker test in each extraction alongside the frozen oracle. Report membership/workspace/extraction equality checks remain in place; the historical validator report-path restriction was not weakened.
- The original validator still invokes the 14-companion author check with expected exit 1. Both historical stage receipts record the same 14 missing companions and `expected-fail`; no silent-pass conversion was found. The current stage receipts independently inspected below retain the same expected-fail result.
- Reviewer performed no checkout, commit, push, merge, version/tag/release/publish action, no production replacement and no G5 implementation. Local state corroborates unchanged HEAD/version/tags and original production files. Remote publication history was not independently queried or claimed verified.

## Checked artifact paths

Contracts and implementation:

- `docs/hardware/g4-fix/{CONTRACT,NAVIGATION,ROUTING-DESIGN,GEOMETRY-ORACLE,PRESENTATION}.md`
- `docs/hardware/g4-fix/G4_FIX_REPORT.md` including the revised resume counts/fingerprint/checker boundary.
- `media/hardware-{navigation,layout,view}.js`, `media/hardware.css`.
- Original-archive changes in `src/hardware/{architecture,scene,scene-query,scene-summary}.js`, `experiments/hardware/g4/index.html`, `test/hardware-navigation.test.js`.
- `scripts/check.js`, `test/check.test.js`.
- `test/hardware-{navigation-context,router,geometry-oracle,interaction}.test.js`.
- `experiments/hardware/g4-fix/{package,geometry-check,browser,browser-audit,before-browser,positive-smoke,run,evidence,preservation,probe,compare}.cjs` and `oracle/{geometry.cjs,regressions.test.cjs}`.
- `experiments/hardware/g4/validate-delivery.js`.

Evidence and preservation:

- `docs/hardware/evidence/g4-fix/run-lopNF5/index.json` and all 102 referenced files by hash, including before/after product probes, browser record/captures/trace/export, frozen oracle, baseline and historical stage receipts.
- `docs/hardware/evidence/g4-fix/resume-01a07ec8/index.json` and all 12 referenced portable files by hash, plus all 257 runtime entries.
- `.build/hardware/runs/g4-fix-geometry-oracle-corpus-Hx9CDX/geometry-oracle.json`.
- `.build/hardware/runs/g4-fix-browser-geometry-audit-pSTyhm/audit.json`.
- Fresh raw run receipt/log paths listed above; `/tmp/st_01a07ece-check-QrdEf4/red.stdout.log` and portable red/green entry/checker logs.
- `dist/bsv-lens-hardware-g4-{source,review}.zip` (historical originals, read only).

## Exact remaining evidence gaps and nonblocking notes

1. **B-PKG-01, original section 20 / contract Delivery:** The current candidate ZIPs and passing replay receipts were received and audited before verdict. Browser trace evidence is missing from both archives, although the archive-resident index requires it. The full evidence-pointer and observed cause are detailed below. Final filename promotion and final-report byte validation remain lead-owned and are not separate blockers.
2. No separate completed code-review report with explicit skill coverage and no notepad path were supplied. The task brief, raw amended request, contracts and checked executor artifacts supplied the review context. No claim about an unseen notepad is made.
3. `GEOMETRY-ORACLE.md` retains its executor-time 22 BSV failures and `NAVIGATION.md` retains F1-lane F2 failures. Their referenced intermediate receipts are historical, not current results. The final report and directly reproduced 58/58 corpus supersede them; clearer historical headings would reduce reader confusion without changing evidence.
4. Native VS Code Extension Host remains NOT RUN; original external review files remain unavailable; user visual/design acceptance remains PENDING. No broader integration or external approval is inferred.

## Final candidate ZIP audit and blocker B-PKG-01

The lead supplied completed candidate artifacts after the initial report draft. This section supersedes the draft's provisional implementation approval and pending-replay state. One final verdict is returned: REJECT for the packaging omission below.

Checked current candidate paths:

- `.build/hardware/runs/g4-fix-package-yZAo9R/review.zip`
- `.build/hardware/runs/g4-fix-package-yZAo9R/source.zip`
- `.build/hardware/runs/g4-fix-package-yZAo9R/review-fix-validation.json`
- `.build/hardware/runs/g4-fix-package-yZAo9R/source-fix-validation.json`
- Adjacent candidate `.zip.sha256` files.

Independent results:

- Recomputed review ZIP SHA256: `5dfaef6ae48a1793fdb9ca4977277ac0ba1e88dc2df2c0f1f83792e33f1f1963`.
- Recomputed source ZIP SHA256: `8cf98fc4f55593a79c1322a161addd277a6a39c57c080befc5720caece36a891`.
- Both ZIP CRC checks pass. Both receipts record status pass, the current feature identity, distinct os.tmpdir extractions, extracted-runtime equality and 41 command records with their required exit status. All 257 common runtime hashes match each ZIP and the workspace; all 478 declared input-artifact hashes match each ZIP.
- Each extraction ran the frozen F1/F2 oracle plus new checker tests: **17 passed, zero failed/skipped**. Parsed each geometry command's stdout: **58 complete valid results**, 18 RTL + 11 BSV at two sizes, zero findings. Public A/B/C scene results and runtime-only PATH/global-lookup checks are present and successful. Both retain the exact 14-companion expected failure.
- A direct artifact-closure check then failed with `KeyError: There is no item named 'bsv-lens/docs/hardware/evidence/g4-fix/run-lopNF5/browser/trace.zip' in the archive`.
- A complete follow-up scan of the two portable evidence directories found **115 byte-identical files and exactly one missing file in each archive**, with zero differing present files. Neither candidate has an alternative G4 trace member.

Missing required artifact:

```text
docs/hardware/evidence/g4-fix/run-lopNF5/browser/trace.zip
bytes: 31746311
SHA256: 132ec555041c3ecb76abb6e5163cf6f9eaf740e83228d6cfae80e0df86945156
```

The trace exists locally, was independently opened during this review and hash-matches the evidence index. Both shipped copies of `run-lopNF5/index.json` still contain `{ path: "browser/trace.zip", bytes: 31746311, sha256: "132ec555041c3ecb76abb6e5163cf6f9eaf740e83228d6cfae80e0df86945156" }`, but the referenced archive member is absent. A recipient cannot inspect the required browser trace from either candidate. Thus the success receipts do not establish complete evidence delivery.

Observed cause: `experiments/hardware/g4-fix/package.cjs:32` delegates member collection to the original G4 collector. `experiments/hardware/g4/package.js:13-14` excludes anything forbidden by the inherited validator. `experiments/hardware/g3/validate-delivery.js:34-39` forbids every `.zip`, which includes this new browser trace. The new package adapter's required-payload list does not verify closure of the new evidence indexes. Original validator behavior itself was not changed; the follow-up adapter failed to accommodate a newly required artifact.

Required correction: deliver the unchanged required browser trace with a resolvable evidence reference, and validate new evidence closure rather than accepting runtime-only equality as complete packaging proof. Regenerate/replay corrected candidates without modifying historical evidence or broadly weakening the original validators. Final filename promotion alone cannot fix this missing member.

**Final judgment:** F1, F2, browser behavior, source preservation and the narrow branding checker fix pass the bounded audit. **REJECT** the current packaged handoff for B-PKG-01: required browser-trace evidence is absent from the built candidates. No design overhaul or additional product defect is requested.
