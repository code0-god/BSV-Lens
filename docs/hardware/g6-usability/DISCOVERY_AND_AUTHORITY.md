# Workspace discovery and authority

The experimental command authorizes bounded, static source discovery in the
selected open workspace folder. Extension activation does not scan or execute
anything. Each folder has its own native panel, registry, source session and
design history. Overlapping workspace folders do not analyse the same URI twice.
Local desktop `file` workspaces are supported; remote, virtual and web hosts
retain the explicit G6 unsupported boundary.

## Input and analysis scope

Discovery finds case-insensitive `.bsv` files throughout the folder, including
deep directories and mixed repositories. Open file documents inside that folder
participate; their unsaved contents are not silently substituted for disk bytes.
The inventory distinguishes included files, configured exclusions, unanalysed
files, incomplete search results and dirty documents.

The source index uses the existing parser. It lists module definitions before
elaborating every possible design. The user chooses a source design when choices
are ambiguous. Its descriptor is the exact logical path, source revision and
definition ID. A selected definition is a source-derived entry, not a claim that
the compiler selected that chip top. The existing semantic builder analyses that
entry and its verified source dependency closure. Index size and analysed-file
count are separate, and the excluded-from-design scope remains recorded.

For current AQuA, the complete inventory has 69 BSV files. The selected Memory
design uses 11 dependency files and Loop uses 7. Testbench-like paths are candidate
classifications, not grounds for deleting their source or assuming a top. A
function/type-only inventory receives a distinct no-module explanation.

Unresolved libraries stay unresolved. Discovery never searches parents, home
directories or unrelated projects. The existing manual source registration is
an explicit alternative input scope; it does not infer cross-project wiring.

## Rules and limits

Reuse `bsvArchitecture.autoRefresh`, `syncWithEditor`, `exclude`, `maxFiles` and
`maxSourceBytes`. New settings are `hardwareAutoDiscover` and `hardwareInclude`.
These keep the existing `bsvArchitecture.*` namespace and VS Code configuration
scope rules. The native Settings action opens the normal extension settings.
Per-folder `.bsv-arch.json` contributes static source roots/exclusions only;
scheduling, commands, compiler recipes and executable fields are not run.

Custom source rules use bounded matching for the existing simple `*`, `**` and
`?` patterns. Explicit includes can override configured source exclusions.
Names such as build, out, vendor and testbench are not permanent authority bans.
Known tool/cache directories and the exact product evidence subtree are excluded
from automatic search; explicit manual registration remains a separate path.

Native discovery caps candidates at 1,024, source files at 256 and total source
bytes at 16 MiB. The effective file count is the lower of the configured and
native limits. The configured per-file limit is enforced during the bounded
read; existing registry registration has its own 16 MiB hard ceiling. Search has
a 10-second deadline and bounded pattern work. Reaching a cap is partial, never
proof that the entire workspace was inventoried. Model/query/scene and message
limits remain separate existing G2/G3/G5/G6 constraints.

`findFiles` is called with explicit exclusions and cancellation. Its undefined
exclude default covers `files.exclude`, not `search.exclude`; the adapter records
which rules it actually applies. Recursive watchers can be affected by
`files.watcherExclude`; exact registered-file watches and document-save events
complement them. [VS Code API](https://code.visualstudio.com/api/references/vscode-api),
[target 1.90 API declarations](https://github.com/microsoft/vscode/blob/1.90.0/src/vscode-dts/vscode.d.ts).

## Changes, cancellation and publication

Create, external change, delete, rename, save, workspace-folder and configuration
events are coalesced. Ordinary file changes reuse the bounded inventory and
unchanged parse records; configuration changes rescan the permitted scope.
No whole-repository analysis runs per keystroke. The semantic graph is rebuilt
for the selected source scope after a revision change; this is not a claim of
fully incremental semantic dependency evaluation.

The opaque source-session cache is private to the product and bounded to
256 records/32 MiB. Neither a manifest nor a Webview can supply trusted ASTs.
Registry bytes and hashes are checked again, and disposal aborts actual workers.

A changed input is staged. Source freshness is checked again before publication,
including the interval before a debounced watcher fires. A valid refresh preserves
the current owner and selection only after the new Scene Query resolves their
canonical identities and source locations. Old queries and source ranges are not
copied into the new revision. A removed/moved target receives an explicit notice.

Native publication checkpoints preserve the last acknowledged scene, history,
selection, viewport and catalog. Failed publication restores that state; late
rejections cannot undo newer intent. Empty input uses an explicit null commit.
Same-revision design visits retain bounded prepared contexts for Back; revision
changes discard obsolete history only after a valid replacement commits.

## Artifacts and trust

Source analysis starts independently. An explicit artifact-folder action offers
bounded Yosys JSON candidates with size, module names, declared tops and hashes.
A format probe is not a connectivity, freshness or source-correspondence proof.
The user chooses a candidate; the original importer revalidates its bytes.
Malformed data and multiple candidates never trigger an automatic choice or join.

For automatically discovered source, an unmapped artifact opens as an independent
artifact context. The source context remains available through Back. Verified
correspondence still requires its explicit metadata bundle. No filename, type or
mtime matching creates BSV-to-RTL correspondence.

Pinned root identity, path containment, symlink/replacement checks, strict native
actions, panel/session/generation binding, source-range validation, CSP and media-
only Webview resource roots remain intact. Restricted Mode permits these bounded
static reads, not compiler/task execution. Trust never grants arbitrary filesystem
authority. [Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust),
[virtual workspace boundary](https://code.visualstudio.com/api/extension-guides/virtual-workspaces),
[Webview security](https://code.visualstudio.com/api/extension-guides/webview).
