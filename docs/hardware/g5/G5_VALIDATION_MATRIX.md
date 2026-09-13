# G5 validation matrix

Rows are the user acceptance IDs, not a claim that one test name covers one row.
Actual assertions must check canonical IDs, ordered incidences, typed edges, source
ranges and stop reasons. A row becomes PASS only after its recorded execution.
Original compiler corpus, synthetic edge cases, API and browser evidence remain
separate. Existing G4 F1/F2 oracle bytes are preserved.

## Acceptance ledger

| ID | Required behavior | Current execution evidence |
| --- | --- | --- |
| Q01 | Verify stock left get ordered hierarchy bits | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| Q02 | Verify hierarchy crossings and pass through contacts | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| Q03 | Separate reused left and right occurrences | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| Q04 | Preserve narrow wide widths and bit order | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| Q05 | Preserve aliases slices reordering and repeated bits | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| Q06 | Preserve constants as connection local literal sites | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| Q07 | Preserve multiple driver inout and unknown direction | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| Q08 | Never union cell inputs with outputs | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| D01 | Verify supported cells backward and forward dependencies | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| D02 | Separate mux data and control operands | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| D03 | Validate arithmetic comparison widths signs and parameters | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| D04 | Stop default cones at register D Q | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| D05 | Stop at memory black box unknown cells | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| D06 | Preserve cycles fanout and reconvergent dependencies | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| D07 | Verify limits time cancellation and partial frontier | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| D08 | Never promote traversal into origin or execution | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| S01 | Verify actual storage declarations readers and writers | PASS: [independent source evidence](../evidence/g5/run-zAkL5y/checks/source/source-integration-evidence.json) and [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json). |
| S02 | Separate explicit predicates and body path conditions | PASS: [independent source evidence](../evidence/g5/run-zAkL5y/checks/source/source-integration-evidence.json) and [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json). |
| S03 | Verify call actual formal and return bindings | PASS: [independent source evidence](../evidence/g5/run-zAkL5y/checks/source/source-integration-evidence.json) and [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json). |
| S04 | Preserve shadowing reassignment and unresolved branch merges | PASS: [independent source evidence](../evidence/g5/run-zAkL5y/checks/source/source-integration-evidence.json) and [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json). |
| S05 | Support source only helper function analysis | PASS: [independent source evidence](../evidence/g5/run-zAkL5y/checks/source/source-integration-evidence.json) and [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json). |
| S06 | Distinguish original generated captured and current source | PASS: [independent source evidence](../evidence/g5/run-zAkL5y/checks/source/source-integration-evidence.json) and [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json). |
| S07 | Validate Unicode ranges revisions and stale source | PASS: [independent source evidence](../evidence/g5/run-zAkL5y/checks/source/source-integration-evidence.json) and [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json). |
| S08 | Distinguish absent scheduling evidence from no constraints | PASS: [independent source evidence](../evidence/g5/run-zAkL5y/checks/source/source-integration-evidence.json) and [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json). |
| X01 | Keep origin claims unchanged during cone expansion | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| X02 | Prevent stock connectivity from inventing origin claims | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| X03 | Keep queries independent of viewport collapse layout | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| X04 | Reject cached results after provider snapshot changes | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| X05 | Preserve valid analysis after failure cancellation stale | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| X06 | Restore analysis with deduplication Back and Forward | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| J01 | Enter BSV left and select get contact | PASS: [browser receipt](../evidence/g5/run-zAkL5y/browser/receipt.json), J01. |
| J02 | Inspect ordered same net bits drivers loads | PASS: [browser receipt](../evidence/g5/run-zAkL5y/browser/receipt.json), J02. |
| J03 | Navigate actual RTL root left right occurrences | PASS: [browser receipt](../evidence/g5/run-zAkL5y/browser/receipt.json), J03. |
| J04 | Match clicked wire path and Inspector identity | PASS: [browser receipt](../evidence/g5/run-zAkL5y/browser/receipt.json), J04. |
| J05 | Select bit slice and verify highlight membership | PASS: [browser receipt](../evidence/g5/run-zAkL5y/browser/receipt.json), J05. |
| J06 | Show backward dependencies with supported cell boundaries | PASS: [browser receipt](../evidence/g5/run-zAkL5y/browser/receipt.json), J06. |
| J07 | Show forward dependents with exact stop reasons | PASS: [browser receipt](../evidence/g5/run-zAkL5y/browser/receipt.json), J07. |
| J08 | Inspect state readers writers and actual source | PASS: [browser receipt](../evidence/g5/run-zAkL5y/browser/receipt.json), J08. |
| J09 | Inspect assignment RHS and actual argument dependency | PASS: [browser receipt](../evidence/g5/run-zAkL5y/browser/receipt.json), J09. |
| J10 | Restore contributor same net dependency analysis history | PASS: [browser receipt](../evidence/g5/run-zAkL5y/browser/receipt.json), J10. |
| J11 | Reject stale query during snapshot provider changes | PASS: [browser receipt](../evidence/g5/run-zAkL5y/browser/receipt.json), J11. |
| J12 | Restore analysis during Back Up and selection | PASS: [browser receipt](../evidence/g5/run-zAkL5y/browser/receipt.json), J12. |
| J13 | Deduplicate identical query history without extra visits | PASS: [browser receipt](../evidence/g5/run-zAkL5y/browser/receipt.json), J13. |
| J14 | Reveal hidden result occurrence and restore Back | PASS: [browser receipt](../evidence/g5/run-zAkL5y/browser/receipt.json), J14. |
| J15 | Verify narrow resize themes contrast reduced motion | PASS: [browser receipt](../evidence/g5/run-zAkL5y/browser/receipt.json), J15. |
| A01 | Find exact connected pins and module ports | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| A02 | Preserve hierarchy aliases constants and bit order | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| A03 | Distinguish same net and internal logic dependency | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| A04 | Compute dependencies only from supported cell semantics | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| A05 | Stop at registers memories and unknown boundaries | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| A06 | Mark limited analysis as partial not complete | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| A07 | Show storage access and conditional assignment source | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| A08 | Preserve actual formal and caller callee occurrence | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| A09 | Separate stock connectivity and partial source contributors | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| A10 | Avoid inventing origins while expanding dependency cones | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| A11 | Reveal hidden results at actual implementation occurrences | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| A12 | Restore selection source context and viewport roundtrips | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| A13 | Preserve RTL child navigation and wire correctness | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| A14 | Complete actual pointer keyboard analysis browser journeys | PASS: [full suite](../evidence/g5/run-zAkL5y/checks/full/receipt.json) and [browser/oracle index](../evidence/g5/run-zAkL5y/index.json). |
| A15 | Reproduce public core queries from new archives | PASS: fresh review/source checkpoint, 287 commands and 286 tests per archive, 12 identical public-query results; final raw receipts are adjacent to the delivered ZIPs. See G5_REPORT. |

## Independent checks

Resume evidence: [current index](../evidence/g5/run-YTGBZS/index.json), [586-test receipt](../evidence/g5/run-YTGBZS/checks/final-full/receipt.json), [final 8-case delivery regression](../evidence/g5/run-YTGBZS/checks/delivery-final/receipt.json), and [independent reviews](../evidence/g5/run-YTGBZS/reviews.json). Q/D/S/X/J/A rows above retain their original immutable evidence links. Fresh J01-J15 regression passed on the same renderer bytes. Full inherited visual acceptance remains REVISE because overview titles can fall below the older 9px minimum; user design acceptance stays PENDING.

- Same-net: raw JSON ordered vectors/incidences and formal/actual slots.
- Cell dependencies: separately implemented small four-state references plus structural role/precision assertions.
- Code: actual captured source bytes and normalized half-open ranges.
- Correspondence: existing G3 public query results, with unchanged claims and coverage.
- Projection: final geometry and canonical membership, not a renderer success flag.

Negative inputs cover foreign snapshot/occurrence/provider/revision, bad slices,
parameter/width contradictions, unsupported exact semantics, forged source,
complete-origin promotion, containment-only payload and global literal union.
Oracles must detect deliberately corrupted incidence, missing dependencies and
wrong boundaries. No sleep-based pass or answer-scene injection is allowed.

## Run and preservation ledger

- Pre-G5 baseline: `.build/hardware/runs/g5-baseline-wJO0P1/g5/baseline.json`,
  6,636 files, SHA256 inventory `0d603cfdc519ef8663c4df47254d13304a11296a662d79f7a9883f2c1be0775b`.
- Run isolation: `g5-isolation-first-sLac88/g5/receipt.json` and
  `g5-isolation-second-qN5NNk/g5/receipt.json`; prior receipt/stdout/stderr unchanged.
- Public host RED: `g5-host-red-WsNqke/g5/receipt.json`, HTTP404 instead of200.
- Public host GREEN: `g5-host-green-I46B6G/g5/receipt.json`,1/1 pass.
- G5-A targeted: `g5-g5-a-final-targeted-sWW3PS/g5/receipt.json`,16/16 pass.
- Related regressions: `g5-g5-a-regression-zqnTQt/g5/receipt.json`,66/66 pass.
- Navigation: `g5-navigation-green-vZgiR8/g5/receipt.json`,10 new and23 original pass.

These are intermediate checkpoints. They do not certify unimplemented dependency,
source, browser or package paths. Final evidence links and actual totals belong
to G5_REPORT and the shipped run indexes.
