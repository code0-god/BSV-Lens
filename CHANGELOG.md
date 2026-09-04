# Change Log

## 0.3.1 — 2026-09-04

- Replace custom VSIX manifest generation with official `@vscode/vsce` packaging.
- Fix Visual Studio Marketplace PackageManifest compatibility.
- Harden Webview refresh state against stale revisions and clear invalid selections after scope changes.
- Improve dense scheduling views with incident-only one-hop edges, bounded fit behavior, and legend parity.
- Prevent comments from contaminating typedef struct fields and alias targets.
- Add pinned real-project browser and Extension Host acceptance coverage.

## 0.3.0 — 2026-09-02

- Split source scope, abstraction level, analysis mode, and hop scope into independent controls.
- Added System summaries, Module member-group collapse/expand, repeated-instance aggregation, and Behavior detail.
- Added source-derived directional Reg/FIFO/Wire/Memory data flow with statement evidence.
- Added logical interface Method Ports with Action/value/ActionValue direction and conservative type widths.
- Added source scheduling attributes, clearly labeled heuristic state dependencies, and Scheduling legend/empty states.
- Added optional trusted BSC schedule reports and invocation with timeout, cancellation, capability probing, and authoritative provenance.
- Added focus breadcrumbs, 1/2/3-hop BFS, mode-aware shortest-path tracing, and editor-to-diagram synchronization.
- Reworked relationship inspector grouping, Webview state migration, graph indexes, responsive layout, accessibility, and SVG rendering.
- Upgraded exported Architecture IR to schema version 2 while retaining `.bsv-arch.json` version 1 compatibility.
- Expanded parser, type, scheduling, graph, panel, manifest, and Webview tests plus the example workspace.

## 0.2.0 — 2026-09-02

- Renamed the extension and package to BSV Lens.
- Replaced project-specific command IDs and settings with the `bsvArchitecture` namespace.
- Made the generated starter configuration source-layout neutral.
- Replaced the sample workspace with a generic mini BSV accelerator fixture.
- Updated the icon, documentation, previews, tests, VSIX identity, and repository archive names.
- Kept the `.bsv-arch.json` schema compatible with 0.1.x project configurations.

## 0.1.0 — 2026-09-02

- Added workspace-level BSV architecture visualization.
- Added package, module, interface, type, function, rule, method, and instance extraction.
- Added inferred module-instantiation, import, call, and state-access edges.
- Added system, file, module, and function-flow views.
- Added source navigation, live refresh, search, filtering, pan/zoom, SVG export, and JSON export.
- Added `.bsv-arch.json` grouping, aliases, virtual nodes, and manual edges.
- Added BSV document symbols and CodeLens navigation.
