# G6 contract and initial scope

This is the implementation/validation contract, not evidence of completion.
The user's G6 brief is authoritative. Keep code0-god.bsv-lens and bsvArchitecture.*,
version0.4.1, existing source-only UI/commands/configuration. New entry is explicit
`bsvArchitecture.openHardwareSchematic` / `BSV Lens: Open Hardware Schematic (Experimental)`.
No automatic compiler/import/large scan on activation. No commit/push/release/G7.

## Reuse and boundaries

Reuse src/hardware registry/import/correspondence/origin/analysis worker APIs,
product parser/source-reference resolver, scene/layout/navigation/readability,
and existing VS Code source text/range validation patterns. Existing
WorkspaceAnalyzer.analyze may invoke configured BSC scheduling and is not the
G6 compiler-free entry. Do not reuse trusted-external-path permission as root authority.

Replace only experimental localhost request transport with a versioned native
postMessage adapter. Native normal runtime has no experiments, evidence catalog,
localhost server or author path dependency. Keep experimental host as external QA.
Host owns approvals/registry/workers/freshness/editor/export; Webview owns intent,
view/history/geometry/text. Core owns all semantic/electrical/origin resolution.

Source-only and artifact-only are explicit supported input modes. Source-only
must retain null hardware snapshot/query scope and cannot invent an empty netlist.
Artifact-only shows actual RTL without fabricated BSV owners. Multiple roots are
presented for explicit selection. Unknown build provenance remains unknown.

VSIX contains original src tree, required media assets (including semantic-query
used by host source core), worker entrypoints and staged build metadata. Existing
runtime has no production npm dependencies. Official vsce package includes needed
runtime; no fixture/test/evidence/profile/toolchain in product VSIX.

## Environment and authorization

Initial available local machine: macOS26.5.2 arm64, VS Code1.136.1. Actual installed
Extension Host Node/Electron/Chromium will be captured in the native lane.
Existing engines.vscode remains ^1.90.0. Validate API compatibility against official
VS Code documentation and1.90 types; do not raise minimum to hide a failure.
Local file-backed desktop is intended support. Remote, virtual and web hosts are
not certified; unavailable providers receive explicit unsupported diagnostics.
No remote credentials/server setup or global profile/PATH/toolchain changes.

Root authority is user selection plus pinned host registry, independent of trust.
Restricted Mode allows bounded explicitly registered data reads. G6 exposes no
compiler/task/command execution transport action. Any separate live compiler test
uses recorded existing tool/argv and a new isolated output directory.

## Fixed budgets before measurement

Input importer retains16MiB/depth64/1MJSONnodes/10Koccurrences/250Kentities ceilings.
Source attachment retains256documents/16MiB; origin capture retains64MiB and
supported caller-approved provider boundary. Host source discovery is bounded to
256BSV files/16MiB under selected roots with explicit limit feedback.
Inbound native envelope <=64KiB/depth16/4096JSONnodes; query payload <=16KiB.
SVG export alone permits a1MiB envelope with explicit failure above this bound.
Single message result <=8MiB; G5 query maxResultBytes remains4MiB. Oversize scene
returns an explicit limited/unsupported outcome while preserving previous scene.
At most4concurrent native requests per panel,1input publication generation;
worker termination and panel disposal settlement target <=2s, deadline5s.
No query limit increases for stress inputs.

S=actual captured A/B/C; M=declared synthetic hierarchy/repeated instances;
L=declared synthetic thousands-to-tens-of-thousands model objects. Stress claims
exclude compiler/origin correctness. Local validation budgets: import<=30s,
attach<=30s, scene/reveal<=5s, small-query<=5s, native roundtrip<=5s,
post-close active workers/listeners=0; host heap delta<=768MiB and Webview
heap<=512MiB in tested bounded scenes. Report actual timing/failures and exact
model/current-scene/query/result/display/frontier counts; never move goalposts.

## Required gates and evidence

Core/security/preview/development/installed/native/current-workspace/scale/remote/
live-compiler/package lanes are separate. N01–N15 and native9CSSpx/12CSSpx title
checks must use actual final installed VSIX, real Webview and real TextDocument.
Observer may drive commands/input/read state, never inject scenes/answer ranges,
mock workers or execute a product backdoor. User design acceptance remains PENDING.

Every run is unique under .build/hardware/runs/<id>/g6. Preserve all prior source,
artifacts, captures and packages. Final VSIX, review/source ZIPs and external
hash/validation receipts share documented runtime identity. Historical optional
QA companion70 and author missing-input14 contracts remain distinct.
