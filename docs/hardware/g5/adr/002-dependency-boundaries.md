# ADR G5-002: Conservative dependencies and state boundaries

Status: accepted for the explicitly authorized G5 implementation.

The default profile is pinned to actual Yosys 0.68 reference semantics.
It represents possible structural dependence, not current values, active
paths, time, readiness or complete origin.

Validate type, parameter encodings, signedness, actual widths and port roles.
For add/sub, use all operand bits per output bit to include four-state
poisoning as well as carry/borrow. Mux data stays positional, select edges
are control, and pmux multi-selection remains undefined. Do not prune
constants or assume two-state runtime signals.

Unknown types have no fallback internal edges. Registers, latches, memories,
blackboxes, unsupported parameters/directions, scope and resource limits
produce explicit boundaries/frontiers. D and Q are not equivalent. A
next-state analysis is an explicit new request, never an invisible extension
of a combinational cone.

Independent small references check soundness and structural precision.
Supported semantics coverage is separate from source-origin coverage.
