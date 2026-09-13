# G5 cell semantics: yosys-0.68-structural-v1

Status: documented default profile and offline reference evidence only. No product
semantics, API, tests, simulator, compiler build, or runtime integration is added
by this deliverable. API ownership remains a separate decision.

## 1. Default contract

The named default profile is **`yosys-0.68-structural-v1`**. It describes
conservative structural bit dependencies for the ten combinational cell types
actually present in the preserved stock/instrumented A/B/C corpus. It does **not**
assume runtime inputs are two-state. It is not a value simulator, an exact
functional-influence analysis, a timing model, or a BSV execution/scheduling proof.

A dependency is a possible structural operand/control contribution. False-positive
edges are allowed; omitted real dependencies are not. Edges retain their data or
select/control role. A complete supported cell mapping does not imply that the
cell's output value is defined for every input. Cones can still terminate at
explicit opaque/state boundaries.

The default is unconditional with respect to signal values:

- No constant, `x`, or `z` branch pruning, even for a literal mux select.
- No assumption of one-hot selects, mutually exclusive guards, initialized state,
  or reachable-only input combinations.
- Preserve literal `0/1/x/z` as connection-local terminals, not shared physical
  driver nodes. Keep the cell's dependency incidence to these terminals; never
  coerce `x/z` to a Boolean or silently drop them from an explanation.
- Never infer signedness, widths, control roles, or semantics from cell/net names.
- Unsupported types or parameter combinations return explicit boundaries, not
  all-input/all-output dependency edges.

The one deliberately broad cell-specific policy is **all A and B input bits to
EACH output bit for supported `$add` and `$sub`**. Under defined Boolean arithmetic,
carry/borrow propagates from low positions upward; a prefix-only rule would be
more precise. But Verilog arithmetic can poison the entire result when any
operand bit is `x/z`, including a high input bit changing a low output bit. For
example, a two-bit operand changing from `00` to `x0` can change bit zero of its
sum with `00` from `0` to `x`. The all-operand policy covers that dependency,
carry/borrow chains, sign extension, truncation, and unknown high operand bits.
This is justified specifically by the pinned add/sub implementations [S], not a
fallback for unknown cells. The former two-state prefix proposal is not the
default and is not implemented here.

## 2. Evidence and toolchain identities

Read the actual preserved JSON and recipes, not hypothetical generated netlists:

- Stock: `docs/hardware/evidence/toolchain/{A,B,C}/design.json`, with `recipe.json`.
- Instrumented: `docs/hardware/evidence/g3-origin-ghc96/results/instrumented/{A,B,C}/design.json`,
  with `recipe-regular.json`.
- Every JSON creator reports **Yosys 0.68, git `38e001a6f`**. Captured
  `docs/hardware/evidence/toolchain/yosys-version.txt` agrees.
- `reader-installation-inventory.json` in the toolchain evidence records
  **yowasp-yosys 0.68.0.0.post1208**. Instrumented recipes and that inventory agree
  on reader launcher SHA256
  `bbe1f96459f45be5b47c53091f34d2a25128336e806c5f9e7f172fa7808f0285`.
  This is a launcher hash, not independently a WASM binary hash.
- All six recipes record stage `bsc-generated-rtl/yosys-hierarchy-proc-noopt`:
  `read_verilog`, `hierarchy -check -top ...`, `proc -noopt`, and JSON/RTLIL capture.
- Hardware provider identity is **yosys-json-v1** (`src/hardware/snapshot.js`);
  stock correspondence is **stock-bluetcl-v1**. Captured BSC version is
  **2026.01, build 9bd39e6f3** (`toolchain/bsc-version.txt`).
- The preserved origin sidecar identifies
  **isolated-bsc-ghc96-root-observer-v1**, BSC source pin
  `9bd39e6f3d54d314a94ce30339a224bb283cbade`, and instrumented compiler SHA256
  `74a8004efdd032860e788dac3ff2d182a62bb3f9f2f79f07314d4774e85d94de`.
  See `g3-origin-ghc96/results/origin-sidecar.json` and
  `g3-origin-ghc96/inputs/execution-identities.json` under evidence.

Cell semantics authority is the official Yosys reference, not either BSC
correspondence/origin provider. Stock and instrumented snapshots remain distinct.

| Corpus | Stock JSON SHA256 | Instrumented JSON SHA256 |
|---|---|---|
| A | `bfbba8b62912548e760141fd07075474df14c2c81067aca5ae83e5e187c6e8a9` | `33aac355602f031448dc824790d591867bb8495863c8e95f9737a862c4f96663` |
| B | `4ac9fd67e0f90147a1748bcbc5dd014262fefbd9994b73b642ae88523653d6b6` | `b0c19ae52fd6d2ead295053bf56cebef998dc890ddfbd200ece6d5bec6978190` |
| C | `b8bce85af868cba26eda55e7f0bd7ed4d7e37dea96f67c172227b6a6e915926a` | `9535602266ce1a278a32fe5bcb80a3fbccc515435ca0fef6f3abe6f0ab0c67fc` |

The machine-readable [census](../evidence/g5/semantics/census.json) includes all
six artifact hashes, creator strings, recipe hashes/commands, module attributes,
formal ports/default parameters, raw and decoded cell parameter variants, actual
port directions/lengths, per-variant cell JSON pointers, constants, and separate
definition/occurrence counts. It records observations, not supported-range claims.

## 3. Exact observed primitive census

Counts apply **separately to each provider**: their type/parameter/port censuses
are identical, not their artifact bytes or snapshot identities. Count each module
definition once. `(a,b,y)` denotes `A_WIDTH,B_WIDTH,Y_WIDTH`.
All observed `A_SIGNED` and `B_SIGNED` values are **0**.

| Actual type | A | B | C | Observed parameter/width combinations |
|---|---:|---:|---:|---|
| `$add` | 2 | 1 | 5 | A `(8,8,8)` x2; B `(8,8,8)`; C `(8,8,8)` x3 and `(12,12,12)` x2 |
| `$sub` | 0 | 1 | 0 | B `(8,8,8)` |
| `$eq` | 1 | 4 | 4 | `(1,1,1)` throughout |
| `$ne` | 0 | 1 | 0 | B `(8,8,1)` |
| `$lt` | 0 | 2 | 0 | B `(8,8,1)` x2 |
| `$logic_and` | 0 | 4 | 0 | B `(1,1,1)` x4 |
| `$logic_or` | 0 | 2 | 0 | B `(1,1,1)` x2 |
| `$logic_not` | 0 | 4 | 0 | `A_WIDTH=1,Y_WIDTH=1,A_SIGNED=0` x4 |
| `$mux` | 2 | 4 | 8 | A `WIDTH=8` x2; B `1` x2 and `8` x2; C `8` x6 and `12` x2 |
| `$pmux` | 0 | 1 | 0 | `WIDTH=8,S_WIDTH=3` |
| `$dff` | 1 | 2 | 4 | `CLK_POLARITY=1`; A `WIDTH=8`; B `1,8`; C `8` x3 and `12` x1 |

Actual primitive ports (all connected lengths agree with their parameters):

| Family | Inputs | Outputs | Roles |
|---|---|---|---|
| Binary arithmetic/comparison/logical | `A[a],B[b]` | `Y[y]` | Arithmetic/compared data; logical predicate operands |
| `$logic_not` | `A[a]` | `Y[y]` | Predicate operand |
| `$mux` | `A[W],B[W],S[1]` | `Y[W]` | A/B data, S select/control |
| `$pmux` | `A[W],B[W*K],S[K]` | `Y[W]` | A default data, B packed branch data, S select/control |
| `$dff` | `D[W],CLK[1]` | `Q[W]` | D data, CLK clock/control, Q state output |

A comparison result used downstream as a mux select does not turn every compared
operand into a select port. Preserve cell-local roles and explain their chain.

Per provider: **53 primitive definition cells = 46 combinational + 7 DFFs**.
Occurrence expansion duplicates A's `mkStage` body: **58 primitive occurrences =
50 combinational + 8 DFFs**. A occurrence counts are add=3, eq=2, mux=4, dff=2;
B and C primitive counts are unchanged.

There are no memory objects, memory cell types, nonempty process objects, or
blackbox/whitebox attributes in these artifacts, and no `x/z` literals in their
cell connection arrays. Absence of literal `x/z` is not proof of two-state runtime
values; the default policy does not use it as such.

### Hierarchy cells, not extra primitive semantics

| Actual type | Count per provider | Observed parameters |
|---|---:|---|
| `mkStage` | A: 2 | Cell `{}` |
| `mkNarrow` | C: 1 | Cell `{}` |
| `mkWide` | C: 1 | Cell `{}` |
| `$paramod\mkBiased\bias=8'00000011` | C: 1 | Cell `{}`; target default `bias="00000011"` |
| `$paramod\mkBiased\bias=8'00001001` | C: 1 | Cell `{}`; target default `bias="00001001"` |

Each has actual inputs `CLK[1],RST_N[1],EN_put[1],put_value[W]`, output `get[W]`,
and empty actual output connections `RDY_get[],RDY_put[]`. W=12 for `mkWide`,
otherwise 8. The formal RDY ports still exist; empty actuals are not fabricated
parent connections. Total cells including hierarchy: A=8, B=26, C=25 definition
cells; A=13, B=26, C=25 occurrence cells.

Resolve a present module definition before primitive-name matching, including
`$paramod...` names. Traverse only verified actual/formal positional bindings and
preserve occurrence identity (especially A left/right). Module cell parameters
must agree with the already specialized target; do not interpret an unevaluated
parameter override or invent primitive semantics for a module. These corpus
module cells all have empty parameter maps.

## 4. Supported range and validation boundary

This section defines the intended profile range; it does not claim that unobserved
combinations have already passed behavioral tests. The supported type set is
exactly the ten combinational types in section 3. Other Yosys types in the shipped
full reference are not implicitly supported.

Validate the complete cell before publishing dependency edges:

1. Check recognized type, no opaque definition, exact expected connection/port
   names and directions, and exact expected semantic parameter keys. Missing,
   extra, or unknown parameters are an unsupported boundary, not defaults.
2. Accept nonempty fully defined binary parameter strings (`0/1` only), decoded
   as unsigned values, or nonnegative safe JSON integers for `write_json
   -compat-int`. Reject `x/z` parameters, booleans, malformed strings, fractional
   or unsafe numbers. Do not confuse binary parameter strings with net bit IDs.
3. Widths are positive integers up to the import's effective `maxVectorWidth`
   (current default 65536). Every actual port length must match. For pmux,
   validate `WIDTH*S_WIDTH` within the same limit before expansion. Respect
   existing lower caller limits and resource bounds; overflow/budget exhaustion
   is an explicit boundary, not silent truncation.
4. Signedness/polarity parameters decode to exactly 0 or 1. Validate the
   family-specific relationships below. A malformed recognized cell is not
   permission to emit a partial guessed mapping.

| Type/family | Exact parameter set | Supported relationship beyond observed census |
|---|---|---|
| `$add,$sub,$eq,$ne,$lt` | `A_WIDTH,B_WIDTH,Y_WIDTH,A_SIGNED,B_SIGNED` | Positive independently varying widths; `A_SIGNED==B_SIGNED`, both 0 or both 1 |
| `$logic_and,$logic_or` | Same five parameters | Positive independently varying widths; each signed flag 0/1; mixed flags allowed by [V] |
| `$logic_not` | `A_WIDTH,Y_WIDTH,A_SIGNED` | Positive independently varying widths; signed flag 0/1 |
| `$mux` | `WIDTH` | Positive W; A/B/Y length W, S length 1 |
| `$pmux` | `WIDTH,S_WIDTH` | Positive W,K; A/Y length W, B length W*K, S length K |
| `$dff` (stop classification only) | `WIDTH,CLK_POLARITY` | Positive W, polarity 0/1, D/Q length W, CLK length 1; never a combinational mapping |

[V] checks matched signs for arithmetic/comparisons. Although [S] uses an
unsigned `else` branch when both flags are not set, that is not authorization to
accept mixed-sign arithmetic/comparison RTLIL rejected by upstream validation.
Binary logical cells explicitly do not require matched signs.

For matched signed arithmetic, operands are sign-extended from their own MSBs
when widening; unsigned operands are zero-extended. Output truncation discards
high result bits. Comparisons align operands to their comparison width using the
same signed/unsigned distinction. All-input arithmetic/comparison mappings retain
these sign-bit dependencies without calculating values. There is no prefix
optimization, even for equal-width unsigned instances or constant operands.

## 5. Normative per-bit dependency rules

Index i is the position in the ordered connection vector (least-significant
position first for these cell ports), not a displayed HDL index label. All rules
apply only after section 4 validation. Each row cites the pinned simulation
implementation [S]; documentation [B], [U], [M] supplies additional contracts.

| Type | Source lines in simlib.v | Output dependency rule |
|---|---|---|
| `$add` | 981-1006 | Every `Y[i]` depends on every `A[j]` and every `B[k]`, data role. Four-state poisoning policy from section 1. |
| `$sub` | 1013-1038 | Same all-operand-to-each-output data policy, including borrow/unknown effects. |
| `$eq` | 790-815 | `Y[0]` depends on all A/B bits; `Y[i>0]` has no dependencies. Verilog `==`, not `===`. |
| `$ne` | 822-847 | `Y[0]` depends on all A/B bits; upper Y bits have no dependencies. Verilog `!=`, not `!==`. |
| `$lt` | 726-751 | `Y[0]` depends on all A/B bits, including signs; upper Y bits have no dependencies. |
| `$logic_not` | 1521-1540 | `Y[0]` depends on all A bits; upper Y bits have no dependencies. Boolean nonzero reduction followed by logical negation, not bitwise inversion. |
| `$logic_and` | 1549-1574 | `Y[0]` depends on all A/B bits; upper Y bits have no dependencies. Logical nonzero predicates, not per-bit AND. |
| `$logic_or` | 1580-1601 | `Y[0]` depends on all A/B bits; upper Y bits have no dependencies. Logical nonzero predicates, not per-bit OR. |
| `$mux` | 1647-1658 | Each `Y[i]`: data from `A[i],B[i]`; select/control from `S[0]`. No cross-bit data edges. |
| `$pmux` | 1699-1731 | Each `Y[i]`: data from `A[i]` and every `B[k*W+i]`, `0<=k<K`; select/control from every `S[k]`. No cross-bit data edges. |
| `$dff` | 2323-2338 | State boundary only. No combinational D-to-Q or CLK-to-Q edge. |

[B] and [U] explicitly state zero extension of Boolean results when Y_WIDTH>1.
Those upper-bit empty dependency sets follow a documented type invariant, not
input-dependent constant propagation or a guessed truncation of operand widths.
Comparison output zero depends on **all operands**, not just their low bits.

### Mux/pmux unknowns and undefined selection

`$mux` is `Y = S ? B : A`. In four-state simulation an unknown select can merge
branch bits; this profile does not perform that merge, infer a value, or prune a
branch. Keeping both same-position data inputs and the select is conservative
for known, unknown, and high-impedance inputs alike.

`$pmux` selects A for zero-hot S and B slice k for one-hot S[k]. **Multiple asserted
selects make the output undefined; it is never modeled as a priority mux.** [S]
contains the misleading title "Priority-encoded multiplexer", but its body and
[M] specify undefined multi-selection. Preserve the original source title in the
capture rather than correcting upstream bytes. Unknown/high-impedance select
values are not guessed into a valid branch; the structural profile retains all
select dependencies and does not claim a defined output or simulate values.

The pmux dependency mapping does not require a proven one-hot assumption:
selectors account for changes in definedness as well as selection, while data
only contributes at the same position in a branch. A path through pmux must
retain its undefined-selection limitation; do not advertise unconditional defined
Boolean behavior. No guards or `parallel_case` attributes discharge this caveat.

## 6. Stop policy and useful corpus paths

- **Sequential:** Q is a state-source boundary; D is a data sink and CLK a clock
  sink. Do not cross `$dff` in either cone direction or via feedback. Negative
  polarity can be recognized but still stops. Other FF/latch types remain
  unsupported sequential boundaries; no asynchronous bypass is inferred.
- **Memory:** stop at memory objects or memory cells, including apparently
  asynchronous read ports. No address/data/clock dependency model is supplied.
- **Blackbox/whitebox:** stop at opaque definitions without traversing their
  internals. A recognized primitive-like name does not override opacity.
- **Unknown/malformed cells:** explicit unsupported type/parameter/port boundary.
  Never apply the add/sub broad rule to an arbitrary cell.
- **Hierarchy:** traverse only validated positional bindings in the same snapshot
  and correct occurrence; stop for unknown/opaque targets or unsupported overrides.
- **Inout/tristate/multiple-driver resolution:** no value-resolution semantics are
  supplied. Preserve physical connectivity, with explicit unresolved boundaries
  wherever cone reasoning would require resolving drivers.
- **Constants:** connection-local terminals, preserving `0/1/x/z` and provenance.
  They are not a reason to discard a supported cell's operand/control incidence.

These ten types cover the real useful paths without adding unrelated Yosys types:

- **A:** stage input +1, enable/reset muxes to register D, root addition, repeated
  left/right stage occurrences. Stop at register Q/D, not across state updates.
- **B:** counter +2/-1, `<4`, `<8`, `!=0`, predicate logic and the three-way pmux.
  Its real default A is **0xAA**, and an ordinary mux has literal S=1; neither
  observation authorizes default branch pruning.
- **C:** 8/12-bit increments, biases **3/9**, and a 12-bit root sum whose narrower
  operand already has four explicit high zero connection bits. There is no
  `$concat`/`$slice` primitive in this census; reuse actual ordered connectivity.

## 7. Independent reference validation

The initial documentation-only census preceded implementation. The implemented
`experiments/hardware/g5/cell-reference.cjs` is now exercised by
`test/hardware-analysis-semantics-reference.test.js` against real imported cells
and public worker-backed queries. The current recorded run covers 101 domains,
104,432 assignments, 1,049,076 transitions and 1,153,508 evaluations, witnesses
565 dependencies, and rejects 514 mutations. The validation matrix links the
execution evidence. This is independent reference execution, not a new native
simlib simulator or compiler run. Larger pmux cases are targeted, not falsely
claimed exhaustive.

The verification contract is:

Use an independent small four-state reference derived from [S], or execute the
unmodified pinned simlib with an independently available four-state simulator.
Do not reuse the product dependency generator in the oracle. For each small legal
cell configuration, enumerate assignments over `{0,1,x,z}`; change one input
position at a time while holding other positions fixed. Whenever an output symbol
changes (including defined-to-unknown), require a corresponding dependency edge.
Check expected structural supersets separately: soundness alone cannot reject an
unwanted generic all-input/all-output implementation. Include literal connections
as incidence expectations even though constants do not vary in the real netlist.

| Type/family | Small independent reference cases and assertions |
|---|---|
| `$add` | Widths 1-3, unequal operand/output widths, matched signed/unsigned, carry chains, sign extension/truncation, high `x/z` poisoning low output. Require all operand bits at every Y; integer addition oracle for defined cases, four-state oracle for poisoning. |
| `$sub` | Same width/sign coverage; independent subtraction modulo output width for defined inputs; `0-1`, borrow chains, unknown/high-impedance poisoning. |
| `$eq` | Independently sized signed/unsigned comparisons, equality and definite mismatches with unknown bits; output0 sees all operands, upper outputs remain zero with no edges. |
| `$ne` | Independent inequality reference, not product logic inversion reused as oracle; same unknown and width/sign boundaries. |
| `$lt` | Signed negative/positive and unsigned ordering; unequal widths, every bit position, `x/z` producing unknown comparison; zero extension above output0. |
| `$logic_not` | Multi-bit zero/nonzero/unknown vectors, including known one plus unknown bits; upper Y invariants. |
| `$logic_and` | Four-state nonzero predicates and controlling false operand; enumerate both operands, do not prune masked incidence. |
| `$logic_or` | Four-state nonzero predicates and controlling true operand; retain masked incidence and verify upper Y invariants. |
| `$mux` | W=1-3; select `0/1/x/z`, equal/different/unknown data, literal selects, bit merging reference; require exactly same-position data and select roles, no cross-bit data edges. |
| `$pmux` | W,K=1-3; all select patterns including zero-hot, one-hot, multi-hot, x/z; use pinned body for four-state reference, never a priority oracle. Require all select bits at every Y, correct `k*W+i` slices, undefined multi-hot behavior, no cross-bit data. |
| `$dff` | Recognized positive/negative polarity boundaries; no combinational traversal from D/CLK to Q or backward, including feedback. Unknown polarity/width produces unsupported boundary. |
| Hierarchy types in section 3 | Independently compare raw JSON actual/formal vectors to cone boundary crossings; repeated A stages must not share identities; C bias specializations and 8/12-bit paths stay distinct; empty RDY actuals stay unconnected. |

Boundary tests must reject missing/extra parameters, malformed binary strings,
x/z parameter values, unsafe numbers, zero/oversized widths, mismatched connection
lengths/directions, invalid or mixed arithmetic/comparison signedness, unknown
cells, unsupported overrides, memories, blackboxes and unresolved inouts. Assert
no guessed edges are emitted on rejection. Signed/unequal-width/wide-Boolean-Y
cases are deliberately beyond the observed census but within the documented
supported range and must be validated before claiming implementation coverage.

Real-corpus checks should load the six captured JSON files without regenerating
fixtures: assert exact type/variant counts, positional paths and terminals above,
then independently compute expected bit sets from raw connections. Tests should
assert machine-consumed profile identities, bit sets, roles and boundaries, not
pin this prose. There is no timing behavior here: no sleeps, polling or probabilistic
test passes. Do not present the census or reference hash checks as a substitute
for these behavioral soundness tests.

## 8. Pinned official references and offline capture

Revision: **`38e001a6ff74ca434bf4cc02c053f53619160ab0`**, resolved from the captured
reader's `38e001a6f`. Every reference below uses that immutable revision, not main,
latest documentation, or an inferred version tag.

The full original simlib is preserved under
`docs/hardware/evidence/g5/semantics/upstream/techlibs/common/simlib.v`.
Its **78,616 bytes** have SHA256
**`e79c08085225bdc6f52ce99f128328158009a33b8ea0c8c273011dfde370561d`** and match
both the static upstream HTTPS response and the installed file at
`.build/hardware/toolchain/tools/venv/lib/python3.14/site-packages/yowasp_yosys/share/simlib.v`.
The original copyright/license header remains untouched. Full upstream COPYING
(ISC) is also preserved; SHA256
`6998b5724d4cb3f459d1c12b6bd0cdbfa9c949ef14d0fb6d7d97d97404e5b5f3`.

| Ref | Official pinned source | Offline relative to evidence/g5/semantics/upstream |
|---|---|---|
| [S] | [Simulation library](https://github.com/YosysHQ/yosys/blob/38e001a6ff74ca434bf4cc02c053f53619160ab0/techlibs/common/simlib.v) | `techlibs/common/simlib.v` |
| [B] | [Binary operators](https://github.com/YosysHQ/yosys/blob/38e001a6ff74ca434bf4cc02c053f53619160ab0/docs/source/cell/word_binary.rst) | `docs/source/cell/word_binary.rst` |
| [U] | [Unary operators](https://github.com/YosysHQ/yosys/blob/38e001a6ff74ca434bf4cc02c053f53619160ab0/docs/source/cell/word_unary.rst) | `docs/source/cell/word_unary.rst` |
| [M] | [Multiplexers](https://github.com/YosysHQ/yosys/blob/38e001a6ff74ca434bf4cc02c053f53619160ab0/docs/source/cell/word_mux.rst) | `docs/source/cell/word_mux.rst` |
| [V] | [RTLIL validation, lines 1697-1921](https://github.com/YosysHQ/yosys/blob/38e001a6ff74ca434bf4cc02c053f53619160ab0/kernel/rtlil.cc#L1697-L1921) | `kernel/rtlil.cc` |
| License | [COPYING](https://github.com/YosysHQ/yosys/blob/38e001a6ff74ca434bf4cc02c053f53619160ab0/COPYING) | `COPYING` |

The [capture manifest](../evidence/g5/semantics/manifest.json) records exact raw
HTTPS URLs, revision, paths, lengths and SHA256 for every original source file,
plus the derived census hash. Sources retain their original bytes, including
upstream wording/typos and license headers. This is static reference evidence,
not a compiler installation, a vendored build dependency, or a claim to support
all types described by the full files. HTTPS/byte identity is not a signed-release
attestation. Saved-byte verification, census derivation, and the bounded
independent-reference checks in section 7 have separate evidence.
