# G4 F1 navigation context contract

## Canonical locations

BSV `rootInstanceId`, `ownerInstanceId`, `occurrencePath`, source revision and
`sourceContext` remain source identities in both views. Entering an actual RTL
child does not reassign the BSV owner. `sourceContext` retains the source
selection separately from the current implementation selection.

`implementationContext.contextOccurrenceId` is the displayed actual G2 RTL
occurrence. Its `snapshotId`, `modelId`, `provider`, supplied `stage`,
`providerIdentity`, `rootOccurrenceId`, `parentOccurrenceId` and `occurrencePath`
are resolved from the attached implementation model, not copied from the
request. Root and parent follow G2 occurrence parent links.

`implementationContext.implementationOccurrenceId` is the verified BSV
boundary anchor from the authoritative G3 source correspondence. Its snapshot
is `implementationSnapshotId` (the stock correspondence snapshot), which can
differ from the displayed provider snapshot. It remains null for containing-only
inlining. It is never substituted for the displayed occurrence or inferred from
a clicked child. The legacy request with both IDs equal to the child is accepted;
its claimed anchor is discarded and the authoritative anchor returned. Other
contradictory anchor targets, foreign locator snapshots/providers/models/stages,
and contradictory explicit actual roots are rejected.

A provider switch without an explicit locator clears the inherited locator and
implementation selection, and resolves from the retained BSV context in the new
attached provider. It does not pretend the old provider occurrence exists in the
new snapshot. Explicit foreign locators fail rather than silently returning the
source root. No stage, provider, or RTL occurrence is fabricated.

## Navigation and restoration

`visitKey` is a stable resolved location key: build, snapshot, source revision,
view kind, BSV root/owner and actual implementation context. It excludes render
IDs, generation, geometry, viewport, hover, selection, disclosure and panel state.
Those detail fields are still saved in complete history frames, together with
the scene and geometry. Back/Forward restore those exact frames without queries
or layout. Source and RTL visits are not interchangeable.

Every navigation queries first, checks response echoes, then validates the full
candidate geometry and scene before deduplicating or committing. An unchanged
canonical location with identical layout inputs and dimensions reuses validated
geometry. An identical result causes no commit, history or animation. Selection
and disclosure still query the inspector, update the current frame and preserve
Forward without adding hierarchy history. The viewport is retained for same-place
updates unless explicitly supplied. Changed layout inputs require new layout.

RTL Up and the primary breadcrumb use actual RTL parents. Up at the actual RTL
root stays RTL and reports `blocked / RTL_ROOT`. `returnBsv()` and the separate
source breadcrumb are explicit source actions, not RTL Up. The header and
inspector show the BSV owner and actual RTL path independently. The provider
control switches attached captures while remaining in RTL.

## Outcomes

Existing boolean returns remain: true means a committed location/detail update;
false means no commit. `getState().outcome` and status callbacks add one bounded
latest diagnostic (`status`, `code`, at most 512 message characters,
`queryGeneration`):

- `committed`: location, detail, restoration or local presentation committed.
- `unchanged`: successfully resolved identical location and detail.
- `unresolved`: query/provider/target resolution failed; displayed frame retained.
- `stale`: current response failed snapshot/generation echo validation.
- `cancelled`: pending work cancelled with no history destination.
- `blocked`: no hierarchy/history destination or invalid breadcrumb action.
- `error`: invalid geometry/scene/viewport or local controller failure.

Superseded successes and failures resolve false without altering newer state or
its diagnostic. Abort is advisory; the generation check also handles providers
that ignore it. There is no accumulating unbounded diagnostic log.

## Regression coverage

`test/hardware-navigation-context.test.js` uses real A/B/C product catalog queries,
G2 models, G3 analyses and product layout: N01 direct-query/navigation equivalence;
N02 resolved repeat and inspector detail; N03 exact Back/Forward; N04 repeated BSV
definitions; N05 repeated RTL definitions and actual Up; N06 attached snapshots,
stages and rejected contradictions; N07 C 8/12 containing-only inlining; N08
controlled deferred race/cancellation; N09 failure versus unchanged, stale and
invalid geometry; N10 the existing positive smoke and HTTP scene surface.

Deferred/event tests subscribe before triggering and use bounded completion,
never fixed sleeps or polling. Existing controller fixtures now give each RTL
occurrence a distinct identity; they do not substitute for the product tests.

F2 routing is outside this deliverable. The frozen independent oracle is not
modified, including its F2 coincident-route assertion.


## F1 verification receipts

All receipt paths below are relative to `.build/hardware/runs/`. Commands used
`node experiments/hardware/g4-fix/run.cjs LABEL node ...`; `tool.monitor` was not
available in this child session, so the shell tool executed the wrapper.

| Check | Command after LABEL | Receipt | Result |
| --- | --- | --- | --- |
| Navigation/product scenes | `node --test test/hardware-navigation.test.js test/hardware-navigation-context.test.js test/hardware-scene.test.js` | `g4-fix-f1-navigation-verified-o8wq7a/receipt.json` | 34/34 PASS |
| Existing positive smoke | `node experiments/hardware/g4-fix/positive-smoke.cjs` | `g4-fix-f1-positive-VI8mEC/receipt.json` | PASS |
| Frozen oracle | `node --test experiments/hardware/g4-fix/oracle/regressions.test.cjs` | `g4-fix-f1-frozen-oracle-5ZvYPU/receipt.json` | F1 PASS, F2 FAIL |
| Repository check | `node scripts/check.js` | `g4-fix-f1-check-myrxjj/receipt.json` | PASS |
| Real browser surface | `node -e` (complete script in receipt) | `g4-fix-f1-browser-chrome-R4yaj3/receipt.json` | PASS, zero page errors |
| Preservation | `node experiments/hardware/g4-fix/preservation.cjs verify BASELINE` plus six allowed existing-file paths | `g4-fix-f1-preservation-85pWgd/receipt.json` | PASS |

The preservation checker receipt is
`g4-fix-preservation-verify-RFOnjD/receipt.json`: 2,718 files checked, 2,712 unchanged,
exactly the six owned existing files changed, no unauthorized changes. New files
are this document and `test/hardware-navigation-context.test.js`.

Frozen oracle SHA-256 before and after:
`a11b4c9b2e93019e68900574c54e583110ae7a4c641c646f43df1719861c4ac5`.
F2 still reports five positive-length overlaps (18, 100, 108, 10, 120); no F2
layout code was changed or assertion suppressed.

The browser exercise used installed Google Chrome through Playwright with
reduced motion, real UI clicks and subscribed completion events. It checked RTL
root/left entry with one BSV owner, an unchanged repeat with no render revision
or transition change, actual Up, blocked RTL-root Up, stock/instrumented switch,
Return BSV, Back, and the separate source breadcrumb. The first launch receipt
`g4-fix-f1-browser-N2CHah/receipt.json` records a missing Playwright-managed browser;
using installed Chrome required no dependency or browser installation.

The first test receipt `g4-fix-f1-navigation-GhgZFw/receipt.json` records 32/34:
N01/N10 compared null-prototype model records against cloned/HTTP records with
strict prototype equality. The tests now normalize the serialization boundary
and still compare every scene value; no product assertion was removed.

LSP references/callers were inspected. Scene query, scene construction, view and
both test files reported no errors (only existing CommonJS/unused hints).
Navigation diagnostics timed out despite successful LSP symbol/reference lookup;
its syntax was validated by the passing repository check. HTML diagnostics were
unavailable because Biome is not installed; Markdown has no configured LSP. No
dependency or workflow was changed to address tooling availability. There is no
transpilation build for these JavaScript files; packaging remains the parent task.
