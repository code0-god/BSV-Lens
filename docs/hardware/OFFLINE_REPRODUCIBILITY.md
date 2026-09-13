# Standalone review ZIP validation

## G3 review and Source archive scope

G3 produces **new** `bsv-lens-hardware-g3-review.zip` and
`bsv-lens-hardware-g3-source.zip`. The G1/G1-BSV/G2 ZIPs and their checksums
are preserved. The review archive adds selected historical QA receipts; the
Source archive omits `.build` entirely. Both contain the same relative
product source/tests and captured G3 evidence needed by the commands below.
Neither includes compiler installations, dependency caches or user profiles.

From either extracted `bsv-lens` root, with Node 22+ and Python 3.9+:

```sh
node --no-global-search-paths --test test/hardware-*.test.js
node --no-global-search-paths experiments/hardware/g3/query.js A mkConnected.left get connectivity
node --no-global-search-paths experiments/hardware/g3/query.js A mkConnected.left get origin
node --no-global-search-paths experiments/hardware/g3/query.js B mkControl read connectivity
node --no-global-search-paths experiments/hardware/g3/query.js C mkReuse.wide get connectivity
node --no-global-search-paths experiments/hardware/g3/origin-query.js A mkConnected/left
node --no-global-search-paths experiments/hardware/g3/origin-query.js B mkControl
node --no-global-search-paths experiments/hardware/g3/origin-query.js C mkReuse/wide
node --no-global-search-paths --test experiments/hardware/g3/coverage.test.js
python3 -B experiments/hardware/g3-origin/ghc96-origin.py --run docs/hardware/evidence/g3-origin-ghc96 --verify docs/hardware/evidence/g3-origin-ghc96/results/origin-sidecar.json
python3 -B experiments/hardware/g3-origin/ghc96-test.py
PYTHONDONTWRITEBYTECODE=1 python3 experiments/hardware/bsv-evidence/check.py
PYTHONDONTWRITEBYTECODE=1 python3 experiments/hardware/toolchain/run.py --verify-evidence
PYTHONDONTWRITEBYTECODE=1 python3 experiments/hardware/g3-origin/verify.py
```

The G3-A explorer invokes the real public mapper, validates original corpus
hashes and returns forward results, premise explanations and coverage.
Stock origin queries return unmapped. The last command validates a captured
origin-experiment outcome; it is not live compiler replay or an origin claim.
The separate origin explorer attaches the actual instrumented captures to the
public origin API. A/C return supported known contributors; Control and complete
origin-set queries do not acquire fabricated claims. `ghc96-test.py` checks
captured transport and negative inputs, including four Python hash seeds.
The seed-independent reducer amendment and its original bytes are preserved
under the captured evidence's `history/` directory.
These remain offline operations; actual earlier compiler execution is separately
scoped in `G3_ORIGIN_EXPERIMENT.md` and the live receipts.

Author-only commands still require every original companion:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 experiments/hardware/bsv-evidence/check_author.py
```

In a bare extraction this must exit nonzero and list the missing 14 companions.
Do not add the previous ZIP or compiler metadata binaries as secret shipped
dependencies. Live compiler/exporter execution uses the separate pinned-source,
isolated tool image, patch and budget recipe, never a product query or automatic
offline step.

Author packaging and fresh replay, once for a new output pair:

```sh
node --no-global-search-paths experiments/hardware/g3/validate-delivery.js
(cd dist && shasum -a 256 -c bsv-lens-hardware-g3-review.zip.sha256)
(cd dist && shasum -a 256 -c bsv-lens-hardware-g3-source.zip.sha256)
```

For an already built pair that has no validation receipt, use
`node experiments/hardware/g3/validate-delivery.js --validate-only REVIEW.zip SOURCE.zip`
with the actual paths. Both modes refuse to overwrite an existing final
validation receipt; build mode also preserves existing ZIPs and checksums.

This reads existing captures; it is not required for a reader of an extracted
archive. Missing required docs/runtime/evidence fails packaging. Compiler
attempt logs under the declared G3 origin evidence directories are retained
because their inventories depend on exact bytes.
Final `.zip.validation.json` files sit outside their own archives and record
actual empty-directory replay, commands/exits/stdout/stderr, runtime byte
equality, isolation and expected author failures.

## Historical G1-BSV correction

This corrects the offline prerequisite only; it does not approve or implement G2.
The original checker combined shipped-data validation with author preservation.
Its missing `.build/hardware/toolchain/A/bdir/Connected.bo` failure in the
original G1-BSV ZIP was real. The corrected default is explicitly shipped-only;
the full author preservation check remains separate and strict.

## Required runtimes, not compiler installations

Use Python 3.9+ and Node.js 22+; the executed versions are recorded in the offline
verification receipt. Python uses only its standard library. Node uses shipped
CommonJS modules and built-ins, including the existing Source/Semantic parser.
ZIP extraction needs `unzip` (also used by the packaging regression), or Python's
standard-library `zipfile` for extraction only. The checksum example uses macOS
`shasum`; SHA-256 is also available in Python's standard library.

No package installation, network access, `node_modules`, BSC/Bluetcl/Yosys,
compiled metadata directories, workspace symlinks or prior review ZIP is needed
for the shipped commands. Paths recorded inside tool inventory/recipe JSON are
historical identifiers; offline checks do not open their original locations.
Run Python without optimization (`-O`/`PYTHONOPTIMIZE`), since preserved validators
use assertions. Do not inject alternate modules through `PYTHONPATH`, `NODE_PATH`
or `NODE_OPTIONS`.

## Build a distinct archive (author workspace only)

The packager needs the retained review screenshots/receipts in `.build/hardware`.
It is not a command for a bare extraction and is not compiler replay.

```sh
node experiments/hardware/package-review.js --bsv --offline
(cd dist && shasum -a 256 -c bsv-lens-hardware-g1-bsv-offline-review.zip.sha256)
```

This uses the existing `scripts/zip.js` helper and validates ZIP CRCs. It checks
that every declared shipped evidence input is included. It never rewrites:

| Preserved archive | SHA-256 |
| --- | --- |
| `dist/bsv-lens-hardware-g1-review.zip` | `624d301fff515fdc368a437b5c2a0c34d810e844a3c875910b25a0edf033fb7c` |
| `dist/bsv-lens-hardware-g1-bsv-review.zip` | `0f4f11a6a542155fd15c147eb992d2aa68bd8002bd4e4c020cd9daa0bb3c913f` |

## Fresh extraction: shipped checks

From the directory containing the corrected ZIP (or substitute its absolute path):

```sh
REVIEW_DIR=$(mktemp -d /tmp/bsv-offline-review.XXXXXX)
unzip -q bsv-lens-hardware-g1-bsv-offline-review.zip -d "$REVIEW_DIR"
cd "$REVIEW_DIR/bsv-lens"
python3 --version
node --version
PYTHONDONTWRITEBYTECODE=1 python3 experiments/hardware/bsv-evidence/check.py
PYTHONDONTWRITEBYTECODE=1 python3 experiments/hardware/toolchain/run.py --verify-evidence
node scripts/check.js
node --test experiments/hardware/*.test.js experiments/hardware/prototype/bsv-navigation.test.js experiments/hardware/prototype/bsv.test.js experiments/hardware/prototype/navigation.test.js experiments/hardware/prototype/server.test.js
node experiments/hardware/prototype/build.js
```

`check.py` runs ten checks: original shipped hash preservation, 21 BSV evidence
hashes, captured output equality, independent raw-binding BFS, aliases/constants,
source slices/census, port contracts, parameter/inlining cases, Source/Semantic
populations, category denominators and negative representative-chain mutations
(some are grouped in one test). `run.py --verify-evidence` checks the original
110 manifest hashes and structural/source invariants; **the flag is essential**.
Neither command regenerates compiler output. The prototype build validates ten
unbundled runtime files and writes only a new local build receipt.

The explicit non-browser test list is deliberate, not a runtime skip. A wildcard
over all prototype tests includes the separately provisioned browser tier below.
The packaging regression creates fresh temporary ZIP extractions and asserts:
pristine shipped success; missing/tampered original and BSV evidence failure;
author failure with all 14 missing companion paths reported. It installs nothing.

The full default repository suite is **not dependency-free**. An initial fresh
extraction trial of `node --test test/*.test.js` exited **1**: 302 tests passed,
and `test/vsix-smoke.test.js` failed to load with `Cannot find module 'playwright'`
through `scripts/run-vsix-smoke.js`. That unchanged module also imports
`@vscode/test-electron`. This is not a passing full-suite result; no tests were
deleted, modified or marked skipped. With `playwright` **1.62.1** and
`@vscode/test-electron` **3.1.0** already provisioned, the distinct full-suite
command remains `node --test test/*.test.js` (`npm test`). No dependencies were
installed and that dependency-provisioned tier was not rerun here.

Unchanged provenance limits: **0/53 exact leaf-cell causes**, **0/168 exact
netname causes**. `left.get` establishes method/compiler-port/net/pin connectivity
only; `exactInvocationToWire=false` and `exactLeafCellCause=false`. Captured BSC
`2026.01 (9bd39e6f3)` / Yosys `0.68 (38e001a6f)` version files identify the tools
that produced the evidence, not tools executed by this offline validation.

## Full author preservation (expected failure in a bare extraction)

```sh
PYTHONDONTWRITEBYTECODE=1 python3 experiments/hardware/bsv-evidence/check_author.py
```

This executes all shipped checks plus the unchanged `capture.preserve()` over
**all 128 original inputs**. It refuses a missing receipt and does not create a
new baseline. Missing or changed companions are failures, never skips or PASS.
Supply these exact files at these paths relative to the extracted root only if
you intend to verify author preservation. All SHA-256 values and byte counts
are in the shipped immutable
[`preserved-inputs.json`](evidence/bsv/preserved-inputs.json); the explicit
partition is [`offline-inputs.json`](evidence/bsv/offline-inputs.json).

```text
.build/hardware/toolchain/A/bdir/Connected.bo
.build/hardware/toolchain/A/bdir/mkConnected.ba
.build/hardware/toolchain/A/bdir/mkStage.ba
.build/hardware/toolchain/B/bdir/Control.bo
.build/hardware/toolchain/B/bdir/mkControl.ba
.build/hardware/toolchain/B-debug/bdir/Control.bo
.build/hardware/toolchain/B-debug/bdir/mkControl.ba
.build/hardware/toolchain/C/bdir/Reuse.bo
.build/hardware/toolchain/C/bdir/mkBiased.ba
.build/hardware/toolchain/C/bdir/mkNarrow.ba
.build/hardware/toolchain/C/bdir/mkReuse.ba
.build/hardware/toolchain/C/bdir/mkWide.ba
.build/hardware/toolchain/no-elab/bdir/Connected.bo
dist/bsv-lens-hardware-g1-review.zip
```

There are **13 compiler intermediate files plus one ZIP**. A/B/C recipe metadata
alone names only ten files and is not the full preservation requirement.
Preservation itself needs no compiler executable. Author regeneration via
`bundle.py` still requires all preserved inputs; live `capture.py` additionally
requires the original compatible BSC/Bluetcl installation and libraries at its
documented `/opt/homebrew/bin` paths. Neither was run for this correction. No
BSC/Yosys compilation or compiler replay belongs to the offline commands above.

## Optional live browser tier, separately provisioned

The local prototype can be served with
`node experiments/hardware/prototype/server.js` and opened at
`http://127.0.0.1:4178` using an existing browser. Automated browser tests require
the locked `@playwright/test` **1.62.1** package and **Google Chrome** installed in
its standard location (`chromium.launch({ channel: 'chrome' })`). Neither is
bundled, installed, or required by the pure shipped checks. With those already
provisioned, the separate command is:

```sh
node --test experiments/hardware/prototype/browser.test.js experiments/hardware/prototype/bsv-browser.test.js
```

Historical screenshots, `verification.json`, `lead-runtime.json`, and browser
receipts remain captured author evidence, not evidence of this command running
in a fresh extraction. The shipped
[`offline-verification.json`](evidence/bsv/offline-verification.json) records
pre-package checks and identifies the final archive receipt. Final fresh-extraction
commands, stdout/stderr, exits, isolation checks and the ZIP hash are in
`bsv-lens-hardware-g1-bsv-offline-review.zip.validation.json` alongside the ZIP
and `.sha256` file, outside the archive to avoid a self-referential archive hash.
