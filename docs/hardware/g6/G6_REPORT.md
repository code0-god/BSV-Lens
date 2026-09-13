# G6 — Native VS Code Integration / Installed VSIX / Workspace Validation

기존 확장 안에 opt-in native Hardware Schematic을 연결했다. 실제 설치본의 workspace 입력,
BSV/RTL 분석, editor 왕복, 재시작, 보안 검수를 수행했다. 대형 설계와 모든 환경의 지원을
선언하지 않는다. **사용자 visual/design acceptance는 PENDING**이다.

## A. 시작 기준과 보존

| 항목 | 확인 결과 |
| --- | --- |
| Branch | `feat/hardware-schematic` |
| HEAD / 시작 시 로컬 origin/main | `c6b9a5c642d105ad4117535c1d85366f1c02ec1c` |
| Extension / package·lockfile version | `code0-god.bsv-lens` / `0.4.1` |
| 정확한 기존 G5 317개 inventory | `bb3967506aa5579028f019432a2c9d9dcfe9c4116e35245211dd589f5bd27f55` |
| 최종 source/test/tool runtime inventory | 정렬 389개, `72dc20c67680f0356dd0c430cfd8b84fa24c1d6be7c8365ca93362e45fc8b50a` |
| 실제 제품 runtime inventory | package/src/media의 102개, 생성 metadata 제외 |

서로 다른 파일 집합의 fingerprint를 단순 비교하지 않았다. Git HEAD도 미커밋 G2–G6
feature 전체를 식별하지 않는다. 시작 시 `.gitignore`, `scripts/check.js` 변경과 기존
미커밋 구현을 보존했다.

[기준선](../evidence/g6/run-TEmIQj/baseline/baseline.json)과
[최종 보존 검사](../evidence/g6/run-TEmIQj/preservation/preservation.json):
**148,815개** 원본 파일/링크 검사, **148,797개 동일**, 승인 범위 runtime/test 파일
**18개 변경**. 승인 밖 변경 0. 이전 run **20,849개** path/type/size/mtime 변경 0이며,
이 metadata 검사를 새 content-hash 검사라고 부르지 않는다. 원본 BSV, compiler artifact,
G2–G5 evidence, 이전 ZIP은 보존했다.

기존 파일 변경은 `src/extension.js`, `package.json`, `src/hardware/{architecture,registry,
scene-query,scene}.js`, 관련 `media/hardware-*`, `scripts/check.js`, geometry oracle 및
관련 테스트다. 추가 runtime은 `src/panel/hardware-*`, generic native input/artifact scene,
`media/hardware-native.*`다. 정확한 기존 변경 파일/전후 SHA는 보존 검사에 있다.
새 테스트·검수 도구는 `experiments/hardware/g6`, 계약은 `docs/hardware/g6`에 둔다.

## B. Native 통합

Command: **BSV Lens: Open Hardware Schematic (Experimental)**,
ID `bsvArchitecture.openHardwareSchematic`. 기존 command/category/config와 source-only
화면을 유지한다. Activation만으로 compiler/import/workspace 전체 scan을 시작하지 않는다.
동일 workspace URI는 panel을 재사용하고 다른 workspace·legacy panel은 분리한다.

Host는 명시적으로 승인한 source/artifact root, registry, worker/query, source freshness,
실제 editor, export dialog를 소유한다. Webview는 기존 Scene/Navigation/Renderer와
가독성 정책을 사용한다. 설치 runtime에 `experiments`, A/B/C catalog, preview 서버,
작성자 `.build`, repository 밖 dependency가 필요하지 않다.

입력 없는 화면은 선택 안내를 제공한다. Source-only는 hardware snapshot `null`,
artifact-only는 BSV owner/sourceContext `null`을 유지한다. Metadata 없는 source/artifact
사이의 join을 추정하지 않는다. 그런 입력의 원문 분석은 명시적인 source-only 등록과
구분한다. Instrumented capture는 별도 승인을 받고 known-contributor/partial 경계를 유지한다.

Native integration에서 확인·수정한 경계:

- 여러 root의 analysis context를 순서대로 요청한다. Host 동시 요청 상한 4를 높이지 않았다.
- `scene` 응답은 후보다. 검증된 `persist(state, revision)`만 실제 표시 visit을 확정한다.
  실패한 layout이 editor owner를 바꾸지 않는다. Semantic commit은 즉시 전송하고
  viewport/disclosure 저장은 debounce한다. 늦은 저장·ACK가 Back을 덮지 않는다.
- Source reverse는 viewport/disclosure 변화에 취소되지 않으며 owner/selection/query 변화는 구분한다.
- Revive는 고유하게 매칭한 Host workspaceState envelope를 사용한다. 입력 재등록과
  identity/revision 검증을 거쳐야 복원한다. Webview 상태는 파일 권한이 아니다.
- 실제 VS Code Position은 plain `{line, character}`로 전달한다. 검수는 editor 선택뿐 아니라
  정확한 source-open ACK와 frontend source 완료까지 확인한다.
- 실패한 hierarchy layout의 오류는 resize 후에도 남는다. 마지막 valid scene은 보존한다.

[Architecture/ADR](G6_NATIVE_ARCHITECTURE.md), [입력/Trust](G6_INPUT_AND_TRUST.md),
[protocol](G6_HOST_WEBVIEW_PROTOCOL.md), [계약](G6_CONTRACT.md)에 책임과 제한을 명시했다.

## C. 설치본 identity

[검증용 VSIX](../../../dist/bsv-lens-0.4.1-568cd5d7de13990a.vsix),
[SHA-256](../../../dist/bsv-lens-0.4.1-568cd5d7de13990a.vsix.sha256).
실제 검사한 파일을 그대로 복사했으며 설치 검사 후 다시 포장하지 않았다.

| 항목 | 값 |
| --- | --- |
| VSIX bytes | 670,124 |
| VSIX SHA-256 | `f9d7a845aab91e366e85e5d73ec8cc04cf0e1f78586f3ef6c0ee8ad9d5b851d7` |
| Build | `g6:568cd5d7de13990a8dd2ac0f2307d0ba993754712ce00a3581c2c422b1a967c7` |
| Host fingerprint | `637226ca6155233db5024689af88141b620ea4f0cb02f5455987b264b2ab397c` |
| Webview fingerprint | `49ce08b85fdd6e1b4ff5449af78145d4732a55630702cb62b95ab86831e12bc5` |
| Protocol/state schema | 1 |
| 실제 환경 | macOS 26.5.2 arm64, VS Code 1.136.1 |
| 실제 Extension Host | Node 24.18.1 / Electron 42.10.0 / Chromium 148.0.7778.280 |

실제 N 설치 위치:
`/private/var/folders/6m/65prllx16pn1yq0bs0q_s5sc0000gn/T/bg6-CvxQqB/extensions/code0-god.bsv-lens-0.4.1`.
각 lane의 설치 위치·실행 argv·runtime inventory는
[native receipt](../evidence/g6/run-TEmIQj/native-n/native-receipt.json)에 기록했다.

최종 모든 CLI/Code 실행은 private **user-data / extensions / shared-data**를 지정했다.
VS Code 1.136.1의 별도 application-shared Trust 저장소도 분리한다. 이전 pilot의
불완전한 shared-data 격리를 최종 gate로 사용하지 않았다. 최종 product와 observer는
둘 다 설치된 VSIX이며 `extensionDevelopmentPath`로 제품을 로드하지 않았다.

VS Code가 package.json을 재서식하고 top-level `__metadata`를 추가하는 경우만 명시적으로
정규화한다. Raw manifest·delta를 남기며 나머지 의미와 모든 runtime 파일은 동일해야 한다.
VSIX 전체 hash는 VSIX 밖에 기록한다.

## D. Native 사용자 여정과 가독성

[N01–N15](../evidence/g6/run-TEmIQj/native-n/native-acceptance.json) **PASS**:
실제 입력 등록, left 단일 클릭, state/writer, 정확한 editor 범위, editor instance 선언 역탐색,
ordered net/pin, same-net/dependency, sequential/unsupported boundary, partial contributor,
RTL root/child/sibling, Back/Forward/Up, 서로 다른 wire 선택, C narrow/wide 구분.

[실제 재시작](../evidence/g6/run-TEmIQj/native-restart/native-restart.json) **PASS**:
서로 다른 Code PID, 같은 private profile. 재등록 전 no-input/무권한 상태,
재등록 후 occurrence·query/source refs·selection·viewport·disclosure 복원, 실제 editor 재열기 확인.

[Native typography](../evidence/g6/run-TEmIQj/native-typography/native-typography.json) **PASS인 실행 범위**:
실제 light/dark/high contrast, reduced-motion 최종 상태, split editor, Inspector 열기/닫기,
선택/전체 Fit, 지연된 실제 source 응답, C 8/12 ordered positions 표시.
지연 검사는 실제 IPC 응답 도착 후 동일 bytes를 잠시 보류한 test-only latency 주입이다.
query/source/worker를 mock하지 않았다.

| 장면 | 실제 window / Webview / canvas CSS px | 최소 표시 node title | 결과 |
| --- | --- | ---: | --- |
| A 전체 | 1440×900 / 792×808 / 512×500.5 | 12.00023 | root·left/right 식별 |
| A left | 1440×900 / 792×808 / 512×500.5 | 12.00042 | state·put/get 식별 |
| A narrow RTL | 1440×900 / 396×808 / 396×255.61 | 9.00009 | 필수 이름·전체 topology |
| Light / reduced-motion | 1440×900 / 396×808 / 396×255.61 | 12.00020 | 필수 이름 유지 |
| 지연 source 뒤 | 1440×900 / 546×808 / 546×330 | 12.00044 | 선택 state·owner 맥락 유지 |
| 실제 Memory source | 1440×900 / 792×808 / 512×440.5 | 10.00017 | root·scratchpad·accumulator·initialized |
| 실제 retained RTL 선택 | 1440×900 / 792×808 / 512×422.5 | 표시 node title 없음 | 선택 contact D_IN 12.00000 |

표의 단위는 CSS px, DPR 1. CTM·glyph bounds·clip·외부 iframe 배율을 독립 측정했다.
숨긴 라벨은 최소값 계산에서 제외하고 필수 이름을 따로 검사한다. 마지막 RTL 행을
전체 제목 가독성 PASS로 취급하지 않는다. 현재 선택과 RTL occurrence는 header/Inspector에
읽히지만 **13 blocks·33 route continuations가 화면 밖**이다. 관계 전체의 시각 검수는 PARTIAL.

전체 Fit은 전체 topology, 선택 Fit은 local scope와 continuation을 뜻한다. Resize/Back은
선택 anchor를 보존하며 자동 전체 Fit하지 않는다. 이에 따라 shell 제목이 밖에 있을 수 있는
선택 화면은 선택 이름과 읽을 수 있는 owner 맥락을 검사한다. 실제 전체 Fit 검사에서는
root/child 이름·전체 bounds를 계속 요구한다. Canvas `clientHeight` 정수화와 DOM bbox의
차이는 따로 기록했고 임의의 큰 오차 허용으로 통과시키지 않았다.

OS 창 전체를 1280×960/1600×1000으로 재조정하는 최종 lane은 **BLOCKED/NOT RUN**.
[CUA 접속 시도](../evidence/g6/run-TEmIQj/window-control/control.json)의 `App quit` 오류를
보존했다. 이전 후보의 1281×959 실측을 현재 빌드 증거로 대체하지 않는다. 현재 T08/T09는
실제 1440×900 창의 pane 변화다. Native 396px pane을 기존 420px 조건이라고 부르지 않는다.

[최종 시각 검토](../evidence/g6/run-TEmIQj/visual-review/visual-review.json)는 현재 원본 9장을 직접
확인했다. 이전 59장 검토는 별도 VSIX이며 src 81개/기능 media 20개가 동일하다는
[lineage](../evidence/g6/run-TEmIQj/visual-review/runtime-lineage.json)와 범위를 구분한다.
사용자 디자인 승인을 대신하지 않는다.

## E. 실제 workspace

현재 `$HOME/aisa-lab/DynDNN/AQuA`, branch `main`,
HEAD `9c8a6f5c4ab2ca3040028eae894d55f893eea299`. 14개 `hw/bsv/src` source fingerprint:
`97ddbd5b3d40f050d23ede4c4f1723174820aa98f3f664f00a7a2f5aa3dd2c46`.
두 실제 독립 root `mkAquaLoopMatmul`, `mkAquaMemorySubsystem`을 chip top 하나로 합치지 않았다.

전체 14-file source 등록/Memory 개요와 내부 장면의 한계를 조사했다. 일반 interface
projection에서 다른 sibling path의 method가 섞이던 문제는 정확한 owner/interfacePath로
제한했다. Memory 개요 27개 연결은 보존했다. `load` 등 내부 장면과 LoopMatmul 전체
장면에는 기존 라우팅/외부 endpoint 한계가 남아 있으며 전체 workspace UI 성공으로 확대하지 않는다.

[지원된 source scope](../evidence/g6/run-TEmIQj/native-source/actual-workspace.json):
위 14개와 **원래 있던 `tb/MemorySynthTop.bsv`**를 명시한 source-only 입력.
실제 scratchpad/accumulator/initialized를 확인했다. `initialized` writer `initialize`의
실제 document URI·revision·UTF-16 `[326,551)`, zero-based `12:4–16:11`, dirty=false,
editor ACK, Back·anchor, editor declaration 역탐색 **PASS**. 긴 guard는 editor 가로
스크롤이 필요하며 일부 PNG에 전체 줄이 보인다고 주장하지 않는다.

[지원된 artifact scope](../evidence/g6/run-TEmIQj/native-artifact/actual-workspace.json):
동일 실제 Memory compile의 `mkMemorySynthTop/scratchpad_laneMemories_0`.
선택 D_IN의 `[1,0,1]` index/bit 순서와 occurrence scope, memory boundary **PASS**.
BSV owner는 Not attached이며 metadata/origin join을 만들지 않았다. Source-only 분석과
unmapped RTL 분석은 서로 다른 명시적 등록/화면이다.

Stock live compiler는 별도 lane에서 기존 SchedulerSynthTop(arrayDim16)와
MemorySynthTop(scratchpad8×4×8, accumulator2×8×32)을 새 output에 컴파일했다.
[Memory](../evidence/g6/run-TEmIQj/live-memory/live-compiler.json),
[Scheduler](../evidence/g6/run-TEmIQj/live-scheduler/live-compiler.json) 모두 실제 BSC/reader/import
PASS, 원본 658개 파일/Git 상태 동일. 새 wrapper나 원본 BSV 변경 없음.
Stock BSC 2026.01, YoWASP Yosys 0.68의 정확한 hash/argv/환경/exit/stdout/stderr를 보존한다.
현재 확장 runtime은 compiler 없이 기존 artifact를 가져온다.

Scheduler 전체 RTL scene 47.8 MB/537 routes는 제한 초과. Memory 전체 RTL은
5,321,217 bytes지만 dimension 8592가 8192를 넘는다. 작은 retained module은
853,690 bytes/12 cells/34 connections로 검사했다. 상위로 이동 실패 후 마지막 valid
query/scene/history/Host owner가 유지됨을 실제 설치본에서 확인했다.

## F. 안전성·환경·자원

[S01–S14](../evidence/g6/run-TEmIQj/native-s/native-security.json) **PASS**:
실제 Restricted Mode, root/URI/symlink, foreign panel/session/snapshot/entity, dirty/stale source,
hostile/oversized input, 취소, dispose, multi-panel, 재등록, protocol/build mismatch,
마지막 valid 상태 보존. Trust와 파일 authority는 별도다. Source/evidence는 text로 표시하며
native transport에 compiler/task/임의 command 실행 action이 없다.

[S/M/L](../evidence/g6/run-TEmIQj/native-scale/native-scale.json): S-A/B/C/L **PASS**,
M은 고정된 complete-cone 기대에 **FAIL**. 기존 4 MiB result 한도에서 `partial`이며
한도를 올리거나 결과를 삭제하지 않았다. 모든 case의 설치 실행/제한된 표시와 나머지
시간·메모리·정리 검사는 PASS. 이 aggregate FAIL을 overall PASS로 바꾸지 않는다.

L은 58,216개 내부 객체의 명시적 synthetic hierarchy다. 전체 객체를 동시에 렌더링하거나
compiler evidence라고 부르지 않는다. Webview 메모리는 별도 CDP isolate를 얻지 못해
`performance.memory` proxy이며, 관찰 객체를 포함할 수 있다. RAF 간격은 JS scheduling
측정이고 compositor FPS 인증이 아니다. 실제 수치·느린 sample도
[G6_PERFORMANCE](G6_PERFORMANCE.md)에 기록했다.

지원 검증은 local macOS arm64/Code1.136.1에 한정한다. 선언된 최소 `^1.90.0`은 유지했고
1.90 API 계약을 확인했으나 그 runtime 실행은 NOT RUN. Windows/Linux/remote는 NOT RUN,
현재 native adapter의 remote/virtual/web host는 UNSUPPORTED.
[지원 matrix](G6_SUPPORT_MATRIX.md)를 참조한다.

## G. 검증·전달

| Lane | 실제 결과 |
| --- | --- |
| 전체 `test/*.test.js` | 725 tests: 722 PASS / 0 FAIL / 3 별도 lane SKIP |
| Skip 연결 | browser negatives 별도 실행, actual interface·dense workspace 별도 실행 |
| Preview browser | J01–J20 PASS, native를 대체하지 않음 |
| Independent browser negatives | 3 tests PASS, V01–V07 실제 DOM 변조 검사 |
| G4 routing/F1/F2 | 실제 18 RTL/11 BSV corpus 및 독립 geometry/membership 유지 |
| G5 semantic | 공개 detailed query 75개, 요청/identity/result/source 전부 동일 |
| Installed native | N01–N15, S01–S14, restart, 실제 source/artifact, typography 실행 범위 PASS |
| Scale / visual limit | M complete-cone FAIL; actual artifact 전체 관계 visual PARTIAL |
| 원본 보존 | 148,815개 검사, 승인 밖 변경 0; 이전 run metadata 20,849개 동일 |
| Source/review ZIP fresh replay | 두 독립 추출본 각각 core 422 PASS / 0 FAIL / 3 별도 SKIP, 실제 설치 VSIX/editor 재생 PASS |

[Core receipt](../evidence/g6/run-TEmIQj/core/core.json),
[semantic receipt](../evidence/g6/run-TEmIQj/semantic-75/semantic.json),
[전체 evidence index](../evidence/g6/run-TEmIQj/index.json)에 실행·입력·환경·stdout/stderr·SHA를 연결했다.
Full suite 뒤 검수 도구의 변경은 G6 문서 2개의 정확한 이름 예외, pure oracle의 native 의존성
지연 로드, macOS 실제 경로 및 core/native 임시 환경 분리다. Checker 17개, oracle 3개,
isolation/runtime 17개 targeted 검사를 통과했고 실제 새 복사본 native 재생도 확인했다.
제품 VSIX runtime은 바뀌지 않았다.

75개 canonical semantic capture는 원본과 동일한 11,184,307 bytes,
SHA `7728623c829d74c7671cdb40133c617c96668557a3b4b472e10abc20d26e18f6`.
Expected는 과거 원본 capture에서 만든 [baseline](G6_SEMANTIC_BASELINE.json)이며
새 결과를 expected로 사용하지 않았다. 시간/메모리/request generation과 의미 결과를 구분한다.

검수 evidence는 원본 PNG·142개 native trace·각 측정 JSON·native ACK·source range를 포함한다.
중복 full state 46개는 원본을 보존하고 정확한 hash/제외 사유를 명시했다. 모든 새 gate의
필수 native trace/capture는 inline이다. 과거 QA companion과 author companion 14개는
별도 계약이며 author 입력이 없으면 명시적 expected-fail을 유지한다. Core/shipped replay는
과거 QA ZIP이나 compiler 설치를 요구하지 않는다.

전달 파일은 기존 ZIP과 다른 G6 이름을 사용한다. Per-member64 MiB, aggregate768 MiB,
기존 G4 collector512 MiB를 높이지 않았다. `.omx`, `.codegraph`, profile/tool cache는 제외한다.
Source/review ZIP의 hash는 archive 밖에 기록한다. 두 빈 추출본의 core/query/input 보존과
동일 VSIX의 새 격리 설치/native editor 재생을 각각 통과했다. 실제 staged 검수는
`g6-review-package-VBJsX6`의 독립 review/source 추출본에서 수행했다. 최종 report를 포함한
전달 archive도 같은 gate를 다시 거치며 결과와 hash는 archive 밖에 기록한다.

- [Review ZIP](../../../dist/bsv-lens-hardware-g6-review.zip) · [SHA](../../../dist/bsv-lens-hardware-g6-review.zip.sha256) · [Validation](../../../dist/bsv-lens-hardware-g6-review.zip.validation.json)
- [Source ZIP](../../../dist/bsv-lens-hardware-g6-source.zip) · [SHA](../../../dist/bsv-lens-hardware-g6-source.zip.sha256) · [Validation](../../../dist/bsv-lens-hardware-g6-source.zip.validation.json)

각 추출본에서 실제 G5 query 12개와 detailed query 75개, source/artifact 선택 입력,
원본 inventory 전체 불변, source/editor 왕복, trace CRC를 확인했다. Author companion
미제공 14개는 계속 명시적으로 실패하며 core/shipped 성공과 별도로 기록한다.

설치·사용·격리 정리는 [G6_USER_INSTALL](G6_USER_INSTALL.md).
기존 기본 화면은 기존 command로 계속 사용할 수 있다.

## H. 종료 상태

| 항목 | 상태 |
| --- | --- |
| G6-0 | COMPLETE |
| G6-A Native host integration | COMPLETE |
| G6-B Installed VSIX | COMPLETE, 명시한 실행 범위 |
| G6-C Actual workspace | COMPLETE, 기존 MemorySynthTop의 작은 지원 범위; 전체 설계 아님 |
| G6-D Safety/scale/platform | PARTIAL, M complete-cone·artifact visual·OS resize·환경 제한 명시 |
| G6-E Final delivery | COMPLETE; 최종 bytes는 외부 validation receipt로 재확인 |
| Live compiler lane | PASS, 기존 두 wrapper 범위 |
| Remote | NOT RUN / 현재 adapter UNSUPPORTED |
| Virtual/web host | UNSUPPORTED |
| User visual/design acceptance | PENDING |
| G7 | NOT STARTED |
| Production default replacement | NOT PERFORMED |
| Commit/push/merge | NOT PERFORMED |
| Version/tag/Release/Marketplace | NOT PERFORMED |
