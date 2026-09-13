# B-PKG-01 independent delta gate

- recommendation: **APPROVE**
- blockerStatus: **B-PKG-01 resolved for the exact candidates below**
- blockers: []
- reviewerTask: st_01a07eef
- originalIntent: Correct the demonstrated omission of original indexed browser trace bytes from both review/source packages without changing historical evidence, renaming/reencoding traces, or broadly weakening exclusions.
- desiredOutcome: Both candidates contain every shipped G4-fix index reference with original size/hash; packaging checks closure before writing candidates and after actual extracted execution, before reporting PASS.
- userOutcomeReview: Satisfied. Both delivered candidate byte streams contain all three original-path traces and all 294 references from their four shipped indexes. The checked replay receipts bind these same archive hashes and index identities to successful distinct isolated executions and post-execution evidence/runtime equality.

This is only the requested delta to `docs/hardware/g4-fix/GATE_INITIAL.md`, B-PKG-01 (original amended request section 20 and `docs/hardware/g4-fix/CONTRACT.md#delivery`). The prior product/browser audit is not repeated. ULW status returned `ULW_LOOP_PLAN_MISSING`; this report uses the task's explicitly permitted new fallback artifact. No product, historical evidence, fixture, index, archive, or distribution file was edited.

## Exact approved candidates

Base directory: `.build/hardware/runs/g4-fix-package-cRMgPI/`.

| Candidate | Independently computed SHA256 | ZIP bytes | Expanded payload bytes |
| --- | --- | ---: | ---: |
| `review.zip` | `7020fba2a31cc0cbedec80d5c780464fa111a47fa5b9fc83e4de56bce92195ed` | 140958515 | 431502244 |
| `source.zip` | `dc97b3ca3b475ba9e82be37a499caeec1f68f8753a14f686d5bba058fc89840e` | 124721839 | 399940494 |

Both payloads are below 512 MiB. Python standard-library ZIP validation independently passed all outer CRCs and all inner trace ZIP CRCs. Member names are unique/safe, regular-file types only, and individual members stay within 64 MiB. Source contains no `.build/` members. Applying the actual inherited G4 forbidden predicate to every archive member found zero forbidden members.

Each candidate contains these unchanged members under `bsv-lens/docs/hardware/evidence/g4-fix/`:

- `run-JWmoeL/browser/trace.zip`
- `run-lopNF5/browser/trace.zip`
- `run-qiEMnV/browser/trace.zip`

Every trace is 31746311 bytes, SHA256 `132ec555041c3ecb76abb6e5163cf6f9eaf740e83228d6cfae80e0df86945156`. Archive bytes equal workspace originals, not renamed or reencoded substitutes.

All files rows were independently resolved, size/hash checked, and byte-compared with workspace evidence:

| Shipped index under `docs/hardware/evidence/g4-fix/` | References | SHA256 |
| --- | ---: | --- |
| `resume-01a07ec8/index.json` | 12 | `7b723c4666e306e12191177e7b39b0d8f7d083ee868379697c45efc5b7fd1e4f` |
| `run-JWmoeL/index.json` | 102 | `62565974da367a79cd002a795881479821205109957e2d3f974583c602c7e166` |
| `run-lopNF5/index.json` | 102 | `835553bbc5a674c1d29477537a829b3c5bc58a23f05f32c2f939f9641fe824c0` |
| `run-qiEMnV/index.json` | 78 | `ba54c187caf48f8500be3b7776ec51cf180d1959feaa291994d1be99e941d744` |

Their byte identities also match this reviewer's earlier source-closure audit. All 258 runtime rows independently match workspace/archive/receipt bytes, and recomputing the receipt runtime identity yields `7817fcefc809ac050cdd71ff4aa037824033e073c5c2f6a3c9cbd317c2db3601` for both candidates.

## Enforcement and actual replay evidence

Read the complete changed production/test files and supplied three diffs; independently reproduced production diffs against the supplied before snapshots. The only inherited exclusion relaxation is the anchored `docs/hardware/evidence/g4-fix/run-[A-Za-z0-9_-]+/browser/trace.zip` allowance. Forbidden segments, secrets, other ZIPs and other forbidden suffixes remain rejected. A direct old/current predicate differential over 33 representative paths found only the exact trace path changed from rejected to allowed.

`validateEvidence` checks safe paths, forbidden members/references, duplicates/self-reference, every index files row's size/hash, and indexed trace membership. `build` invokes it before `saveCandidate`, checks both modes against the same index identities, and requires the new delivery test in the payload. After extracted commands finish, `validateExtractedEvidence` reads actual disk evidence without the packaging exclusion filter and checks expected index identities before setting receipt PASS.

Checked `review-fix-validation.json` and `source-fix-validation.json` in the candidate directory:

- Exact candidate SHA256, runtime identity and all four index identity rows match the independently read archives.
- Both record PASS, `extractedEvidenceEquality: true`, and `extractedRuntimeEquality: true`.
- All 41 command exits in each receipt equal their expected exits; no recorded process signal/error.
- Actual extraction commands assert an empty destination, validate ZIP CRCs, extract these candidate paths, and exit zero.
- Distinct destinations: `/var/folders/6m/65prllx16pn1yq0bs0q_s5sc0000gn/T/bsv-g4-review-replay-UukuX1/extracted` and `/var/folders/6m/65prllx16pn1yq0bs0q_s5sc0000gn/T/bsv-g4-source-replay-RpLl5s/extracted`.
- Both offline commands actually include `test/hardware-delivery.test.js`; each records 159 passed, zero failed/cancelled/skipped. Supplemental regression/checker command records 17 passed in each. These are audited execution receipts, not reviewer-rerun product tests.

## Direct skill-perspective / overfit check

No `remove-ai-slops` or `programming` skill file was found in the consulted conventional skill locations; applied the task's documented criteria directly to this delta's diff, tests and production implementation.

- No excessive/useless or deletion-only tests identified: four delivery tests exercise real collection/inherited validation, member corruption/absence/unsafe references/index loss, exclusion boundaries, and actual temporary-disk mutation.
- Not tests that merely verify requested removal: the positive assertion requires original indexed trace bytes to be delivered, and negative mutations exercise the closure contract.
- No tautological or implementation-mirroring oracle identified: expected evidence sizes/hashes come from real immutable indexes; collector and inherited validator are not mocked. The filesystem test invokes the same post-replay boundary used before PASS.
- No timing-luck sleeps/polling in the new test file. Temporary trees isolate mutations from historical evidence.
- No unnecessary production extraction, parsing or normalization added: index parsing and disk collection directly implement the requested boundary checks; unsafe paths are rejected rather than repaired. No hypothetical helper framework or product refactor.
- No delta maintenance-burden, false-confidence or scope-drift finding requiring correction.

A separate completed delta code-review report with explicit matching skill/overfit coverage was not supplied or identified in the evidence listing. Consequently that separate-report coverage cannot be confirmed; it is a NOTE, not a B-PKG-01 failure. Direct review above does not pretend such a report exists.

## Checked artifact paths and evidence limits

- `docs/hardware/g4-fix/GATE_INITIAL.md`: blocker passages only; `docs/hardware/g4-fix/CONTRACT.md`: Delivery criterion.
- `experiments/hardware/g3/validate-delivery.js`, `experiments/hardware/g4-fix/package.cjs`, `test/hardware-delivery.test.js`.
- Dependencies: `experiments/hardware/g4/package.js`, relevant `experiments/hardware/g4/validate-delivery.js` exclusion/replay paths, `scripts/zip.js`.
- `/tmp/st_01a07ee3/{g3.diff,package.diff,test.diff,g3-validate-delivery.before.js,package.before.cjs}`.
- Both exact ZIPs and both `*-fix-validation.json` receipts in `.build/hardware/runs/g4-fix-package-cRMgPI/`; their four archive-resident indexes and all referenced members, plus corresponding workspace bytes.
- `docs/hardware/evidence/g4-fix/closure-01a07ec8/index.json` and its `{red,green,g3-regressions}/stdout.log`: read historical red missing-trace failure and green 7/7 / G3 4/4 logs. These supplemental files are NOT in these candidates.
- `.build/hardware/runs/g4-fix-trace-full-suite-NAdGIv/receipt.json` and test-summary lines in `stdout.log`: exit zero and 476 passed / zero failed confirmed; not rerun here.

Exact evidence gaps / scope notes:

1. The first candidate audit assertion used the lead's initially claimed five indexes/297 references and failed. Direct inspection proved four/294; the lead explicitly corrected the scope. Revalidation with the actual shipped inventory passed. No failed product test was hidden or skipped.
2. Supplemental closure-01a07ec8 evidence and later portable full-suite receipts are absent from these exact candidates. They are later additions, not missing references from shipped indexes or missing original required traces.
3. Future regenerated final ZIP bytes, final report/promotion and later additions are not covered by these hashes; their validation is lead-owned and is not a separate blocker in this requested delta gate.
4. Extracted workspaces were removed by the packager; post-execution disk closure is supported by the inspected implementation and hash-bound execution receipts, not by a retained filesystem inspection or a second full replay in this reviewer task.
5. No notepad path or separate delta manual-QA/code-review artifact was supplied. The original audit remains the authorized baseline; this report makes no new product/browser approval claim or fresh whole-baseline preservation claim.

**Final recommendation: APPROVE. B-PKG-01 is resolved for both named candidates; no remaining blocker within the requested delta scope.**
