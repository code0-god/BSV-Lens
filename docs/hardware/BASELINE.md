# G0 baseline receipt

Captured 2026-09-06 before repository edits.

## Contract

Source: `~/Downloads/BSV_Lens_Hardware_Schematic_Master_Prompt.md`.
Read all 999 lines, including G0/G1 exit criteria, later gates, security,
source/evidence regression requirements, and the final prohibition on claiming
full completion from selected UI changes.

SHA256:
`ec89f9201426a58fe729693873965ae0c1d3b8da115648b8b8f2129e00af9bb6`.
The file remains an external supplied contract; its identity is recorded here.

## Local and remote state

```text
$ git status --porcelain=v2 --branch
# branch.oid c6b9a5c642d105ad4117535c1d85366f1c02ec1c
# branch.head main
# branch.upstream origin/main
# branch.ab +0 -0

$ git rev-parse HEAD
c6b9a5c642d105ad4117535c1d85366f1c02ec1c

$ git remote -v
origin git@github.com:code0-god/BSV-Lens.git (fetch)
origin git@github.com:code0-god/BSV-Lens.git (push)

$ git ls-remote --symref origin HEAD refs/heads/main 'refs/tags/*'
ref: refs/heads/main HEAD
c6b9a5c642d105ad4117535c1d85366f1c02ec1c HEAD
c6b9a5c642d105ad4117535c1d85366f1c02ec1c refs/heads/main
```

All commands exited 0. No tracked or untracked changes existed at preflight.
Local and remote tags were `v0.3.0`, `v0.3.1`, `v0.3.2`, `v0.4.0`.
Latest observed annotated tag:

```text
7b2796211774ea39d06f3dc4d2e4321464d2b2d4 refs/tags/v0.4.0
075f688ecb514d6bf74612c93219830a7f5e707a refs/tags/v0.4.0^{}
```

`package.json`: name `bsv-lens`, publisher `code0-god`, version `0.4.1`.
No version/tag relation was inferred from the older public tag.

Read-only CI query:

```text
gh run list --repo code0-god/BSV-Lens --limit 5 \
  --json databaseId,headSha,headBranch,conclusion,status,workflowName,url
```

Exact baseline SHA: workflow `CI`, run `33977415375`, `main`,
`completed/success`.
URL: https://github.com/code0-god/BSV-Lens/actions/runs/33977415375
This remote success describes the baseline, not the uncommitted G1 changes.

## Feature branch and preserved boundaries

```text
$ git switch -c feat/hardware-schematic
Switched to a new branch 'feat/hardware-schematic'
```

Exit 0. HEAD remained the baseline SHA. No reset, cleanup of user changes,
commit, push, merge, version edit, tag, Release or Marketplace publish occurred.
The final receipt verifies the resulting changed paths and release boundary.
Ignored local package artifacts may be rebuilt for verification; they are not
a published candidate or an installed-profile change.

## Available material

Downloads contained:

- `bsv-lens-0.4.1-system-code-audit.zip`
- `bsv-lens-0.4.1-system-code-audit (1).zip`
- an extracted `bsv-lens-0.4.1-system-code-audit/` directory

No focus-review or independent-check archive matched the requested names in
that directory. G0_AUDIT records the actual relevant members inspected and
which old findings reproduce today.

Installed extension directories included `code0-god.bsv-lens-0.4.0` and
`code0-god.bsv-lens-0.4.1`. They were inspected read-only; no user VS Code
profile was changed. Directory names alone are not runtime identity evidence.

Pinned external integration remains read-only at
`6692a52973fbb487a421b07fc8cd881d0542e964` in `.github/workflows/ci.yml`
and the existing integration test configuration. No production design source,
top wrapper or parameter was changed for this G1 experiment.

## Tool discovery and isolated reader

Host: Darwin 25.5.0, arm64, Apple M5 Pro, 18 cores.
Existing BSC/Bluetcl resolved through `/opt/homebrew/bin` to BSC 2026.01.
Actual version: `Bluespec Compiler, version 2026.01 (build 9bd39e6f3)`.

No native Yosys was on PATH. The feasibility experiment installed a pinned
reader in `.build/hardware/toolchain/tools/venv`, not globally:

```text
yowasp-yosys==0.68.0.0.post1208
yowasp-runtime==1.96
wasmtime==47.0.1
click==8.5.0
platformdirs==4.11.7
```

Actual reader: `Yosys 0.68 (git sha1 38e001a6f, Release, ...)`.
Install log, licenses, binary/library identities, actual help and compiler
recipes are retained under `evidence/toolchain/`. No tool is bundled into the
extension, added to global PATH, or invoked from a browser action.

## Packaging baseline

`package.json` uses a VSIX `files` whitelist: `src/**`, `media/**`, README,
CHANGELOG and LICENSE. G1 experiment/docs remain outside the production VSIX.
`scripts/package-vsix.js` embeds current source/build fingerprint and dirty
status. A G1 package built before a commit must therefore say dirty.
`scripts/package-repo.js`, checksums and package verification remain unchanged.
