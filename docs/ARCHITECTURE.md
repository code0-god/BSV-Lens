# Extension architecture

## Pipeline

```text
VS Code workspace
      │
      ▼
WorkspaceAnalyzer
  - source-root detection
  - version 1/2 .bsv-arch.json normalization
  - bounded concurrent reads
  - optional schedule provider selection
      │
      ├───────────────┐
      ▼               ▼
BSV source parser    BscScheduleProvider
  - masked source      - report-files first
  - declarations       - trust/capability gate
  - behavior access    - timeout/cancellation
  - source attributes  - isolated compiler output
      │               │
      └───────┬───────┘
              ▼
Architecture graph builder
  - schema version 2
  - hierarchy and member buckets
  - interface/module contracts
  - directional data flow
  - scheduling provenance
  - type widths and Method Ports
              │
              ▼
Serializable Architecture IR
              │
              ▼
VS Code Webview
  - indexed graph view model
  - independent source/level/mode/hop axes
  - dependency-free SVG renderer
  - inspector, trace, state, export
```

Extension host owns workspace I/O, optional process execution, save dialogs, and source
navigation. Webview receives serialized IR and never reads workspace files or executes tools.

## Source analysis

`src/architecture/parser.js` keeps regex-based declaration discovery but delegates token-aware
work:

- `source-utils.js`: comment/string masking, balanced delimiters, top-level splitting,
  source annotations, BSV attribute scanning
- `behavior-analysis.js`: primitive operation map and directional access evidence
- `type-analysis.js`: conservative exact-width resolver
- `scheduling.js`: independent source scheduling provider

Masking replaces comment and string content with spaces while preserving offsets and newlines.
Keyword candidates therefore retain source locations without accepting fake syntax.

Module bodies retain:

- instances and primitive classification
- rules, methods, local functions, provided interfaces
- guards, calls, references
- structured `accesses`, `reads`, `writes`, `invocations`
- immediately leading scheduling attributes

Each access includes callable, instance, member, line, classification, snippet, origin, and
confidence. Unknown member chains remain `unclassified-access`.

## Architecture IR schema version 2

Top-level fields:

- `schemaVersion`
- `title`, `workspaceName`, `workspaceUri`, `activeFile`
- normalized `config`
- `viewDefaults`
- `files`, `nodes`, `edges`, `groups`, `roots`
- `interfaceContracts`
- `scheduling`
- `diagnostics`, `stats`

Existing schema version 1 fields remain. JSON export always writes complete, unfiltered IR.

### Node contract

Source-backed nodes preserve existing fields and may add:

- `ownerId`
- `memberGroup`
- `sourceRange`
- `ports`
- `reads`
- `writes`
- `invocations`
- `scheduleRelations`
- `analysisOrigin`
- `confidence`
- `sourceEvidence`

Module nodes contain `memberBuckets`:

```js
{
    methods: {
        totalCount: 12,
        visibleCount: 0,
        collapsed: true,
        memberNodeIds: ["method:..."]
    }
}
```

Buckets are Interfaces, Methods, Rules, Local Functions, State, Child Instances, and Types.
Methods, Rules, Local Functions, and State default to collapsed.

Method Ports stay metadata, not extra graph nodes. This prevents interface-heavy modules from
inflating System level while retaining parameter, return, category, direction, width, guard,
and declaration evidence.

### Interface/module contracts

Modules with a resolved return interface receive one source-derived semantic contract:

```js
{
    interfaceId,
    moduleId,
    status: "exact" | "mismatch" | "unresolved",
    methods: [],
    diagnostics: [],
    analysisOrigin: "Source-derived"
}
```

Validation compares method presence, duplicate implementations, category, parameter count,
return type, and only confidently comparable parameter types. Generic type expressions that
cannot be specialized from source remain `unresolved`; they are never reported as definite
mismatches.

### Edge contract

Every edge can carry:

- `kind`
- `mode`: `structure`, `data-flow`, or `scheduling`
- `origin`
- `confidence`
- `evidence`
- `sourceLocation`
- `compilerLocation`
- `bidirectional`
- `inferred`

Deduplication key is normalized `source + target + kind + evidence`. Labels do not create
duplicate semantic relations.

## Data Flow projection

`behavior-analysis.js` centralizes primitive operations instead of spreading method-name
checks across parser expressions.

Projection direction:

- state read: state node to rule/method
- state write: rule/method to state node
- Action call: caller to instance
- value method: instance to caller
- ActionValue: request caller to instance plus result instance to caller
- unknown access: caller to instance as `access`

Example:

```text
produce --write/enqueue--> FIFO --read/first,dequeue--> consume
```

These edges are Source-derived. They are not compiler elaboration or RTL connectivity.

## Type-width analysis

`type-analysis.js` returns only:

```js
{ bits: 32, status: "exact", origin: "Bit#(32)" }
```

or:

```js
{ bits: null, status: "unresolved", reason: "numeric type parameter width" }
```

Supported forms are intentionally bounded: Bool, literal Bit/UInt/Int widths, direct aliases,
fully resolved structs, enum tags, Maybe payloads, and Tuple2/3/4. Type-level arithmetic,
proviso solving, parameterized aliases, unknown external types, malformed expressions,
cycles, and overflow remain unresolved.

## Scheduling layers

### Source attribute layer

Recognized attributes:

- `descending_urgency`
- `execution_order`
- `mutually_exclusive`
- `conflict_free`
- `preempts`

Edges use `origin: "source-attribute"` and `confidence: "explicit"`.

### Heuristic state layer

Rules/methods sharing state where at least one writes create
`potential-state-dependency`. These edges use:

- `origin: "source-heuristic"`
- `confidence: "potential"`
- bidirectional dashed rendering
- evidence such as `A writes state; B reads state`

They never become `conflict`.

### BSC layer

`src/compiler/bsc-schedule-provider.js` supports report files and an optional compiler
invocation.

1. Read configured `.sched` reports.
2. For invocation, require trusted workspace.
3. Probe `bsc -help`; use `-help-hidden` when public help omits required capability.
4. Require advertised `-show-schedule` and `-show-rule-rel-all`.
5. Invoke executable and argument array separately.
6. Use isolated temporary `bdir`, `simdir`, and `info-dir`.
7. Stream stdout/stderr to Output Channel.
8. Honor cancellation and bounded timeout.
9. Parse generated report, then remove temporary output.

BSC relations use `origin: "bsc"` and `confidence: "authoritative"`. Source heuristic edges
remain in IR; overlapping BSC edges reference them as supporting evidence.

## View model and performance

`media/graph-view.js` is UMD/CommonJS so browser code and `node:test` use identical logic.

Model update builds these indexes once:

- node and edge by ID
- owner children
- relations by node
- edges by analysis mode
- adjacency by analysis mode

Rendering first derives visible graph, then lays it out, then creates SVG DOM. System level
never materializes rule/method/state nodes. BFS reads cached adjacency maps. Inspector uses
relation indexes. Search changes classes through a debounce instead of reparsing or relayout.

Layout sorting, rank caps, hash-based edge offsets, and group order are deterministic for the
same visible input.

## Webview state

`vscode.setState()` stores:

- workspace and active file
- source scope
- abstraction level
- analysis mode
- hop scope
- focus stack and selected node
- collapsed groups and expanded aggregations
- filters and search
- trace paths/index
- pan/zoom transform

Migration accepts v0.2 `mode: system|file`, `expandedModules`, `hops`, and older focus fields.
Host serializer restores current-file URI relative to workspace.

## Source/diagram synchronization

Parser source ranges become node `sourceRange`. `symbol-index.js` chooses smallest range
containing current editor cursor. Panel debounces selection events and sends `revealNode`
without re-analysis. Webview highlights visible nodes; off-focus nodes produce a user action
instead of silently changing graph scope.

## Webview security boundary

- `default-src 'none'`
- per-document nonce scripts
- CSS/JavaScript only from packaged extension resources
- no CDN or runtime dependency
- source content inserted with DOM `textContent`
- workspace and save I/O stays in Extension Host
- BSC executable receives an argument array, never a concatenated shell command
- Restricted Mode keeps workspace-contained source/config/report reads available
- BSC execution and external reports/working directories are disabled in untrusted workspaces
- local paths use resolved real paths and containment checks, including symlink escapes

## Export

- SVG clones only current visible/collapsed/focused diagram and embeds standalone styles.
- JSON serializes complete Architecture IR with origin/evidence.

## Accuracy boundary

- Source parser is not a complete BSV compiler.
- Source-only instance multiplicity may remain parameterized or unresolved.
- Potential state dependency is not compiler conflict.
- Unknown width is never estimated.
- Only BSC provider output is Compiler-authoritative.

## Product architecture direction

BSV Lens centers BSV architecture and code analysis: instantiated hardware, typed
interface/method flow, state and behavior relationships, rule/method scheduling, and source
evidence. Source/package maps remain secondary. The v0.4.0 direction is
`Definition -> Instance -> Endpoint -> Protocol Channel -> Semantic Flow -> Presentation`;
v0.3.2 records this direction without implementing the future Architecture Flow UI.
