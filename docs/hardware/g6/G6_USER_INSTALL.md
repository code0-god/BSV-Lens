# G6 isolated installation and use

The verified native product is **bsv-lens-0.4.1-568cd5d7de13990a.vsix**
(670,124 bytes), SHA-256:

`f9d7a845aab91e366e85e5d73ec8cc04cf0e1f78586f3ef6c0ee8ad9d5b851d7`

[Actual tested VSIX](../evidence/g6/run-TEmIQj/vsix/bsv-lens-0.4.1-568cd5d7de13990a.vsix)
passes the current installed batch. Delivery target is
`dist/bsv-lens-0.4.1-568cd5d7de13990a.vsix`, promoted from these exact bytes
without repackaging. Two independent staged source/review extractions passed core and installed native/editor replay. G6_REPORT links final source/review ZIPs, checksums and external final-byte validation receipts. Never substitute a different
0.4.1 VSIX based on version alone.

Current environment scope: local macOS arm64, VS Code 1.136.1. Other environments
have separate statuses in [G6_SUPPORT_MATRIX](G6_SUPPORT_MATRIX.md). No compiler
is required for existing-artifact analysis. This experimental entry preserves
the original Architecture/Source commands.

## Open an isolated VS Code window

The verified local CLI is
`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`.
No global `code` command or PATH change is needed. VS Code 1.136.1 keeps shared
trust state outside `--user-data-dir`; therefore **every Code CLI/install/list
and runtime invocation must also use a private `--shared-data-dir`**. A named
profile or user-data directory alone is insufficient. Use three distinct stores
under one short private parent, preserving macOS's 103-byte IPC socket limit.
In zsh, replace the VSIX and workspace paths below with actual absolute paths
from the delivery and your selected local design:

```sh
g6_profile=$(mktemp -d /tmp/bg6.XXXXXX)
g6_user_data="$g6_profile/user-data"
g6_extensions="$g6_profile/extensions"
g6_shared_data="$g6_profile/shared-data"
mkdir "$g6_user_data" "$g6_extensions" "$g6_shared_data"
g6_vsix='/absolute/path/bsv-lens-0.4.1-568cd5d7de13990a.vsix'
g6_workspace='/absolute/path/to/your/BSV/workspace'

/usr/bin/shasum -a 256 "$g6_vsix"

"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --user-data-dir "$g6_user_data" --extensions-dir "$g6_extensions" \
  --shared-data-dir "$g6_shared_data" \
  --install-extension "$g6_vsix"

"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --user-data-dir "$g6_user_data" --extensions-dir "$g6_extensions" \
  --shared-data-dir "$g6_shared_data" \
  --list-extensions --show-versions

"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --new-window --user-data-dir "$g6_user_data" \
  --extensions-dir "$g6_extensions" --shared-data-dir "$g6_shared_data" \
  "$g6_workspace"
```

Compare the printed digest with the supplied `.sha256` receipt before opening
the extension. The extension list must contain `code0-god.bsv-lens@0.4.1`.
That confirms identity/version only; the panel build ID and installed receipt
provide the stronger byte identity. Do not enable Settings Sync or install the
VSIX into a normal user window for this isolated check.

For GUI installation, first launch the same isolated window without the
`--install-extension` step. Inside that window open **Extensions**, its **…**
menu, then **Install from VSIX…**, and select the verified file. This is the
standard GUI route; the recorded final batch installed through the explicit CLI.
Installing from the ordinary existing VS Code window does not preserve this
directory isolation. Keep all three options for subsequent launches, installs,
listing or uninstalls. Do not drop the shared-data option to bypass an unsupported
CLI error; use the recorded VS Code 1.136.1 build and its checked option support.
Earlier pilots that omitted shared-data isolation are not final isolation proof.

## Identify the active build

Run **BSV Lens: Open Hardware Schematic (Experimental)** from the Command Palette.
Open **Inputs and build** and compare **Build g6:… · protocol 1** with the final
receipt's `nativeBuild.buildId`, which for this VSIX is
`g6:568cd5d7de13990a8dd2ac0f2307d0ba993754712ce00a3581c2c422b1a967c7`. A build/protocol mismatch is an error requiring
the matching VSIX/runtime, not evidence that a reload succeeded. **View: Output**,
channel **BSV Lens**, provides bounded Host/session diagnostics.

The final receipt must also identify actual installation path, VS Code and
Extension Host versions and Host/Webview fingerprints. VS Code may reformat
installed `package.json` and add top-level `__metadata`; only that explicit
installer normalization is allowed. Product files and every other manifest
field must match. See [G6_HOST_WEBVIEW_PROTOCOL](G6_HOST_WEBVIEW_PROTOCOL.md).

## Register your design

1. Choose **Choose BSV source**. Select the source authority root, then its
   relative BSV folder (`.` uses that root). Discovery is bounded and compiler-free.
2. If several actual roots are found, choose the intended one. The root selector
   keeps independent roots separate; the first candidate is not assumed to be
   the chip top.
3. For an existing Yosys JSON implementation use **Register artifact**, choose
   its authority root and relative file. Source-only structure and electrical
   artifact analysis are different modes. Without correspondence metadata the
   source and RTL are separate unmapped entries, not a guessed join. RTL choices
   identify actual **design roots** and their immediate retained **modules**.
   Choose the intended entry explicitly; entering a module preserves its real
   parent/design-root context. More than 128 total RTL choices is an explicit
   limit rather than a silently shortened list.
4. For captured metadata use **Register bundle** and a native version-1 manifest.
   Source paths resolve under the separately approved source root; artifact and
   evidence paths resolve under the separately approved artifact root. See
   [G6_INPUT_AND_TRUST](G6_INPUT_AND_TRUST.md) for the schema and example.
5. Approve an instrumented capture only if you intend to use its supported
   known-contributor evidence. **Register stock inputs only** leaves it unapproved.
   Missing metadata, source specialization or complete origins remain unavailable.

No registration command runs BSC, Yosys, workspace tasks or provider executables.
Restricted Mode and read authority are independent: selecting one root does not
authorize arbitrary local paths. Current native runtime rejects remote/virtual
workspaces explicitly. It does not copy them to a hidden local staging area.

## Navigate and open real source

Click a BSV module once to enter. Select storage or an interface object and use
the relevant Inspector analysis, such as readers/writers or signal connectivity.
Open a supported writer/source result to read the drawer and reveal its verified
BSV range in an editor beside the schematic. Matching current text gets the exact
selection. An unsaved or changed document instead uses an explicitly historical,
read-only captured revision when available; old offsets are not applied to new
text. Missing capture is reported as stale/unavailable.

With matching registered source, move the actual editor cursor to a supported
instance declaration, storage, method/rule or source expression. The existing
resolver reveals an occurrence in the current BSV scope; ambiguity offers a real
choice. A target in another root or in BSV while viewing RTL is explained instead
of switching context silently. Generated RTL is not original BSV; direct native
editor opening currently covers registered BSV documents only.

Use **View RTL Implementation** explicitly when the selected input has the
required implementation evidence. Choose **Stock metadata** or **Instrumented
capture** inside **Inputs and build**; the chosen provider does not change the
current scene until the explicit RTL action. **Back**, **Forward**, **Up** and
**Return BSV** preserve the appropriate BSV owner and actual RTL occurrence.
Do not infer an electrical relation from a source-only BSV relationship.

**Fit structure** shows the complete current topology with bounded overview
detail. **Fit selection** shows selected hardware and its local relations and
may leave other structure outside the viewport. **Hide Inspector** gives a narrow
pane more room. Neither display operation changes query scope. Source changes
mark the captured build stale; **Refresh registered input** explicitly prepares
a new input. A failed refresh retains the previous valid result.

Dense optional wire names may be folded when no safe label placement exists.
The wire, its canonical name and its hit target remain; select it for the full
name in Inspector. Such folding does not hide a missing root/module title or
turn a cropped scene into successful **Fit structure**.

Whole-workspace support is bounded. Current AQuA's two independent source roots
are not one chip. The separately compiled SchedulerSynthTop wrapper does not map
the whole workspace, and its full RTL scene exceeds the unchanged native
message/layout limits. An explicit retained-module entry can analyze a smaller
actual occurrence; it does not certify the oversized parent view. See
[G6_INPUT_AND_TRUST](G6_INPUT_AND_TRUST.md) and the final workspace receipt, once
available, for the exact validated scope.

Closing/reopening a hidden panel differs from disposing it. After restart, select
and approve inputs again; only matching stored identities restore prior view
state. A stale or moved input must be reselected, never silently substituted.

## Return to the existing UI and clean up

Run **BSV Lens: Open Workspace Architecture** or **BSV Lens: Open Current File**
to use the existing source-oriented UI. The experimental command does not change
the default command or replace saved legacy panel state.

Close the isolated VS Code window before cleanup. In Finder, use **Go to Folder…**
with the exact temporary parent retained in `g6_profile`, verify its three private
stores, then move only that test parent to Trash. Keep the delivered VSIX, checksum,
report and workspace. Do not remove the normal VS Code profile or
`~/.vscode/extensions`. Automated acceptance retains its own profiles inside its
run directory for audit after process shutdown; those are test artifacts, not
product runtime or review/source ZIP members.

Current installed N01–N15, S01–S14, process restart, source/artifact and
current-pane typography results are in [G6_VALIDATION_MATRIX](G6_VALIDATION_MATRIX.md).
OS whole-window resize is BLOCKED; 1280×960 and 1600×1000 were not executed.
Measured current 1440×900 window/pane changes are not those requested sizes.
M complete-cone scale and full real-parent visualization remain limited.
Remote support and user design approval are not implied.
User visual/design acceptance remains **PENDING**.
