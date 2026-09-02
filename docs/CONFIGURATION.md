# `.bsv-arch.json` reference

The file is optional and is read from the workspace root. JSON with line and block comments is accepted.

## Top-level fields

### `version`

Configuration schema version. Current value: `1`.

### `title`

Title shown in the Webview and used as the default export name.

### `sourceRoots`

Workspace-relative directories recursively searched for `.bsv` files.

```json
"sourceRoots": ["hw/bsv/src", "hw/bsv/generated-contracts"]
```

When omitted, the extension checks `hw/bsv/src`, `bsv/src`, and `src`, then falls back to the workspace root.

### `exclude`

Additional glob patterns. Built-in build, generated, target, `.git`, and `node_modules` exclusions remain active.

### `entrypoints`

Module names or exact node IDs that should be treated as architecture roots.

### `groups`

Subsystem containers used by the system view.

```json
{
  "id": "memory",
  "label": "Memory Subsystem",
  "match": "hw/bsv/src/memory/**",
  "description": "Banked local memories and staging",
  "order": 20
}
```

The first ordered matching group wins.

### `nodes`

Overrides keyed by exact node ID, plain declaration name, or package-qualified name.

Supported values:

- `label`
- `kind`
- `group`
- `description`
- `hide`
- `entry`

### `virtualNodes`

Architecture elements that are meaningful but not declared as BSV modules, such as host runtime, DMA, NoC, or off-chip memory.

Supported values:

- `id`
- `name`
- `label`
- `kind`
- `group`
- `description`
- `entry`
- `hide`

The normalized ID is prefixed with `virtual:`.

### `edges`

Manual architecture relationships.

```json
{
  "from": "mkLoadController",
  "to": "activation-dma",
  "kind": "control",
  "label": "read requests",
  "description": "Provider-side activation fetch"
}
```

Common kinds are `data` and `control`, but any string is accepted. Inferred edges remain separately marked in the exported IR.

### `view`

- `direction`: `LR` or `TB`
- `showPackages`: boolean
- `showImports`: boolean
- `showPrimitives`: boolean

## Annotation precedence

Node configuration is applied in this order:

1. parser defaults
2. source path group
3. source annotation
4. `nodes` override

An explicit `.bsv-arch.json` node override therefore has the highest priority.
