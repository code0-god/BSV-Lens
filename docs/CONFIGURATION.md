# `.bsv-arch.json` reference

Optional JSONC file at workspace root. Line/block comments are accepted.

Version 1 remains supported. New starter files use version 2, but v0.3 features do not require
manually migrating existing files.

## Complete example

```jsonc
{
  "version": 2,
  "title": "BSV Architecture",
  "sourceRoots": ["hw/bsv/src"],
  "exclude": ["**/tb/**"],
  "entrypoints": ["mkTop"],

  "groups": [
    {
      "id": "control",
      "label": "Control",
      "match": "hw/bsv/src/control/**",
      "description": "Control-plane modules",
      "order": 10
    }
  ],

  "nodes": {
    "mkTop": {
      "label": "Top",
      "group": "control",
      "entry": true
    }
  },

  "virtualNodes": [
    {
      "id": "host",
      "label": "Host Runtime",
      "kind": "host",
      "group": "control"
    }
  ],

  "edges": [
    {
      "from": "host",
      "to": "mkTop",
      "kind": "control",
      "mode": "structure",
      "label": "commands",
      "description": "Configured control path",
      "evidence": "System architecture document",
      "bidirectional": false
    }
  ],

  "scheduling": {
    "provider": "auto",
    "bscExecutable": "bsc",
    "topModule": "",
    "workingDirectory": ".",
    "sourcePaths": [],
    "arguments": [],
    "reportFiles": [],
    "timeoutMs": 30000,
    "includePotentialDependencies": true
  },

  "view": {
    "direction": "LR",
    "showPackages": false,
    "showImports": false,
    "showPrimitives": false
  }
}
```

## Top-level fields

### `version`

- `1`: fully supported legacy format
- `2`: current starter format

Normalizer emits internal config `schemaVersion: 2` for both.

### `title`

Webview title and default export basename.

### `sourceRoots`

Workspace-relative directories searched recursively for `.bsv`.

When omitted, extension checks `hw/bsv/src`, `bsv/src`, and `src`, then workspace root.

### `exclude`

Additional glob patterns. Built-in `.git`, `node_modules`, build, out, generated, and target
exclusions remain active.

### `entrypoints`

Module names or exact node IDs treated as architecture roots.

### `groups`

System-level subsystem containers.

Fields:

- `id`
- `label`
- `match`
- `description`
- `order`

First ordered matching group wins.

### `nodes`

Overrides keyed by exact ID, declaration name, or package-qualified name.

Supported values:

- `label`
- `kind`
- `group`
- `description`
- `hide`
- `entry`

### `virtualNodes`

Configured architecture elements without BSV declarations.

Supported values:

- `id`
- `name`
- `label`
- `kind`
- `group`
- `description`
- `entry`
- `hide`

Normalized IDs use `virtual:` prefix.

### `edges`

Manual architecture relations.

Fields:

- `from`, `to`: exact ID or resolvable name
- `kind`
- `mode`: optional `structure`, `data-flow`, or `scheduling`
- `label`
- `description`
- `evidence`
- `bidirectional`

When `mode` is omitted:

- `data`, `read`, `write`, `invoke`, `return`, `value`, `producer`, `consumer` use Data Flow
- scheduling relation kinds use Scheduling
- remaining kinds use Structure

Normalized manual edges use `origin: "config"` and `confidence: "explicit"`.

### `scheduling`

#### `provider`

- `auto`: configured report, supported BSC invocation, source fallback
- `source`: source attributes and optional potential dependencies
- `bsc`: request BSC; unavailable compiler produces diagnostic and source fallback
- `off`: disable scheduling relations

#### `bscExecutable`

Executable path or name. Default: `bsc`.

No shell command string is built. Executable and arguments are passed separately.

#### `topModule`

Top module supplied through BSC `-g`. `auto` does not invoke BSC without either
`topModule` or readable `reportFiles`.

#### `workingDirectory`

Workspace-relative BSC working directory. Default: `.`.

#### `sourcePaths`

Additional BSC source paths. They are passed as one platform-delimited `-p` value while
retaining BSC's current path.

#### `arguments`

Additional literal BSC arguments. Do not include shell quoting.

#### `reportFiles`

Schedule report paths, resolved from `workingDirectory`. Readable reports take priority over
compiler invocation and work without BSC installed.

#### `timeoutMs`

Compiler/help timeout. Normalized to 1,000–120,000 ms. Default: 30,000.

#### `includePotentialDependencies`

When `true`, shared state read/write pairs create dashed
`potential-state-dependency` edges. These remain heuristic, never compiler conflict.

### `view`

Legacy project-level visual defaults:

- `direction`: `LR` or `TB`
- `showPackages`
- `showImports`
- `showPrimitives`

Interactive Source Scope, Level, Mode, hop, collapse, trace, and transform are stored in
Webview state rather than project config.

## Node references

Accepted references:

- exact ID: `module:Package.mkTop`
- declaration name: `mkTop`
- package-qualified name: `Package.mkTop`
- virtual ID: `host` or `virtual:host`

Use exact IDs when names are ambiguous. Complete JSON export contains them.

## Source annotations

Architecture annotations immediately above declarations:

```bsv
// @arch.group compute
// @arch.label Compute Pipeline
// @arch.entry
module mkCompute(ComputeIfc);
```

Supported:

- `@arch.group`
- `@arch.label`
- `@arch.kind`
- `@arch.description`
- `@arch.entry`
- `@arch.hide`

BSV scheduling attributes remain standard `(* ... *)` attributes and are not `@arch`
annotations.

## Precedence

Node metadata precedence:

1. parser defaults
2. source-path group
3. source annotation
4. `nodes` override

Project edge/scheduling configuration does not relabel Source-derived or BSC facts.

## VS Code settings

| Setting | Default | Notes |
|---|---|---|
| `bsvArchitecture.defaultSourceScope` | `workspace` | `workspace` or `current-file` |
| `bsvArchitecture.defaultLevel` | `system` | `system`, `module`, `behavior` |
| `bsvArchitecture.defaultMode` | `structure` | `structure`, `data-flow`, `scheduling` |
| `bsvArchitecture.defaultHopScope` | `all` | `1`, `2`, `3`, `all` |
| `bsvArchitecture.syncWithEditor` | `true` | Debounced source-to-diagram reveal |
| `bsvArchitecture.showMethodPorts` | `true` | Logical BSV Method Ports |
| `bsvArchitecture.collapseModuleMembers` | `true` | Module member default |
| `bsvArchitecture.includePotentialScheduleDependencies` | `true` | Source heuristic |
| `bsvArchitecture.showPrimitives` | `false` | Legacy default filter |
| `bsvArchitecture.autoRefresh` | `true` | Source/config watcher |
| `bsvArchitecture.enableCodeLens` | `true` | Source navigation |
| `bsvArchitecture.maxFiles` | `750` | Maximum discovered BSV files |
| `bsvArchitecture.exclude` | build paths | Additional glob exclusions |

`bsvArchitecture.defaultView` is deprecated but retained:

- `system` migrates to `defaultSourceScope: workspace`
- `file` migrates to `defaultSourceScope: current-file`

## Trust and fallback

Source analysis and configured report reads remain available without BSC. Compiler execution
requires trusted workspace. Missing executable, missing capability, timeout, cancellation, or
compiler failure returns Source-derived fallback instead of failing extension analysis.
