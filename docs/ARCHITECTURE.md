# Extension architecture

## Pipeline

```text
VS Code workspace
      │
      ▼
WorkspaceAnalyzer
  - source-root detection
  - .bsv-arch.json loading
  - bounded concurrent reads
      │
      ▼
BSV source parser
  - comments/strings masked
  - balanced delimiter scanning
  - package/module/interface/function/type extraction
      │
      ▼
Architecture graph builder
  - stable node IDs
  - hierarchy/implements/call/access relationships
  - user grouping and manual relationships
      │
      ▼
Architecture IR (JSON)
      │
      ▼
VS Code Webview
  - dependency-free SVG renderer
  - grouped and ranked layout
  - drill-down, pan/zoom, search, export
```

The extension host owns file access and source navigation. The Webview receives a serializable model and never reads the workspace directly.

## Architecture IR

The top-level model contains:

- `schemaVersion`
- `title`, `workspaceName`, `workspaceUri`, `activeFile`
- normalized `config`
- `files`
- `nodes`
- `edges`
- `groups`
- `roots`
- `diagnostics`
- `stats`

Representative node kinds:

- `package`
- `module`
- `interface`
- `function`
- `rule`
- `method`
- `enum`, `struct`, `union`, `type`
- `instance`
- `register`, `fifo`, `memory`, `wire`, `vector`
- arbitrary virtual kinds such as `host`, `dma`, `dram`

Representative edge kinds:

- `contains`
- `import`
- `implements`
- `instantiate`
- `call`
- `access`
- user-defined `data` and `control`

Every source-backed node carries a URI and zero-based line/column range.

## Parser strategy

The parser is intentionally source-oriented rather than compiler-complete.

1. Comments and string contents are replaced by spaces while preserving offsets and newlines.
2. Keyword candidates are located in the masked source.
3. Parentheses, brackets, and braces are balanced before statement termination is accepted.
4. Module spans are recorded so top-level and local declarations can be distinguished.
5. Module bodies are inspected for instances, rules, methods, provided interfaces, and local functions.
6. Calls and direct instance references are resolved against workspace symbols.

This avoids the common failure mode where comments, strings, nested type arguments, or multiline provisos are parsed as declarations.

## Webview security boundary

- `default-src 'none'`
- scripts are enabled only through a per-document nonce
- CSS and JavaScript are loaded only from the extension's `media` directory
- source file access stays in the extension host
- export paths are selected through VS Code's save dialog
- text is inserted with `textContent`; source text is not interpolated into HTML

## Layout

At system scope, configured subsystem groups are placed in declared order and rendered as architecture containers. Within a drill-down scope, a bounded rank layout uses hierarchy and relationship edges to place an owner, behavior nodes, storage instances, and implementation targets.

The renderer uses real SVG marker arrowheads. It does not construct arrows by combining text glyphs.

## Future compiler-backed adapter

A compiler-backed adapter can be added without changing the Webview by translating BSC/Bluetcl elaboration output into the same IR. Source locations and annotations can then be merged with elaborated module instances. The current source adapter remains useful when BSC is not installed or a file is incomplete.
