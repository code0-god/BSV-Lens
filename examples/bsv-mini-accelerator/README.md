# Mini BSV accelerator workspace

Open this directory in VS Code and run **BSV Lens: Open Workspace Architecture**.
It is a parser and visualization fixture; it is not intended to be synthesized.

The fixture exercises all v0.3 analysis modes:

- **Structure:** top module, child modules, and two statically repeated systolic-array instances.
- **Data Flow:** register reads/writes, FIFO enqueue/first/dequeue, and interface calls.
- **Scheduling:** explicit urgency/mutual-exclusion attributes plus potential shared-state dependencies.

`AcceleratorControllerIfc` includes Action, value, and ActionValue methods. `BankedRow`
retains unresolved numeric type parameters so width resolution visibly distinguishes exact
and unresolved types. Project config intentionally remains version 1 to exercise
backward-compatible normalization.
