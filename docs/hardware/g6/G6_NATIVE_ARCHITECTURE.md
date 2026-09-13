# G6 native architecture and ADRs

## ADR1: opt-in inside existing extension

Add bsvArchitecture.openHardwareSchematic with distinct view type
bsvArchitecture.hardwareSchematic. Existing six commands/ArchitecturePanel and
its stored state remain independent. Hardware panel is one per selected workspace
URI; different workspace panels have separate sessions and input authority.
Activation registers commands/serializer only. No G6 scan/import/compiler begins
before user input. Local desktop file workspaces only in the initial support lane.

## ADR2: transport boundary

Product src/hardware owns parsing/import/correspondence/analysis/scene. Existing
media/hardware-* owns geometry/navigation/readability. Generic native-input
adapter replaces fixture catalog preparation. It receives Host-granted roots,
never Webview filesystem authority. Native HTML/media and workers are VSIX assets.
Experimental HTTP host stays a QA surface and is absent from normal native runtime.

Native message transport has no arbitrary command/fsPath/process operation.
Host request allowlist maps to the same SceneQuery APIs. Worker's require.resolve
entrypoints stay in original src tree, avoiding process.execPath-as-Node mistakes.

Scene response is a pure candidate. It does not publish Host `current` while the
Webview is still validating layout/navigation. The displayed semantic commit
confirms authority through existing `persist` with `{state, revision}`: a positive
monotonic live-session revision and a canonically validated schema-1 view. Semantic
commits are immediate; viewport/active-panel/disclosure-only saves are debounced
200 ms. Host current is updated after validation, independently of serialized
metadata writes. Old revisions and late saves cannot overwrite a newer current
visit. Commit revision is not stored state or source/snapshot authority.

Native analysis-context preparation is sequential per registered build, with
providers within that build still allowed to run concurrently. The four-request
Host limit is unchanged. Artifact-only `sourceContext: null` is preserved through
state, and the header says **BSV owner: Not attached** alongside actual RTL path.

Artifact-only/unmapped RTL catalog entries separate true design roots from their
immediate retained children. `getRootCandidates()` remains unchanged;
`getEntryCandidates()` supplies explicit occurrence/parent/design-root identity.
Native registration rejects more than 128 total choices instead of silently
publishing a truncated menu. Child entry is a starting viewport context, not a
new design root, reduced model, invented BSV owner or hidden query-scope change.

## ADR3: source revision and editor buffer

Forward source open re-resolves issued canonical reference through SceneQuery,
rechecks registered source authority and compares actual TextDocument.getText()
SHA including unsaved buffer. UTF16 half-open ranges use positionAt. Equal bytes
open live source; different bytes open explicitly historical read-only captured
source, if present. Generated RTL is distinct. Reverse selection uses existing
source-reference indexes plus canonical occurrence context; ambiguity is selected
explicitly, never first-name fallback. One-shot forward-event suppression and
selection dedup prevent feedback loops without disabling later user movement.
Reverse-source lookup uses the committed Host visit. Geometry/disclosure updates
do not invalidate a pending lookup; semantic owner/provider/snapshot/selection/
query changes, document changes, input replacement or session disposal do. A
scene that failed layout cannot redirect source resolution away from the scene
the user still sees.

Panel revival uses the Webview's schema/build ID only to locate a unique
Host-owned workspace-state envelope. Its `inputIdentity` and saved view are used
only after explicit input re-registration and normal identity checks. No unique
match means an unregistered panel; no first-workspace fallback or Webview-state
promotion grants file authority. A recreated panel and full Code-process restart
remain separate validation scopes.

## ADR4: local/remote authority

Source/artifact roots are explicit user selection and pinned registry roots,
independent of Workspace Trust. Normal path uses no compiler/task/executable.
Remote/virtual URI is not coerced to local fsPath. Unsupported environments get a
clear status. Local workers execute in actual workspace Extension Host process.
No staging or remote credentials are introduced in this implementation lane.

The isolated VS Code 1.136.1 verification process has a separate requirement:
every CLI version/install/list and runtime invocation supplies one private
`--user-data-dir`, `--extensions-dir` and `--shared-data-dir`. Application-shared
trust state is not isolated by user data or a named profile alone. The three
stores are distinct directories under one short private temporary parent;
argument and actual-runtime checks bind them to that test. A restart check may
reuse its own recorded private parent, never a normal user profile. Temporary
profiles can remain in place after shutdown; only runs with explicit relocation
receipts claim to have moved them. They are excluded from delivery archives.

## ADR5: installed bytes

Use official vsce in a unique source staging directory. Generate build metadata
there; original metadata/VSIX/evidence are preserved. Identity distinguishes old
317-file G5 comparison, G6 product runtime, Host, Webview and protocol. Metadata
itself is excluded from its input digest. VSIX SHA is external. Actual target is
installed code0-god.bsv-lens. Final-lane testing also installs the separate
observer VSIX and uses no product or observer development path. Earlier smoke
runs that used a development observer remain labeled pilots; they do not define
the final loading mode. Compare source/staged/VSIX/installation/assets and record
every transformation. Final installed success binds to one final VSIX SHA;
that final identity and execution remain **PENDING**.

Official API basis: [Webviews](https://code.visualstudio.com/api/extension-guides/webview),
[Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust),
[Remote extensions](https://code.visualstudio.com/api/advanced-topics/remote-extensions),
[Virtual workspaces](https://code.visualstudio.com/api/extension-guides/virtual-workspaces),
[integration testing](https://code.visualstudio.com/api/working-with-extensions/testing-extension),
[VS Code1.90 API definitions](https://raw.githubusercontent.com/microsoft/vscode/1.90.0/src/vscode-dts/vscode.d.ts).
Installed VS Code1.136.1 is available; minimum1.90 has Electron29.4.0 and remains
an unexecuted compatibility environment until an explicit separate run.

### Observed installer manifest transformation

The first actual isolated VS Code1.136.1 install changed only package.json: JSON
formatting and top-level `__metadata` (installedTimestamp/targetPlatform/size).
All src/media bytes matched exactly. The strict initial failure and both raw
manifests remain in g6-installed-smoke-hLakjk/g6. This is not a blanket mismatch
waiver. G6 identity canonicalizes package JSON recursively, preserving arrays and
all fields except VS Code's top-level installation-only `__metadata`. The
package inventory row explicitly says `canonical-json-without-vscode-metadata`.
Every other runtime file remains raw byte/SHA compared. Both raw manifest SHAs
and exact parsed installer delta are recorded independently. Package name,
publisher, version, commands, capabilities, dependencies and all other fields
remain identity-bearing. Native metadata excludes itself and legacy generated
metadata; final VSIX hash stays external.

## Bounded display and workspace corrections

Interface-group projection now uses exact owner and interface definition plus
the immediate `interfacePath` prefix. Shared types do not collect another
instance's ports. When an optional connection label has no safe placement,
geometry preserves canonical owner/full text/route anchor with `bounds: null`
and `foldedReason: "no-label-clearance"`. Readability hides only that text with
no pointer target; canonical topology and ordered membership remain unchanged.
The full name remains available through selection/Inspector and export metadata.
Mandatory titles still have their independent visible-label/typography gate.

Actual AQuA remains two independent source roots, not an automatically joined
system. Existing SchedulerSynthTop and MemorySynthTop wrappers have separate
stock compiler/reader/import receipts. Scheduler's full RTL scene exceeds message
and connection limits; Memory's full root fits the message-size bound but exceeds
the 8192 layout dimension. Memory's retained scratchpad occurrence passes bounded
core/layout preflight, not installed-native acceptance. No caps, canonical query
scope or origin coverage changed to turn those parent scenes into PASS. See
[G6_SUPPORT_MATRIX](G6_SUPPORT_MATRIX.md) and [G6_PERFORMANCE](G6_PERFORMANCE.md)
for exact inputs, counts and separate pending native gates.
