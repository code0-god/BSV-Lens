# Hardware Schematic: G1 toolchain feasibility

## Current scope: measured G3 correspondence and origin transport

G3-A is implemented and independently checked. The third G3-B strategy completed
on isolated GHC 9.6.7 AArch64 after two GHC 9.0.2/LLVM OOM attempts.
Actual storage and RHS origin roots pass through compiler and reader stages
for `mkStage`, `mkNarrow` and `mkWide`. The recorded A/B/C noninterference
comparison passes full functional RTL and ordered structural projection.

This establishes six known-contributor leaf definitions out of a new population
of 53, not complete origin sets or alias causes. Control operand rewrites,
multi-storage processes and parameter-derived clone identity remain unsupported
or partial. No removal is inferred from missing names. Full coverage and exact
identities are in `G3_COVERAGE.json` and `G3_ORIGIN_EXPERIMENT.md`.

G3 delivery, UI and later-gate status are reported separately in `G3_REPORT.md`.
These results do not grant final design, production or release approval.

### Historical G3 execution plan

[G3_CONTRACT](G3_CONTRACT.md) authorizes G3-A product correspondence and,
after its internal checkpoint, G3-B isolated compiler/reader origin transport.
The findings below are historical G1/G1-BSV results, not fresh G3 measurements
and not an already completed origin exporter.

New experiments, tool/source/patch identities, loss-map values and measured
outcomes will be recorded separately in `G3_ORIGIN_EXPERIMENT.md` and G3
coverage/report artifacts. The original `0/53` leaf and `0/168` alias cause
ledgers remain unchanged. A valid generated location or same-net contact does
not by itself resolve those origin gaps.

## Change history: G1-BSV

2026-09-06: BSC/Bluetcl source/elaboration/type/behavior evidence becomes the
first semantic input to the default BSV architecture, supplemented by the
existing Source/Semantic IR. Yosys remains the implementation-connectivity
reader, not a source of inferred BSV meaning. The original outputs, stage,
coverage and limitations below are preserved.

The current amendment reports BSV instance/source, method-rule/source,
storage/source, method/generated-port, state-expression/RTL, RTL/netlist and
complete-chain coverage separately. A representative chain must include actual
compiler metadata and an actual artifact port/pin/net or cell, not only a
declaration link. New evidence is kept under `evidence/bsv/`; original
`evidence/toolchain/` and its manifest remain unchanged.

The original exact-cause gaps remain explicit: 0/53 leaf cells and 0/168
netnames. A verified source invocation or method-port chain cannot replace
those denominators. LSP availability remains unrelated to provenance coverage.
See the G1-BSV report for the measured amendment results and remaining gaps.

### G1-BSV measured evidence

The fresh BSC/Bluetcl replay is byte-equal to the preserved A/B/C metadata.
Nine runnable evidence checks passed; 128 protected files and the original
review ZIP remained unchanged. See [evidence report](evidence/bsv/README.md),
[verification](evidence/bsv/verification.json), and
[exporter gaps](evidence/bsv/EXPORTER_GAPS.md).

| Category | Measured support | Limit |
| --- | --- | --- |
| BSV nonroot module occurrence to source | 8/8: six retained boundaries and two source inlined occurrences | Three build roots are separate; this is not eight RTL module boundaries. |
| Method/rule to source | 12/12 lexical method implementations; 3/3 lexical rule ranges | Source-reviewed ranges, not compiler-exported method body spans. Compiler supplies 14 method entries and zero exact method body ranges. |
| Storage occurrence to source | 8/8 source declarations/types/points, from five lexical declarations | Does not identify each storage implementation cell's full origin set. |
| Method to generated ports | 40/40 contracts; 16 implementation-definition method entries, including parameter derivation reuse | 56 total ports include 16 additional clock/reset ports. |
| State/expression to RTL exact cause | 0/8 storage occurrence origin sets; 0/22 enumerated behavior-expression sites | Sites are outermost RHS/calls/guards, not all AST subexpressions. |
| Generated RTL to netlist | 59/59 cell `src` attributes; 136/168 netname `src` attributes | The remaining 32 aliases are retained without precise RTL origin attributes. |
| Complete representative chain | 1/1 audited method-result vector, eight ordered bits | A selected-chain denominator, not all possible paths or leaf causes. |
| Exact BSV leaf/net causes | 0/53 leaf cells; 0/168 netnames | Unchanged original cause gaps, not replaced by source-link totals. |

The representative `mkConnected/left.get` chain starts at the actual source
method, follows Bluetcl's result-port contract `get`, the generated instance
connection `.get(left$get)`, parent bits 21-28 and the actual top `$add` cell's
`A` pins. Child formal bits are 13-20; its actual `$procdff$10.Q` shares those
bits. [Chain data](evidence/bsv/representative-chain.json) retains source,
metadata, RTL and artifact hashes. It explicitly sets invocation-to-wire and
leaf-cause claims false: this proves boundary connectivity, not expression
causality.

The alias/connectivity census is separately normalized:
168 definition-level netname aliases; 185 occurrence-expanded aliases;
413 definition-local integer bits; 457 occurrence-local integer bits;
122 formal/actual scalar bindings, of which 118 are integer/integer.
Union only those hierarchy bindings, never cell input/output dependencies:
**339 components containing integer signals** remain, including four components
bound to constants. There are 220 connection-local literal terminal sites;
four already join integer components through hierarchy bindings. Thus
339 + 220 - 4 gives 555 components/sites, not 555 physical drivers.
These units must not be interchanged.

### Actual BSV source inventory

The unchanged sources, rather than a rendered `$cell` name, establish:

| Fixture | Source composition and types | Source behavior, not physical cells |
| --- | --- | --- |
| Connected | `mkConnected(Stage)` contains `Stage left <- mkStage` and `Stage right <- mkStage`. Each `mkStage(Stage)` contains `Reg#(Bit#(8)) state <- mkReg(0)`. | `put(Bit#(8) value)` writes `state <= value + 1`; `get` returns state. The top invokes `left.put(value)` and `right.put(left.get + value)`, returning `right.get`. No rule/child module is declared inside `mkStage`. |
| Control | `mkControl(Control)` contains `Reg#(Bit#(8)) count` and `Reg#(Bool) phase`. | Rules `tick`, `decrement (count > 0 && phase)`, `increment (count < 8)`; `inject(value)` has explicit guard `count < 4`; `read` returns count. Rule guards and body paths are distinct. |
| Reuse | `low/high: Sample#(8)` instantiate `mkBiased(3/9)`; `narrow: Sample#(8)` and `wide: Sample#(12)` instantiate wrappers. Each wrapper declares `implementation <- mkWidth` and returns it. | `mkBiased` writes `value + bias`; generic `mkWidth` declares `Reg#(Bit#(width)) state`. `zeroExtend` and arithmetic are source semantic expressions, not child modules. The declared symbolic width remains distinct from compiler-confirmed specialization. |

Direct execution of the existing Source/Semantic IR yields 19 contextual source
instances: 11 module occurrences (including the two inlined `implementation`
occurrences) and eight storage occurrences. It yields 21 contextual behaviors:
18 methods and three rules. The preserved implementation model has nine module
occurrences. These populations describe different layers and must not be merged
into one count or one parent tree.

## Decision and scope

**Real BSC/Bluetcl compilation and real hierarchical RTL import are demonstrated for three designs. Original-BSV mapping is partial, not complete.** Use Yosys JSON at the recorded hierarchical, process-lowered stage as implementation structural truth. This does not make it the sole composition basis of the default BSV architecture. Keep Bluetcl evidence separate; never derive RTL wiring from BSV names, types, rules, or method calls.

This is an isolated G1 experiment on `feat/hardware-schematic`, starting from `c6b9a5c642d105ad4117535c1d85366f1c02ec1c`, version 0.4.1. Fixtures are test-only source, not a production external design or production hierarchy modification. Their synthesis boundaries are part of their original test specification. No version change, commit, push, tag, upstream patch, global package installation, or PATH modification was performed by this workstream. Main/release and user design acceptance remain unauthorized/pending.

Importer/UI acceptance belongs to the separate prototype workstream. This document proves the compiler/reader path and its limits, not production installation, general RTL support, simulation equivalence, or complete source correspondence.

## Reproduction and evidence entry points

Run the commands in [`experiments/hardware/toolchain/README.md`](../../experiments/hardware/toolchain/README.md). No compiler is required for `python3 experiments/hardware/toolchain/run.py --verify-evidence`: it verifies shipped hashes and captured fixture invariants. Rebuilding requires explicitly installed tools and the macOS inventory utilities. The scripts do not auto-download tools. The optional compiler study downloads only pinned source into `.build/hardware/toolchain/compiler-source`.

All paths below are relative to `docs/hardware/evidence/toolchain/`:

| Artifact | Meaning |
| --- | --- |
| `{A,B,C}/design.json` | Unmodified, importer-consumable Yosys JSON; tops `mkConnected`, `mkControl`, `mkReuse` |
| `{A,B,C}/design.il` | RTLIL at the same post-`proc -noopt` stage |
| `{A,B,C}/pre-proc.il` | Distinct pre-lowering representation retaining behavioral processes |
| `{A,B,C}/rtl/*.v` | Actual BSC-generated RTL; `.use` files record module use |
| `{A,B,C}/compile.txt`, `import.txt`, `bluetcl.txt` | Exact command arrays, exit codes, actual compiler/reader/query output |
| `{A,B,C}/recipe.json` | Compilation options, exact ordered pass list, source/dependency identity |
| `{A,B,C}/schedule/*.sched` | Compiler-generated method/rule schedule dumps |
| `{A,B,C}/bluetcl.json` | Actual raw Tcl results plus normalized module, method, instance, rule, and hierarchy records |
| `{A,B,C}/correspondence.json` | Executed experimental sidecar; **not an existing BSC standard** |
| `coverage.json`, `{A,B,C}/coverage.json` | Measured complete definition-local denominators and occurrence counts |
| `manifest.json` | SHA-256 and byte sizes of shipped evidence, fixtures, and scripts |
| `bsc-installation-inventory.json` | Every file in the installed compiler distribution, including standard `.bo` libraries and actual executables |
| `native-runtime-inventory.json` | Conservative full Tcl/GMP dependency inventories |
| `reader-installation-inventory.json` | Actual reader/runtime versions, file hashes, metadata, and license identities |
| `compiler-source-study.json` | Pinned upstream source hashes and line-numbered excerpts at the mapping loss boundary |
| `B-debug/` | Separate `-keep-fires -keep-inlined-boundaries` snapshot; never substituted for baseline |
| `no-elab-failure.txt`, `rtl-elab-diff.txt` | Real missing-`.ba` failure and comparison against the elaboration-enabled build |
| `extraction-example.json` | Actual module/cell/port/net/bit/hierarchy extraction, described below |

`.ba`/`.bo` compiler artifacts stay in `.build/hardware/toolchain/{A,B,C}/bdir`; their paths/hashes are recorded in recipes and regeneration is explicit. The environment and caches stay under `.build/hardware/toolchain/tools`, not shipped with the extension. Historical `compile-baseline.txt` and `import-initial-proc.txt` are retained observations, not the final recipe. Evidence uses `.txt`, not ignored `.log` files.

## Actual tool identity, installation, licenses, platforms

| Tool | Actual version / route | License / compatibility |
| --- | --- | --- |
| BSC | `/opt/homebrew/bin/bsc`; 2026.01, build `9bd39e6f3` | BSC primarily BSD-3-Clause; bundled solver/library exceptions in captured COPYING/LICENSE. Actual arm64 macOS execution succeeded. Other OS compatibility is upstream-supported, not tested here. |
| Bluetcl | `/opt/homebrew/bin/bluetcl`, same compiler build | Requires matching compiled `.bo`/`.ba` and library ABI. Tcl runtime is identified separately by inventory and `otool` output. |
| Yosys | `yowasp-yosys==0.68.0.0.post1208`; runtime reports Yosys 0.68, git `38e001a6f` | Yosys and YoWASP ISC. A real WebAssembly build of Yosys, not a hand-written reader or mock. |
| YoWASP runtime | 1.96 | ISC; documented Python embedding with native Wasmtime runtime |
| Wasmtime | 47.0.1 | Apache-2.0 WITH LLVM-exception |
| Python dependency set | click 8.5.0, platformdirs 4.11.7; Python 3.14.6 | BSD-3-Clause and MIT dependency metadata captured; exact dependency pins in requirements.txt |
| Host | macOS 26.5.2 build 25F84, Darwin 25.5.0, arm64 | Only this host was executed; Windows/Linux are not claimed tested |

No native or YoWASP Yosys was found in PATH or searched local project/cache locations. Official PyPI metadata, the upstream ISC license, and installation route were reviewed, and the lead was notified before the isolated download. `install.txt` records the actual installed versions and downloads. The initial upstream README URL on `main` did not exist; the actual upstream `master` README/license and installed package metadata are captured. No claim rests on the missing URL.

YoWASP is portable via its Python/Wasmtime embedding, but available Python/native Wasmtime wheels remain a platform constraint. This release is not evidence that every installed Yosys version has identical JSON fields. The extension should prefer existing tools or imported artifacts, not silently download this distribution. The initial version probe used YoWASP's default macOS cache; subsequent compilation/import uses an explicit isolated cache. No global package environment was changed.

The BSC wrapper itself sets `BLUESPECDIR=/opt/homebrew/Cellar/bsc/2026.01/libexec/lib`; it is not inferred from PATH. `.bo` package dependencies for these fixtures are `Prelude` and `PreludeBSV`, reported by `Bluetcl::bpackage depend`. Entire BSC library/runtime installations are fingerprinted conservatively, not claimed to have all been consumed. There are **zero external Verilog library inputs** for A/B/C: BSC inlines the `RegN` primitives into RTL register/always blocks. Tcl/GMP and solver dynamic links are captured with `otool -L`; system libraries in the macOS shared cache are identified by OS build rather than individual file hashes. No file-open trace or hermetic sandbox claim is made.

## Compilation and transformation stage

The real compile command pattern is:

```text
bsc -u -verilog -elab -g <top>
    -bdir .build/hardware/toolchain/<fixture>/bdir
    -vdir docs/hardware/evidence/toolchain/<fixture>/rtl
    -info-dir .build/hardware/toolchain/<fixture>/info
    -show-schedule -show-module-use -show-elab-progress <fixture.bsv>
```

All flags were checked against installed `bsc -help`. No invented JSON export flag exists in this experiment. `-elab` is required to retain the `.ba` metadata used by Bluetcl. Actual compilation without it succeeds, but `module load mkConnected` fails with S0040 and exit 1. Adding `-elab` succeeds; the measured A RTL diff contains only compiler generation timestamp comments.

Final ordered reader commands, with explicit RTL filenames in each recipe:

```text
read_verilog <actual generated RTL files>
hierarchy -check -top <actual top>
write_rtlil <pre-proc.il>
proc -noopt
write_json <design.json>
write_rtlil <design.il>
```

Stage ID: `bsc-generated-rtl/yosys-hierarchy-proc-noopt`.

`hierarchy` elaborates Verilog parameters, checks module references, derives concrete module definitions, and removes unused unspecialized definitions. `read_verilog` uses its documented default frontend simplification/constant folding; this is not a raw source AST. `proc -noopt` expands to `proc_clean`, `proc_rmdead`, `proc_prune`, `proc_init`, `proc_arst`, `proc_rom`, `proc_mux`, `proc_dlatch`, `proc_dff`, `proc_memwr`, `proc_clean`. Process pruning, empty-process removal, mux/dff construction and frontend elaboration are real transformations, not hidden display operations. This stage does not promise fidelity to a representation before those transformations.

The initial plain `proc` run exposed its internal `opt_expr -keepdc`. Installed help confirmed `-noopt`, so the final baseline excludes that pass. There is no `opt`, `flatten`, `synth`, `memory_map`, `techmap`, or technology mapping in the final command list. `pre-proc.il` preserves the earlier behavioral stage; the JSON stage has no unlowered processes. The compiler's own RTL optimization is not disabled or represented as a fully tracked provenance history.

Yosys defines its normal synthesis macro and honors BSC `translate_off` simulation initial blocks; those initial register patterns do not become the displayed hardware initialization. Reset polarity comes from emitted BSC macros. `translate_off` warning text is retained. Do not report initialized simulation patterns, FPGA resources, latency, timing, or physical placement from these artifacts.

## Three compiled fixture results

| Fixture | Actual source and purpose | Observed hierarchy / behavior |
| --- | --- | --- |
| A | `Connected.bsv`: external put/get, arithmetic, state, two children | `mkConnected` contains `left` and `right`, both actual `mkStage` instances. Their state registers inline within `mkStage`; they are not RTL `RegN` children. Both parent arithmetic and child register/update logic remain in imported cells. |
| B | `Control.bsv`: three guarded/shared-state rules plus guarded inject/read | `mkControl` contains two state registers, logic, add/subtract and mux cells. Actual G0010 warns inject is more urgent than decrement because both access count. `rule full` gives rule positions, predicates and method-use sets; schedule execution is `read inject RL_decrement RL_tick RL_increment`. This is schedule evidence, not a clock-by-clock simulation. |
| C | `Reuse.bsv`: two occurrences with concrete bias 3/9; generic numeric specialization | BSC emits a shared `mkBiased` definition with real Verilog parameters; Yosys derives two `$paramod` definitions. `low` and `high` are distinct occurrences, not merged by their common definition. `mkWidth` is a generic source definition inlined into separate `mkNarrow`/`mkWide` wrappers with 8/12-bit ports. Numeric specialization is **not** the same thing as the runtime-width-independent Verilog bias parameter. |

All three baseline compiles, metadata exports and reader imports exited 0. Debug B also compiles/imports with exit 0, but has 27 cells/56 netnames versus baseline B's 26/49. Its extra public netnames are the four `CAN_FIRE_*` names and `WILL_FIRE_RL_tick`/`WILL_FIRE_inject` enumerated in `B-debug/comparison.json`. This proves debug flags change the selected artifact; it does not prove an exact rule-to-generated-cell mapping. No missing fire/enable wire is synthesized by the sidecar.

## Measured coverage: denominators are explicit

Counts below are sums over **module definitions**, not expanded occurrence copies. A has one stored `mkStage` definition and two occurrences. Integer bits are module-local distinct identities; connection bit entries count ordered pin membership including repeated bits and constants. Netnames are aliases, not necessarily distinct nets.

| Measure | A | B | C | Total |
| --- | ---: | ---: | ---: | ---: |
| Implementation definitions | 2 | 1 | 5 | 8 |
| Implementation occurrences, including top | 3 | 1 | 5 | 9 |
| All cells | 8 | 26 | 25 | 59 |
| Hierarchy cells / verified BSV instance positions | 2 / 2 | 0 / 0 | 4 / 4 | 6 / 6 |
| Leaf cells / exact original-BSV origins | 6 / 0 | 26 / 0 | 21 / 0 | 53 / 0 |
| Cells with generated-RTL src | 8 / 8 | 26 / 26 | 25 / 25 | 59 / 59 |
| Module ports / explicit method-bound ports | 14 / 10 | 7 / 5 | 35 / 25 | 56 / 40 |
| Netnames / generated-RTL src / exact BSV origin | 31 / 27 / 0 | 49 / 37 / 0 | 88 / 72 / 0 | 168 / 136 / 0 |
| Module-local distinct integer bits | 79 | 79 | 255 | 413 |
| Cell pins | 34 | 79 | 99 | 212 |
| Ordered cell-pin bit entries | 156 | 258 | 540 | 954 |
| Constant cell-pin entries | 17 | 62 | 84 | 163 |
| Explicitly open cell pins | 4 | 0 | 8 | 12 |
| Source hierarchy nodes, including primitives/rules | 5 | 6 | 11 | 22 |
| Source primitive occurrences | 2 | 2 | 4 | 8 |
| Source inlined boundary nodes | 0 | 0 | 2 | 2 |
| Rule positions provided | 0 | 3 | 0 | 3 |

All eight implementation definitions can be associated with BSV module definition context, using direct compiler definitions and explicit Yosys `hdlname` for parameter derivation. The 16 remaining ports are clock/reset arguments, not missing method metadata. **0/16 implementation-definition method entries have an exact source range exported here** (14 unique BSC definition/method pairs, with the two `mkBiased` methods represented in both parameter specializations): all 16 entries have exact port contracts, but Bluetcl method-rule positions in these fixtures point to the containing module header. A BSV module point is source context, not an exact method body location. Rule declaration points are available for 3/3 B rules, without a rule-to-cell mapping.

The 32 netnames without `src` retain raw connectivity and remain source-unmapped; they are not discarded. No denominator is restricted to already mapped objects. Original expression and register mapping is 0/53 leaf cells and 0/168 netnames, not 100% based on the six successful hierarchy boundaries.

## Actual information table

| Required information | Actual provider / example | Exact scope | Missing / next responsibility |
| --- | --- | --- | --- |
| Implementation definitions/cells | Yosys `modules.mkConnected.cells.left.type = mkStage` | Selected post-lowering artifact | Unsupported cell semantics stay raw; never infer cell function by instance name |
| Ordered connectivity | `cells.left.connections.get = [21..28]` | Eight ordered parent-local bits | Canonical importer must preserve namespaces, constants, aliases and open pins |
| Formal/actual hierarchy | `mkStage.ports.get.bits = [13..20]` paired by bit position with parent [21..28] | Explicit child pin/formal port contract | Not a global join of integer IDs or matching names |
| BSV instance declaration | `submodule full mkConnected`: `left mkStage ... position {Connected.bsv 20 10}` (full path in raw output) | Exact compiler occurrence identity, definition and reported source point | No source end range or global identifier-stability guarantee |
| Source vs implementation hierarchy | `browseinst detail`: `BSVPath`, `SynthPath`, `LocalPath`, `Node`, `UniqueName`, `Interface` | Real occurrence and inlined-source boundary evidence | `mkWidth`'s inlined boundary record identifies wrapper as `BSVModule`; source-definition resolution needs Source IR, not a fabricated RTL child |
| Method ports | `module ports`: `put` argument `put_value`, size 8, enable `EN_put`, ready `RDY_put`; `get` result `get`, ready `RDY_get` | Exact method-to-emitted-port contract verified against Yosys ports | Not exact BSV statement provenance |
| Clock/reset | `module ports` args: clock oscillator `CLK`, reset port `RST_N`, default clock/reset associations | Compiler-reported interface association and actual artifact pins | Internal domains and sequential semantics need validated cell/library contracts |
| Rule/schedule | `rule full mkControl RL_decrement`: position 17:9, predicate `(! (count == 8'd0)) && phase`; schedule execution and method-use maps | Exact compiler scheduling output and rule point | Does not identify generated mux/dff/operator cells or every fire signal |
| Generated RTL provenance | Yosys cell/netname `attributes.src` | Generated Verilog file/line/column span only | No automatic transitive BSV map |
| Concrete parameters | Yosys derived module `parameter_default_values.bias = 00000011/00001001`, `attributes.hdlname = mkBiased` | Actual elaborated 3/9 values and source HDL definition identity | Do not strip `$paramod` names using regex |
| Inlining/shared/deleted origins | Bluetcl source primitives vs actual inline RTL; pre/post process stage pair | These observed boundaries and transformations | Full compiler optimization/merging/origin history is not exported by this metadata |

`IfcPosition` is not trusted as a unique occurrence declaration: repeated instances sometimes reuse the first interface-type position (for example A `right` has the correct instance position 21:10 but `IfcPosition` 20:4). The sidecar uses `submodule full` instance positions instead. `bpackage position Control::inject` returns empty; it is not patched with a name search.

## Exact extraction and source-correspondence path

The importer reads `design.modules[name]`, each `ports[port].bits`, `cells[cell].connections[pin]`, `cells[cell].port_directions[pin]`, and `netnames[alias].bits/attributes`. Preserve every raw parameter and attribute, including provider-generated names. Signal identity is `(snapshot, occurrence, module-local integer bit)`. String bits are literal `0/1/x/z`, not node IDs. JSON bit vectors are least-significant-position first; offsets/upto/signed metadata must survive when present.

Executed example in `extraction-example.json`:

1. Select A `mkConnected/left`. Yosys gives type `mkStage` and generated RTL `mkConnected.v:75.11-81.20`.
2. Its `get` actual bits are `[21,22,23,24,25,26,27,28]`; formal `mkStage.get` bits are `[13,14,15,16,17,18,19,20]`. Pair by vector index. These local bit numbers must **not** be globally equated outside that occurrence boundary.
3. Parent bit 21 is the `left.get[0]` output and the `$add` cell's `A[0]` input. Its alias is `left$get`. The adder output is another net, not an extension of bit 21.
4. Top `RDY_put.bits` is `["1"]`; child `left.connections.RDY_put` is `[]` (explicitly unconnected), not an unknown one-bit wire or missing port.
5. Bluetcl independently identifies `left`, `mkStage`, and source point `experiments/hardware/fixtures/Connected.bsv:20:10`. `correspondence.json` records the actual line `Stage left <- mkStage;` with its content hash and the generated RTL span. This is a verified fixture instance declaration round trip.
6. Select the adder instead: generated RTL origin is available; an exact BSV expression origin is **unmapped**. The sidecar does not upgrade name similarity or the enclosing module's position into an exact expression mapping.

Source refs retain compiler-reported 1-based points and actual source line slices/hashes. All fixtures are ASCII, so no Unicode byte/UTF-16 conversion has been validated; do not manufacture an end column. A changed source hash invalidates these locations for live editor navigation. Exact-identifier joins are limited to emitted compiler instance/port identities, checked against module targets/port contracts; neither connectivity nor expression provenance is derived from regex or type compatibility.

## Located loss boundary and provenance experiment

Pinned compiler study: commit `9bd39e6f3d54d314a94ce30339a224bb283cbade`; full downloaded source stays isolated and only hashed excerpts are shipped.

1. `ASyntax.hs:716-749,1221-1238` retains source positions on `ADef`, rule IDs and several `AExpr` variants. Other variants explicitly return `noPosition`; this is already incomplete origin coverage.
2. `bluetcl.hs:1438-1496` builds `submodule full` from actual `avi_vname`, `VModInfo`, method-to-signal maps and `getPosition`. `1626-1654` explains why method position follows internal rule/definition IDs rather than guaranteeing the original method token. The executed public queries expose instance/method/schedule context, not a complete expression-to-final-object mapping.
3. `AVerilog.hs:885-929` partitions inlined register instances, calls `vInlineReg`, and emits non-inlined instances separately. Hence source `RegN` nodes are not surviving implementation module instances.
4. `AVerilogUtil.hs:595-631,648-682` converts definition/expression IDs into Verilog IDs. Binary operators can retain an ID via `idToVId`; some concat/select/conditional cases discard their original IDs while building `VExpr` variants. Thus adding a map only after final pretty-printing cannot recover all origins.
5. `Verilog.hs:731-763` defines `VId String Id ...` and `HasPosition`, but its printer emits only the string. `VExpr` printing also omits source IDs. Actual generated RTL has no BSV `src` attributes; Yosys creates **new generated-RTL** `src` attributes while parsing. This is a demonstrated transport loss boundary, not proof that every earlier optimization preserved origins.

The executed `metadata.tcl` plus `run.py` sidecar prototype recovers what these public interfaces genuinely provide. Its schemas `g1-bluetcl-metadata-experiment-v1` and `g1-correspondence-experiment-v1` are project proposals, not BSC APIs. Forty method-port bindings and six instance-declaration mappings are materialized with artifact/source hashes; unavailable mappings remain absent/unmapped. The debug build verifies that preservation flags alone do not establish the missing provenance chain.

Recommended isolated compiler-side experiment for G3:

- At `ADef/AExpr/ARule` creation and transformation sites, carry sets of origin IDs with source file hash, compiler point/range convention, parent origins and transformation reason. Missing position stays explicit. Do not assign a shared resource to its first source use.
- Export at the A-to-Verilog conversion boundary: emitted definition/instance/port identity, retained origin IDs, inlining/merge/delete relation and compiler pass identity. Capture printer output spans or stable custom RTL attributes to join the sidecar to **that exact generated RTL hash**.
- Prototype schema: `{schema:"bsv-lens-provenance-experiment-v1", compilerBuild, sourceHashes, rtlHash, stage, objects:[{rtlObjectId, rtlSpan, origins:[], relation, status}], transformations:[]}`. This is a proposed schema only; no such exporter is claimed installed.
- Match parser-produced RTL spans/attributes to the sidecar, preserve many-to-many origins through process lowering, and classify ambiguous span overlaps rather than declaring every cell on a line exact. Test shared muxes, removed expressions, inline boundaries and numeric occurrences independently.
- Build a copied/pinned compiler under `.build` only, compare its emitted circuit with the unpatched baseline, and fail if added provenance changes circuit semantics. GHC/Cabal are not installed on this host; no compiler rebuild/patch was performed. The metadata-sidecar prototype is executed; the compiler patch remains explicitly proposed research.

Do not claim optimized-away source merely because mapping is missing. Neither baseline nor debug provides a complete merge/share/delete ledger.

## Support limits and gate disposition

Proven: three actual BSV compile/import paths; preserved real child hierarchy and parameter-derived definitions; typed method-port contracts; rule/schedule/source-point queries; raw cell/port/net/ordered-bit artifacts; process stage capture; measured partial source correspondence; isolated reproducible recipes and hashes.

Not demonstrated by these three compiler fixtures: memories and memory lowering, BVI/vendor blackboxes, unknown custom cells, inout/tri-state/multiple-driver semantics, x/z constant vectors, ascending indices, escaped-identifier stress, broad SystemVerilog coverage, unsaved-editor staleness UX, cancellation/trust enforcement, large-design performance, packaged extension operation, full source round trip for leaf cells, or cross-platform execution. A/B/C only contain literal 0/1 constant connections. An importer may test broader raw JSON preservation separately, but those tests are not compiler integration evidence here.

Preserve blackbox/unknown objects and their raw pins when later supported, stop semantic traversal at unknown behavior, and reject/mark unsupported processes or memories rather than silently dropping them. No external library behavior is guessed from a `RegN`, scheduler, memory, or port name.

**G1 toolchain feasibility: demonstrated. Structural importer fidelity: assess using the independent importer evidence. Original BSV correspondence: partial, measured; complete mapping remains a G3 research/implementation gate. Production build/VSIX, user visual acceptance, and release: not validated or authorized by this bundle.**
