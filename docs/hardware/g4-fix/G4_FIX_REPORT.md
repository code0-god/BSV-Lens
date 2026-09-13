# G4 Correctness Follow-up

F1: **FIXED**. F2: **FIXED**.
실제 browser B01–B12: **PASS**.
G4 technical gate: **PASS — 검증된 correctness·전달 범위**.
User visual/design acceptance: **PENDING**.

이전 독립 최종 reviewer는 사용량 제한으로 verdict를 내지 못했다.
재개 후 단일 최종 검토는 제품 correctness를 통과시켰지만, 두 후보 ZIP의
browser trace 누락으로 **REJECT (B-PKG-01)** 판정을 내렸다.
원문은 [GATE_INITIAL.md](GATE_INITIAL.md)에 보존했다.
수정 후 독립 재검토는 **APPROVE**, B-PKG-01 해소로 판정했다.
[GATE_RECHECK.md](GATE_RECHECK.md)는 승인된 후보의 정확한 hash와 검사 범위를 기록한다.
이후 추가된 보고서·검사 로그를 포함한 최종 ZIP은 별도로 전체 재현을 통과해야 생성된다.

## A. Baseline

**COMPLETE**

- Branch: `feat/hardware-schematic`.
- HEAD / 확인 가능한 `origin/main`:
  `c6b9a5c642d105ad4117535c1d85366f1c02ec1c`.
- `package.json` / lockfile version: `0.4.1`.
- 시작 시 status, branch, HEAD, origin/main, diff, cached diff, tags 확인.
  tracked/staged diff는 없었고, 기존 untracked 작업은 보존했다.
- 기존 tag 목록: v0.3.0, v0.3.1, v0.3.2, v0.4.0. 새 tag 없음.
- 기존 167-file G4 runtime fingerprint 재계산 결과:
  `e3ed0eb1eb60bd058287472a545ad1c27aeb6e1c98dbfdf1f993fba665820a07`.
- 현재 fix runtime/test/package inventory identity:
  `7817fcefc809ac050cdd71ff4aa037824033e073c5c2f6a3c9cbd317c2db3601`.
  Git HEAD와 다른 content identity이며 CJS·HTML·CSS도 포함한다.

원본 입력:

- G4 source ZIP SHA256:
  `605c10c13026d085748f5414cf99fd5b9d9225c147e5b227d308f402bfc0aec3`.
- G4 review ZIP SHA256:
  `1253e9a4d4baaa2fb93fb4a6e409017e25a257e792319290f9f1c70e52ef9052`.
- 실제 A/B/C stock 및 instrumented compiler/reader capture.
- 기존 G2/G3 계약, G3 coverage, G4 Scene/Navigation/Design 문서.

`G4_BSV_INDEPENDENT_REVIEW.md`, `G4_BSV_independent_review.zip`은 제공되지 않았고
로컬 검색에서도 찾지 못했다. 수정된 요청의 “가능하면 기존 oracle 사용”에 따라
보고된 F1/F2를 별도 local oracle로 재구성했다. 외부 reviewer 원본이라고 부르지 않는다.

고정 oracle:

```text
experiments/hardware/g4-fix/oracle/regressions.test.cjs
SHA256 a11b4c9b2e93019e68900574c54e583110ae7a4c641c646f43df1719861c4ac5
```

수정 전 두 assertion FAIL, 기존 positive smoke PASS를 먼저 확인했고,
같은 oracle byte가 수정 후 PASS했다. assertion 삭제·범위 축소 없음.
원본 외부 oracle 실행은 **NOT RUN — 파일 미제공**이다.

보존:

- 2,718개 기존 파일을 수정 전 inventory로 고정.
- 2,706개 동일, 기존 runtime/test/HTML/CSS 10개와 패키지 검사 2개만 변경.
- 원본 fixtures, compiler/reader output, G0–G4 evidence, ZIP, checksum, receipt는 동일.
- 원본 ZIP의 별도 fresh copy에서 before browser/probe를 실행해 live 수정과 분리.
- 새 결과는 run-specific 디렉터리에만 생성.

기존 파일 변경 목록:

```text
media/hardware-navigation.js
media/hardware-layout.js
media/hardware-view.js
media/hardware.css
src/hardware/architecture.js
src/hardware/scene.js
src/hardware/scene-query.js
src/hardware/scene-summary.js
experiments/hardware/g4/index.html
test/hardware-navigation.test.js
scripts/check.js
experiments/hardware/g3/validate-delivery.js
```

추가 파일은 `experiments/hardware/g4-fix/`, 새 hardware tests,
`docs/hardware/g4-fix/`, `docs/hardware/evidence/g4-fix/`에 있다.
전체 file/hash inventory: [evidence index](../evidence/g4-fix/run-lopNF5/index.json).

재개 시 256개 기존 runtime/test 파일이 마지막 검증 지문과 모두 일치했다.
실제 browser 입력 11개도 동일하여 UI 증거를 재사용했다. 새 검사 회귀와
패키지 wrapper 및 trace 전달 회귀를 포함한 현재 inventory는 258개다.
[재개 증거](../evidence/g4-fix/resume-01a07ec8/index.json)에 새 검사, 전체 회귀,
보존 결과와 원본 실패/성공 로그를 기록했다. 빈 stdout/stderr는 index에
빈 문자열과 0-byte hash로 명시했다.

## B. F1

**FIXED**

### Before

직접 Scene Query는 실제 RTL left를 반환했지만 `navigate()`는 false였다.
BSV owner가 그대로라 기존 key가 root와 left를 구분하지 못했다.

원래 source ZIP을 새 경로에 풀고 **실제 Chrome pointer로도 재현**했다.
RTL root에서 left body 클릭 후 shell과 history가 그대로였다.
이는 기존 제출 캡처나 browser가 차단된 외부 검토를 재사용한 주장이 아니다.

### Cause / Fix

BSV analysis context와 실제 RTL location을 분리했다.

- BSV root/owner/path, source revision, analysis identity는 계속 source 문맥.
- `contextOccurrenceId`: 현재 표시하는 실제 RTL occurrence.
- `implementationOccurrenceId`: G3가 확인한 BSV boundary anchor.
  Inlined source context에서는 null일 수 있다.
- Hardware snapshot, provider, 실제 제공된 stage, root, parent, path는 G2에서 해석.
- Request가 provenance anchor를 만들 수 없음. 편의상 두 occurrence 필드 중
  하나를 선택하는 fallback으로 모순을 숨기지 않음.

Stable visit key는 실제 canonical context를 사용한다. Selection, disclosure,
viewport, hover, generation, geometry/render ID는 stable location identity가 아니다.
Selection/detail 변경은 inspector를 갱신하지만 hierarchy history를 추가하지 않는다.

유효한 scene와 geometry 준비, stale 확인, canonical equality 비교 후 commit한다.
동일 방문에는 history/animation을 추가하지 않고 검증된 geometry를 재사용한다.

Boolean API를 유지하면서 `outcome`에 committed/unchanged/unresolved/stale/
cancelled/blocked/error와 code를 제공한다. 늦은 응답이 최신 진단도 덮지 않는다.

### After

- A RTL root/left/right가 다른 방문. 같은 definition을 공유해도 occurrence 구분.
- 같은 left 재진입은 unchanged, history 불변.
- Back/Forward는 shell, provider, selection, viewport, source context까지 복원.
- RTL Up/breadcrumb는 실제 RTL parent. RTL root Up은 `blocked / RTL_ROOT`.
- BSV 복귀는 Back 또는 명시적 Return BSV/source breadcrumb.
- Header와 inspector는 BSV owner와 실제 RTL path를 별도로 표시.
- Provider 변경은 이전 implementation locator를 재사용하지 않음.
- N01–N10, failure/race, C 8/12-bit inlining 검증 완료.

실제 browser에서 header의 10px 높이 변화가 Back viewport를 5px 보정하는
추가 문제도 발견했다. Chrome 영역 높이를 안정화하고 정확한 deep-equality
복원 검사를 통과시켰다.

계약: [NAVIGATION.md](NAVIGATION.md).
Before/after context와 pointer trace는 evidence의 `before-browser/`, `browser/`,
`f1/`에 있다.

## C. F2

**FIXED**

### Before

A/left instrumented 16 vectors에서 서로 다른 네 net 쌍이 겹쳤다.

| 쌍 | 원래 겹친 구간 길이 |
| --- | --- |
| CLK [2] / state input [30..37] | 수평 18 |
| $procmux$6_CMP [12] / put_value [4..11] | 수직 100, 108 |
| $procmux$6_CMP [12] / $add..._Y [21..28] | 수평 10 |
| RST_N [3] / $eq..._Y [29] | 수직 120 |

원인은 modulo track/escape 재사용이었다. G2 connectivity 병합 문제는 아니었다.
실제 B에는 더 많은 공유 contact와 충돌이 있었다. 특정 이름 네 쌍만 예외 처리하지 않았다.

### Fix

- Connection-owned 수평/수직 interval reservation. 겹치지 않는 구간은 track 재사용.
- 첫 contact escape도 예약·충돌 검사 대상.
- Body, contact/slot, label, enclosing boundary, incompatible route를 장애물로 사용.
- 제한된 rectilinear search와 spacing retry. 부분 route를 조용히 버리지 않음.
- Same-net tree/fanout만 공통 trunk 허용. Proper crossing은 junction이 아님.
- 실제 parent pin과 child formal port는 **검증된 G2 boundary**로 incidence 투영.
  이름으로 pin/port를 연결하지 않음.
- Vector contact의 별개 bit groups는 원래 contact ID와 정확한 member indices/
  bit IDs를 가진 attachment slots로 표시. 새 physical pin이나 global driver가 아님.
- Source interface group은 별도 header/brace. 실제 typed methods와 구분.

대표 limits: 512 connections, 250,000 grid vertices, 2,000,000 A* expansions,
50,000,000 counted checks, 3 passes, 8192-unit 최대 크기.
초과/불가능/잘못된 입력은 typed error이며 기존 valid scene를 보존한다.
실제 corpus를 모두 blocked로 돌려 성공 처리하지 않았다.

### After

- 고정 F2 oracle: **PASS**, 원래 네 쌍 및 새로운 cross-net overlap 없음.
- 실제 29개 장면: canonical members, ordered bits, aliases **동일**.
- 29개 장면 전체의 overlap pairs: **233 → 0**.
- 18개 실제 RTL + 11개 BSV를 두 크기에서 검사: **58/58 PASS, findings 0**.
- Fanout, repeated names/scopes, aliases, slices/reorder, literal sites,
  multiple-driver/inout, synthetic congestion, negative oracle 검증 통과.

독립 oracle은 router의 `valid` 값을 믿지 않고 실제 segments와 canonical
membership를 비교한다. Diagram tolerance는 `1e-7`.
Body/port/label/boundary, dangling/shifted endpoints, complete bounds도 검사한다.
첫/마지막 segment 전체를 제외하지 않는다.

### Hit target / export

실제 screen-space segment 거리로 선택한다. SVG paint order로 선택하지 않는다.
고유하게 가까운 wire를 선택하며 모호한 crossing은 명시적 후보 버튼을 표시한다.
실제 관련 신호 7개를 각각 pointer로 선택해 inspector ID/ordered bits를 대조했다.
Fanout junction과 crossing 후보 선택도 실행했다.

선택/hover는 canonical geometry를 바꾸지 않는다.
SVG export는 viewport transform을 제거하고 전체 geometry bounds와 canonical
connection metadata를 보존한다. 실제 download와 재파싱으로 검증했다.

계약: [ROUTING-DESIGN.md](ROUTING-DESIGN.md),
[GEOMETRY-ORACLE.md](GEOMETRY-ORACLE.md), [PRESENTATION.md](PRESENTATION.md).

## D. Readability

**Correctness PASS; density tradeoff 명시**

아래 before는 원래 G4, after는 최종 fix의 1100×650 제품 geometry다.

| 장면 | Bounds before / after | Length before / after | Bends | Crossings | Overlap pairs |
| --- | --- | --- | --- | --- | --- |
| A/left instrumented | 1178×670 / 1848×1164 | 7336 / 12540 | 37 / 37 | 29 / 22 | 4 / 0 |
| B/root instrumented | 2030×1386 / 3432×2616 | 63232 / 69708 | 136 / 178 | 434 / 162 | 74 / 0 |
| C/root instrumented | 1178×784 / 1992×1452 | 13624 / 17892 | 46 / 60 | 96 / 40 | 8 / 0 |
| A BSV overall | 1152.8×414 / 1368×552 | 1543.2 / 1176 | 13 / 8 | 1 / 1 | 1 / 0 |
| B BSV overall | 988.4×484 / 1488×744 | 1659 / 3768 | 14 / 22 | 1 / 5 | 8 / 0 |
| C BSV overall | 1568.2×680 / 2016×996 | 5680.6 / 6132 | 23 / 25 | 11 / 10 | 6 / 0 |

일부 route와 bounds는 커졌다. 겹치거나 node를 관통한 이전 경로를 올바른
짧은 경로로 취급하지 않았다. A BSV의 짧은 전달 관계는 오히려 줄었다.
B Control read/tick 등 라벨은 삭제하거나 바꾸지 않고 예약된 label boxes에 배치했다.

Renderer는 geometry label 좌표/축약 text를 그대로 사용한다.
실제 DOM 감사: **597 visible labels, 254 slots, findings 0**.
DOM pixel rounding tolerance 0.75px는 wire overlap 판정의 `1e-7`과 별도다.

Dense B와 좁은 창의 Fit은 overview이며 상세 읽기는 zoom/inspection이 필요하다.
이 제한을 디자인 승인이나 큰 설계 전체 scalability 보장으로 바꾸지 않는다.

대표 실제 화면은 evidence `browser/`의 `A-BSV.png`, `B-BSV.png`, `B-RTL.png`,
`C-BSV.png`, `C-RTL.png`, `wire-2.png`, `wire-12.png`, `crossing-candidates.png`.

## E. Browser

Chrome **152.0.7977.82**, 실제 pointer/keyboard, arbitrary sleep 없음.
완료 event/state에 구독한 뒤 action을 실행했다.

| Journey | 결과 | 확인 |
| --- | --- | --- |
| B01 | PASS | BSV root, RTL 버튼, 실제 left body 진입 |
| B02 | PASS | left 선택/pan, Back root, Forward left 정확 복원 |
| B03 | PASS | right의 별도 occurrence |
| B04 | PASS | 실제 RTL Up, root의 명시적 RTL_ROOT blocked |
| B05 | PASS | RTL breadcrumb와 실제 scene/header/path |
| B06 | PASS | 같은 left unchanged, history 불변 |
| B07 | PASS | 자연스러운 두 번째 click event, 추가 진입/선택 없음 |
| B08 | PASS | 지연 left, right, Back, 늦은 응답 폐기 |
| B09 | PASS | 이전 충돌 신호 7개, ID와 ordered bits 일치 |
| B10 | PASS | crossing 후보 선택, 실제 fanout junction |
| B11 | PASS | state/RHS, contributor, Fit, 정확한 BSV Back |
| B12 | PASS | 1440/960/420, dark/light/high contrast, reduced motion, resize |

각 기록은 kind, BSV owner, actual RTL occurrence, snapshot/provider/stage, shell,
selection/history/viewport, DOM path, 실제 geometry/hit target, inspector, page
errors를 포함한다. Page errors 0. Tab/Enter/Space/Escape/Alt+Left도 별도 통과.

실제 SVG download/export: **PASS**.
VS Code Extension Host: **NOT RUN**.
정책 우회: **NOT PERFORMED**. 이 환경에서 browser 차단은 발생하지 않았다.

추가 검증 중의 harness 수정도 남겼다. 원본 ZIP의 `bsv-lens/` prefix 확인,
root Up의 실제 blocked 계약 검사, `mouse.click(clickCount:2)`가 만드는 두 번의
추가 click 대신 실제 두 번째 down/up을 쓰도록 수정했다. 제품 assertion을
현재 오류에 맞춰 약화한 것이 아니다.

## F. Regression / reproducibility

**PASS**

- 고정 재구성 oracle 2개: before FAIL/FAIL, after PASS/PASS, SHA256 동일.
- F1 targeted/product tests: 34/34.
- Router/기존 layout/고정 oracle 등 최종 targeted: 32/32.
- 독립 oracle negative/identity tests: 16/16.
- F1/F2/interaction 통합 targeted: 41/41.
- 실제 geometry corpus: 58/58.
- Hardware suite: **151/151**.
- Repository check: exit 0.
- Default suite: **476/476** (기존 457개, 검사 회귀 15개, 전달 회귀 4개).
- 패키지 branding 검사 회귀: **15/15**, 수정 전 **13 PASS / 2 FAIL**.
- Trace 전달 및 관련 G4 검사: **7/7**, 관련 G3 검사 **4/4**.
- Packaging guards/host/output regression: **4/4**.
- Review/source 후보 ZIP의 서로 다른 빈 외부 temp 경로에서 core/public replay PASS.
  최종 이름으로 승격하는 ZIP도 같은 검증을 다시 통과해야 한다.
- Runtime byte identity에는 JS/CJS/MJS/Python/HTML/CSS 및 package 파일을 포함.
- Compiler, node_modules, global module lookup 없는 core replay.
- Browser dependency lane은 별도.
- Companion 14개 미제공 author check는 계속 **expected-fail**. 검사 삭제 없음.

Fresh replay는 고정 oracle, 실제 product positive smoke, 독립 corpus runner와
G2/G3/G4 tests를 실행한다. 명령·exit code·stdout/stderr·환경·input artifact hashes·
feature identity는 각 `.zip.validation.json`에 기록한다.

재현:

```sh
node experiments/hardware/g4-fix/run.cjs regressions \
  node --no-global-search-paths --test experiments/hardware/g4-fix/oracle/regressions.test.cjs

node experiments/hardware/g4-fix/positive-smoke.cjs
node experiments/hardware/g4-fix/geometry-check.cjs

# 별도 browser dependency lane
node experiments/hardware/g4-fix/browser.cjs

# 기존 제출물을 덮지 않는 새 후보 검증
node experiments/hardware/g4-fix/package.cjs --stage
```

기존 G4 validator의 report 경로 제한은 수정하지 않았다. 새 fix wrapper가
`g4-fix/G4_FIX_REPORT.md`의 포함 여부와 workspace/두 archive/추출본 byte 동일성을
별도로 검사한다. 기존 validation assertion을 삭제하거나 약화하지 않았다.

재개 당시 최종 패키지는 보존된 `full-suite/stdout.log`의 외부 fixture 이름을
현재 제품 branding으로 오인하여 실패했다. `scripts/check.js`는
`docs/hardware/evidence/` 아래 `stdout.log`/`stderr.log`만 구분한다.
원본 로그의 내용·경로·포함 여부는 바꾸지 않았다. 현재 source/docs/tests와
evidence의 JavaScript에 대한 branding 및 syntax 검사는 유지한다.
새 `test/check.test.js`가 실제 checker 진입점에서 이 경계를 검증하며,
두 ZIP의 독립 추출본에서도 고정 F1/F2 oracle과 함께 실행한다.

### B-PKG-01: browser trace 전달

첫 재검토는 runtime replay가 통과해도 browser trace가 ZIP에서 빠졌음을
발견했다. 기존 G3 archive 제외 규칙이 모든 `.zip`을 제외한 결과였다.
`docs/hardware/evidence/g4-fix/run-*/browser/trace.zip` 경로만 허용하고,
그 외 archive·secret·금지 경로 규칙은 유지했다. 원본 세 trace와 기존 index는
이름·내용·hash를 바꾸지 않고 그대로 포함한다.

새 wrapper는 각 G4-fix index의 모든 file reference에 대해 경로 안전성,
누락, 크기, SHA256, 중복과 index identity를 검사한다. 실제 추출본의 실행이
끝난 후에도 같은 검사를 통과해야 receipt가 PASS가 된다.

수정 후보 `g4-fix-package-cRMgPI/`의 두 독립 추출본은 runtime 및 evidence
동일성, 4개 기존 index의 294개 참조, 실제 public/geometry replay를 통과했다.
최종 패키지는 추가된 재개 로그까지 같은 검사로 검증한 뒤에만 생성한다.

대표 원본 trace:
`run-lopNF5/browser/trace.zip`, 31,746,311 bytes,
SHA256 `132ec555041c3ecb76abb6e5163cf6f9eaf740e83228d6cfae80e0df86945156`.

실패·성공 로그, 최종 476개 검사 및 2,718개 원본 보존 영수증:
[최종 전달 증거](../evidence/g4-fix/closure-01a07ec8/index.json).
재개 중 수정된 JavaScript/CJS 진단 오류·경고는 없었다. JSON LSP는 Biome
미설치로 실행하지 못했고, JSON parsing과 실제 파일 hash 검사는 통과했다.

핵심 evidence: [run-lopNF5/index.json](../evidence/g4-fix/run-lopNF5/index.json).
여기에 before/after raw geometry, navigation trace, browser PNG/Playwright trace,
실행 영수증과 source preservation manifest의 portable 위치·hash가 있다.

## G. Remaining limitations

- Complete origin set은 계속 not established. Known contributor를 complete로 바꾸지 않음.
- General reset/enable/mux/shared/merged cause, 일부 Control transform 및 alias origin은
  기존처럼 unresolved/unsupported.
- B는 여전히 dense. Desktop bounds 3432×2616, proper crossings 162개이며 zoom 필요.
  측정된 대표 layout은 약 90–112ms였지만 임의 대형 설계의 성능 보장은 아님.
- Bounded router가 한도에 도달하면 명시적으로 실패하고 이전 scene를 보존한다.
  이 한도를 높여 모든 입력을 지원한다고 주장하지 않음.
- 이전 독립 gate/visual reviewer는 Codex usage limit으로 verdict가 없었다.
  재개 후 검토는 제품 검사를 통과시켰지만 B-PKG-01 패키지 누락을 발견했다.
  trace 수정 후보의 독립 재검토는 **APPROVE**이며 남은 blocker는 없다.
  최종 파일명으로 생성된 새 bytes의 재현·checksum 검사는 별도 영수증으로 제공한다.
- 일부 fresh LSP 응답 timeout, HTML/CSS Biome 미설치. Syntax, actual browser,
  geometry, regression 결과와 구분한다.
- Native VS Code integration, production 교체, 새 live compiler replay: **NOT RUN**.
- 검증된 actual corpus와 필수 browser 경로에 남은 F1/F2 correctness blocker는 없음.
  사용자 디자인 승인까지 받았다는 뜻은 아니다.

## H. Final status

```text
F1: FIXED
F2: FIXED
Actual browser: PASS
G4 technical gate: PASS (verified correctness and delivery scope)
Independent final reviewer verdict: APPROVE (B-PKG-01 resolved; exact candidates recorded)
User visual/design acceptance: PENDING
G5: NOT STARTED
Production UI replacement: NOT PERFORMED
Commit: NOT PERFORMED
Push: NOT PERFORMED
Main merge: NOT PERFORMED
Version bump: NOT PERFORMED
Tag: NOT CREATED
GitHub Release: NOT CREATED
Marketplace publish: NOT PERFORMED
```

제출명:

- `dist/bsv-lens-hardware-g4-fix-review.zip`
- `dist/bsv-lens-hardware-g4-fix-source.zip`
- 각각 `.sha256`, `.validation.json`, `.validation.json.sha256`.
- 이 보고서와 before/after, 실제 RTL child, distinct-wire selection,
  Back-restored BSV 캡처 및 trace.

Archive 자신의 checksum은 자기참조를 피하기 위해 archive 밖에 둔다.
최종 전달은 두 ZIP의 public replay와 checksum 검증 후에만 한다.
