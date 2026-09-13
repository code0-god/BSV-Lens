# ADR 003: one actual process-lowered hierarchical reader stage

Status: proposed for G1 approval, backed by the actual three-design experiment.

Decision: first provider reads Yosys JSON emitted from BSC-generated Verilog.
The measured stage is `bsc-generated-rtl/yosys-hierarchy-proc-noopt`.
The actual reader profile is:

```text
read_verilog <actual generated RTL files>
hierarchy -check -top <actual selected top>
write_rtlil <pre-lowering evidence>
proc -noopt
write_json <output>
write_rtlil <output>
```

The files and exact commands, including fixture-specific parameters, are in
`evidence/toolchain/{A,B,C}/recipe.json`. These are demonstrated commands, not
a proposed BSC exporter. `proc` performs documented lowering passes even with
`-noopt`; the raw log is authoritative. This is not untouched Verilog AST or
technology-mapped hardware.

The small measured fixtures require no external Verilog library input.
The recipes record that empty set rather than claiming untested library-reader
coverage. BSC package dependencies and compiler libraries are hashed separately.

Measured tools: BSC `2026.01 (build 9bd39e6f3)` and YoWASP-packaged
Yosys `0.68 (git sha1 38e001a6f)`. Reader installation is isolated under `.build`;
the actual package/dependency versions and licenses are recorded. Nothing is
bundled with the extension or installed into a user global toolchain.

BSC `-elab` exposes actual Bluetcl metadata. Baseline-versus-metadata RTL is
compared separately; do not assume every future flag is non-functional.
The optional `-keep-fires` control experiment is a separate build, not silently
substituted for the baseline or used to invent missing default fire signals.

Rejected: nonexistent BSC netlist-export flags, source-regex wires, automatic
`synth`, flattening or optimizing to make a drawing smaller; several unfinished
reader backends; a new Verilog parser where a real reader already works.

Consequences: structural support is declared for the emitted JSON stage.
Reader-preserved black-box/library contracts remain visible, with unknown
internals. Generated RTL `src` is retained without elevating it to BSV.
Future optimized/technology stages require their own snapshots and evidence.
Inspect FEASIBILITY for parameters, control cells, mapping coverage and exact
stock-compiler provenance limits before approving G3.
