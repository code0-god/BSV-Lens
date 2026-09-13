# G6 Host/Webview protocol

Protocol version is `1`. The implementation is
`src/panel/hardware-protocol.js`, `hardware-session.js`, `hardware-state.js`,
`hardware-build.js`, `hardware-source.js` and `media/hardware-native.js`.
Semantic queries remain in the existing `src/hardware` APIs.

## Envelope and handshake

Every request carries `protocol`, `panelId`, `sessionId`, `buildId`, `requestId`,
`generation`, `snapshotId`, `action` and object `payload`. Optional `kind` must be
`request`. Request IDs match `[A-Za-z0-9:_-]{1,80}`; generation is a nonnegative
safe integer. Here envelope `buildId` identifies the installed runtime. A query
payload's `buildId` identifies registered design input; they are different IDs.

The only bootstrap is `hello` with null panel/session/snapshot, request ID
`hello`, generation zero, and `{expectedBuildId, expectedProtocol}`. Expected
identity comes from Host-generated HTML metadata. Both envelope and expected
identity must match the Host's independently inspected packaged runtime. A valid
handshake cancels older requests, creates a fresh session and sends `welcome`.
A mismatched build/protocol fails explicitly. It does not retry against a demo
server or silently accept stale assets.

`welcome` supplies build diagnostics, current registered catalog, input status,
theme and eligible restore state. Subsequent messages bind to the issued panel,
session and generation. A successful input replacement increments generation;
its `catalog` event clears old Webview requests and snapshot context. Responses
must match request ID, action, generation and snapshot in addition to runtime,
panel and session. Replayed request IDs are discarded; foreign/stale messages
cannot publish a new scene. Session capacity is 50,000 distinct requests, after
which reopening the panel is required.

## Actions and owners

| Action | Host operation |
| --- | --- |
| `choose-source`, `choose-artifact`, `choose-manifest`, `choose-origin`, `refresh-input` | Native dialogs and pinned authority; generic native input preparation; atomic catalog publication. Payload is empty. |
| `catalog` | Registered BSV roots and explicit RTL design-root/immediate-module entry catalog only. |
| `scene`, `analysis-context` | Existing SceneQuery projection/context for a registered design build and canonical intent. A scene response is a candidate, not committed Host selection. |
| `analysis`, `analysis-reveal` | Existing public query worker or target resolver; canonical seed/scope/occurrence retained. |
| `source` | Canonical source evidence for the in-panel drawer. |
| `source-open` | Re-resolve source reference, verify live/captured revision and range, open actual editor. |
| `persist` | Validate `{state, revision}`, canonical contexts and session-issued query; confirm the displayed current visit and serialize schema-1 metadata storage. |
| `export-svg` | Validate bounded SVG and show a native save dialog; only explicit local save. |
| `cancel` | Abort a pending request by `targetRequestId` in the same bound session. |

There is no generic execute-command, read-file, compiler or HTTP proxy action.
Action payload fields are allowlisted. Registered build and stock/instrumented
snapshot authority are checked before query dispatch; core validates entity IDs,
ordered positions, ranges, enums and query limits. Source-only has a null hardware
snapshot and remains a real source model, not a fabricated implementation model.

For artifact-only or unmapped RTL inputs, entry selection preserves both the true
`rootInstanceId` and actual `entryOccurrenceId`. `getRootCandidates()` still
returns only design roots. A separate `getEntryCandidates()` describes the roots
and immediate retained children with parent/design-root identity; native input
registration rejects more than 128 total choices explicitly. It does not publish
a truncated menu or choose an arbitrary first occurrence. The entry is an
explicit scene starting point, not a reduced immutable model or hidden query
scope rewrite. An oversized full-root scene can still return `limited`.

Transport success is `status: "ok"` with the unmodified product payload.
Empty/partial/limited product outcomes remain explicit in that payload. Errors
use `cancelled`, `forbidden`, `unsupported`, `ambiguous`, `unresolved`, `stale`,
`invalid`, `limited` or `host-error`, with bounded code/message. For example,
`LIMIT_EXCEEDED` maps to `limited`, a revision mismatch to `stale`, and denied root
authority to `forbidden`. A result limit is not converted to an empty success.
Events are `welcome`, `catalog`, `status`, `theme` or reverse-source `reveal`.

## Display commit and Host authority

`scene` is a pure candidate response. The Host validates response bounds and
returns it without changing `current`. Only after Webview navigation accepts the
scene and layout does the renderer confirm that displayed visit through the
existing `persist` action. A rejected layout, cancelled navigation or failed
candidate cannot move Host source-resolution authority away from the prior
displayed owner.

The payload is `{state, revision}`. `state` remains the existing schema-1 view
envelope; `revision` is a positive safe integer, monotonically increasing within
the live session and current input generation. Zero, invalid or non-increasing
revisions fail. Revision is transport commit ordering only: it is not saved in
Webview/workspace state, a source revision, snapshot ID or file-read grant.
Input publication starts a new ordering context without reusing old authority.

Host confirmation re-resolves the view against canonical SceneQuery, checks
source revision/context and any session-issued analysis, then publishes current
immediately. Durable metadata writes are serialized and recheck input, session
and latest revision. A late older save cannot republish or replace newer current
selection; its response becomes superseded where appropriate. A storage failure
is reported and does not invent another scene. Semantic display commits are sent
without the debounce delay. Viewport, active panel and disclosure-only changes
use the existing 200 ms debounce; they add no hierarchy visit or query scope.

Native catalog preparation loads one registered build's analysis contexts at a
time; supported providers within that build may load concurrently. This avoids
flooding the unchanged four-request Host limit when many explicit entries exist.
Preview catalog preparation remains independent. Artifact-only saved state keeps
`sourceContext: null`; no empty object or RTL path is substituted for a BSV owner.
The native header displays **BSV owner: Not attached** separately from the actual
RTL occurrence path.

## Fixed bounds, cancellation and state

Normal inbound envelope: 64 KiB, JSON depth 16 and 4,096 nodes. `export-svg`
alone permits a 1 MiB envelope, so its SVG text must also fit envelope overhead.
Scene/query/reference/state validation uses a 16 KiB, depth-12, 2,048-node bound.
Single outgoing payload is at most 8 MiB. Existing G5 query result limit remains
4 MiB. At most four requests are active per panel; input replacement has its own
single publication generation. These are independent of artifact model size.

Abort propagates through the session into input/query workers. Before replying
or publishing input, the Host rechecks session lifetime, cancellation and
generation. Dispose waits for pending operations; a disposed session cannot
update another panel. Hidden panels retain context and are not treated as
disposed. No query/source cancellation is caused merely by label detail,
Inspector scroll, disclosure or geometric zoom. A pending reverse-editor lookup
compares semantic context rather than object identity: viewport/disclosure
updates leave it eligible, while build, snapshot, source revision, scene/provider,
root/owner, selection, source/implementation context or query changes invalidate
it. Document-version and session/lifetime checks remain mandatory.

Persistence validates exact allowed fields, finite viewport values and explicit
disclosures. Code scroll stores `{top,left}` per reference, with at most 128
entries. A saved query must have been issued in this session. During panel revive,
Webview schema/build state is only a lookup hint. Exactly one matching local
workspace's Host-owned `workspaceState` envelope supplies saved `inputIdentity`
and view; ambiguous or absent matches produce an unregistered panel. Webview
state is not promoted to a Host authority envelope. Restore then rechecks input
identity, registered build, source revision and query context after the user
explicitly registers inputs again. No root grant, executable or input is restored
merely by reopening a panel.

Display projection remains distinct from transport and canonical identity. A BSV
interface group includes only immediate member paths with the same owner and
interface definition and an exact `interfacePath` prefix. It cannot collect
same-typed ports from another instance. If optional connection text has no safe
label pocket, geometry retains its canonical owner, full text and route anchor
with `bounds: null` and `foldedReason: "no-label-clearance"`. Readability projects
that label as hidden with no pointer target; it does not reserve a fake rectangle
or remove the wire, ordered members or query result. Full names remain available
through selection/Inspector and export metadata. Hidden optional text is excluded
from font-minimum measurements; mandatory names remain a separate requirement.

## Files, CSP and build identity

The Host reads approved source/artifact URIs. The Webview owns pointer/keyboard
intent, rendering, Fit, labels and navigation; it cannot read workspace files.
`localResourceRoots` is the extension's `media` directory, not the workspace.
`asWebviewUri` produces asset URLs. CSP has `default-src 'none'`, nonce-only
scripts, `connect-src 'none'`, `base-uri 'none'`, `form-action 'none'` and no
`unsafe-eval`. Inline styles remain allowed for the existing SVG/rendering path;
source/evidence is text, not executable HTML. SVG export rejects scripts,
foreignObject, event handlers and disallowed external/file references.

Packaged identity hashes the defined sorted `src/**`, `media/**` and package
inventory, excluding generated `media/hardware-build.json` and legacy
`media/build-metadata.js` to avoid self-reference. It also records separate Host
and Webview fingerprints. On load the Host recomputes the inventory and compares
packaged metadata. The G5 317-file fingerprint uses a different defined inventory
and is preserved as baseline evidence, not compared directly to this digest.

Only `package.json` has an installer normalization: recursively canonical JSON
object keys, unchanged array order, and omission of top-level VS Code
`__metadata` only. Every other package field remains identity-bearing; all
`src`/`media` files remain raw byte/SHA comparisons. Raw package hashes and the
exact installer delta are recorded separately. The whole VSIX SHA stays outside
the archive. See [G6_NATIVE_ARCHITECTURE](G6_NATIVE_ARCHITECTURE.md) ADR 5.

Read-only Host diagnostics expose identity, actual Extension Host versions,
session operation counts and bounded events. Source diagnostics retain text
hash/byte count in logs rather than copying source text. These diagnostics
observe production behavior; they are not an arbitrary execution test backdoor.

Actual installed checks and their candidate/final scope belong in
[G6_VALIDATION_MATRIX](G6_VALIDATION_MATRIX.md). Protocol unit tests or the Chrome
preview cannot establish installed Webview/editor acceptance.

The VS Code 1.136.1 test launcher additionally isolates application-shared trust
storage. Every CLI install/list and runtime invocation must specify matching
private `--user-data-dir`, `--extensions-dir` and `--shared-data-dir` paths.
Launcher assertions require exactly one occurrence of each option and three
distinct directories under the private profile parent; it verifies that the
selected Code build supports the shared-data option. These paths are execution
receipt fields, never Webview file-reading authority. Earlier pilots lacking
explicit shared-data isolation cannot satisfy the final isolation gate.
