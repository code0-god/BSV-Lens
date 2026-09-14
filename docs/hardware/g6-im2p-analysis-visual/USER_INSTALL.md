# Install and Use the Validation VSIX

## GUI

1. Start an isolated VS Code profile or temporary user-data directory.
2. Open Extensions view, choose **Install from VSIX…**, then select the delivered VSIX.
3. Open IM2P.sim or another BSV workspace.
4. Run **BSV Lens: Open Hardware Schematic (Experimental)** from Command Palette.
5. Choose a design root. Click module body/title to enter. Select storage or connection for value/control/source details.
6. **Open source** reveals the verified range in the normal editor group; schematic remains in the right editor group.
7. Use Back/Forward/Up and Fit structure/Fit selection to navigate.

Source-only mode works without compiler or RTL. **Connect RTL result** is optional and requires a matching, user-selected artifact.

## Verified isolated CLI form

Use the VS Code CLI inside the app bundle when `code` is absent from PATH:

~~~sh
"/path/to/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --user-data-dir /tmp/bsv-lens-user-data \
  --extensions-dir /tmp/bsv-lens-extensions \
  --install-extension /path/to/bsv-lens-0.4.1-4cc702ffc343c1c5.vsix
~~~

Launch same executable with the same two isolation flags and workspace path. Remove only those temporary directories to clean up. Do not target the normal profile.

## Identity check

Expected:

- Extension ID `code0-god.bsv-lens`
- Version `0.4.1`
- Build ID `sha256:4cc702ffc343c1c59190ae864a32346ec413dcad54004e9551e6f5bd6d354895`
- VSIX SHA-256 `bd42b9b5f7cd1d826c86ab3205dde98a33dc704d1f4f9c3585207c318ca6e4ee`
