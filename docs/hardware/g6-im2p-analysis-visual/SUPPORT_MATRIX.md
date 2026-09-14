# Support Matrix

| Area | Status | Verified scope |
| --- | --- | --- |
| Local installed VSIX | PASS | macOS arm64, VS Code 1.136.1 |
| Extension Host | PASS | Node 24.18.1, local, Restricted Mode |
| Native Webview | PASS | final VSIX, 11 captured states |
| Workspace discovery | PASS | IM2P local file workspace, bounded source-only discovery |
| Editor source reveal | PASS | SystolicArray.bsv, PE.bsv, VectorUnit.bsv exact ranges |
| SystolicArray family | PASS | symbolic module family and storage family aggregate |
| PE analysis | PASS | storage families, scalar state, value lens |
| VectorUnit analysis | PASS | groupIndexReg value/control lenses and source |
| G2/G3/G4/G5 regression | PASS | full suite and semantic v2 replay |
| High contrast/reduced motion contract | PASS in automated tests | No separate final manual capture |
| RTL-backed IM2P | NOT RUN | no matching RTL artifact attached |
| Live compiler | NOT RUN | activation/import did not execute compiler |
| Remote host | NOT RUN | no remote environment used |
| Virtual/web workspace | UNSUPPORTED | manifest declares virtualWorkspaces false |
| Other OS/architecture | NOT RUN | no support claim |
| Marketplace | NOT PERFORMED | local validation VSIX only |

## Known limits

- Concrete per-element navigation needs proven parameter bindings and element occurrence identity.
- Typeclass dispatch and unsupported patterns remain unresolved with candidates/evidence.
- Static source operations are visually distinct from compiler-confirmed implementation cells.
- Large design performance beyond current bounded tests is not claimed.
