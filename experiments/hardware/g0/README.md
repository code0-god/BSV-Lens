# G0 audit harness

Run from the repository root:

```sh
node experiments/hardware/g0/run.cjs
python3 experiments/hardware/g0/inventory.py
node scripts/verify-package.js
```

`run.cjs` needs the existing npm development dependencies, local Google Chrome (or `CHROMIUM_PATH`), `.build/aqua-041-pinned`, and the already installed 0.4.1 directory. It does not install tools or touch a VS Code profile. The inventory also reads the existing `dist/bsv-lens-0.4.1.vsix` and matching Downloads audit ZIPs. These are explicit local audit prerequisites, not dependencies for the default test suite.

Results go only to `.build/hardware/g0/`. The real production preview server is spawned on an ephemeral loopback port and terminated after the browser closes. The browser uses production HTML, CSP, CSS, navigation, queries, projection, renderer, and inspector with the existing simulated VS Code message host. Source fixtures are parsed by the real parser/model builder; none is claimed to be compiled hardware. `blackbox.bsv` deliberately references unavailable vendor source.

Each `EXPECTED-FAILURE` retains the failing assertion, actual/expected values, and stack in `results.json`. Exit zero means the observed baseline matches the audit, **not** that production defects are fixed. An unexpected pass, ordinary failure, browser exception, or missing event fails the command. No test is skipped and no production assertion is changed. HDL types, IDs, counts, and diagnostic status tokens are asserted; explanatory prose is captured as evidence rather than pinned by tests.

Browser activation uses actual double-clicks, buttons, and breadcrumbs. State event subscriptions precede actions; bounded timeouts detect missing signals. There are no fixed sleeps or polling loops. Payload fixtures and build-envelope cases enter through the real webview message surface. Host refresh-envelope reproduction invokes `ArchitecturePanel.refresh` and `handleMessage` with a minimal I/O boundary stub, not a reimplementation of either method.

`identity.json`, `baseline.json`, `pinned-fixture.json`, `results.json`, `browser-runtime.json`, PNGs, and validation logs are local evidence, not release artifacts. Archive probes are read but never executed: the old browser script contains fixed sleeps and disables CSP. `inventory.py` rejects traversal, symlink, and oversize archive members and extracts only relevant text/scripts into the isolated archive directory.

See `docs/hardware/G0_AUDIT.md` for causes, expected outcomes, limitations, and new responsibility ownership. The report also records the local AST-only graphify query and its integrity warnings; graphify is not required to rerun regression reproductions.
