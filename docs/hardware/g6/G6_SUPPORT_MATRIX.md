# G6 support matrix

This document separates environment discovery from installed-product acceptance.
Final native results belong in G6_NATIVE_ACCEPTANCE and G6_REPORT. An available
executable, API declaration, or successful compiler run is not a native PASS.

## Executed installed scope on current final runtime

The tested product is `code0-god.bsv-lens` 0.4.1, build
`g6:568cd5d7de13990a8dd2ac0f2307d0ba993754712ce00a3581c2c422b1a967c7`.
Its 670,124-byte VSIX has SHA-256
`f9d7a845aab91e366e85e5d73ec8cc04cf0e1f78586f3ef6c0ee8ad9d5b851d7`.
The following executions use those same installed bytes, separately installed
observer and private user/extension/shared stores:

| Installed lane | Actual result and scope |
| --- | --- |
| [N01–N15 controlled A/B/C](../evidence/g6/run-TEmIQj/native-n/native-acceptance.json) | PASS; actual command, registration, native queries/navigation and editor integration. |
| [S01–S14 security/lifecycle](../evidence/g6/run-TEmIQj/native-s/native-security.json) | PASS; actual Restricted Mode and input/message/source/cancel/dispose boundaries. S11 itself is panel recreation. |
| [Full Code process restart](../evidence/g6/run-TEmIQj/native-restart/native-restart.json) | PASS; two processes reuse their own private stores. Second process has no automatic input authority; explicit registration restores the saved analysis and real source editor. |
| [Current workspace source-only](../evidence/g6/run-TEmIQj/native-source/actual-workspace.json) | PASS for 14 original production BSV files plus the existing MemorySynthTop wrapper, explicitly selecting its initialized/initialize source-editor roundtrip. |
| [Current workspace retained artifact](../evidence/g6/run-TEmIQj/native-artifact/actual-workspace.json) | PASS for explicit scratchpad retained occurrence, ordered same-net and memory-boundary analysis. Full parent is limited; no original-BSV implementation mapping is claimed. |

These are local macOS arm64/VS Code 1.136.1 results, not all-platform support.
Two independent staged archive extractions passed compiler-free core (422 pass, zero fail, three separate-lane skips), public queries and installed native/editor replay. Final archive bytes receive the same gate; external validation receipts linked in G6_REPORT are authoritative. User visual/design acceptance remains separate.

## Historical pilot evidence

The initial installed source-only native smoke **passed as a historical pilot** for VSIX SHA-256
`e76a713ba0cc971c36fd5d91a699d42b3000092676dac66853928f206d8cf42e`,
build `g6:97720dc4c19f4289051351350648275858af3787c26cc589705051fe6d286dc0`.
[Installed smoke receipt](../../../.build/hardware/runs/g6-installed-smoke-protocol-4DJskU/g6/installed-smoke.json)
records the actual experimental command, empty input, real source registration,
left/state/writer analysis, and exact editor source selection. The product context
mode is `installed`; that pilot used an observer development path. All product
src/media bytes match the VSIX and stay unchanged during execution. The window's
Extension Development Host title describes the observer test shell, not the
product loading mode. Current final-lane policy installs the separate observer
VSIX as well as the product VSIX and launches an ordinary Code window with no
product or observer development path. The current installed identity above
supersedes this pilot for final native claims.

VS Code rewrites manifest formatting and adds top-level `__metadata` at install.
The explicit contract canonicalizes JSON object-key ordering and omits only that
top-level metadata; every other field and array order is preserved. Raw manifest
copies/hashes and parsed installer delta remain recorded. Command/version/
dependency changes still fail the independent comparison. Actual transport
evidence contains 11 Webview requests and 13 Host messages bound to the observed
panel/session/build. Those counts apply only to this smoke. Later controlled
N01–N15 and S01–S14 pilots also passed, but predate explicit shared-data isolation
and later runtime changes. They remain separate historical evidence in
[G6_VALIDATION_MATRIX](G6_VALIDATION_MATRIX.md), not final installed certification.

| Environment or surface | Actual evidence | Current scope |
| --- | --- | --- |
| Local desktop macOS arm64 | macOS 26.5.2, build 25F84; VS Code 1.136.1, commit `a44adf7f53e00964ab890f9f8758a334f1fc15bc` | Current installed N01–N15/S01–S14 and bounded workspace lanes PASS on the specified VSIX. |
| Actual development Extension Host | Real `Code Helper (Plugin)` reports Electron 42.10.0, Chromium 148.0.7778.280, Node 24.18.1 | Development source roundtrip PASS; installed VSIX remains separate |
| Current installed Extension Host | Real installed runs report Electron 42.10.0, Chromium 148.0.7778.280, Node 24.18.1; darwin arm64, no remote host | Runtime, memory, command, Webview and editor evidence belong to the installed receipts above. |
| Declared minimum VS Code | Existing `engines.vscode: ^1.90.0`; API types inspected at 1.90.0; its Electron target is 29.4.0 | No minimum-version increase; 1.90 runtime is NOT RUN |
| Windows or Linux desktop | No local execution in this lane | NOT RUN; no cross-platform certification |
| SSH, WSL, Dev Containers, Codespaces | No remote server or credentials used | Runtime rejects remote hosts as UNSUPPORTED; environment execution NOT RUN |
| Virtual filesystem workspace | Existing manifest declares unsupported | UNSUPPORTED; non-file URI must not be converted to a local path |
| Browser/web extension host | Product has Node Extension Host and filesystem workers | UNSUPPORTED |
| Restricted Mode | Actual final installed security receipt observes `workspace.isTrusted === false` | S01–S14 PASS within explicit data roots; ordinary trusted scale runs do not substitute for this gate. |

The local app is `/Applications/Visual Studio Code.app`. Its verified CLI is
`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`.
The already available test copy is
`.vscode-test/vscode-darwin-arm64-1.136.1/Visual Studio Code.app`.
No global PATH, user profile, or extension installation was changed by discovery.

Project-local validation tools already installed: `@vscode/vsce 3.9.2`,
`@vscode/test-electron 3.1.0`, `@playwright/test 1.62.1`. These are test/package
dependencies, not an instruction to ship their entire installation in the VSIX.
The test-electron `runTests` helper unconditionally adds
`--disable-workspace-trust`; final native testing therefore directly launches
ordinary Code rather than an extension-test window. The final-lane launcher
installs a separate observer VSIX and the explicit product VSIX in its private
extensions directory, avoiding `extensionDevelopmentPath` for both. Historical
development/smoke helpers can still use an observer development path; their
receipts name that distinct mode. A final installed receipt must show installed
product and observer paths and their matching package bytes. Restricted tests
omit the disable-trust flag and observe the actual Restricted Mode state.

The [actual development source smoke](../../../.build/hardware/runs/g6-development-smoke-NIxCIb/g6/development-smoke.json)
passed the experimental command, empty-input state, real source-root QuickPick
and relative-folder InputBox, `left` module entry, state readers/writers, writer
behavior, and exact VS Code source selection. The product's real context mode is
`test` because it is an explicit development extension under the test runner;
metadata status is `development-unpackaged`. This is not installed VSIX evidence.
The observed editor selects UTF-16 `[257,329)`, zero-based `11:3` to `13:12`,
in the unmodified Connected fixture copy with source SHA-256
`c8030dc75e34dfd87dc8edc28ad428efd3e35f0cd376c2240c2691c7eca9cb3c`.
The driver did not supply the forward selection range; it came from the product
query/source resolver and was compared with the actual editor observation.

Native macOS requires a short user-data pathname because its Unix-domain IPC
socket limit is 103 bytes. The first long-run-path launch failed before activation
and remains recorded. Current runs create a short private OS-temporary parent
with separate `user-data`, `extensions` and `shared-data` stores. VS Code 1.136.1
keeps application-shared trust storage outside user data; every Code CLI version,
install/list and runtime invocation must supply all three explicit private paths.
A named profile or private user-data directory alone is not sufficient isolation.
The launcher checks option support in the selected executable and records the
actual arguments and resolved stores. Earlier two-store pilots cannot satisfy
the final isolation gate.

Profiles are not universally moved into run directories. Older runs with a
`profile-retention.json` record their actual relocation; current short temporary
profiles can remain at their recorded private path after Code closes. A restart
check may reuse only its own previously created profile, with all three store
paths and input/build identity recorded. Profiles and extensions are excluded
from delivery archives. No normal user profile is authorized for testing; see
[G6_USER_INSTALL](G6_USER_INSTALL.md) for cleanup of the explicit private parent.

## Actual workspace selection

Available current workspace: `$HOME/aisa-lab/DynDNN/AQuA`, branch `main`,
HEAD `9c8a6f5c4ab2ca3040028eae894d55f893eea299`. Source root `hw/bsv/src`
contains 14 BSV files, source fingerprint
`97ddbd5b3d40f050d23ede4c4f1723174820aa98f3f664f00a7a2f5aa3dd2c46`.
Definition matches the existing `scripts/aqua-fixture.js`: locale-sorted relative
path, NUL, raw source bytes, NUL, accumulated with SHA-256. It is not the G5
317-runtime-file fingerprint definition.

Current public source analysis, without supplied entrypoints, finds two independent
unbound root candidates: `mkAquaLoopMatmul` and `mkAquaMemorySubsystem`. Neither
is declared to be a chip top. It has 70 instances, 227 endpoints, 634 statements,
2,748 expressions, 598 call sites, and six existing informational unresolved
Vector-interface diagnostics. These are core discovery results, not an installed
workspace validation result.

Two separate live lanes use existing `hw/bsv/tb/SchedulerSynthTop.bsv` and
`hw/bsv/tb/MemorySynthTop.bsv` wrappers. The former fixes arrayDim to 16; the latter
uses scratchpad rows 8, lanes 4, Int8 and accumulator banks 2, rows 8, width 32.
These are selected real module scopes. Neither compiles both independent source
roots or establishes a combined AQuA system. Initial current-workspace artifacts comprise five
RTL files, 66 `.bo`, 46 `.ba`, and 46 `.sched`; no Yosys JSON was present.

The old `.build/aqua-041-pinned` clone has different HEAD/source bytes and is
historical acceptance input only. G6 must not substitute it for the current
workspace. Untracked user local-state/example files are preserved; exact dirty
state and the before/after hardware inventory are in the live receipt.

The Scheduler lane has an actual successful stock compiler/reader/core
import result in [its live receipt](../evidence/g6/run-TEmIQj/live-scheduler/live-compiler.json).
Its [native v1 input manifest](../evidence/g6/run-TEmIQj/inputs/live-scheduler/native-input.json)
registers the current 14 source files plus the existing wrapper and new Yosys
artifact. No metadata or origin capture is supplied, so this input does not claim
an original-BSV implementation correspondence. Select source root `hw/bsv` and
the receipt's artifact root explicitly; stored paths are not read authority.

That run preserved 658 original hardware files, original Git state, and the
14-source fingerprint. It does not establish installed VSIX acceptance. Exact
tool identities, invocation environment, generated RTL, reader pass script,
stdout/stderr, timeouts, and input inventories are retained in the run directory.

The [MemorySynthTop live receipt](../evidence/g6/run-TEmIQj/live-memory/live-compiler.json)
also reports stock compiler, reader and public import PASS. It used the existing
574-byte wrapper unchanged, fully read the original BSC `RegFile.v`, and preserved
the same 658-file hardware inventory and 14-source fingerprint. Its generated
JSON is 141,591 bytes with seven occurrences, 144 cells and six memories. Imported
structure and declared-input freshness are verified; original BSV origins,
complete compiler-library closure and source specialization remain unknown.
Its [native input manifest](../evidence/g6/run-TEmIQj/inputs/live-memory/native-input.json)
registers the 14 source files plus that wrapper, adding the wrapper as a separate
BSV root candidate. It supplies no correspondence metadata or origin capture.
Native preflight freshness remains `unknown`; core freshness with the separately
registered library does not manufacture native BSV correspondence.

## Actual input display limits

Compiler success does not imply that a whole root fits the current native scene
budget. Scheduler's full RTL scene was 47,809,773 bytes and 537 connections,
above the unchanged 8 MiB message and 512-connection layout bounds.
The [Memory native preflight](../../../.build/hardware/runs/g6-memory-native-preflight-zPHs6s/g6/preflight.json)
separates two actual occurrences:

| Entry | Measured scene and geometry | Support claim |
| --- | --- | --- |
| `mkMemorySynthTop` design root | 5,321,217-byte scene, 72 child nodes, 305 connections; message-size check passes, layout fails `maxDimension: 8592 > 8192` | Whole-root native display not certified. |
| `mkMemorySynthTop/scratchpad_laneMemories_0` | 853,690-byte preflight scene, 12 child nodes, 34 routes; geometry and canonical membership pass, bounds 1992×2208 | Later installed registration/query gate PASS; selected-seed readability PASS; broader/full-parent visual scope PARTIAL. |

Explicit artifact-only/unmapped RTL entry choice retains the true design root and
actual child occurrence; it does not promote a retained child to a new chip top.
The 128-choice limit rejects an oversized menu rather than silently selecting or
publishing the first choices. No transport, geometry or query caps were raised.

Two bounded display repairs preserve the native display contract: BSV interface groups now
match exact owner, definition and immediate `interfacePath`; optional connection
text without clearance retains its full name and route anchor with null label
bounds. Neither repair creates/merges electrical connections, removes query
results, expands origin coverage or certifies dense parent scenes.

The actual source-only and retained-artifact installed runs above both preserve
all 658 original hardware files, original Git state and the 14-source fingerprint.
Registration of all 15 selected documents is not certification of every source
root's internal scene; the accepted editor roundtrip targets the existing wrapper.
Adding that wrapper creates its own explicit source candidate, not a merged chip.

[Independent AI visual review](../evidence/g6/run-TEmIQj/visual-review/visual-review.json)
opened nine original captures on this final VSIX. Its broader 59-image prior
review is explicitly from a different VSIX, with equal Host/functional media
proven by ZIP-member hashes; those are not 59 fresh captures. Current representative
native/typography and bounded source surfaces PASS; artifact visualization is **PARTIAL**. Selected `D_IN`, input [8],
actual RTL occurrence and ordered positions are readable, while Selection Fit
reports 13 blocks and 33 route continuations outside. Full parent Up remains
limited and keeps the child view. The source editor selects exact offsets
326–551 (225 UTF-16 code units), but the long guard/call lines extend beyond the
standard editor's right edge and need horizontal scrolling. The screenshot does
not prove every selected character is simultaneously visible. User visual/design
acceptance remains **PENDING**.

## Installed scale support and limits

The [final installed scale run](../evidence/g6/run-TEmIQj/native-scale/native-scale.json)
uses the same VSIX. All five cases have `installedExecution: PASS` and automated
`displaySupport: PASS`. Their aggregate scale result is **FAIL** solely because
M's fixed default-budget complete-cone expectation returns partial. It is not
relaxed to an expected pass after measurement.

| Input | Full model entities / root scene nodes | Dependency result | Scale status | Max sampled Host heap delta / reported Webview JS heap MiB |
| --- | ---: | --- | --- | ---: |
| S-A captured | 345 / 4 | Complete; 14 returned objects | PASS | 10.03 / 47.84 |
| S-B captured | 308 / 27 | Complete; 18 returned objects | PASS | 18.36 / 33.81 |
| S-C captured | 704 / 6 | Complete; 72 returned objects | PASS | 31.99 / 47.51 |
| M synthetic | 5,791 / 3 | Partial; 275 objects, 98 frontier, maxResultBytes | FAIL: complete-cone expectation unmet | 34.68 / 59.32 |
| L synthetic | 58,216 / 9 | Partial; 1,347 objects, 191 frontier, maxResultBytes | PASS for bounded-result contract | 120.87 / 93.47 |

L uses real hierarchy entry to bounded scenes; all 58,216 objects are not rendered
at once. M/L are declared synthetic stress inputs, not compiler/source-origin
evidence. Import took 24–582 ms, same-net/dependency native roundtrips
21.80–347.10 ms and idle panel close 6.11–9.56 ms. Every case closed with zero
session operations, watchers and listeners. Active query cancellation belongs
to separate installed S08, with 0.69 ms reported worker cancellation and no late
success response. Exact boundaries, counts and timings are in
[G6_PERFORMANCE](G6_PERFORMANCE.md).

Host numbers are sampled actual Extension Host JS heap deltas, including observer
overhead. The Webview lacked a separate CDP isolate session, so measurement used
its `performance.memory`; Chromium may aggregate shared contexts. This is a
bounded JS-heap proxy, not isolated Webview or total OS/graphics memory. The
fixed sampled budgets pass, but RAF scheduling includes a retained S-B maximum
gap of 1,350.0 ms; this is not a claim of smooth physical frames. M complete-cone
support, oversized real parent rendering and remote environments remain limited.

## API and environment basis

- [VS Code 1.90 API declarations](https://raw.githubusercontent.com/microsoft/vscode/1.90.0/src/vscode-dts/vscode.d.ts) include document revision/dirty/range, selection event, trust, and Webview APIs used by this design.
- [1.90 Electron target](https://raw.githubusercontent.com/microsoft/vscode/1.90.0/.yarnrc) prevents treating current Node 24 execution as minimum-runtime proof.
- [Extension testing](https://code.visualstudio.com/api/working-with-extensions/testing-extension) documents explicit development/test paths; installed runtime identity requires the additional G6 directory/hash checks.
- [Remote extensions](https://code.visualstudio.com/api/advanced-topics/remote-extensions) explains workspace-host execution and Webview message passing without a preview server.
- [Virtual workspaces](https://code.visualstudio.com/api/extension-guides/virtual-workspaces) requires checking URI schemes before filesystem use.
- [Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust) supports limited-mode feature gates; trust does not grant arbitrary file authority.

User visual/design acceptance remains **PENDING** in every environment.

Current final typography: [18 measured captures](../evidence/g6/run-TEmIQj/native-typography/native-typography.json) pass current-pane/Inspector, actual dark/light/high-contrast themes, UA reduced-motion final state, source-delay restoration and C 8/12-bit distinctions. OS whole-window resize remains BLOCKED after the CUA application route became unavailable; Electron CDP does not expose Browser.getWindowForTarget. The final harness records requested 1280×960 and 1600×1000 as NOT RUN. T08-current-window measures a 1440×900 outer window, 396×808 Webview, and 396×255.609375 canvas; T09-wide-pane measures that same outer window, 1092×808 Webview and 792×566.5 canvas. No requested OS size is substituted. DPR is 1, browser zoom and outer frame scale are 1. Native CJK fixture is NOT RUN.
