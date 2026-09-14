# G6 IM2P Analysis and Visual Follow-up Report

Date: 2026-09-14

## A. 수정한 분석 오류

- Expression IR now applies BSV precedence and left associativity, including grouping, unary forms, member/index postfix forms, calls, and shifts. Unsupported syntax keeps its source text and does not receive `exact`.
- Structural expression parsing uses length-preserving masked source, so comments, strings, commas, and parentheses do not corrupt argument boundaries or UTF-16 ranges.
- Inline methods separate guard and result ranges. Result expressions no longer become unsupported statements.
- `case` records selector, value/matches mode, per-arm labels or patterns, default, body statement IDs, source ranges, and arm resolution. Unsupported pattern semantics remain explicit.
- Nested type arguments use balanced delimiter parsing. `PairIfc#(Vector#(2, Bit#(8)), Bool)` stays two arguments.
- Source analysis schema/cache identity is `codeAnalysisVersion: 2`; historical v1 capture remains a strict rejection gate.

Official syntax reference: [BSV Language Reference Guide 2026.01](https://github.com/B-Lang-org/bsc/releases/download/2026.01/BSV_lang_ref_guide.pdf).

## B. 보존한 반복 하드웨어와 symbolic 범위

- Nested `replicateM` preserves ordered dimensions, leaf type, generator expression, leaf constructor, multiplicity, source range, and symbolic/exact status.
- IM2P `processingElements` is a module family with dimensions `[arrayDim, arrayDim]`, leaf constructor `mkPE`, symbolic multiplicity `arrayDim * arrayDim`, and lazy expansion.
- `loadedRows` is a storage family `[2, arrayDim]`; `weightRegs` and `weightValidRegs` are exact two-element storage families.
- `Reg#(Vector#(...))` remains one packed register. `Vector#(..., Reg#(...))` remains a repeated register family.
- `mapM` is conservative. A directly confirmed constructor is retained; unknown mapping logic is unresolved.
- Indexed family access retains aggregate family identity, index expressions, and deterministic member IDs. UI labels selected aggregate instances as indexed representatives.

Limit: canonical per-element materialization is not implemented for symbolic dimensions. Family selection is aggregate/shared-source, not a claim that a concrete RTL occurrence exists.

## C. 실제로 바뀐 그래픽 표현

- Module, register, FIFO, memory, BSV operation, unresolved object, vector family, matrix family, and symbolic family use distinct SVG glyphs.
- VS Code theme variables feed BSV Lens tokens. Object kind also uses outline, icon, pattern, and text; color is not the sole signal.
- Module instances keep title boundary and enter affordance. Registers use compact storage marks. Repeated families use stacked/tiled marks with explicit dimensions.
- Overview hides low-priority route labels while preserving canonical relation membership and routes. Selected scope exposes exact member/evidence data in Inspector.
- Relation evidence, role, and interaction state remain separate: source relation versus RTL net; data/control/binding; hover/selected/query state.
- Selected title fallback uses a non-interactive screen-space label only when collision-free scene placement cannot preserve the 12 CSS px target.

## D. Hover, 선택, 확대, Back

- Hover, persistent selection, keyboard focus, analysis seed/result/boundary, and unresolved state have separate classes and styles.
- Selecting a route highlights the same canonical route and exact endpoints; unrelated routes are muted but remain readable.
- Structure, value, and control lenses filter displayed relation roles without changing canonical source facts.
- Wheel zoom remains geometric. Module entry is explicit and history-backed.
- Installed journey verified `mkIM2PCore / systolicArray / processingElements / source / Back / Back` with owner and viewport restoration.
- `prefers-reduced-motion` preserves the final semantic state without required animation.

## E. 실제 IM2P 검수

- Workspace: `/Users/zerogod/aisa-lab/DynDNN/IM2P/IM2P.sim`
- Branch/HEAD: `exp/pe-local-partial-int20` / `3aeb5feee6872f88ec1f6a5dc0d77fb1bb8babf8`
- Source inventory: 21 BSV files; fingerprint `1aa9ed312e97e41b983c2ddcf10614390d8d21540d873b84b94b59a50b1f8d8a`; unchanged after validation.
- Native bounded discovery analyzed 17 files for each selected root; core receipt analyzed all 21 files.
- SystolicArray: symbolic `processingElements[*][*]`, `loadedRows`, scalar `activeWeightBankReg`, source reveal, and Back restoration passed.
- PE: `weightRegs`, `weightValidRegs`, scalar registers/pipelines, value lens, and exact editor source reveals passed.
- VectorUnit: `groupIndexReg`, value/control lens actions, selected-title readability, and `VectorUnit.bsv:66` reveal passed.
- Source editor stayed in left editor group; Hardware Schematic stayed in right group.
- Validation used source-only mode. No RTL artifact or live compiler was attached.

## F. 회귀와 검증

| Lane | Result | Evidence |
| --- | --- | --- |
| Full Node suite | 894 pass, 0 fail, 3 skip / 897 | `test-summary.json` |
| Product check | PASS; 8 examples, 141 nodes, 316 edges | `check.stdout.log` |
| Readability targeted | 21 pass, 0 fail | `test-summary.json` |
| Semantic v2 replay | PASS; 75 queries; 627 authenticated identity paths | `semantic-final/semantic.json` |
| IM2P core | PASS; 147 definitions, 299 instances, 1497 statements | `core-receipt.json` |
| Installed VSIX native | PASS; 14 steps, 11 captures | `validation.json` |
| Independent final visual QA | PASS; 0 blockers | `visual-qa.json` |

The semantic replay intentionally differs from v1. Authenticated identity rebasing yields 11,285,035 bytes and SHA-256 `68765ecc635a38d9e87a9e55e53e9bfbecd49a47761ca9e3898ec6e55118cbc6`; the historical v1 comparator fails as required.

Existing G2/G3/G4/G5 boundaries remain: source relations are not RTL nets; known contributors are not a complete origin set; different canonical nets cannot share a positive-length segment.

## G. 지원 한계

- Live compiler: NOT RUN.
- RTL artifact-backed IM2P path: NOT RUN.
- Remote Extension Host, virtual workspace, web extension host, other OS/architecture: NOT RUN or unsupported as listed in support matrix.
- Symbolic family elements are indexed representatives until parameters and element occurrences are proven.
- Static analysis does not animate cycle-accurate signal flow or infer physical cells.
- Current source-derived interface contract warnings remain visible; no compiler evidence was invented to resolve them.
- User visual/design acceptance: PENDING.

## H. 최종 설치본

- Extension: `code0-god.bsv-lens` 0.4.1
- Build ID: `sha256:4cc702ffc343c1c59190ae864a32346ec413dcad54004e9551e6f5bd6d354895`
- VSIX SHA-256: `bd42b9b5f7cd1d826c86ab3205dde98a33dc704d1f4f9c3585207c318ca6e4ee`
- Installed runtime fingerprint: `16595622f6a9cc4a8e530c7673ba1acb7591b4042dabc07b269ae39a922a0852`
- Raw installed runtime fingerprint: `e00c11da91c706ce2fa40134d76120918fcc4afdca8c3e23854618424fec9556`
- Verified host: VS Code 1.136.1, Electron 42.10.0, Chromium 148.0.7778.280, Node 24.18.1, macOS arm64, local Extension Host, Restricted Mode.
- Final installed bytes remained unchanged through shutdown.

## 종료 상태

- Semantic correctness: COMPLETE for documented syntax subset.
- Repeated hardware families: PARTIAL; aggregate and symbolic families complete, canonical concrete element materialization deferred.
- Hardware visual design: IMPLEMENTED.
- Actual native visual/interaction tests: PASS for recorded local journeys.
- User visual/design acceptance: PENDING.
- Commit/push/merge/version/release/Marketplace: NOT PERFORMED.
