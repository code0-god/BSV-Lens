# G5 Readability / Fit Follow-up

2026-09-09. 수정 후보의 제목 가독성 결함은 **FIXED**. 420px 재현 제목 4.133333에서 12.000099 CSS px, 기존 J11 제목 5.480000에서 12.000238 CSS px. 실제 브라우저 J01–J20과 독립 측정 통과. 사용자 visual/design acceptance는 **PENDING**.

## A. Baseline

| 항목 | 확인값 |
| --- | --- |
| Branch | `feat/hardware-schematic` |
| HEAD | `c6b9a5c642d105ad4117535c1d85366f1c02ec1c` |
| 로컬 origin/main | `c6b9a5c642d105ad4117535c1d85366f1c02ec1c` (fetch 없이 로컬 ref 확인) |
| package.json / package-lock.json version | `0.4.1` / `0.4.1` |
| 수정 전 feature content, 298 runtime files | `e6d7404f107482d3ac45fe39797379a92ea40958b72a90236fa5390461767c6d` |
| 최종 feature content, 317 runtime files | `bb3967506aa5579028f019432a2c9d9dcfe9c4116e35245211dd589f5bd27f55` |
| 수정 전 8,338-file inventory | `a860848af788f10898c971cf09ced33a7f666938dc6f414a41f6ee14c34b765a` |

Git HEAD가 현재 feature 전체를 나타내지 않는다. 시작 시 staged 없음, `.gitignore`와 `scripts/check.js`는 기존 unstaged 수정, G2–G5 runtime·tests·docs·dist는 다수 untracked 상태였다. 두 기존 tracked 수정은 이번 작업에서 바꾸지 않았다. 전체 status/staged/unstaged/untracked, 파일 크기와 SHA는 [baseline.json](../evidence/g5-readability/run-0vHU05/baseline.json)에 보존했다. 최종 content fingerprint는 상대 경로·크기·SHA를 정렬한 [runtime.json](../evidence/g5-readability/run-0vHU05/runtime.json)에 결합한다.

기존 파일 수정은 7개다. [preservation receipt](../evidence/g5-readability/run-0vHU05/checks/preservation/preservation.json)가 8,338개 중 8,331개 동일, 허용한 7개 변경, 비허용 변경 0개를 확인한다.

| 파일 | 변경과 단순화 |
| --- | --- |
| `media/hardware-view.js` | 기존 renderer에 표시 라벨 정책, 실제 font metrics cache, Fit selection, context·panel 연결. 분석마다 자동 Fit하지 않음. |
| `media/hardware-navigation.js` | 기존 disclosure에 명시적 presentation intent 저장. query/source cancellation과 분리, resize/Back anchor 복원. |
| `media/hardware.css` | 기존 Inspector 구조 재사용, canvas 실제 크기 분리, 설명 문구를 SVG 아래 정상 흐름으로 배치. |
| `experiments/hardware/g4/index.html` / `server.js` | 기존 실험 host에 최소 control과 라벨 module 연결. |
| `experiments/hardware/g4/package.js` | 단계별 evidence wrapper가 자기 evidence를 포함하도록 중복 수집 방지. |
| `experiments/hardware/g5/validate-review.cjs` | 기존 validator에 member/replay hook만 추가. 기본 G5 검증 동작 유지. |

새 runtime은 `media/hardware-readability.js` 하나다. 새 검증 도구는 `experiments/hardware/g5-readability/`, 네 regression 파일은 `test/hardware-readability-{policy,navigation,oracle,delivery}.test.js`. 문서·측정·원본 이미지는 `docs/hardware/g5-readability/`와 이 보고서의 evidence index에 있다. 새 framework·dependency·renderer·query engine은 추가하지 않았다. `src/hardware`, 기존 layout/router, 원본 BSV fixture와 compiler artifact는 변경하지 않았다.

기존 G5 report/source/compiler/query evidence와 ZIP을 보존했다. 기존 review SHA는 `8a9ebbacefdac7a523bad036af37fa374ea1bb574495974ac8a12e1e2e897282`, source SHA는 `3504decafff6ad0c600b2a8c2d0c2651edee3f84a33c408e522d85663b23c686`. 새 실행은 `.build/hardware/runs/<unique>/g5-readability/`에만 생성했다. 최종 전달 evidence는 원본 실행 파일의 hash를 확인한 새 indexed copy다.

자료 확인: G5_REPORT, G5_ANALYSIS_UX, G5_VALIDATION_MATRIX, 현재 G4 DESIGN 및 G4/G5 receipt/trace, 실제 renderer/layout/navigation/CSS와 packaging 계약을 읽었다. 요청된 `G4_FIX_BSV_INDEPENDENT_REVIEW.md`는 workspace·Downloads·Desktop·Documents와 dist ZIP 21개 member 목록에서 발견하지 못했다. 확인 가능한 `g4-fix/GATE_INITIAL.md`, `GATE_RECHECK.md`와 실제 F1/F2 코드·evidence를 대신 교차 확인했다. 없는 문서를 읽었다고 주장하지 않는다.

## B. 재현한 결함

현재 G4 DESIGN의 문구는 “Overview keeps hardware titles at a minimum rendered 9px and hides secondary”로 시작한다. 적용 대상은 축소된 overview hardware title이다. 선언된 font-size 또는 이전 baseline 픽셀 일치가 판정 기준이 아니다. 원래 9px 하한은 유지했다. 상세 선택·주요 라벨의 12 CSS px는 이번 설계 목표다.

**R0-A: 420은 브라우저 viewport 너비다.** 원래 테스트의 세 너비 순서와 pointer 행동을 재실행했다. 새 Chrome context, 420×900 CSS px, DPR 1, CSS zoom 1, visualViewport scale 1, browser zoom 조작 없음. 이전 실제 SVG/canvas는 420×390.0625, Inspector는 아래쪽 420×200.9375였다. 고정 300px 옆 panel 때문에 120px canvas가 됐다는 추측은 틀리다.

A / stock / BSV `mkConnected.left`, `state` 선택, `state-accesses`, 전체 Fit scale `0.34444444444444444`. `left`와 `state` 모두 선언 12px지만 최종 font는 **4.133333086967468 CSS px**, character-cell 높이는 약 **5px**였다. 1줄이고 clip fraction 1이라 잘려서 작아진 현상도 아니다. 원래 측정의 collision/interference는 0/0; 크기 계약 실패다. 당시 원문 drawer는 보존됐으나 Inspector 스크롤 밖에 있었다.

Canonical owner: `instance:instance:def:Connected:mkConnected:mkConnected:mkConnected.left`. 선택 ID: `instance:instance:instance:def:Connected:mkConnected:mkConnected:mkConnected.left:mkConnected.left.state`. snapshot `hw-9725d9de09383250ccd7e98ff46883b4dcdb6e9eaabf53dce47f12dd791a5f34`, scene `scene-133ea683872e01703a90335a9c28237404956c3295061661124bd9161a828d50`. query/result/source revision와 전체 제목 목록은 [420 before 측정](../evidence/g5-readability/run-0vHU05/browser/before/A-left-420-high-contrast.measurement.json)에 있다.

**R0-B: 기존 J11은 A의 instrumented RTL root다.** stock RTL에서 get 선택·same-net 후 drivers-loads HTTP 응답을 보류하고 provider를 instrumented로 전환, 보류 응답을 해제했다. 최종 선택·분석은 null, occurrence는 실제 `mkConnected` root다. B dense 화면과 혼동하지 않았다.

1440×900, DPR 1, canvas 1140×745, Inspector 300×745, drawer 없음, scale `0.45666666666666667`. `mkConnected`, `$add`, `left`, `right`의 font는 **5.480000138282776 CSS px**, character-cell 높이는 약 **6px**였다. 보고서의 약 6px와 glyph 높이는 일치하지만 이번 유효 font 측정은 5.48이다. 모두 1줄, clip fraction 1, 원래 collision/interference 0/0. root canonical ID는 `hw-c13713c0b0e3d2bdaa9af2bd8682afa1b64d9a8deb62d802d19182f0df8d97b0/occurrence/%5B%22mkConnected%22%5D`. 해당 snapshot, child occurrence와 `$add` cell의 전체 ID는 [기존 J11 before 측정](../evidence/g5-readability/run-0vHU05/browser/before/J11-exact-instrumented-root.measurement.json)에 보존했다.

**R0-C:** A overall/left, B BSV/dense RTL, C narrow/wide source·RTL 등 원본 14개 before capture를 확보했다. before typography/character bounds는 실측이다. R0 당시 visibility diagnostics는 초기 측정기 범위이며 최종 oracle 전체 PASS로 재해석하지 않았다. 작은 글자의 DOM 존재는 식별성 PASS가 아니다.

## C. 변경한 표시 계약

[표시 계약 DESIGN.md](DESIGN.md), [독립 측정 정의 MEASUREMENT.md](MEASUREMENT.md).

| 책임 | 현재 경로와 보장 |
| --- | --- |
| source/hardware identity | 기존 snapshot/occurrence/net/source 모델 유지 |
| analysis query | 기존 공개 G5 API와 scope/result 유지 |
| scene projection | 기존 canonical Scene에 객체·연결 선택 |
| geometry | 기존 layout이 node/contact/route 배치 확정 |
| viewport | 실제 SVG 영역으로 Fit structure 또는 Fit selection 계산 |
| display detail | scene/geometry/selection/font/viewport 입력으로 표시 문자열·위치·크기·접힘 사유 계산 |
| renderer | 기존 SVG transform에 anchor된 text, 배경 없는 라벨, 실제 screen-size 보정 |
| history | hierarchy/analysis visit과 명시적 disclosure만 저장. 파생 label level은 visit key 제외 |
| hit testing | 기존 canonical semantic group/contact/net target 유지 |
| export | 전체 scene intrinsic scale 1의 별도 label projection과 canonical metadata |

- **전체 구조 맞춤 / `Fit structure`:** 현재 node·route·경계 전체를 표시한다. 최소 zoom 강제로 topology를 자르지 않는다. 주요 이름과 진입점은 남기고 반복 pin/type/wire 설명은 접는다.
- **선택 대상 맞춤 / `Fit selection`:** 선택 객체와 직접 관련된 분석 범위를 읽을 수 있게 맞춘다. 큰 범위는 seed와 local relations를 우선하고 화면 밖 continuation을 명시한다. 전체 회로가 보인다고 약속하지 않는다. 선택 없는 경우 비활성화한다.
- **필수 맥락:** owner, 실제 RTL occurrence, BSV/RTL, provider, 선택, 분석 boundary/status를 기존 header/Inspector와 읽을 수 있는 context 줄에서 유지한다. 선택 없는 상태는 `Current module`로 명시한다.
- **우선순위:** 선택·현재 맥락, child module, storage, 관련 boundary contact, 부가 alias/type/provenance 순. A/B/C 이름이나 좌표별 예외 없음. A overall의 root·left/right와 left 내부 state·put/get 유지.
- **긴 이름:** 실제 font metrics와 사용 너비, grapheme 경계, 구분되는 suffix를 사용한다. 반복 definition보다 instance 이름을 우선한다. 전체 문자열은 accessible name/title와 Inspector에 남는다. 모든 이름을 동일한 `...`로 바꾸지 않는다.
- **충돌:** 기존 owner 공간과 제한된 후보 위치만 사용한다. wire·port·이웃 node·label을 가리는 부가 text는 접는다. 라벨 배경 없음, canonical wire 삭제/병합 없음. 명시적 선택과 keyboard로 전체 이름·상세에 접근한다.
- **안정성:** 낮은 배율 detail은 hysteresis, deterministic priority로 파생한다. 실제 font/text cache 재사용, font/theme 변화 시 갱신. query·layout 전체를 매 frame 재분석하지 않는다. selection/hover로 회로 geometry가 흔들리지 않는다.
- **Inspector/drawer:** 기존 compact 아래쪽 Inspector와 toggle 재사용. 닫았다 다시 열어도 분석·source·disclosure/scroll 보존. panel/resize는 선택 anchor를 유지하며 full Fit 또는 query scope 변경을 만들지 않는다. 원문은 스크롤해 읽을 수 있고 지연 응답도 유지된다.
- **실제 canvas:** 설명·상태를 SVG 위 overlay에서 아래 정상 흐름 caption으로 분리했다. 보통 46px, canvas 너비 640px 이하 76px을 확보한다. `canvasContainer`에는 caption이 포함되지만 Fit·clip·anchor의 `canvas`는 drawable SVG다. 이 차이를 측정에 그대로 기록했다.

## D. Before / After

단위 CSS px. 아래 각 쌍은 before / after. 최소 font는 **실제로 표시된 텍스트만** 대상으로 하며 title minimum과 별도다. 모든 행 Inspector open. occurrence 표기의 slash는 실제 RTL path이며 상세 BSV owner는 [42개 전체 측정표](MEASUREMENTS.md)에 있다. 수치는 보기 위해 6자리로 반올림했다. 판정은 원래 JSON 값과 1e-6 산술 허용치 사용; 8.99·8.995px는 실패한다.

| 원본 화면 / 수정 화면 | Browser viewport | Drawable canvas before / after | Build / scene / provider / path | Scale before / after | Min visible font before / after | Min title before / after | Selected title before / after | Source drawer before / after |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [A-left-420-high-contrast](../evidence/g5-readability/run-0vHU05/browser/before/A-left-420-high-contrast.png) / [after](../evidence/g5-readability/run-0vHU05/browser/after/J01-left-420-high-contrast.png) | 420×900 | 420×390.063 / 420×258.625 | A/bsv/stock/mkConnected/left | 0.344444 / 0.344444 | 3.788889 / 9.000333 | 4.133333 / 12.000099 | 4.133 canvas / 12 canvas | retained/offscreen / retained/offscreen |
| [J11-exact-instrumented-root](../evidence/g5-readability/run-0vHU05/browser/before/J11-exact-instrumented-root.png) / [after](../evidence/g5-readability/run-0vHU05/browser/after/J02-original-J11.png) | 1440×900 | 1140×745 / 1140×677 | A/rtl/instrumented/mkConnected | 0.456667 / 0.411333 | 5.023333 / 10.000000 | 5.480000 / 12.000238 | none / none | absent / absent |
| [A-overall-desktop](../evidence/g5-readability/run-0vHU05/browser/before/A-overall-desktop.png) / [after](../evidence/g5-readability/run-0vHU05/browser/after/J03-overall-1440.png) | 1440×900 | 1140×745 / 1140×687 | A/bsv/stock/mkConnected | 0.798246 / 0.798246 | 7.982455 / 9.000219 | 9.578947 / 12.000025 | none / none | absent / absent |
| [A-left-1440-dark](../evidence/g5-readability/run-0vHU05/browser/before/A-left-1440-dark.png) / [after](../evidence/g5-readability/run-0vHU05/browser/after/J01-left-1440-dark.png) | 1440×900 | 1140×745 / 1140×687 | A/bsv/stock/mkConnected/left | 1.011111 / 1.011111 | 10.000000 / 10.000000 | 12.133334 / 12.000878 | 12.133 canvas / 12.001 canvas | retained/offscreen / source visible |
| [A-left-960-light](../evidence/g5-readability/run-0vHU05/browser/before/A-left-960-light.png) / [after](../evidence/g5-readability/run-0vHU05/browser/after/J01-left-960-light.png) | 960×900 | 660×745 / 660×651 | A/bsv/stock/mkConnected/left | 0.566667 / 0.566667 | 5.666667 / 9.000367 | 6.800000 / 12.000300 | 6.8 canvas / 12 canvas | retained/offscreen / source visible |
| [B-source-desktop](../evidence/g5-readability/run-0vHU05/browser/before/B-source-desktop.png) / [after](../evidence/g5-readability/run-0vHU05/browser/after/J05-B-source.png) | 1440×900 | 1140×745 / 1140×687 | B/bsv/stock/mkControl | 0.733871 / 0.733871 | 7.338710 / 9.000194 | 8.806452 / 12.000258 | 8.806 canvas / 12 canvas | retained/offscreen / source visible |
| [B-dense-rtl-desktop](../evidence/g5-readability/run-0vHU05/browser/before/B-dense-rtl-desktop.png) / [after](../evidence/g5-readability/run-0vHU05/browser/after/J05-B-overview.png) | 1440×900 | 1140×745 / 1140×677 | B/rtl/stock/mkControl | 0.261850 / 0.235856 | 2.880352 / 10.000000 | 3.142202 / 12.000131 | 3.142 canvas / 12 canvas | absent / absent |
| [C-narrow-source-desktop](../evidence/g5-readability/run-0vHU05/browser/before/C-narrow-source-desktop.png) / [after](../evidence/g5-readability/run-0vHU05/browser/after/J06-narrow-source.png) | 1440×900 | 1140×745 / 1140×687 | C/bsv/stock/mkReuse/narrow | 1.011111 / 1.011111 | 10.000000 / 10.000000 | 12.133334 / 12.000878 | 12.133 canvas / 12.001 canvas | retained/offscreen / source visible |
| [C-narrow-rtl-desktop](../evidence/g5-readability/run-0vHU05/browser/before/C-narrow-rtl-desktop.png) / [after](../evidence/g5-readability/run-0vHU05/browser/after/J06-narrow-rtl.png) | 1440×900 | 1140×745 / 1140×677 | C/rtl/instrumented/mkReuse/narrow | 0.588488 / 0.538660 | 5.884879 / 9.000467 | 7.061855 / 12.000263 | 6.473 canvas / 12 canvas | absent / absent |
| [C-wide-source-desktop](../evidence/g5-readability/run-0vHU05/browser/before/C-wide-source-desktop.png) / [after](../evidence/g5-readability/run-0vHU05/browser/after/J06-wide-source.png) | 1440×900 | 1140×745 / 1140×687 | C/bsv/stock/mkReuse/wide | 1.011111 / 1.011111 | 10.000000 / 10.000000 | 12.133334 / 12.000878 | 12.133 canvas / 12.001 canvas | retained/offscreen / source visible |
| [C-wide-rtl-desktop](../evidence/g5-readability/run-0vHU05/browser/before/C-wide-rtl-desktop.png) / [after](../evidence/g5-readability/run-0vHU05/browser/after/J06-wide-rtl.png) | 1440×900 | 1140×745 / 1140×677 | C/rtl/instrumented/mkReuse/wide | 0.588488 / 0.538660 | 5.884879 / 9.000467 | 7.061855 / 12.000263 | 6.473 canvas / 12 canvas | absent / absent |

전체 after 42개 settled capture의 displayed font 하한은 **9.000000134 CSS px**, title 하한은 **12 CSS px**. 모든 mandatory set PASS, clip/label collision/node-wire-contact interference findings 0. 전체 Fit 상태는 모든 실제 node·route bounds 포함, selection/manual 상태는 전체 Fit으로 판정하지 않는다. 접힌 라벨은 최소 font 계산에서 제외하고 별도 reason/count와 mandatory 누락 검사로 검증했다.

대표 접힘: 420 left에서 부가 detail 3개·wire name 2개; 기존 J11에서 반복 name 1개·pin detail 48개·부가 detail 3개·wire name 11개. B dense overview는 detail 37개·중복 1개·충돌 회피 6개·이름 공간 부족 2개·pin detail 150개·wire name 44개를 접는다. B selection에는 화면 밖 167개와 중복 27개·wire name 44개가 따로 기록된다. 이를 query 삭제나 topology 삭제로 취급하지 않는다. 실제 노출된 이름/전체 이름/canonical owner와 이유는 각 measurement 및 state JSON에 있다.

420 after: canvas 420×258.625, outer canvas 420×334.625, 아래 Inspector 420×172.375. 같은 scale 0.344444에서 `left`/`state` 선언 font 34.839 scene px를 최종 12.000099 CSS px로 보정한다. character-cell 높이는 약 14px, 1줄, clip fraction 1. font와 glyph bounds를 섞지 않는다. source가 처음 스크롤 밖인 J01과 스크롤 후 읽는 `J01-source-420`은 별도 캡처다.

B selection에서 pin glyph bottom 823.10, SVG bottom 830, caption glyph top 839: 실제 글자 간격 15.90 CSS px. 제목 확대 때문에 wire/port 클릭을 막는 caption 겹침도 수정했다. 실제 pointer 결과는 J09/J15, exact geometry는 F1/F2로 교차 확인했다.

원본 비교: [420 before](../evidence/g5-readability/run-0vHU05/browser/before/A-left-420-high-contrast.png), [420 after](../evidence/g5-readability/run-0vHU05/browser/after/J01-left-420-high-contrast.png), [기존 J11 before](../evidence/g5-readability/run-0vHU05/browser/before/J11-exact-instrumented-root.png), [J11 after](../evidence/g5-readability/run-0vHU05/browser/after/J02-original-J11.png), [A overview](../evidence/g5-readability/run-0vHU05/browser/after/J03-overall-1440.png), [B selection](../evidence/g5-readability/run-0vHU05/browser/after/J05-B-selection.png), [C narrow](../evidence/g5-readability/run-0vHU05/browser/after/J06-narrow-rtl.png), [C wide](../evidence/g5-readability/run-0vHU05/browser/after/J06-wide-rtl.png). 전부 원본 browser PNG이며 확대·편집본 아님.

## E. 동작 회귀

[실제 browser receipt](../evidence/g5-readability/run-0vHU05/browser/after/receipt.json)는 아래 20개를 PASS로 기록한다. 각 pointer/keyboard 동작 후 fonts/layout/navigation/animation 완료 조건을 기다렸다. source 지연은 실제 HTTP 응답 barrier로 만들었다. renderer/driver 시작·종료 hashes 일치, pageErrors 0.

| Journey | 확인한 동작 |
| --- | --- |
| J01 | 원래 1440/960/420 순서, A left state-accesses/Fit, 420 source 스크롤 |
| J02 | 기존 J11 정확한 A instrumented root/provider 전환·stale response 무효화 |
| J03 | A 전체 root·left/right, 1440×900·1920×1080·360×800의 실제 전체 Fit |
| J04 | left 단일 클릭, state·put/get, 시작·실제 animation 중간·완료 anchor |
| J05 | B source 및 dense RTL overview/selection fit, 선택 $add와 핵심 관계 |
| J06 | C narrow/wide, 실제 occurrence와 8/12bit, source와 instrumented RTL 구분 |
| J07 | threshold 주변 wheel zoom 18회, 안정된 detail level, history 증가 없음 |
| J08 | 동일 Fit/선택 Fit 반복, viewport/presentation 재현, visit 증가 없음 |
| J09 | port·wire·module body·title 각각 pointer target, keyboard entry |
| J10 | dependency detail 후 전체 구조 복귀, result ID와 design scope 유지 |
| J11 | Inspector 닫기/열기, source scroll/resize, selected anchor·분석 보존 |
| J12 | 지연 source 중 panel/disclosure 변경, pending 후 같은 reference complete |
| J13 | BSV left state/code·RTL·선택 Fit·Back/Forward, 이전 semantic/selection/viewport 복원; resize Back은 anchor 적응 |
| J14 | 실제 RTL root·left/right·Up/Back, sibling occurrence 분리와 방문 dedup |
| J15 | 기존 충돌 net 두 개를 별도 선택, bit 2/12 구분, F2 및 V08 geometry/membership 변조 검출 |
| J16 | dark/light/high-contrast; 420×900·420×1100·960×1000·1440×900·1920×1080 |
| J17 | reduced-motion와 일반 motion의 최종 semantic/display 동일 |
| J18 | 별도 display-only fixture: 긴 영문·CJK/혼합·구분 suffix, 한 글자 orphan/동일 축약 없음 |
| J19 | DPR 1/2에서 같은 CSS px 기준 적용 |
| J20 | 실제 SVG export intrinsic 1080×528, scale 1, 전체 topology·canonical metadata·scope 비교 |

기존 320ms 계층 animation을 새로 구현하지 않았다. `J04-mid.png`는 실제 전환 중 프레임이며 settled font PASS 표본이 아니다. 시작/중간/완료 anchor와 motion 기록을 함께 시각 검토했다. J18은 compiler evidence가 아닌 표시 fixture다. J20은 제품에서 내보낸 실제 SVG다. 외부 뷰어가 SVG를 축소한 크기까지 12px를 보장하지 않는다.

G5 semantic 비교는 두 가지다. 첫째, UI 수정 전에 실행한 공개 CLI/HTTP 12개와 correspondence/origin 9개를 최종 runtime으로 다시 실행해 동일성을 확인했다. 둘째, 원래 G5 source ZIP의 새 추출본과 현재 코드에서 **75개 공개 query**를 실행했다. 둘째 before는 과거 실행이라고 위장하지 않고 **원래 코드 추출 후 현재 시점 재실행**이라고 기록했다.

75개는 behavior 21, source-dependencies 21, call-site 8, correspondence 19, slice same-net 3, occurrence dependency 3. 결과 11,184,307 bytes 전체 비교 SHA `7728623c829d74c7671cdb40133c617c96668557a3b4b472e10abc20d26e18f6`. query metrics/request generation만 의미 결과에서 분리했다. G3 별도 측정의 attachAndQueryMs도 실행별 값으로 분리했다.

같은 snapshot/provider/source revision/seed/scope에서 ordered positions, repeated bits/slices, driver/load/boundary, dependency edges/frontiers/stop reason, state readers/writers, predicate/body conditions, actual/formal/source ranges, stock correspondence, known instrumented contributor와 complete-origin-set 미확인 상태가 동일하다. 178개 관련 source/canonical/compiler 입력 hash도 동일하다. 14 actual/formal mapping, predicate 3개, stock claim 66개, known contributor 8개는 늘어나지 않았다. 실제 A/B/C의 signed else body condition은 비어 있으며 이를 비교했다; 별도 synthetic signed-condition test와 구분한다. generic implementation join/source specialization/formal-token range의 기존 미해결 상태도 그대로다.

## F. 검증과 전달

| 검증 | 실제 결과 / 근거 |
| --- | --- |
| 최종 전체 core suite | 605 tests, **604 pass / 0 fail / 1 skip / 0 cancelled**, load failure 0. skip은 별도 browser-negative lane. [core receipt](../evidence/g5-readability/run-0vHU05/checks/core/core.json), [TAP stdout](../evidence/g5-readability/run-0vHU05/checks/core/suite/stdout.log) |
| 독립 negative lane | 3 pass / 0 fail / 0 skip. V01–V07 실제 synthetic browser, V09/V10 navigation/identity. V08은 실제 J15 geometry·canonical 변조. [negative receipt](../evidence/g5-readability/run-0vHU05/checks/negative-tests/receipt.json) |
| F1/F2 targeted regression | 28 pass, 0 fail. [receipt](../evidence/g5-readability/run-0vHU05/checks/f1-f2/receipt.json) |
| Geometry | 58 cases, 18 RTL + 11 BSV scenes의 fresh 독립 검사 PASS. 결과 36,993,279 bytes가 기존 inline geometry artifact와 byte-identical. [실행 receipt](../evidence/g5-readability/run-0vHU05/checks/geometry/receipt.json), [중복 제거 근거](../evidence/g5-readability/run-0vHU05/checks/geometry/shared-artifact.json) |
| G5 의미 불변 | 12 CLI/HTTP + 9 correspondence/origin, 추가 75 공개 query 비교 PASS. [비교 receipt](../evidence/g5-readability/run-0vHU05/checks/semantic/semantic.json), [75-query receipt](../evidence/g5-readability/run-0vHU05/checks/semantic-details/semantic-details.json) |
| 실제 browser | J01–J20 PASS, 42 settled after + 1 motion frame, before 14개, trace 4개. 페이지 오류 0. [index](../evidence/g5-readability/run-0vHU05/index.json) |
| 정적 검사 | 기존 repository static checker와 변경 JS/CJS Node syntax 검사 exit 0. [receipt](../evidence/g5-readability/run-0vHU05/checks/static/receipt.json). 별도 Biome 설치/실행 없음; 저장소의 기존 검증 도구 사용. |
| 시각 검토 | 독립 AI reviewer 2개가 원본 57개 이미지 각각 열어 검토, PASS/HIGH, blocker 0. footer 아래 배치·이름 식별·source·CJK·export 확인. [reviews.json](../evidence/g5-readability/run-0vHU05/reviews.json) |
| 입력 보존 | 기존 8,338개 검사, 7개 허용 수정 외 동일. compiler/source/evidence/이전 ZIP 변경 없음. |

V01 parent-scale 4px, V02 필수 이름 전부 숨김, V03 큰 padding 속 작은 glyph, V04 label/wire/port/node 겹침, V05 clip/offscreen, V06 모호한 축약, V07 cropped fake Fit가 실패하도록 검사했다. V08 서로 다른 net/route 변조, V09 zoom history 추가, V10 snapshot/result 불일치도 실패한다. runtime의 `readable`, `minFontSize`, `visibleLabels` 자기 보고를 expected로 사용하지 않았다.

최종 evidence refresh는 standalone J18/J20 context 파일과 표준 raw log basename을 보완한 것이다. 최종 UI 9개 파일 hash는 시각 검토 때와 동일, settled PNG 42개도 byte-identical이다. 새 live midpoint를 따로 열어 재검토했고 42개 state reference 존재도 확인했다. [reviews.json](../evidence/g5-readability/run-0vHU05/reviews.json)에 이전 전체 코드 identity와 새 evidence lineage를 분리 기록했다. 최종 전체 code inventory는 A절의 317-file fingerprint다.

실행 환경: macOS darwin/arm64, Node v26.7.0, Playwright 1.62.1, 실제 설치된 Chrome 152.0.7977.83 headless. DPR 1/2, 모든 context의 browser zoom 조작 없음, visualViewport scale 1. 폰트는 제품의 시스템 UI/VS Code fallback이며 per-label `fontFamily`, `fontWeight`, ink metrics와 `fontsStatus=loaded`를 저장했다. 다른 OS/browser/native editor를 검증한 것으로 확대하지 않는다.

최종 browser receipt 성능: 일반 전체 Fit action-to-settled 37.791–56.073ms(3회), resize-to-settled 40.921/63.717ms, 반복 Fit 138.566ms·선택 Fit 116.521ms. 각각 label preparation 0.5/0.8ms, candidate 11개. wheel 18회 action-to-settled 81.218–96.406ms, 실제 RAF 103개 간격은 약 16.6–16.8ms, p95 16.7ms. 자동화 왕복·settle 대기가 포함된 측정이며 물리 compositor/모니터 지연은 아니다. candidate/visible/hidden counts는 표시 진단이며 font PASS 근거를 대신하지 않는다. 기존 실제 trace에서 분리한 storage/cell 선택 11회의 click 시작부터 title·Inspector 갱신을 포함한 font/render settle까지는 45.982–172.396ms(p95 172.396ms)였다. 선택 전 pointer auto-wait와 protocol 시간이 포함된 상한 관찰이며 물리 paint 시간은 아니다. [선택 timing 원자료](../evidence/g5-readability/run-timing-EXUJar/selection-timing.json)는 원본 trace SHA·call ID·시작/종료 timestamp·추출 명령을 별도 indexed run에 기록한다.

### 새 패키지와 격리 재생

문서 동결 전 preflight `g5-readability-package-gqVCvI`에서 review/source **둘 다 PASS**. 서로 다른 빈 추출 root에서 각 309개 command의 expected exit를 확인했다. 각 추출본 core는 **305 tests / 304 pass / 0 fail / 1 skip / 0 cancelled**, 각 browser는 **J01–J20 PASS**, 75-query 전체 stdout SHA도 동일하다. 이 305개는 배포 계약의 명시적 core test 목록이며 author 전체 605개와 구분한다. 전체 original inventory 재비교, post-replay closure, CRC/SHA PASS. 14개 author companion 누락은 두 추출본 모두 expected-fail/exit 1이다.

문서 포함 전 preflight 크기: review 2,330 members / expanded 744,698,638 bytes, source 2,053 members / expanded 713,136,888 bytes, 최대 member 42,805,465 bytes. 최종 보고서를 포함한 ZIP은 새로 구성하고 같은 격리 검증 gate를 다시 통과한 경우에만 최종 이름을 생성한다. 최종 member 수·크기·SHA·검증 결과는 아래 외부 validation receipt를 따른다.

새 파일명은 `bsv-lens-hardware-g5-readability-review.zip`, `bsv-lens-hardware-g5-readability-source.zip`이다. 각각 `.sha256`, `.zip.validation.json`, `.zip.validation.json.sha256`를 archive 바깥에 둔다. 최종 archive 자신의 SHA를 내부 보고서에 넣어 순환 hash를 만들지 않는다. 최종 실행 결과와 hash는 [review validation](../../../dist/bsv-lens-hardware-g5-readability-review.zip.validation.json), [source validation](../../../dist/bsv-lens-hardware-g5-readability-source.zip.validation.json)이 권위 자료다.

64 MiB/member, 768 MiB/aggregate 상한은 그대로다. 과거 G5 resume QA supplement `run-YTGBZS` 70개 파일·130,812,902 bytes만 새 archive에서 생략하고, 보존된 두 기존 G5 ZIP에서 모든 byte를 확인한 [optional historical companion 계약](DELIVERY_COMPANION.json)을 제공한다. 기존 source/compiler/query evidence와 필수 G4 자료는 새 archive 안에 남는다. 새 core/readability replay에 과거 ZIP은 필요 없다. fresh geometry 중복 35MB도 이미 inline인 동일 SHA artifact를 참조한다. 자원 상한을 높여 통과시키지 않았다.

두 ZIP은 각기 빈 경로에 추출한다. 공통 runtime 상대 경로·크기·SHA와 path-sorted inventory, 공개 query, compiler 없는 core, 별도 browser replay, 전체 원본 inventory를 재생 전후 비교한다. 새 replay output은 새 unique run에 격리한다. `.omx`, `.codegraph`, node_modules, 임의 trace·과거 실행 scratch는 포함하지 않는다. 승인된 evidence root와 indexed trace attachment만 허용한다. Source ZIP에는 `.build`가 없다.

14개 외부 author companion이 없으면 author preservation은 **예상된 FAIL**로 남는다. core/shipped 검증과 구분하며 해당 검사를 삭제하거나 silent-pass로 바꾸지 않았다. browser replay만 준비된 Playwright의 absolute module entry를 명시적으로 제공하며 전역 NODE_PATH/toolchain/profile은 변경하지 않는다.

재현 명령(프로젝트 루트, 기존 dependency가 준비된 환경):

```sh
node experiments/hardware/g5-readability/run.cjs browser-replay node experiments/hardware/g5-readability/browser.cjs
node experiments/hardware/g5-readability/run.cjs semantic-replay node experiments/hardware/g5-readability/semantic.cjs docs/hardware/evidence/g5-readability/run-0vHU05/checks/semantic/semantic.json
readability_replay_dir="$(node -e 'process.stdout.write(require("./experiments/hardware/g5-readability/run.cjs").createRun("archive-copies"))')"
cp dist/bsv-lens-hardware-g5-readability-{review,source}.zip{,.sha256} "$readability_replay_dir/"
node experiments/hardware/g5-readability/run.cjs delivery-replay node experiments/hardware/g5-readability/validate-delivery.cjs "$readability_replay_dir/bsv-lens-hardware-g5-readability-review.zip" "$readability_replay_dir/bsv-lens-hardware-g5-readability-source.zip" --playwright-entry /absolute/path/to/node_modules/@playwright/test/index.js
```

두 번째 명령은 새 output에 쓰고 indexed baseline과 비교한다. 첫 번째 author-workspace browser 명령은 이미 설치된 dependency를 사용한다. fresh extraction은 ZIP과 SHA만 새 run에 복사한 뒤 validator가 두 새 임시 root에서 core test와 browser를 분리 실행한다. 기존 `.validation.json`이 있는 최종 dist 원본에는 validator를 직접 재실행하지 않는다; 기존 영수증 덮어쓰기를 의도적으로 거부한다. `core.cjs`는 author snapshot 준비 helper이므로 과거 author archive가 없는 추출본의 진입점으로 사용하지 않는다. validator는 `node --no-global-search-paths --test --test-reporter=tap`에 계약의 명시적 38개 test 경로를 전달하며, 실행별 절대 cwd·정확한 args·환경·exit/stdout/stderr는 외부 receipt에 남는다.

## G. 한계와 종료 상태

| 항목 | 상태 |
| --- | --- |
| Readability defect | **FIXED**: 재현한 420px·기존 J11 및 현재 A/B/C acceptance 범위 |
| Typography/geometry automated checks | **PASS** |
| Actual browser acceptance | **PASS**: Chrome, 위 J01–J20/환경 범위 |
| G5 semantic regression | **PASS** |
| User visual/design acceptance | **PENDING** |
| Native VSIX/editor integration | **NOT RUN** |
| Live compiler | **NOT RUN** |
| G6/G7 | **NOT STARTED** |
| Production default replacement | **NOT PERFORMED** |
| Commit/push/merge | **NOT PERFORMED** |
| Version/tag/Release/Marketplace | **NOT PERFORMED** |

대형 dense 개요는 일부 부가 이름을 접는다. 선택·keyboard·Inspector/선택 Fit으로 상세에 접근하며 전체 topology와 주요 진입 이름은 유지한다. 극단적인 임의 zoom/OS font/native webview 전체를 인증한 것은 아니다. source 긴 범위는 명시적 scroll을 사용한다. exported SVG는 intrinsic 표시 범위를 선언한다. 기존 generic source join·formal-token specialization·complete origin coverage 미확인은 이번 시각 수정에서 해결했다고 주장하지 않는다.

원본 capture와 측정은 실제 제품 surface에서 얻었다. 자동 검사 PASS, AI 시각 검토 PASS, 사용자의 최종 디자인 승인은 서로 다른 상태다. 이번 전달 후 병합·출시·후속 G6/G7 작업으로 진행하지 않는다.
