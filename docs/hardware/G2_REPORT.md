# G2 backend and offline reproducibility report

Status: G2 backend implementation verified; independent backend gate
**APPROVE**, no remaining blockers. G3, final design, production UI replacement
and release remain unapproved. Final archive replay has its own adjacent
`.zip.validation.json` receipt.

Review history: [initial rejection](evidence/g2/GATE_INITIAL.md) and
[focused approval after correction](evidence/g2/GATE_RECHECK.md).
Approval covers backend code/evidence only, not design, archive assembly or release.

After correction, the full default suite passed **336 tests**, and the
packaging/offline regression suite passed **10 tests**, all without skips.
The official VSIX includes all six product modules and passed its 61-entry
identity/content/CRC checks. Source archive and SHA256 checks also passed.

## Delivered scope

The BSV-native default / explicit RTL Implementation direction remains adopted.
G2 adds a product-owned artifact importer, immutable BuildSnapshot and
cancellable atomic import lifecycle. It does not execute BSC/Yosys/Tcl, add a
production UI, or add original BSV cause mappings.

Files:

- `src/hardware/{index,registry,snapshot,json,import-worker,yosys-json}.js`
- `test/hardware-{import,snapshot,independent}.test.js`
- [G2_CONTRACT](G2_CONTRACT.md), amended Product/Architecture/Schema/UX/Validation/
  Implementation Plan and this report.

The experimental importer, original compiled fixtures/artifacts and earlier
review ZIPs remain historical evidence. Product code does not load the old
experimental importer. Its actual semantics are compared independently.

## Offline prerequisite: reproduced, separated and verified

The original G1-BSV ZIP failed in a fresh extraction on missing
`.build/hardware/toolchain/A/bdir/Connected.bo`. This was a real defect, not
a reason to skip preservation or report PASS.

The corrected standalone artifact is
`dist/bsv-lens-hardware-g1-bsv-offline-review.zip`, SHA256
`8996c83d57fd08eafeee311622902496aca3a8dca184deda2ae49f4396d89f36`.
Its commands/exits/stdout/stderr are in the adjacent `.validation.json`.

In `/private/tmp/bsv-offline-review.7hk8rur7/bsv-lens`, with no node_modules,
compiler directories, prior ZIP, workspace symlinks or global Node module
searching:

- Ten shipped checks passed.
- All 110 original manifest hashes and artifact invariants passed.
- 49 explicitly dependency-free experimental tests passed, zero skips.
- Runtime build and actual CLI/HTTP A/B/C model/source smoke passed.
- The lead independently reran shipped validation there: ten checks, exit 0.

The strict `check_author.py` remains separate: 11 checks pass in the author
workspace with all 128 preserved inputs; it fails in a bare extraction and
lists all 14 missing companions. These are the exact 13 `.bo/.ba` files plus
the original G1 ZIP listed in [OFFLINE_REPRODUCIBILITY](OFFLINE_REPRODUCIBILITY.md)
and `evidence/bsv/preserved-inputs.json`, with hashes/bytes. Live compiler
metadata replay is a separate explicit author command, not an offline check.
No compiler replay or compilation was performed for this prerequisite.

An initial isolated full default-suite trial failed on missing `playwright`
(its chain also requires `@vscode/test-electron`). That failure is retained;
no tests were removed or skipped. Those optional dependencies are separate
from the genuinely shipped-only commands.

## Product API and truth ownership

Use the real product module with existing artifacts:

```js
const path = require('node:path');
const hardware = require('./src/hardware');

(async () => {
    const artifactRoot = path.resolve('docs/hardware/evidence/toolchain');
    const registry = hardware.createArtifactRegistry({
        artifactRoots: [artifactRoot],
        sourceRoots: [],
        workspaceTrusted: false
    });
    await registry.registerArtifact({
        pathRef: 'design',
        path: path.join(artifactRoot, 'A/design.json')
    });
    const result = await hardware.importArtifact({ registry, artifactRef: 'design' });
    console.log(result.snapshot.id, result.snapshot.structure, result.availability);
})().catch(error => {
    console.error(error.code, error.message);
    process.exitCode = 1;
});
```

Artifact-only imports require no manifest. Unknown build inputs remain null:
stage, declared tops, source inputs, dependencies, toolchain, pass list, build
options and concrete parameters. Actual selected roots are recorded separately
as artifact-derived. No compiler identity or original source fact is invented.

The result separates:

- **Implementation:** immutable artifact structure and ordered connections.
- **BuildSnapshot:** immutable content/build-input identity and capabilities.
- **Availability:** ready/partial/stale and independent import/freshness reasons.
- **Source / BSV Architecture / Correspondence:** explicitly not attached by
  this importer. Existing Source/Semantic ownership remains separate.

The exposed model, nested collections and snapshot are deeply immutable.
Source registry paths are private caller authority. Provider attributes remain
lossless raw evidence but cannot authorize an arbitrary file read.

## Supported, partial and unsupported scope

Supported: bounded UTF-8 Yosys JSON definitions, occurrences, cells, ports/pins,
ordered bit vectors, aliases, constants, raw parameters/attributes and actual
formal/actual hierarchy bindings. Unknown cells are retained rather than dropped.
No input/output pin union or global physical constant driver is invented.

Partial is explicit for unknown build inputs and opaque cell/memory semantics,
black boxes or unknown directions. `snapshot.structure=verified` means the
supported artifact structure was preserved; it does not mean behavior or source
causes are complete. A/B/C artifact-only imports correctly returned partial
while preserving all 13/26/25 occurrence cells.

Unsupported raw behavioral processes or formats do not become empty models.
Malformed JSON, invalid references/directions/bindings and resource limits have
explicit failure codes. No compiler lowering is silently run to make them fit.
Original BSV correspondence, primitive behavior/cones, simulation and physical
timing/resources are not implemented by G2.

## Lifecycle, paths and source freshness

An owned Node worker performs CPU import. Abort before work and during import
is observed; completion/cancellation settles only after the worker exits.
Session events expose the real lifecycle. A newer request supersedes earlier
publication, and failure/unsupported/cancel/stale results preserve the last
valid current snapshot.

Approved artifact/source roots are enforced independently of workspace trust.
Tests cover direct escape, traversal, symlink escape and replacement checks.
Unregistered logical refs grant no path access.
Source hashes and ranges are validated. Changed current text is never used
at an old range; captured old text is labeled captured, otherwise the result
is stale/unavailable. Refresh changes availability, not immutable identity.

Lead independent checks exposed an initial artifact-only API failure:
omitting `manifest` threw `INVALID_INPUT: Non-JSON value`. The implementation
was corrected to use an unknown envelope, while malformed explicit metadata
still fails. The unchanged independent tests then passed.

## Real product execution and tests

Product/lead independent tests passed **30/30**:
24 product tests plus six independent tests. The independent oracle checks
actual A/B/C ordered port/pin/alias/boundary data directly against raw JSON,
not only counts. It also tests relocation identity, frozen data, opaque
constants, root/symlink policy, source capture/staleness, real worker cancellation
and latest-request publication.

Independent gate review found a real taxonomy defect: a malformed binding
named `Unsupported` changed `INVALID_INPUT` into `UNSUPPORTED`, and a null bit
vector was mislabeled `LIMIT_EXCEEDED`. Error creation now assigns the code
at the failure site; message text and provider-controlled names do not choose
machine status. Separate regression cases failed first, then passed for five
misleading names, malformed vectors, real width limits and actual unsupported
processes. The original rejected review remains evidence of this correction.

The lead invoked the public module in `PATH=/usr/bin:/bin` with Node
`--no-global-search-paths`. Compiler lookup found no BSC/Bluetcl/Yosys.
All three imports exited 0, emitted actual `importing` then `exited` worker
events, returned immutable structures and retained unknown provenance:

| Build | Artifact-derived top | Occurrence cells | Structure | Availability |
| --- | --- | ---: | --- | --- |
| A | `mkConnected` | 13 | verified | partial |
| B | `mkControl` | 26 | verified | partial |
| C | `mkReuse` | 25 | verified | partial |

All six product JS files had zero LSP errors; source syntax and repository
checks passed. This is product module validation, not native VS Code UI or
compiler execution.

## Design and correspondence limits retained

The current all-relations-as-separate-lines prototype is not a final layout.
G2_CONTRACT and UX_DESIGN specify summary projections retaining every member
relation and its source, branch conditions, direction and evidence scope.
Selection reveals that detail; aggregation never upgrades semantic links to
physical wires. No G4 renderer implementation was added.

Same-shell DOM identity remains distinct from continuous zoom UX. Real
transition geometry, port continuity, interruption and reduced motion need
their own later acceptance, not a static 50% image.

`left.get` remains **method-port-net/pin connectivity only**.
Exact causes remain **0/53 leaf cells** and **0/168 netnames**.
No declaration-link count, LSP result or import success replaces those gaps.
G3 source/state/expression origin transport has not begun.

## G2 archive and repeatable checks

The G2 bundle uses a separate name:

```sh
node experiments/hardware/package-review.js --g2
(cd dist && shasum -a 256 -c bsv-lens-hardware-g2-review.zip.sha256)
```

After extracting it into a new directory, from its `bsv-lens` root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 experiments/hardware/bsv-evidence/check.py
python3 experiments/hardware/toolchain/run.py --verify-evidence
node scripts/check.js
node --test test/hardware-import.test.js test/hardware-snapshot.test.js test/hardware-independent.test.js
```

These use shipped code plus Node/Python standard libraries, not compilers or
node_modules. Author preservation/replay and optional full browser suites
remain distinct. The final archive validation receipt records actual extraction,
commands/exits and inventory rather than treating packager unit tests as
archive-completeness proof.

## Stop boundary

Feature branch remains `feat/hardware-schematic`; version `0.4.1` is unchanged.
The default abstraction was adopted, not final design or full source causes.
No production UI replacement, compiler hookup, main merge, version bump,
tag, Release or publish is authorized or performed. Stop after this G2 report;
G3 requires a new explicit user instruction.
