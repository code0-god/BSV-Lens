# G6 input, authority and source policy

This describes the current product adapter. Installed acceptance is tracked in
[G6_NATIVE_ACCEPTANCE](G6_NATIVE_ACCEPTANCE.md) and
[G6_VALIDATION_MATRIX](G6_VALIDATION_MATRIX.md); the policy alone is not a PASS.
Architecture and fixed budgets remain in [G6_CONTRACT](G6_CONTRACT.md).

## User registration

The explicit command is `bsvArchitecture.openHardwareSchematic`, displayed as
**BSV Lens: Open Hardware Schematic (Experimental)**. The empty panel offers
source, artifact and bundle registration. It neither loads a demo nor runs a
compiler. **Inputs and build** contains the same controls after registration.

| Action | Actual dialog and authority |
| --- | --- |
| Choose BSV source | Select a workspace folder or **Choose another folder…**, then enter a source folder relative to that approved root. `.` means the selected folder itself. |
| Register artifact | Select an artifact authority root, then enter the relative implementation JSON path. Existing selected source may be retained; this does not create correspondence metadata. |
| Register bundle | Select an artifact authority root and relative native manifest path. If source input is required and none is registered, separately select the source authority root and relative source folder. |
| Register origin capture | Approve the supported captured provider separately. A bundle can instead be registered as **Register stock inputs only**, keeping origin evidence unavailable until approval. |
| Refresh registered input | Reread the already selected input with its existing pinned grants. A replaced root must be selected again. Failure preserves the previous valid input. |

Paths in a bundle are descriptors, never root grants. Source descriptors resolve
under the separately selected source root. Implementation JSON, metadata,
generated RTL and origin evidence descriptors resolve under the artifact root,
not automatically relative to the manifest's own directory. `pathRef` is a
logical source/evidence identifier; it is not an arbitrary editor URI.

Root choice pins the resolved directory path, device and inode. Reads recheck
that grant and use the existing registry's canonical-path/file protections.
Source subfolders cannot traverse symlinks. Discovery rejects encountered
symlinks and skips dot-prefixed entries, `node_modules`, `build` and `out`.
Discovery is limited to 256 BSV files, 16 MiB source bytes, 65,536 entries,
4,096 directories and depth 32. Limit failure is explicit, not silent truncation.

## Manifest version 1

The smallest source-only manifest is `{"version":1}` with a separately approved
source root. Omitting `sources` requests bounded discovery; `"sources":[]`
requests no BSV documents. A source plus artifact example is:

```json
{
  "version": 1,
  "label": "My selected design",
  "sources": [{ "path": "Top.bsv", "pathRef": "src/Top.bsv" }],
  "artifact": { "path": "design.json" }
}
```

This example does not assert a build stage, chip top, source/artifact match,
parameter value, toolchain identity or original-BSV implementation mapping.
Unknown provenance stays unknown. Each descriptor may include a verified
SHA-256 `contentHash`; a mismatch fails. Names alone do not prove identity.

The schema accepts only `version`, `label`, `sources`, `artifact`, `metadata`,
`generatedRtl`, `origin` and `sourceBindings`. Unknown fields, hostile prototype
keys, unsafe relative paths and unsupported versions/providers fail. The native
manifest limit is 1 MiB, depth 16 and 30,000 JSON nodes. Label limit is 256
characters. Implementation `artifact.manifest` reuses the existing G2 manifest
contract in `src/hardware/snapshot.js`; it is not a compiler recipe.

Optional `metadata` uses the existing `stock-bluetcl-v1` provider. It requires
its own content hash, declared `{pathRef, contentHash}` source inputs, selected
BSV documents and an implementation artifact. `generatedRtl` requires metadata
and hashed descriptors. Optional `origin` reuses only
`isolated-bsc-ghc96-root-observer-v1`, with hashed artifact/sidecar/files and
compiler, patch and adapter hashes plus `sourcePin`. Host approval is separate
from those provenance strings. No executable is read or run from the manifest.
Ambiguous equal source captures require explicit `sourceBindings`; no first
matching hash or occurrence is chosen silently.

## Input states and semantic limits

| State | What is available |
| --- | --- |
| No input | Registration instructions; no hidden fixture or empty invented netlist. |
| Source-only | BSV structure and supported source/behavior queries. Hardware snapshot remains null. |
| Artifact-only | Actual imported RTL hierarchy and electrical queries. No fabricated BSV owner. |
| Source and artifact, no metadata | Separate BSV and unmapped RTL root entries. Registration alone does not join them. |
| Metadata registered | Existing stock correspondence and its limitations; no increased origin coverage. |
| Instrumented capture approved | Explicit instrumented provider and supported partial known contributors. Complete origin set remains unverified. |
| Multiple root candidates | Explicit root QuickPick and registered-root selector. Independent roots stay independent. |
| Stale, unavailable, unsupported or limited | Explain the condition. Preserve a previously valid immutable snapshot; do not replace it with guessed data. |

Artifact-only saved `sourceContext` remains null. Its native header states
**BSV owner: Not attached** and names the actual RTL occurrence separately;
an RTL path is not used as an original-BSV owner. Native catalog contexts load
sequentially per registered build, retaining the existing four-request Host cap.

Artifact-only and unmapped RTL inputs offer explicit **RTL design root** and
immediate retained **RTL module** entries. This is an entry menu, not a change to
`getRootCandidates()`: true design roots remain unchanged. Each module entry
retains its actual occurrence, parent and design-root IDs; later Up/Back and
analysis use those identities. The menu is bounded to 128 roots plus immediate
children. If that total is larger, native registration fails with
`LIMIT_EXCEEDED` and asks for a smaller explicit input rather than silently
showing the first 128. Selecting a child does not redefine it as the chip top,
invent a BSV owner, or promise that the larger parent scene fits current limits.

BSV interface-group display uses the exact owner, interface definition and
`interfacePath`, with immediate member paths only. Identical interface types in
other owners or nested paths are not members of the group. This projection
repair neither changes source semantics nor creates electrical connections.

The current AQuA source scope has two independent root candidates,
`mkAquaLoopMatmul` and `mkAquaMemorySubsystem`; neither is asserted to be a chip
top. The separate live `mkSchedulerSynthTop` artifact is a bounded wrapper scope,
not an artifact for both whole-workspace roots. Its full RTL scene was measured
at 47,809,773 bytes and 537 connections, above the unchanged 8 MiB native result
and 512-connection layout bounds. Explicit retained-module entry permits choosing
a smaller actual occurrence; it does not certify the whole root or extend source
correspondence. Final installed workspace acceptance remains **PENDING**.

## Editor source and freshness

Forward editor reveal re-resolves the canonical reference through the registered
SceneQuery, checks source authority, hashes the actual `TextDocument.getText()`
including unsaved text, and validates UTF-16 half-open offsets, slice hash and
selected text. Matching text opens the original BSV file beside the schematic
and selects/reveals the exact range through `positionAt`.

Changed/deleted source opens a verified captured revision, when available, under
the read-only `bsv-hardware-capture:` scheme. It is explicitly historical BSV.
Without that verified capture the result is stale/unavailable. A symlink/authority
escape is denied rather than converted into a captured-source success. Current
generated RTL evidence is used by correspondence and can be identified as such;
the native editor adapter currently grants forward editor reveal only to
registered BSV source documents. It does not relabel generated RTL as original
BSV or grant arbitrary provider paths editor access.

Reverse editor selection uses the existing source-reference index. It considers
current root/owner context, asks for an actual occurrence if ambiguity remains,
reports other-root targets as outside scope, and reports BSV targets while in
RTL as available in BSV. It does not silently switch root, view or query scope.
Programmatic forward selection receives bounded one-shot echo suppression;
subsequent keyboard/mouse selections remain eligible.

Reverse selection resolves against the last displayed, committed Host visit.
Pending lookup survives geometric zoom, viewport changes and disclosure updates,
but rejects changed semantic build/snapshot/owner/provider/selection/query or
document/session authority. Requesting a new scene alone cannot redirect it:
a scene response is only a candidate until the Webview accepts layout/navigation
and confirms its displayed view.

## Trust, lifetime and restoration

Restricted Mode permits these bounded explicitly selected data reads. The native
action allowlist contains no compiler, task, shell, arbitrary command or general
filesystem action. Trust does not authorize the home directory, other roots or
symlink targets. This contract requires separate installed Restricted Mode tests.

Only registered files and the selected manifest receive watchers. File or editor
buffer changes publish stale status without mutating captured build data.
Replacement input is prepared before publication; cancellation or failure retains
the last valid input. Hidden panels retain context and work; disposed panels abort
pending work and remove their watchers/listeners and captured-source authority.

That display confirmation uses `persist` with a validated schema-1 `state` and
positive monotonic per-session `revision`. Semantic commits are sent immediately;
viewport/active-panel/disclosure-only updates are debounced 200 ms. The Host
publishes canonical current after validation and serializes metadata saves.
Stale revisions and older save completions cannot replace newer current
selection. Revision is request ordering, not source identity or persistent read
authority, and is not stored inside the saved view.

Stored schema-1 state is bounded to 16 KiB and contains view identities,
selection, query description, viewport and explicit disclosure. It contains no
netlist/source blob, executable or root grant. Revival treats Webview build state
only as a hint for a unique matching Host `workspaceState` record; the Host-owned
envelope carries `inputIdentity`. No match or multiple matches leave the panel
unregistered. Raw Webview state is never used as that authority envelope.
Restart requires explicit input registration again. Only matching
input/build/source/query identity permits view restoration; a mismatch safely
rejects the saved view. Legacy panel state uses a
different key and view type. See [G6_HOST_WEBVIEW_PROTOCOL](G6_HOST_WEBVIEW_PROTOCOL.md).

Current native support is local desktop `file:` workspaces. Remote, virtual and
web hosts receive unsupported diagnostics instead of `fsPath` coercion or hidden
staging. The [support matrix](G6_SUPPORT_MATRIX.md) separates API compatibility
from actual installed execution.

Native validation under VS Code 1.136.1 must isolate all three stores on every
Code invocation: `--user-data-dir`, `--extensions-dir` and `--shared-data-dir`.
Application-shared trust storage is separate from user data; a named profile or
private user-data directory alone is insufficient. CLI install/list and window
launch use the same three distinct private directories. This is a test/install
isolation requirement, not additional source/artifact authority. The procedure
is in [G6_USER_INSTALL](G6_USER_INSTALL.md).
