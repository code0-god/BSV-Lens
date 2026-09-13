# G6 performance and resource scope

Budgets are defined before execution in [G6_CONTRACT](G6_CONTRACT.md). Their
values are not to be increased after a failing run. Final installed measurements
must identify their VSIX hash, actual Extension Host environment, input identity,
and observable scene/query counts. Compiler timing does not substitute for them.

| Operation | Fixed local validation budget |
| --- | --- |
| Artifact import | 30 seconds |
| Correspondence attachment | 30 seconds |
| Scene/reveal and small query | 5 seconds each |
| Native round trip | 5 seconds |
| Cancellation/disposal | 2-second target, 5-second deadline |
| Post-close resources | Zero active session workers/listeners |
| Host heap delta / Webview heap | 768 MiB / 512 MiB |
| Separate live BSC / reader command | 30 seconds / 120 seconds |

Existing bounded core limits remain in force: artifact 16 MiB, JSON depth 64,
one million JSON nodes, 10,000 occurrences, and 250,000 entities. Native source
discovery is bounded to 256 BSV files / 16 MiB under approved roots. Inbound
native message 64 KiB; single outbound message 8 MiB; G5 query result 4 MiB.
Import size, query visits/results, and visible labels are different quantities.

## Input classes and current measurement status

| Class | Meaning | Current evidence scope |
| --- | --- | --- |
| S | Actual captured A/B/C | Installed 568cd5d7 candidate execution, bounded display and scale checks PASS. |
| M | 16 | 275 / 98 | 4,112,193 | partial / maxResultBytes; fixed complete-cone expectation FAIL | 6 / 269 |
| L | 193 | 1,347 / 191 | 4,177,492 | partial / maxResultBytes; bounded-result expectation PASS | 6 / 1,341 |
| Actual workspace source | Current AQuA's 14 BSV files plus existing MemorySynthTop wrapper | Explicit installed source-only registration and bounded writer/editor roundtrip PASS. |
| Live actual modules | Existing SchedulerSynthTop and MemorySynthTop wrappers with recorded parameters | Separate BSC/reader/import receipts and bounded scene preflight; not full-workspace synthesis |

Native measurement must separately record total model entities, current scene
nodes/routes, query visits, complete result count, displayed result count,
frontier/limited state, label candidates/visible/hidden, and panel resources.
No result deletion, scope reduction, or higher limits to improve timing.

## Measurement definitions

`experiments/hardware/g6/live-compiler.cjs` records monotonic command duration
from spawn through process/stream completion. BSC and reader run with explicit
argv, a minimal recorded child environment, and a unique output/cache directory.
Reader version startup may include cold WASM cache preparation and is recorded
separately from RTL conversion. Core import timing includes the actual registry
read and worker import; it excludes the earlier compiler/reader execution.

Native driver timings and memory belong in the installed receipts below. The
driver's own Node version or heap is not the Extension Host's memory measurement.
Renderer JavaScript timing is not physical compositor frame timing. Measurements
must preserve their operation boundary and report failed/limited samples.

## Installed S/M/L measurements on final runtime bytes

The [installed scale receipt](../evidence/g6/run-TEmIQj/native-scale/native-scale.json)
uses `bsv-lens-0.4.1-568cd5d7de13990a.vsix`, 670,124 bytes, SHA-256
`f9d7a845aab91e366e85e5d73ec8cc04cf0e1f78586f3ef6c0ee8ad9d5b851d7`.
Actual environment: local darwin arm64, VS Code 1.136.1, Extension Host Node
24.18.1, Electron 42.10.0, Chromium 148.0.7778.280. Product and observer are
installed VSIXs; user data, extensions and application-shared data are private.
All five cases preserve input/VSIX bytes and complete installed execution and
automated display support. Aggregate scale result remains **FAIL**: M alone fails
the fixed expectation **M default-budget cone completes**. Its actual result is
partial. No limit, input, seed or scope was changed to turn that into complete.

| Input | Model entities / cells / occurrences | Root scene nodes / contacts / routes | Import / attach+verification ms | Same-net / dependency native roundtrip ms | Detail reveal ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| S-A captured | 345 / 13 / 3 | 4 / 24 / 11 | 27 / 93 | 23.20 / 21.80 | 766.22 |
| S-B captured | 308 / 26 / 1 | 27 / 86 / 47 | 24 / 68 | 63.70 / 97.40 | Not applicable: no child occurrence |
| S-C captured | 704 / 25 / 5 | 6 / 38 / 19 | 35 / 141 | 29.10 / 46.20 | 871.60 |
| M synthetic | 5,791 / 266 / 11 | 3 / 6 / 3 | 104 / Not attached | 51.20 / 160.70 | 840.45 |
| L synthetic | 58,216 / 8,264 / 73 | 9 / 18 / 9 | 582 / Not attached | 266.30 / 347.10 | 953.86 |

Import/attachment intervals are actual Host progress timestamps after input
dialogs; they exclude user-choice time. Message roundtrips run from Webview post
to matching response. Detail reveal includes pointer automation through settled
layout/rendering. Native scene-response roundtrips ranged 3.50–29.00 ms across
these cases; standalone layout duration is not exposed and must not be inferred
from that transport time. The scene node count includes the shell; it is not
the complete model count. L retains all 58,216 entities while displaying nine
root nodes and nine routes, then the actual selected child hierarchy.

| Dependency | Visited cells | Returned objects / frontier | Result bytes | Result and stopping limit | Projected in current scene / off-scene |
| --- | ---: | ---: | ---: | --- | ---: |
| S-A | 3 | 14 / 2 | 49,348 | complete / none | 7 / 7 |
| S-B | 7 | 18 / 2 | 58,915 | complete / none | 18 / 0 |
| S-C | 7 | 72 / 25 | 538,848 | complete / none | 58 / 14 |
| M | 16 | 275 / 98 | 4,112,193 | partial / maxResultBytes; fixed complete-cone expectation FAIL | 6 / 269 |
| L | 193 | 1,347 / 191 | 4,177,492 | partial / maxResultBytes; bounded-result expectation PASS | 6 / 1,341 |

Native queries use the unchanged default 512-cell and 4 MiB result limits; no UI
maxCells control was added. The separate earlier Node lane owns the 16-cell
comparison. Frontier can be nonzero for a complete traversal because it includes
semantic boundaries; the explicit stopping-limit/status fields determine
completeness. Projection membership is distinct from screen visibility and does
not remove off-scene results. M's complete cone remains unsupported at this
default result budget even though its installed input, query and UI execution work.

| Input | Root label candidates / shown / folded | Root/query label preparation ms | Max sampled Host heap delta / heap MiB | Max sampled Webview JS heap MiB | Idle panel close ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| S-A | 67 / 4 / 63 | 1.80–1.80 | 10.03 / 45.71 | 47.84 | 6.11 |
| S-B | 273 / 27 / 246 | 13.50–15.50 | 18.36 / 53.89 | 33.81 | 6.43 |
| S-C | 107 / 6 / 101 | 2.90–3.10 | 31.99 / 67.52 | 47.51 | 6.46 |
| M | 21 / 3 / 18 | 0.70–1.10 | 34.68 / 70.00 | 59.32 | 9.56 |
| L | 63 / 9 / 54 | 1.70–3.00 | 120.87 / 156.14 | 93.47 | 6.11 |

Label preparation/counts are renderer telemetry, separately checked against 14
actual DOM/geometry/mandatory-name captures; all those automated verdicts pass.
They are not a claim that every optional label is shown or that an AI/person
visually reviewed every scale capture. Host memory is `process.memoryUsage()`
inside the actual Extension Host, including observer overhead. Delta uses each
case's pre-input sample. These are sampled JS heap figures, not continuous peaks
or total OS/graphics memory.

The Webview has no separate CDP session in this Code build. The attempted
`Runtime.getHeapUsage` isolation therefore falls back to the actual frame's
`performance.memory.usedJSHeapSize`. This Chromium-reported JS heap can aggregate
shared contexts; it is not an isolated Webview-only allocation measurement.
All recorded samples pass the existing 512 MiB proxy budget, with that scope
limitation retained. No memory success is inferred from the driver's Node heap.

RAF intervals record JavaScript scheduling across UI activity, not physical
compositor frames. S-A/B/C/M/L 95th-percentile intervals were respectively
20.0/38.5/21.5/21.4/20.0 ms; maxima were 110/1,350.0/220.1/350.1/380 ms. The S-B
long interval is retained, not hidden by the passing operation budgets. There
was no predeclared per-frame cutoff, so no smooth-every-frame claim follows.

Scale cases use idle panel close, not active query cancellation. Each close
settled with zero active session operations, watchers and listeners. Separate
installed [S08](../evidence/g6/run-TEmIQj/native-s/S08.json)
on the same VSIX observed an actual cancelled query-worker exit, reported
cancellation settlement 0.69 ms, zero remaining operations and zero late success
responses; worker total elapsed time was 11.79 ms. This is its observed worker
cancellation boundary, not arbitrary-instruction cancellation or every S/M/L
query's cancellation. [S09](../evidence/g6/run-TEmIQj/native-s/S09.json)
separately closes a panel with an outstanding native chooser and confirms cleanup.

All fixed timing/memory/resource checks apart from M's complete-cone expectation
pass. `installedExecution` and automated `displaySupport` are PASS for all five
cases; M and aggregate scale remain FAIL. Independent staged review/source extraction, core and installed native/editor replay passed. Final-byte CRC/delivery receipts are linked from G6_REPORT; their archive hashes remain external.

## Scheduler live lane results

The bounded actual module lane passed in
[`g6-live-compiler-final-Vtx3xu`](../evidence/g6/run-TEmIQj/live-scheduler/live-compiler.json).
Environment: macOS 26.5.2 arm64; author Node 26.7.0; stock BSC 2026.01
`9bd39e6f3`; YoWASP Yosys 0.68 (`38e001a6f`), package
`0.68.0.0.post1208`. No compiler or reader timeout occurred.

| Executed operation | Actual duration | Exit |
| --- | ---: | ---: |
| BSC version probe | 67.53 ms | 0 |
| Reader version / fresh cache startup | 4,974.80 ms | 0 |
| Existing SchedulerSynthTop compilation | 1,249.09 ms | 0 |
| Generated RTL plus full FIFO2 library conversion | 557.74 ms | 0 |
| Public core registry/worker import | 285.95 ms | successful result |

New JSON is 457,850 bytes, SHA-256
`9fe071c9ce2010a25ce855b665878b20cc1c5d8734862c334aa5aa75fa80ef43`.
It contains two implementation occurrences, 241 cells, 37 ports, 740 pins,
10,494 bit entities, 387 aliases, and 12,166 total canonical entities. These
counts describe the imported model, not the simultaneously visible scene.
No memory entities occur in this selected wrapper. FIFO2 is fully read from its
original BSC standard RTL and retained as the second parameterized occurrence.

All 15 declared BSV source documents and the copied FIFO2 library were registered
by hash for the core import. Their freshness is `fresh`; input completeness and
semantics remain `partial`. Complete consumed compiler-library closure and general
parameter/source specialization claims remain unknown. Native registration is a
separate check: the manifest's FIFO2 library is not a BSV source document and must
not be silently parsed as one merely to make native freshness green.

Before/after inventories match all 658 original files under `hw/bsv` (including
previous build outputs, excluding `.git/.omo`). The 14-file source fingerprint
and original Git state also match. This proves preservation for the bounded live
run, not an installed native workspace round trip.

An earlier isolated execution `g6-live-compiler-t7kfqS` is preserved. Its reader
artifact has identical bytes, but its first diagnostic summary queried a
nonexistent `nets` collection and imported before source registration. Use the
final receipt's `bits`/`aliases` counts and declared-input freshness instead.

Installed measurements above are a separate lane on the final runtime bytes.
No native performance PASS is inferred from this live compiler result.

## Memory live lane and retained-occurrence preflight

The separate [Memory live run](../evidence/g6/run-TEmIQj/live-memory/live-compiler.json)
passed stock BSC, reader and public registry/worker import using the unchanged
existing `tb/MemorySynthTop.bsv`. Parameters are scratchpad rows 8, lanes 4, Int8
and accumulator banks 2, rows 8, width 32. This is an existing wrapper scope,
not the whole AQuA system. Stock BSC remains 2026.01 `9bd39e6f3`; reader remains
Yosys 0.68 `38e001a6f`. Every command exited 0 with no timeout.

| Executed operation | Actual duration |
| --- | ---: |
| BSC version probe | 85.59 ms |
| Reader version / fresh cache startup | 5,120.88 ms |
| Existing MemorySynthTop compilation | 614.46 ms |
| Generated RTL plus complete RegFile library conversion | 515.98 ms |
| Public registry/worker import | 101.77 ms |

JSON is 141,591 bytes, SHA-256
`e581be42ca64251237d056ccc4661a3d6b41221a5ace9ac809ba7f11b5d7d6ac`.
The imported model contains seven occurrences, 144 cells, 86 ports, 559 pins,
2,639 bit entities, 381 aliases, six memories and 4,137 total entities.
The original BSC `RegFile.v` was fully read, not replaced with a blackbox.
Its 3,103 bytes have SHA-256
`7de616d2aff8b2411994abadf3876aba8bd64e753741c73d2c0ea19fff0a7db8`.
Memory and opaque-cell semantics remain partial; original BSV cell origins,
complete consumed library closure and source specialization remain unknown.
All 658 original hardware files, original Git state and the 14-file source
fingerprint were preserved. No original wrapper or output was overwritten.

The [native input/layout preflight](../../../.build/hardware/runs/g6-memory-native-preflight-zPHs6s/g6/preflight.json)
then loaded 15 BSV documents / 121,314 source bytes and that actual artifact through
the product adapter without executing a compiler. No metadata/origin was supplied;
native freshness is `unknown`. Its `transport: pass` field checks serialized
scene size in this Node preflight; it is not a measured Extension Host/Webview
round trip. Root scenes and retained entries are deliberately separate:

| Actual scene | Serialized bytes | Child nodes / contacts / connections | Result |
| --- | ---: | ---: | --- |
| Scheduler design root, separate prior artifact | 47,809,773 | 199 / 643 / 537 | Exceeds unchanged 8 MiB native message and 512-connection layout limits. |
| Memory design root `mkMemorySynthTop` | 5,321,217 | 72 / 291 / 305 | Message-size check passes; layout fails `Routing budget maxDimension: 8592 > 8192`. |
| Memory `scratchpad_laneMemories_0` retained occurrence | 853,690 | 12 / 59 / 34 | Preflight layout 63.54 ms; independent geometry and canonical membership PASS. Later installed result is recorded below. |

Scheduler's [full scene measurement](../../../.build/hardware/runs/g6-workspace-live-message-repro-SPD7IP/g6/message-repro.json)
remains a failed parent-scene limit, not replaced by the smaller Memory result.
The retained scratchpad geometry is 1992×2208, with 95 bends, 75 crossings and
zero overlapping pairs/segments. The node column counts scene children and
excludes each scene's own shell. A retained-entry PASS cannot certify its full
root, all memory entries, whole-workspace source mapping or native readability.

The entry menu preserves true design-root and occurrence identity and rejects
more than 128 roots plus immediate children. No model objects, query results or
canonical scope are removed to meet budgets. Optional connection-label folding
retains full text and anchor with null label bounds; the wire remains. Exact
owner/definition/interfacePath membership prevents cross-instance interface
grouping without changing source analysis. These are bounded display repairs,
not higher limits or broader hardware/origin support.

The subsequent [installed retained-artifact run](../evidence/g6/run-TEmIQj/native-artifact/actual-workspace.json)
passes explicit registration, ordered same-net and memory-boundary queries on
the final 568cd5d7 VSIX. Up to the full Memory root remains explicitly limited
and preserves the child result. The [installed source-only run](../evidence/g6/run-TEmIQj/native-source/actual-workspace.json)
separately passes registration of 15 original files, initialized/initialize
writer editor reveal, Back and reverse editor selection. Both preserve all 658
original hardware files and the 14-production-source fingerprint. They do not
prove a source-to-RTL correspondence absent from the input metadata.

[Independent AI visual review](../evidence/g6/run-TEmIQj/visual-review/visual-review.json)
opened nine original final-VSIX captures. A separate prior 59-image review has
verified equal Host/functional media, but is not relabeled as current captures.
Current representative native/typography and source surfaces pass; artifact visualization is **PARTIAL** despite readable selected
`D_IN` and its eight ordered positions. Selection Fit reports 13 blocks and 33
route continuations outside the view; full parent rendering remains limited.
The actual writer range is correct, but long guard/call lines extend past the
standard editor's right edge and require horizontal scrolling. The still capture
does not prove all 225 selected characters are simultaneously visible. User
visual/design acceptance remains **PENDING**.

## Final native measurement isolation

The installed measurements above, [N01–N15](../evidence/g6/run-TEmIQj/native-n/native-acceptance.json),
[S01–S14](../evidence/g6/run-TEmIQj/native-s/native-security.json)
and [full process restart](../evidence/g6/run-TEmIQj/native-restart/native-restart.json)
bind to the same VSIX SHA. They use the installed product and separately installed
observer VSIX, not development paths. The broader native typography lane and
final archive packaging remain separate gates. Every VS Code 1.136.1 CLI and
runtime invocation must isolate user data, extensions and application-shared
data with all three explicit directory options. Earlier pilots lacking
`--shared-data-dir` do not satisfy the final isolation gate.

Short temporary profiles can be retained at their actual recorded path after
shutdown. A process-restart probe may reuse only that probe's own private stores
and must record the reuse; it is not a new cold profile. Do not claim profiles
were relocated unless a relocation receipt records it. These environment and
lifetime distinctions must remain separate from worker timings or compiler
results. Profiles and installed extension directories stay outside archives.

## S/M/L Node protocol and worker measurements

Executed with `node experiments/hardware/g6/run.cjs scale-complete-measurement
node --expose-gc experiments/hardware/g6/scale.cjs`. The full command, exit,
stdout and stderr are in the
[run receipt](../../../.build/hardware/runs/g6-scale-complete-measurement-I15qWJ/g6/receipt.json);
[scale.json](../../../.build/hardware/runs/g6-scale-complete-measurement-I15qWJ/g6/scale.json)
contains individual worker events, input hashes, queries, budgets and counts.
This is an actual `loadNativeInput`, `createHardwareSession`, `HardwareProtocol`,
G5 query-worker and product-layout execution in a Node harness. It is not an
Extension Host or Webview execution. Environment: Node 26.7.0, darwin arm64,
Darwin 25.5.0, explicit GC before each input. Do not replace this measured kernel
version with another lane's environment record.

Runtime was unchanged across this execution; its native inventory fingerprint
was `e84e8460d330f11122e2f7763171dd5e877a12ea40aa484799c4cf317f4d0f4d`.
This binds development runtime bytes, not a final installed VSIX. All 16 original
S source/compiler input files retained their size and SHA. Synthetic inputs and
negative data exist only in this new run's `g6/inputs` directory.

| Input | Actual model entities / cells / occurrences | Root scene nodes / contacts / routes | Import ms | Attach plus verification ms | Scene protocol ms / layout ms | Node heap delta MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| S A, captured | 345 / 13 / 3 | 4 / 24 / 11 | 34.12 | 79.44 | 4.60 / 20.23 | 8.58 |
| S B, captured | 308 / 26 / 1 | 27 / 86 / 47 | 19.79 | 62.42 | 9.59 / 100.67 | 12.58 |
| S C, captured | 704 / 25 / 5 | 6 / 38 / 19 | 27.08 | 142.99 | 5.52 / 41.14 | 23.50 |
| M, synthetic | 5,791 / 266 / 11 | 3 / 6 / 3 | 75.03 | Not attached | 1.67 / 0.84 | 82.51 |
| L, synthetic | 58,216 / 8,264 / 73 | 9 / 18 / 9 | 570.76 | Not attached | 1.37 / 7.89 | 109.05 |
| Separate scalar positive control | 200 / 26 / 3 | 2 / 4 / 2 | 17.55 | Not attached | 0.52 / 0.63 | 18.37 |

M is two groups of four tiles, each containing 32 eight-bit `$add` cells. L is
eight groups of eight tiles, each containing 128 one-bit `$add` cells. Module
boundaries connect these stages in series. All canonical cells, vectors, aliases
and connections remain in their immutable models. Compact root scenes show the
actual top-level groups, without flattening the whole model. The reusable raw
artifacts are 44,208 and 91,554 bytes respectively; this stresses occurrence
expansion, not a claim that these byte sizes approach the 16 MiB import ceiling.
No synthetic input is compiler-generated evidence or an origin claim.

The probe selects the largest actual root output vector, bit zero for dependency,
and repeated ordered positions `[1, 0, 1]` for same-net when available. Scope is
the complete selected design root in both the 16-cell and 512-cell runs. Query
scope and seed never shrink to match the root scene. All 18 query requests passed
through the real protocol and returned product results; complete and partial
results remain distinct.

| Dependency probe | Cell limit / cells visited | Returned objects / frontier | Result bytes | Result / stopping limit | Protocol round trip ms |
| --- | ---: | ---: | ---: | --- | ---: |
| M | 16 / 16 | 275 / 98 | 4,112,192 | partial / maxResultBytes | 125.29 |
| M | 512 / 16 | 275 / 98 | 4,112,195 | partial / maxResultBytes | 117.15 |
| L | 16 / 16 | 106 / 15 | 327,701 | partial / maxCells | 229.92 |
| L | 512 / 193 | 1,347 / 191 | 4,177,492 | partial / maxResultBytes | 312.79 |
| Scalar positive control | 16 / 16 | 106 / 15 | 329,416 | partial / maxCells | 26.14 |
| Scalar positive control | 512 / 26 | 190 / 26 | 583,841 | complete / none | 31.83 |

The fixed expectation that M's complete cone would fit its default budgets was
**not met**. Its large evidence-bearing result reaches the existing 4 MiB result
budget even though most model cells remain outside the returned cone. The scale
receipt therefore intentionally retains aggregate **FAIL**, and the M complete
cone is not certified. The initial
[failed run](../../../.build/hardware/runs/g6-scale-core-ZLi1sb/g6/scale.json)
is also retained: an overly specific `maxCells` frontier assertion stopped before
M's 512-cell measurement. The follow-up recorded both real stopping limits;
neither input size, scope nor any product limit was changed. A separately labeled
24-cell scalar positive control demonstrates complete versus limited results.
It does not replace M or L.

All fixed timing, declared work/result limits and sampled Node memory checks
passed. In L's 512-cell result, 1,347 objects were returned, six had a presentation
in the current root scene, and 1,341 were off-scene; none were deleted from the
query. These `projectAnalysis` counts describe canonical scene membership, not
measured DOM visibility. No actual displayed-label or font-size PASS is claimed.
Real font metrics, label preparation, Webview heap, compositor responsiveness,
panel expansion and split-editor measurements remain in the installed lane.

Actual L query-worker cancellation at its `ready` event settled in 1.65 ms and
preserved the prior input and current scene. Actual import-worker cancellation
at `importing` settled in 0.46 ms. Both include observed worker exit; they do not
claim cancellation at an arbitrary mid-algorithm instruction. Every input's
dispose completed with zero pending protocol requests, active session operations
or workers awaiting exit. Idle disposal took 0.01–0.03 ms in this harness; actual
panel/listener cleanup belongs to the native lane. A 16,777,217-byte artifact was
rejected with `LIMIT_EXCEEDED` before import.

Native-ready manifests and exact root choices are indexed in
[`inputs/catalog.json`](../evidence/g6/run-TEmIQj/stress-inputs/inputs/catalog.json).
The manifest does not grant path authority; the installed test must separately
select the listed source/artifact roots. Native S/M/L acceptance and Extension
Host/Webview memory are **NOT RUN by this Node lane**. No product runtime changed
to improve these figures.

Current final typography: [18 measured captures](../evidence/g6/run-TEmIQj/native-typography/native-typography.json) pass current-pane/Inspector, actual dark/light/high-contrast themes, UA reduced-motion final state, source-delay restoration and C 8/12-bit distinctions. OS whole-window resize remains BLOCKED after the CUA application route became unavailable; Electron CDP does not expose Browser.getWindowForTarget. The final harness records requested 1280×960 and 1600×1000 as NOT RUN. T08-current-window measures a 1440×900 outer window, 396×808 Webview, and 396×255.609375 canvas; T09-wide-pane measures that same outer window, 1092×808 Webview and 792×566.5 canvas. No requested OS size is substituted. DPR is 1, browser zoom and outer frame scale are 1. Native CJK fixture is NOT RUN.
