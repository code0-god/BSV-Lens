# G6 Actual-Workspace Usability / Automatic Discovery Follow-up

**실제 native 사용 검수 완료. 패키지 재생 gate 진행 중.** 검증한 최종 VSIX는
`e600679639f90e1f`다. 실제 AQuA 자동 시작·네 child·Loop·원문 왕복, 영어/한국어
420px pane·접근성·export, lifecycle 22단계, Code 프로세스 재시작과 secondary
routing 실패 복구가 같은 설치 bytes에서 통과했다. 마지막 전체 core는 841개 중 838개
통과, 실패 0개이며 분리 실행 대상 3개는 별도 검수했다. 이후 fresh 보조 도구 두
파일 수정은 10개 targeted 검사와 별도 native preflight로 확인했다. source/review ZIP의 fresh
replay 결과는 해당 외부 receipt에서 따로 확정한다.
사용자 visual/design acceptance는 `PENDING`이다.

이 보고서는 **archive 포장 전 native 완료 기록**이다. 포장 뒤 fresh replay의
최종 판정은 ZIP 옆 `.validation.json`과 외부 전달 영수증을 따른다. 실제 replay가
끝난 뒤 별도로 작성하는 `FINAL_DELIVERY.md`가 전체 전달 상태를 요약한다.

## A. 사용자 문제의 Before / After

시작 branch는 `feat/hardware-schematic`, HEAD와 로컬 `origin/main`은
`c6b9a5c642d105ad4117535c1d85366f1c02ec1c`, package와 lockfile은 `0.4.1`이다.
이전 G4/G5/G6와 같은 정렬 필터의 **389개 runtime/test/tool 파일** fingerprint는
`72dc20c67680f0356dd0c430cfd8b84fa24c1d6be7c8365ca93362e45fc8b50a`였다.
이는 Git HEAD와 별개인 미커밋 feature identity다. 시작 staged/unstaged/untracked
목록과 파일별 SHA는 [baseline](../evidence/g6-usability/run-2a6Mmm/baseline/baseline.json),
[Git/version 기록](../evidence/g6-usability/run-2a6Mmm/baseline/identity.json)에 있다.

Before는 기존 전달 VSIX `568cd5d7de13990a`를 격리 설치해 현재 AQuA로 재현했다.
SHA-256은 `f9d7a845aab91e366e85e5d73ec8cc04cf0e1f78586f3ef6c0ee8ad9d5b851d7`이다.
사용자 스크린샷의 수치를 복사하지 않았다. [재현 보고](../evidence/g6-usability/run-2a6Mmm/before/before-report.json).

| 문제 | 실제 Before | 실제 After — 최종 설치본 `e600` |
| --- | --- | --- |
| 수동 source 등록 | 빈 입력에서 source 폴더 등록 필요 | 명령 실행으로 69개 BSV 발견. 설계 선택 외 source 폴더·입력 이름·manifest·compiler 설정 없음 |
| MemorySubsystem 과밀 | 109 leaf 접점, 46 interface group, 27 route. `283 labels not shown` 표시 | 네 child 유지. 기본 leaf 접점 0, 경계 group 25, 실제 요약 route 21. 상세는 선택 시 표시 |
| `load`, `accumulators` 클릭 | 실제 몸체 중심 한 번 클릭 후 `ROUTING_BLOCKED` | 각 내부에 진입하고 원래 Memory overview로 Back |
| `staging`, `store` 클릭 | scene 밖 endpoint 때문에 `INVALID_ROUTING_INPUT` | 실제 child/storage/interface와 route가 있는 내부로 진입 |
| LoopMatmul root 전환 | `ROUTING_BLOCKED`, Memory 장면 유지 | Loop root 및 `matmul` 내부 진입. selector·owner·Inspector 일치 |
| selector/canvas 불일치 | 이전 설치본의 전환 완료 후 지속 불일치는 **재현되지 않음** | requested/pending/committed 분리, 실패 rollback·빠른 전환 회귀 추가. 보고된 증상을 재현한 것으로 꾸미지 않음 |
| raw router 오류 | 긴 `No orthogonal path: semantic-summary-…`가 기본 메시지 | 유지 중인 화면·실패 대상·재시도 안내. 원본 ID/stack은 문제 상세·진단에 보존 |
| source-only RTL 안내 | `Not attached`와 `stock` 등 내부 상태 반복 | 소스만 분석 중이라는 안내와 `RTL 결과 연결` 경로. RTL 없이 내부·코드 분석 가능 |

확인된 원인은 overview에서 leaf와 nested group을 동시에 투영한 점, 서로 다른
relation family가 같은 summary에 들어간 점, 현재 scene 밖 endpoint를 geometry에
넘긴 점이다. 이번 재현으로 parser나 canonical connectivity 결함이 확인된 것은
아니다. [변경 계약](FOLLOWUP_CONTRACT.md).

실제 원본 화면: [Before Memory](../evidence/g6-usability/run-2a6Mmm/before/memory-overall-webview.png),
[After Memory — `e600`](../evidence/g6-usability/run-2a6Mmm/happy/A02-memory-overview-webview.png),
[After load](../evidence/g6-usability/run-2a6Mmm/happy/A03-load-inside-webview.png),
[After Loop](../evidence/g6-usability/run-2a6Mmm/happy/A04-loop-overview-webview.png).
PNG는 실제 native capture이며 사후 확대·편집하지 않았다.

변경 책임은 기존 제품 경계에 둔다. Host discovery/session/input은
`src/panel/hardware-discovery.js`, `hardware-panel.js`, `hardware-session.js`,
`src/hardware/native-input*.js`; 선택 범위와 parse 재사용은 기존
`src/hardware/correspondence/*`; overview·선택 근거는 `scene-overview.js`,
`scene-summary.js`, `scene-query.js`; 화면·탐색·가독성은 기존 `media/hardware-*`다.
새 parser·query 엔진·UI framework·dependency는 추가하지 않았다. 기존 파일의 변경
41개와 당시 전후 SHA는 [보존 검사](../evidence/g6-usability/run-2a6Mmm/preservation/preservation.json)에 있다.
같은 정렬·포함 규칙의 최종 feature inventory는 **431개 파일**, fingerprint
`70e25382999765718a6d285ba8c2871f75dfb8bbccc495889cdb6eaad7aba1e7`다.
기존 파일 41개 변경과 새 runtime/test/tool 파일 42개, 각 상대 경로·크기·SHA는
[최종 feature identity](../evidence/g6-usability/run-6Gfu5Q/fresh-helper/identity.json)에 기록했다.
문서·evidence·VSIX 전체 파일 집합을 이 431개와 같다고 표현하지 않는다.
첫 evidence 보충의 변경은 `scripts/check.js`와 `test/check.test.js` 두 파일이었다.
경로·크기·SHA가 index와 일치하는 두 종류의 원본 시각 보고서만 검수 도구에서
인정하도록 좁힌 변경이며, 일반/미등록/변조 문서는 계속 거부한다. 제품 runtime과
검수 VSIX `e600`은 변하지 않았다. 최종 identity의 `postAssemblyDelta`에 이전
identity와 변경 근거를 기록했다. 이후 fresh 보조 도구와 관련 테스트 두 파일을
고친 이력도 마지막 identity의 delta로 이어진다. 제품 파일은 두 변경에 포함되지
않는다.

## B. 자동 발견

기존 `bsvArchitecture.openHardwareSchematic` 명령을 실행할 때 선택한 현재
workspace folder만 정적으로 읽는다. activation은 scan이나 compiler 실행을
시작하지 않는다. Webview는 파일 권한을 받지 않는다.

실제 workspace는 `$HOME/aisa-lab/DynDNN/AQuA`, branch `main`, commit
`9c8a6f5c4ab2ca3040028eae894d55f893eea299`다. 현재 inventory는 **69개 BSV**이며
`hw/bsv/src` 14개, `hw/bsv/tb` 54개, experimental 1개다. 이전 14개/two-root
범위를 전체 workspace로 보고하지 않는다. source index는 69개 파일의 68개
module definition을 확인했다. Memory를 고르면 검증된 의존 소스 **11개**,
Loop를 고르면 **7개**를 기존 semantic builder로 분석한다. compiler top이나
전체 workspace의 모든 구현을 확정했다는 뜻은 아니다.
[자동 시작 영수증 · 복원 JSON](../evidence/g6-usability/run-2a6Mmm/interned-json/json-interning.json) (원본 `happy/A01-automatic-start.json`),
[재생 입력·선택 descriptor](../evidence/g6-usability/run-2a6Mmm/inputs/workspace-descriptors.json).

workspace 시작 상태에는 기존 untracked 문서·도구 상태 등이 있었다. 이를 삭제하거나
clean workspace라고 보고하지 않는다. 보존용 전체 BSV 69개 fingerprint는
`9df9a798cee142e5ab9f9118820f4789c6f8cb7927cc62a996110767174f519b`,
기존 `hw/bsv/src` 14개 fingerprint는
`97ddbd5b3d40f050d23ede4c4f1723174820aa98f3f664f00a7a2f5aa3dd2c46`이다.
[원본 workspace 상태·정렬 inventory](../evidence/g6-usability/run-2a6Mmm/baseline/actual-workspace.inventory.json).

자동 inventory fingerprint는
`19b6bf469b0eb8f999e65386f908b4d31727f6f0de99584afbd42d015a9510ab`이다.
선택 입력 identity는 Memory
`78f19806d577d41cc427ab9715bc8994012c71bf797c2f49f9f4befed94aa25f`, Loop
`cac3068a898fb24144b7967c046eb5d7b529ebd704884356abee2879790df3bc`다.
inventory·선택 입력·source revision은 서로 다른 정의이며 같은 hash로 취급하지 않는다.

- **범위·중복:** 대소문자 `.bsv`, 깊은 하위 폴더, mixed repository, 열린 저장 파일,
  multi-root를 지원한다. 같은 URI는 중복 분석하지 않으며 다른 프로젝트의 같은
  이름을 합치지 않는다. root가 여러 개면 선택하고, function/type-only는 별도 안내한다.
- **include/exclude:** 기존 `bsvArchitecture.exclude`, `.bsv-arch.json`의 정적
  source roots/exclusions와 VS Code 설정 범위를 재사용한다. 새 설정은
  `hardwareAutoDiscover`, `hardwareInclude`다. cache/evidence는 기본 제외한다.
  `build`, `vendor`, `tb`라는 이름만으로 영구 제외하거나 chip top을 결정하지 않는다.
  제외 이유와 다시 포함하는 경로는 Settings에 있다.
- **library/testbench:** 이름·경로는 후보 분류 근거다. unresolved import는 남기고
  workspace 밖 library를 홈이나 상위 폴더에서 자동 검색하지 않는다.
- **갱신:** watcher와 save/document/workspace/configuration 이벤트를 coalesce한다.
  변경 파일은 inventory/parse를 재사용하고 선택 scope의 semantic graph는 다시
  만든다. 완전한 incremental semantic evaluation이나 모든 attach 시간 개선을
  주장하지 않는다. 삭제·rename 후 이전 range를 임의로 이식하지 않는다.
- **unsaved:** 저장된 디스크 분석과 dirty buffer, artifact의 과거 revision을 분리한다.
  자동 저장하지 않는다. source reveal 직전 실제 document hash/range를 검증한다.
- **한도:** discovery 후보 1,024개, source 256개, 총 16 MiB, 검색 10초.
  configured per-file 제한과 기존 registry/message/query 제한은 따로 적용한다.
  source entry 1,024개 상한에 걸리면 미반환 개수까지 partial로 표시한다.
  opaque parse cache는 256 records/32 MiB다.
- **artifact:** source-only를 먼저 연다. 알려진/승인된 folder의 후보만 제한적으로
  검사하며 여러 후보 중 첫 번째를 고르지 않는다. 파일명·mtime·type으로 BSV와
  join하지 않는다. 명시적 import 실패도 source 장면을 막지 않는다.
- **권한:** Restricted Mode의 bounded static read만 사용한다. root containment,
  symlink/replacement, panel/session/generation, source freshness, CSP와 제한된
  localResourceRoots를 유지한다. compiler·task·Makefile·script·다운로드 실행 없음.

정확한 API·ignore·watcher·authority 계약은 [DISCOVERY_AND_AUTHORITY](DISCOVERY_AND_AUTHORITY.md)에 연결한다.

## C. 새 기본 표시

현재 module 경계, 직접 child/storage, 직접 interface 경계 group과 확인된 요약
관계를 먼저 표시한다. interface를 고르면 하위 interface/method와 typed member를,
연결을 고르면 정확한 양끝·family·원본 relation·코드를 읽는다. 모듈 몸체와 제목은
한 번 클릭해 내부로 진입한다. 정보 액션·storage·port·wire는 별도 동작이다.

Memory overview의 **37개 canonical relation**은 요약에 포함된 원본 27개와
접힌 원본 10개로 정확히 나뉜다. 27개 원본이 실제 **21개 summary/route**로
표현된다. 접힌 leaf contact는 109개이며 모델에서 삭제하지 않았다. `load`는
111개 원본 중 103개를 32개 summary로, 8개를 상세로 보존한다. Loop는 152개
중 129개를 19개 summary로, 23개를 상세로 보존한다. 이것은 RTL net 수가 아니다.
[Memory membership · 복원 JSON](../evidence/g6-usability/run-2a6Mmm/interned-json/json-interning.json) (원본 `happy/A02-memory-overview.json`).

summary key는 owner, 정확한 interface path, 양끝 context, family, 방향을 포함한다.
containment·binding·forwarding·invoke·payload·state·scheduling을 임의의 데이터
화살표 하나로 합치지 않는다. 원본 membership은 독립 coverage 검사 대상으로 남긴다.

접힌 상세와 배치 실패도 구분한다. 정상 필수 AQuA 장면은 실제 route가 모두
배치된 상태였다. 의도적 secondary BSV routing failure에서만 해당 summary를
`deferred`로 남기고 구조·원본 관계 목록·source·Retry를 유지한다. source/occurrence/
authority/structure 실패와 RTL net routing 실패는 이 fallback을 받지 않는다.
`e600`의 원본 router 검색 queue에 한 번 실패를 주입한 검수는 **기존 설치
script bytes와 CSP를 그대로 유지**했다. 해당 summary 1개만 deferred로 남고
원본 relation·source 접근이 유지됐다. breakpoint 제거 후 Retry로 정상 3개 route를
복원했다. [현재 빌드 오류 주입·복구](../evidence/g6-usability/run-2a6Mmm/fault/routing-fault.validation.json).

기존 9 CSS px 하한과 선택/상세 12 CSS px 목표를 유지한다. 낮은 배율의 부가
caption을 접고 child 몸체 중앙·제목을 클릭 영역으로 보호한다. 선택 이름이 box에
맞지 않으면 충돌 없는 인접 위치를 제한적으로 시험한다. viewport나 query를 바꾸어
성공 수치를 만들지 않는다. 상세 규칙은 [UX_AND_PROJECTION](UX_AND_PROJECTION.md)에 있다.

## D. 실제 Native 검증

### 빌드와 설치 범위

전달할 설치 파일은 [bsv-lens-0.4.1-e600679639f90e1f.vsix](../../../dist/bsv-lens-0.4.1-e600679639f90e1f.vsix)이며
[SHA-256](../../../dist/bsv-lens-0.4.1-e600679639f90e1f.vsix.sha256),
[설치본 전달 영수증](../../../dist/bsv-lens-0.4.1-e600679639f90e1f.vsix.validation.json)을 함께 제공한다.
검수한 원본 VSIX를 재패키징 없이 복사한 동일 bytes다.
위 `dist` 링크는 저장소의 외부 전달 파일 위치이며 source/review ZIP 내부 경로가
아니다. ZIP 안에서는 아래 VSIX 검증 영수증과 indexed evidence의 원본 VSIX로
설치 bytes를 대조한다.
공식 `@vscode/vsce` 3.9.2 `createVSIX`로 만들었다. 708,341 bytes, 114개 entry,
runtime fingerprint 입력 107개 파일이며 CRC는 PASS다. **전체 전달 gate는 아직
PENDING**이다. 이후 runtime을 바꾸면 이 설치 검수와 분리한 새 VSIX가 필요하다.

| 항목 | 값 |
| --- | --- |
| Extension / version | `code0-god.bsv-lens` / `0.4.1` |
| VSIX SHA-256 | `fbedafa9fbf4435c305da01e0fb2279ad5288049f439bec6200d266d96800bbf` |
| Build/runtime fingerprint | `e600679639f90e1f070bd44f969ea8fe3cbac8ae67c7109eeffffad22964fe74` |
| Host fingerprint | `eefaa14fe4af821de4622e6623549da83b2c4d3c3cf950146c0aa54df8254305` |
| Webview fingerprint | `1bd445ee26673b4be5213525b95ac428371d8e828b4d4a27ab8517db2df0a0ef` |
| Schema / protocol | `1` / `1` |
| 실제 AQuA 설치 경로 | `/private/var/folders/6m/65prllx16pn1yq0bs0q_s5sc0000gn/T/bg6-8vZB6q/extensions/code0-god.bsv-lens-0.4.1` |

[VSIX 검증 영수증](../evidence/g6-usability/run-2a6Mmm/bindings/current/original-validation.json),
[현재 installed native 영수증](../evidence/g6-usability/run-2a6Mmm/lifecycle/native-receipt.json).
전체 archive SHA는 archive 밖에 기록한다. runtime fingerprint와 Git SHA, inventory
fingerprint, VSIX SHA는 각각의 파일 집합/정의대로 구분한다.

현재 `e600`은 VS Code **1.136.1**, Extension Host
Node **24.18.1**, Electron **42.10.0**, Chromium **148.0.7778.280**, macOS arm64,
local `file` workspace, Restricted Mode에서 실행했다.
개발 Extension Host나 localhost preview가 아니라 실제 격리 설치 VSIX였다.
설치 runtime·loaded build·harness 불변, 종료 code 0을
[native validation](../evidence/g6-usability/run-2a6Mmm/happy/native-happy.validation.json),
[독립 installed-byte 비교 · 복원 JSON](../evidence/g6-usability/run-2a6Mmm/interned-json/json-interning.json) (원본 `happy/installed-runtime-independent.json`)로 확인했다.

### 실제 장면·원문·가독성

아래는 `e600`의 actual native 측정이다. 이전 후보 수치를 복사하지 않았다. 기본 영어
dark theme, DPR 2, browser visual scale/CSS zoom 1이었다. Before Webview는
792×782, canvas 512×474.5, Inspector 280px; After Memory Webview는 792×782,
canvas 512×478.5, Inspector 280px이었다. canvas 높이가 같은 조건이라고 주장하지 않는다.

| 화면 | 실제 direct child | leaf 접점 / group | routed / deferred | 최소 표시 제목 CSS px | 결과 |
| --- | --- | ---: | ---: | ---: | --- |
| Before Memory | load, staging, accumulators, store | 109 / 46 | 27 / 해당 없음 | 12.00006 | 네 child 내부 진입 실패 |
| After Memory | 동일 네 child | 0 / 25 | 21 / 0 | 12.00010 | 네 이름·몸체 클릭·요약 연결 확인 |
| load 내부 | 직접 child module 없음; storage 17개 | 0 / 5 | 32 / 0 | 12.00001 | 진입·state·원문·Back; storage 이름은 선택해서 읽음 |
| staging 내부 | activations, weights, metadata | 4 / 14 | 14 / 0 | 11.00032 | 진입·Back |
| accumulators 내부 | 직접 child module 없음; storage 표시 | 0 / 1 | 8 / 0 | 9.00033 | 진입·Back |
| store 내부 | 직접 child module 없음; storage 표시 | 0 / 3 | 16 / 0 | 9.00011 | 진입·Back |
| Loop overview | matmul, fragments | 0 / 3 | 19 / 0 | 9.00011 | root/selector/owner 일치 |
| matmul 내부 | 직접 child module 없음; storage 표시 | 0 / 1 | 14 / 0 | 9.00011 | keyboard 진입·Back |
| active 선택 맞춤 | 선택 scope | 0 / 5 | scene 32 / 0 | 12.00000 | scope 밖 대상은 별도 표시 |

최솟값은 숨긴 글자를 제외한 실제 transform 이후 CSS px다. 모든 제목을 9px로
줄이라는 목표가 아니다. 선택 `active`는 기본 선택·source Back·선택 맞춤에서
12px 목표를 확인했다. 자동 typography/geometry finding은 14개 측정 상태에서
0개였으며, 실제 child·원본 relation 선택·source range와 함께 판단했다.
[14개 상태·17개 여정](../evidence/g6-usability/run-2a6Mmm/happy/acceptance-report.json).

`load` 초기 overview에서는 **17개 storage 이름이 모두 접혀 있다**. 해당 개요만으로
storage 이름을 읽을 수 있다는 성공 판정은 하지 않았다. 보이는 load 모듈의 접근성
이름에서 시작해 실제 **Tab/Enter**로 17개 모두를
선택했다. 각 전체 이름은 Inspector에서 **16 CSS px**로 보였고 source reference가
일치했으며 history는 늘지 않았다. 정답 entity ID로 숨은 지점을 직접 클릭한 검수가
아니다. [17개 실제 keyboard 접근](../evidence/g6-usability/run-2a6Mmm/happy/U11-load-storage-keyboard.json).

실제 `load.active`를 선택하고 writer `completeLoad`를 열었다. 제품 source resolver가
`hw/bsv/src/control/LoadController.bsv`의 **UTF-16 `[16783,17590)`**을 반환했고,
실제 TextDocument에서 **0-based `(458,4)`–`(482,11)`**을 선택했다. dirty=false,
document/source hash는 `53090eed8e40b74de2370149163641674a5ea56040691c9a250e1a94b2ed81cf`,
선택 문자열 hash는 `cd7c2b64434982c0d05d78ecf280acdba50065abef86d54367c74b755d53936b`로
일치했다. Back/Forward가 occurrence·state 선택·분석·viewport를 복원했다.
[실제 editor 영수증 · 복원 JSON](../evidence/g6-usability/run-2a6Mmm/interned-json/json-interning.json) (원본 `happy/A05-actual-editor-range.json`),
[원본 capture](../evidence/g6-usability/run-2a6Mmm/happy/A05-actual-editor-range.png).

현재 `e600`의 영어·한국어 responsive 검수는 실제 VS Code sash를 끌어 Webview를
**420×782 CSS px**로 만들었다. VS Code 창 1440×900, DPR 2, zoom 1과 실제
canvas 크기는 각 capture에 따로 기록했다. Light Modern/Dark Modern/High Contrast,
keyboard 선택, Inspector 닫기·복원, anchor/query/history 보존, reduced-motion의
동일 최종 상태와 제품 SVG 저장을 실행했다. PNG 33개·trace 34개를 보존했다.
실제 한국어 `설계`, `이어지는`은 개별 glyph와 한 줄 표시를 확인했다. 한국어/혼합
원문 QuickOpen은 저장된 텍스트 표시 검수이며 새 compiler 근거가 아니다. OS 창
전체 크기 변경은 NOT RUN이고, 실제 workbench pane 크기만 바꿨다.
[영어·한국어 responsive 실행](../evidence/g6-usability/run-2a6Mmm/responsive-summary/summary.json).

한국어 환경은 격리 profile에 `ms-ceintl.vscode-language-pack-ko`
`1.131.2026090407`을 설치하고 VS Code의 정상 첫 GUI 실행·재시작으로 언어 캐시를
준비했다. 실제 locale `ko`를 확인했으며 product 문자열이나 전역 설정을 주입하지
않았다. 번역 파일 SHA는 `5e01f090de1562fbde13265e4895b4723dc2a8b9f19990b1cbd2124cb7bd814c`다.

독립 검수자가 실제로 본 `e600` 원본 PNG는 총 **66개**, 대조한 DOM/측정 상태는
31개다. 실제 AQuA·EN/KO·새로 촬영한 가림 없는 Code 재시작 범위는 PASS이며
구체적으로 본 이미지 목록을 기록했다. 66개가 서로 다른 66개 여정이라는 뜻은
아니고, happy의 중복 전체 창 capture 14개를 다시 보았다는 주장도 아니다.
좁은 partial/실패 유지 장면을 전체 Fit 가독성 PASS로 확대하지 않는다.
[최종 독립 시각 검토](../evidence/g6-usability/run-2a6Mmm/visual/FINAL_VISUAL_REVIEW.json).

### 실제 실행 비용

최종 AQuA 공개 요청의 보고 시간은 **3,661.01ms**였다. discovery 109.63ms,
source 등록부터 index까지 54ms, scene preparation부터 완료까지 1,387ms가 각각
관측됐다. 설계 picker와 worker/transport를 포함하는 전체 요청을 순수 parsing이나
routing 시간으로 부르지 않는다. Memory scene의 compact JSON은 820,812 bytes,
그중 projection은 42,338 bytes; load scene은 1,249,598 bytes다. label preparation은
해당 Memory capture 0.70ms, load 2.00ms였다. 이는 한 환경의 실행 관측이며 대형
설계 지원 성능 보장이 아니다. 필수 정보 삭제나 query limit 증가로 수치를 맞추지
않았다. [계측 정의·단계별 수치 · 복원 JSON](../evidence/g6-usability/run-2a6Mmm/interned-json/json-interning.json) (원본 `happy/performance.json`).

### 회귀와 전달 gate

| lane | 실행 결과 | 증명 범위 |
| --- | --- | --- |
| 전체 core — fresh 보조 도구 수정 전 | 841 tests, 838 pass, 0 fail, 3 separate-lane skip, 0 cancel; 119 test files | source fingerprint `9d692a7a…`의 431개 파일 복사본 실행. 입력·dependency·author content 변화 0. 이후 보조 도구 변경까지 전체 재실행한 결과로 표시하지 않음 |
| Fresh 보조 도구 수정 | targeted 10 tests / 10 pass / 0 fail·skip·cancel; native preflight 4단계 PASS | 원본 archive와 core 생성 경로 구분. 수정 후 복사 snapshot의 실제 설치 실행이며 새 두 ZIP의 최종 fresh replay와 별개 |
| 분리 실행 | 8 tests, 8 pass, 0 fail/skip/cancel | 위 3개 skip에 대응하는 실제 browser-negative, source-interface, historical dense lane 실행. native acceptance와 구분 |
| A01–A06 / U03·U04·U09·U11 — `e600` | 17단계 PASS, 14개 장면, 31 PNG, 35 trace | 실제 AQuA 자동 시작, 네 child, Loop, interface/원본 relation, editor range·Back, storage 17개 keyboard 접근 |
| Discovery/lifecycle — `e600` | 22단계 PASS | no-BSV/function-only/deep/multi-root/dirty/save/create/rename/delete/library/include/exclude/symlink/partial 및 authority/stale/Back/source/dispose/reopen |
| Artifact / F1·F2 — `e600` | lifecycle 내 실제 실행 PASS | 후보·malformed·다중 선택·revision mismatch·artifact 실패 후 source 복귀·RTL occurrence/wire. strict RTL routing 거부는 별도 core 범위 |
| Secondary BSV routing — `e600` | F01–F03 PASS | 원본 route 1개 실패 주입, 정확한 deferred/member 유지, Retry 3개 route 복원 |
| 실제 Code 프로세스 재시작 — `e600` | PASS | 서로 다른 두 process에서 source 재등록 없이 identity·선택·query·표시 상태·동일 canvas의 정확한 transform 복원 |
| G5 semantic 75 queries | 검증된 cross-build identity 대응 후 전체 사실 PASS | 원래 strict identity 비교 FAIL도 함께 보존 |
| 공개 delivery 12 queries | CLI/HTTP/source/worker cancellation/전체 indexed facts PASS | 과거 외부 ZIP 없이 실행. 기존 request 그대로의 `ANALYSIS_MISMATCH` 보존 |
| 영어·한국어 responsive / export — `e600` | PASS | 실제 420px pane, theme/HC/keyboard/Inspector/anchor/reduced-motion/source/CJK/export. 실제 locale en/ko 확인 |
| 최종 source/review ZIP / fresh extraction / installed replay | PENDING | SHA·CRC·runtime·원본 보존·author companion expected-fail 최종 확인 필요 |

[마지막 전체 core 영수증](../evidence/g6-usability/run-4uFBPL/final-validation/core/core.json),
[분리 실행 영수증](../evidence/g6-usability/run-2a6Mmm/separate-eight/completion.json),
[현재 lifecycle 영수증](../evidence/g6-usability/run-2a6Mmm/lifecycle/lifecycle.validation.json),
[실제 재시작 영수증](../evidence/g6-usability/run-2a6Mmm/restart/restarted/g6/process-restart.validation.json),
[75 query 실행](../evidence/g6-usability/run-2a6Mmm/semantic75/receipt.json),
[12 query 실행](../evidence/g6-usability/run-2a6Mmm/legacy12/receipt.json).

core 실행은 `/opt/homebrew/Cellar/node/26.7.0/bin/node`의 독립 test lane이다.
설치 native의 Extension Host Node 24.18.1 실행을 대신하는 결과로 쓰지 않았다.

이전 FAIL/REVISE를 삭제하지 않았다. `5cae`의 D09는 늦은 저장 응답이 partial
안내를 되돌린 문제였고, `84ba`는 다른 입력으로 Back한 뒤 discovery 안내가 섞인
문제였다. 현재 빌드는 입력에 바인딩한 display metadata를 유지한다.
D09 FAIL 원본은 아래 과거 실행 보존 목록에 기록했다,
cross-input 실패 재현 원본은 아래 과거 실행 보존 목록에 기록했다.

이후 `06c` lifecycle 시각 검토는 **REVISE**였다. 264px pane의 작은 captured-A
RTL root에서 root/left/right 이름이 전부 숨고, 작업이 끝나도 source 여는 중 안내가
남았다. 초기 canvas 264×87에서 계산한 Fit이 chrome 정착 뒤 264×188에도 남는
경우를 확인했다. 현재 빌드는 첫 committed frame의 Fit을 한 번 정리하고 주요 RTL
제목을 collision-safe 위치에 표시하며, 완료된 artifact 상태와 작업 중 안내를
분리한다. M complete-cone·canonical net·F2 geometry는 확대/완화하지 않았다.
06c 시각 REVISE 원본은 아래 과거 실행 보존 목록에 기록했다.

Code 재시작에서는 saved canvas 크기가 빠져 512×479에서 512×505로 바뀔 때
선택 anchor가 −2.5px 어긋났다. geometry hash는 같았다. viewport 크기·anchor를
함께 복원한 `e600`의 resize 재시작 DOM은 y를 정확히 **13px** 조정해 anchor 오차
0을 확인했다. 해당 실행의 after PNG는 trust dialog로 가려져 시각 증거가 제한됐다.
이를 덮어쓰지 않고 새 격리 실행에서 두 번 모두 **No, I don't trust the authors**를
실제로 선택하고 visible dialog 0 상태를 촬영했다. 서로 다른 PID 73692/74195의
canvas가 512×479로 같을 때 viewport transform도 정확히 같았으며 원문·선택·query가
복원됐다. resize DOM과 가림 한계 원본은 아래 과거 실행 보존 목록에 기록했다,
[가림 없는 실제 재시작](../evidence/g6-usability/run-2a6Mmm/restart/restarted/g6/process-restart.validation.json).
지연 복원 query/scene가 사용자의 새 수동 viewport를 되감는 두 재현도
추가했고, 현재는 새 manual intent를 우선하면서 query 결과를 유지한다.
원래 anchor 실패 원본은 아래 과거 실행 보존 목록에 기록했다,
지연 query 실패 원본은 아래 과거 실행 보존 목록에 기록했다,
지연 scene 실패 원본은 아래 과거 실행 보존 목록에 기록했다.

다음은 이번 수정 중 FAIL/REVISE 및 가림 한계를 남긴 원본 보존 기록이다. 경로는
작성자 저장소의 `.build/hardware/runs/` 기준이며 **이번 검수 ZIP에는 미포함**이다.
현재 PASS gate의 증거로 대신 사용하지 않는다. 기존 G6 historical companion은
별도 계약이며 아래 follow-up 실행을 그 companion에 포함했다고 주장하지 않는다.

| 과거 원본 경로 | SHA-256 |
| --- | --- |
| D09 FAIL: `g6-usability-final-lifecycle-Yr4rld/g6/lifecycle-report.json` | `dfc751ae5a8fdf63ee6337a4e28d73e40614a3f47b3c7925e51d38eab89aa089` |
| cross-input 실패 재현: `g6-usability-d09-review-glntL1/g6-usability/cross-input-build-alias-repro.json` | `c9f5993e46269dedbdd61fb1310eed3166c74c18590dcf012e82a4288df56df3` |
| 06c 시각 REVISE: `g6-usability-visual-XIsITE/g6/visual-review.json` | `c65bd337184786b848d46652231529e06bd2b7105b9fe9d9bb6f4d58613b0e1f` |
| resize DOM과 가림 한계: `g6-usability-final-process-restart-sGxYoR/g6/process-restart.validation.json` | `8fe05e40576e46ad26f4de19856c0f836401ec19a6e208b8a08d19bf2af18850` |
| 원래 anchor 실패: `g6-usability-viewport-debug-etTmkg/g6-usability/observed.json` | `458b7e7b9295c14e7d191a53ecbb568064f1ffbd28ecbd2ec7a86f99c0abed9d` |
| 지연 query 실패: `g6-usability-restore-review-yUNZeI/g6-usability/manual-during-restored-query.json` | `ca16a295ebd9efcc3d85fd58e2aa3e5a12083b3fb6f6087e8a15b79d85b482dc` |
| 지연 scene 실패: `g6-usability-restore-scene-review-infEHP/g6-usability/manual-during-restored-scene.json` | `d02e4a4db24b0e6b94945c500791442c76994b1fcc331f0b90ee84b641350511` |

첫 review fresh 실행은 shipped/core·12/75 public query·decoder·author companion
14개 expected-fail 검사를 지난 뒤 Code 실행 전 보조 도구에서 실패했다. core 보안
검사가 만든 generated-run symlink를 원본 archive 파일로 잘못 분류한 원인이며 제품
실패가 아니다. 기존 원본 archive에는 금지된 정확한 `.build/hardware/runs/` 경로와
검사 후 생성된 output을 구분하도록 보조 도구만 수정했다. 다른 경로·symlink 검사는
유지한다. [실패 영수증](../evidence/g6-usability/run-6Gfu5Q/fresh-helper/failed-fresh-receipt.json),
[10개 targeted red/green](../evidence/g6-usability/run-6Gfu5Q/fresh-helper/helper-receipt.json),
[독립 경계 검토](../evidence/g6-usability/run-6Gfu5Q/fresh-helper/audit.json)를 보존했다.

수정 후 복사 snapshot에서 같은 VSIX를 격리 설치하고 자동 소스 발견, Memory/load,
writer의 실제 editor 범위, Back, Loop를 실행한
[native preflight](../evidence/g6-usability/run-6Gfu5Q/fresh-helper/native-preflight-receipt.json)는 PASS다.
최종 두 ZIP 자체의 fresh 결과로 바꿔 부르지 않으며, 그 실행 판정은 계속 외부
receipt에 남긴다. 841개 전체 suite는 이 보조 도구 변경 전 결과다.

source-entry/cache 구현 변경은 source provider closure hash를 바꾼다. 따라서
analysis/correspondence/origin/query/result의 파생 ID까지 과거와 byte-equal이라고
주장하지 않는다. 비교기는 양쪽 provider closure와 bundle/analysis/query/result
seal을 검증하고 **546개 typed identity 경로만 일대일 대응**했다. 그대로인 과거
전체 semantic 비교기로 재검사한 capture SHA는
`7728623c829d74c7671cdb40133c617c96668557a3b4b472e10abc20d26e18f6`로 과거와 같다.
ordered bits/slices, driver/load, dependency/frontier, scope, state readers/writers,
conditions, actual/formal/source ranges, stock facts와 instrumented contributor
claims를 지워 맞춘 비교가 아니다. complete-origin 미확인 상태도 유지한다.
[비교기](../../../experiments/hardware/g6-usability/semantic.cjs),
[봉인된 기준](SEMANTIC_BASELINE.json).

시작 보존 inventory는 content-hash 151,399개와 별도 과거-run metadata 48,531개다.
이 둘을 모두 새 content-hash 검증으로 표현하지 않는다. 실제 보존 검사에서
151,399개 중 151,358개가 같았고 승인 범위의 기존 파일 41개만 변경됐다.
unauthorized/historical/workspace 변화는 각각 0이다. 이후 검수 도구·테스트의
추가 변경은 위 최종 identity의 delta로 구분하며 그 시점의 보존 영수증을 덮어쓰지
않았다. actual native happy 실행에서도
원본 AQuA `hw/bsv` 658개 파일은 최초 Before부터 최종 After까지 byte-identical이었다.
기존 FAIL/PARTIAL/trace/receipt/ZIP은 그대로 남긴다.
[보존 실행 결과·41개 변경 목록](../evidence/g6-usability/run-2a6Mmm/preservation/preservation.json).

## E. 남은 한계

- source-only는 실제 compiler 구현과 자동 대응하지 않는다. 별도 artifact에
  metadata/revision 근거가 없으면 독립 context다. G3 origin coverage, generic
  implementation join, source specialization, formal-token range를 확장하지 않았다.
- BSV semantic summary는 실제 RTL net이 아니다. 모든 관계를 한 화면에서 동시에
  표시하지 않는다. 선택 scope 밖 결과·folded detail·unrouted detail을 구분한다.
  `load` 초기 overview의 storage 17개 이름은 모두 접힌다. 각각의 keyboard/Inspector
  접근을 검증했다. 선택 Fit은 화면 범위 밖의 block 17개와 route continuation
  32개를 명시하는 subset이며 complete cone이 아니다.
- 큰 RTL scene 제한과 기존 M complete-cone/frontier 한계는 그대로다. 전체 AQuA
  artifact-backed 또는 모든 큰 회로 렌더링 성공으로 확대하지 않는다.
- 검증 환경은 local macOS arm64 native다. remote/virtual/web host는 기존 미지원
  범위를 유지한다. 다른 OS와 최소 지원 VS Code 1.90 실제 설치 실행은 NOT RUN이다.
- Live compiler lane은 이번 follow-up에서 NOT RUN. 자동 compiler/task 실행 없음.
- Biome LSP는 설치되지 않았고 기존 설치 거절을 유지했다. LSP 진단은 미수행이며
  실제 syntax/core/native 검수와 구분한다.
- 독립 시각 검토와 사용자 visual/design acceptance는 별개다. 사용자 승인은 PENDING.

## F. 종료 상태

아래 native 사용 기능의 완료는 실제 `e600` 설치본 결과에 한정한다. 최종 검수
archive 재생·외부 receipt 작성은 별도 전달 gate다.

| 항목 | 현재 상태 |
| --- | --- |
| Workspace auto discovery | COMPLETE — 지원 local 범위의 현재 설치본 discovery/lifecycle 통과 |
| Actual AQuA source-only navigation | COMPLETE — 최종 설치본 A01–A06 및 실제 source 왕복 통과 |
| Overview / interface disclosure | COMPLETE — 실제 root/child·원본 membership·선택 상세·keyboard 접근 통과 |
| Failure recovery / state consistency | COMPLETE — 현재 lifecycle·오류 주입·실제 Code 재시작과 관련 core 회귀 통과 |
| Installed native validation | PASS — D에 명시한 동일 `e600` VSIX의 AQuA·EN/KO·lifecycle·복구·재시작 lane |
| Fresh source/review delivery | PENDING |
| User visual/design acceptance | PENDING |
| Production default replacement | NOT PERFORMED |
| Commit/push/merge/version/release | NOT PERFORMED |
| G7 | NOT STARTED |

전달 예정 파일은 `bsv-lens-hardware-g6-usability-review.zip`,
`bsv-lens-hardware-g6-usability-source.zip`, 검증한 최종 VSIX와 각각의 SHA-256·validation
receipt다. 최종 ZIP 링크·크기·SHA·fresh replay는 아직 미확정이다.

**archive 밖 최종 실행 영수증 계약:** source/review ZIP을 만든 뒤 빈 디렉터리에
추출하여 검사한다. 그 실제 결과와 archive SHA는 같은 전달 디렉터리의
`bsv-lens-hardware-g6-usability-review.zip.validation.json`,
`bsv-lens-hardware-g6-usability-source.zip.validation.json` 및 각 `.sha256`에 기록한다.
이 내부 보고서를 갱신해 아직 만들지 않은 자기 archive의 hash나 미래 replay PASS를
예측하지 않는다. 외부 receipt가 실제 SHA·CRC·공통 runtime·원본 보존·core/native
fresh 실행 결과를 증명하며, 최종 사용자 요약도 그 실제 완료 상태를 따른다.
fresh의 core는 기존 G4 replay plan이 지정한 shipped/core 검사와 이번 package/
decoder 검사다. 위 author 전체 suite 841개 재실행과 같은 범위가 아니며, 실제
fresh pass/fail/skip 수는 각 외부 receipt에 따로 기록한다. compiler 없이 실행하는
공개 query·shipped/core 계약을 유지한다.
fresh replay가 끝나면 ZIP 바깥에 `FINAL_DELIVERY.md`와 전달 영수증을 새로
작성한다. 이미 검수한 archive 내부 보고서를 바꾸거나 다시 포장해 hash를 바꾸지
않는다. 따라서 이 문서의 포장 전 `PENDING`과 이후 외부 영수증의 최종 판정은
서로 다른 시점의 기록이다.

[현재 evidence index](../evidence/g6-usability/run-2a6Mmm/index.json)는 attachment **725개**와 원본 PNG **120개**,
trace ZIP **107개**를 바인딩한다. PNG 전체 수와 독립 검수자가 실제 본 66개는
범위가 다르다. [ACCEPTANCE.json](ACCEPTANCE.json)의 45개 gate는 같은 index의 실제
실행 결과를 가리킨다. 44개는 installed VSIX, strict RTL routing 거부 1개는 core
검사이며, 이를 45개의 독립 native 여정으로 합산하지 않는다.

본문의 **복원 JSON** 링크는 물리적으로 포함한
[원본 경로·크기·SHA와 공유 표현 manifest](../evidence/g6-usability/run-2a6Mmm/interned-json/json-interning.json)를
가리킨다. 괄호의 원본 경로는 복원된 논리 파일명이며 압축 해제 직후의 파일인 것처럼
링크하지 않았다. Before DOM 6개와 큰 초기 inventory 2개도 해당 index의 decoder
manifest로 원본 SHA를 검증한다. [EVIDENCE_ENCODING](EVIDENCE_ENCODING.md)에
정확한 복원 방식과 실행 명령을 적었다. 원본 trace/PNG와 acceptance 주 보고서는
그대로 포함하며, 자원 한도는 올리지 않았다.

[전체 core·checker identity 보충 index](../evidence/g6-usability/run-4uFBPL/index.json)는 7개 attachment를 추가한다.
마지막 전체 core 841개/838 pass와 당시 source fingerprint를 이 index에 봉인했다.
보충 index에는 native/acceptance 기록이 없으며, 기존 45개 gate와 `run-2a6Mmm`을
수정하지 않는다. F07의 strict RTL routing 거부 proof는 관련 제품·테스트 코드가
동일한 기존 core 실행을 계속 가리킨다. [Fresh 보조 도구 보충 index](../evidence/g6-usability/run-6Gfu5Q/index.json)의 7개 attachment에 마지막
source identity·실패·수정·preflight 근거를 추가했다. 세 index의 attachment 합계는
739개이며 PNG 120개·trace 107개 수는 변하지 않았다.

기존 optional historical QA companion과 **author companion 14개**는 다른 계약이다.
author companion이 없으면 기존 author preservation 검사는 명시적으로 실패해야 하며
silent-pass로 바꾸지 않는다. 현재 gate의 필수 native trace·PNG·측정을 과거 참고
자료로 돌려 제외하지 않는다.

사용 절차는 [USER_INSTALL](USER_INSTALL.md)에 모았다. 격리 profile에서 최종 VSIX를
설치하고 workspace를 연 뒤 Hardware Schematic 명령을 실행한다. 설계를 선택하고
블록을 한 번 클릭해 내부·연결·원문을 확인한다. 일반 profile·기존 Architecture/Source
화면은 그대로 유지한다.
