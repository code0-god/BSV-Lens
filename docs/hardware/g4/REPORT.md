# BSV Lens G4 보고서

G4 구현과 실제 브라우저 acceptance: **COMPLETE**.
독립 gate 및 독립 시각 검수: **BLOCKED**.
User visual/design acceptance: **PENDING**.

이 결과는 기존 production webview 교체나 디자인 승인 선언이 아니다.
BSV 하드웨어 scene, typed inspection, 검증된 correspondence, 명시적 RTL,
정확한 navigation 복원을 별도 실행 가능한 G4 경로로 구현했다.

## A. Baseline — COMPLETE

- Branch: `feat/hardware-schematic`.
- HEAD / `origin/main`: `c6b9a5c642d105ad4117535c1d85366f1c02ec1c`.
- `package.json`: `0.4.1` 유지.
- 시작 시 status, branch, HEAD, origin/main, diff, cached diff, version, tags 확인.
  tracked/staged diff는 비어 있었고, 기존 untracked 자료는 보존 대상으로 취급했다.
- 기존 tag: `v0.3.0`, `v0.3.1`, `v0.3.2`, `v0.4.0`. 새 tag 없음.
- Git HEAD는 G4 변경 내용의 identity가 아니다. G4는 아직 commit하지 않았다.

Feature content identity:

```text
e3ed0eb1eb60bd058287472a545ad1c27aeb6e1c98dbfdf1f993fba665820a07
```

정의는 `../evidence/g4/final/index.json`의 정렬된 runtime/test/package 파일
byte inventory를 JSON으로 직렬화한 SHA256이다. 각 파일 hash도 같은 index에 있다.

기존 파일 중 수정한 것은 `test/hardware-correspondence.test.js` 하나다.
추가한 코드/실행 파일:

- `src/hardware/architecture.js`, `scene.js`, `scene-query.js`, `scene-summary.js`.
- `media/hardware-view.js`, `hardware-navigation.js`, `hardware-layout.js`,
  `hardware-inspector.js`, `hardware.css`.
- `test/hardware-scene.test.js`, `hardware-navigation.test.js`,
  `hardware-layout.test.js`.
- `experiments/hardware/g4/index.html`, `server.js`, `server.test.js`,
  `run-output.js`, `run-output.test.js`, `preserve.py`, `test_preserve.py`,
  `package.js`, `package.test.js`, `validate-delivery.js`, `browser.test.js`,
  `acceptance.js`, `finalize-evidence.js`.
- 새 계약·보고서: `docs/hardware/g4/`.
- 새 검증 자료: `docs/hardware/evidence/g4/`.

기존 G0/G1/G1-BSV/G2/G3 문서, evidence, origin sidecar, review ZIP,
history는 수정하지 않았다. 보존 기준은 추정 Git diff가 아니라
`../evidence/g4/g4-0/baseline.json`의 2,587개 실제 파일 hash다.

## B. G4-0 — COMPLETE

수정 전 두 correspondence 테스트가 `.build/hardware/g3-a/`에 새 측정값과
query/bundle을 썼다. 수정 후 각 실행이 `mkdtemp`로
`.build/hardware/runs/correspondence-*/`를 독점 생성한다.
두 nondeterministic 파일만이 아니라 해당 테스트의 8개 출력 모두 분리했다.

격리 복사본에서 먼저 `history overwritten: cancellation.json` 실패를 확인했다.
실제 과거 evidence 경로에 구형 writer를 실행하지 않았다.

```sh
node --test --test-reporter=tap \
  test/hardware-correspondence.test.js \
  test/hardware-correspondence-independent.test.js \
  experiments/hardware/g4/run-output.test.js
```

연속 두 실행 모두 **43/43 PASS**. 매번 2,587개 기준 파일을 재해시했다.
허용한 테스트 파일 하나만 달라졌고 나머지 **2,586개 동일**.
기존 dist 전달물 32개, source fixtures, G3 sidecar와 review ZIP도 동일하다.

```text
Baseline inventory:
45e59375357386cd6cdac8f65a9517b424b336a23cf588d7b89c37944feaad08

Protected inventory, before == after:
7f38ad4e0bfb541a6a7da709390ea04bda1d2e9b674736e3ed60b28045711d9f
```

근거: `../evidence/g4/g4-0/RESULT.json`, `README.md`,
`preservation-after-repeat-1.json`, `preservation-after-repeat-2.json`.

## C. Scene model — COMPLETE

Source/Semantic, BSV Architecture, G2 Implementation, G3 Correspondence를 분리했다.
Scene은 이 모델과 제품 query의 결과를 읽는 presentation이다.
Renderer나 layout이 source 관계, compiler signal, origin을 추측하지 않는다.

BSV scene 기본값은 `bsv`. 실제 module occurrence, storage, child instance,
typed interface/method boundary를 표시한다. Rules/methods는 inspector의
동작 설명과 선택 가능한 overlay이며 가짜 물리 블록이 아니다.

RTL scene은 명시적 버튼으로만 진입한다. 해당 provider의 실제 module/cell,
port/pin, net, ordered bits, constants와 aliases를 보존한다.
`$add`, `$mux`, `$dff`를 source 이름으로 바꾸지 않는다.
접점 없는 vector도 선택 가능한 별도 표식으로 남긴다.

Scene contract는 identity, revision, kind, root/owner/path, shell, children,
storages, contacts, connections, correspondence, capabilities, selection,
disclosure, provenance, header, breadcrumb, source/implementation context를 가진다.
RTL에서도 root/owner와 breadcrumb는 BSV 문맥을 유지하며 실제 RTL 경로는 별도다.

Summary는 source statement와 동작 문맥을 기준으로 묶고, 투명한 method 경계
관계를 같은 summary에 보존한다. A 전체는 3개 summary, left 내부는 2개다.
모든 member relation ID, 원본 member, source range, 조건과 확인 scope를 남긴다.
Constant vector도 실제 동일 contact 안에서만 묶고 개별 bit identity를 유지한다.

Capabilities는 stock connectivity와 instrumented partial origin을 구분한다.
Complete sets, general reset/mux, shared/merged cause를 지원한다고 표시하지 않는다.

## D. Navigation — COMPLETE

Visit에 snapshot/scene/build/provider, root/owner/path, entity/relation selection,
source/implementation context, viewport, disclosure, active panel, generation을 저장한다.

- Back/Forward: 저장한 complete visit, scene, geometry 복원. query 재실행으로
  비슷한 화면을 재구성하는 방식이 아니다.
- Up: 실제 BSV hierarchy parent. 방문 history와 별도 동작.
- Breadcrumb: source hierarchy 경로. RTL 경로와 합쳐 가짜 hierarchy를 만들지 않음.
- Repeat entry: semantic visit key가 같으면 history 추가 없음.
- Storage/contact/connection 선택: inspector와 correspondence를 query로 갱신하되
  history를 추가하지 않음.
- 실패·stale: 기존 valid scene 유지. snapshot echo, generation, AbortController로
  오래된 성공/실패 응답 차단.
- Atomic commit: query와 final geometry 검증 후 한 번 commit.
- BSV와 RTL viewport 분리. RTL Fit 후에도 Back은 원래 BSV viewport 복원.

빠른 left/right, pending build 중 Back, transition 중 resize를 실제 browser에서
검증했다. Double-click의 추가 click은 두 번째 level을 열지 않는다.

## E. Visual behavior — COMPLETE, 사용자 승인 PENDING

실제 Chrome 152.0.7977.82에서 검증했다. 생성한 mockup이나 정적 SVG를 runtime
animation 증거로 사용하지 않았다.

- 전체: `../evidence/g4/final/browser/bsv-overall.png`.
- Module 확대: `../evidence/g4/final/browser/J01.png`.
- Storage 선택: `../evidence/g4/final/browser/J02.png`.
- Semantic detail: `../evidence/g4/final/browser/J04.png`.
- RTL contributor: `../evidence/g4/final/browser/J06.png`.
- Back 복원: `../evidence/g4/final/browser/J08.png`.
- 전환: `../evidence/g4/final/browser/transition-frame-000.png`부터 순서대로.

동일 shell DOM과 semantic ID를 유지하고, **21개 실제 geometry frame**과
**23개 Chrome CDP screenshot frame**을 기록했다. 20–30%, 50%, 70–80% 구간에서
shell bounds의 연속 변화, boundary contact 유지, 화면 안의 현재 shell,
inspector 폭 유지가 검사된다. 선택 outline은 layout 크기를 바꾸지 않는다.

기하 zoom은 viewport만 바꾼다. Overview에서는 secondary labels를 줄이지만
canonical facts는 유지한다. 제목은 최소 9px로 남기고 상세는 선택/확대로 확인한다.
진입 직후 내부 전체는 정상 밝기다. 선택 때문에 관련 하드웨어를 없애지 않는다.

375/768/1280 폭, light/dark/high contrast, reduced motion, Tab/Enter/Space,
Escape와 Alt+Left를 실제로 실행했다. Native source editor 통합은 이 증거가 아니다.

## F. Correspondence display — COMPLETE, 근거 범위는 Partial

Stock `left.get`:

- 실제 result port, formal bits 13–20, parent actual bits 21–28과 실제 net/pin
  contacts를 G3 query 결과로 표시·강조한다.
- 이것을 `$dff` 또는 mux의 source cause라고 표시하지 않는다.
- `Expand RTL signals`는 실제 metadata의 signal만 공개한다.

Instrumented:

- `state <- mkReg(0)`의 검증된 `$dff` contributor.
- `value + 1`의 검증된 `$add` contributor.
- 선택한 claim target만 강조. 주변 mux, reset/enable logic, alias로 origin을 확대하지 않음.
- `Verified implementation contributor`, `Partial origin`,
  `Complete origin set: not established` 수준을 확인할 수 있음.

Stock과 instrumented는 다른 snapshot이다. 명시적인 source path/revision 쌍,
동일 source bytes, 검증된 range와 occurrence로 연결하며 entity ID를 혼용하지 않는다.
Unmapped hardware는 그대로 표시한다. Unmapped를 unused/optimized-away로 번역하지 않는다.
Unknown, Unresolved, Unsupported, Not present, None, Partial은 별도 상태다.

G3 경계 유지: definition leaf 53개 중 알려진 contributor object 6개,
complete origin sets 0, definition aliases 168개의 origin claims 0.
G4는 이 범위를 넓힌 compiler-origin 구현이 아니다.

## G. A/B/C — COMPLETE

제품 API가 실제 compiled capture를 읽는다. 정답 graph를 UI fixture에 심지 않았다.

- A: left/right, state, put/get, stock get connectivity, instrumented state와 RHS.
- B: count/phase, 실제 method/rule과 guard/body condition. known-origin object 0.
  Unsupported transformation 범위를 유지한다.
- C: narrow 8-bit와 wide 12-bit. `implementation : mkWidth` source occurrence와
  retained RTL wrapper를 구분한다. source-declared `Reg#(Bit#(width))`를
  임의 concrete declaration으로 바꾸지 않는다.

`A-stock-get-RTL.png`, `A-RHS-RTL.png`, `B-control.png`,
`C-narrow-inlined-RTL.png`, `C-wide-inlined-RTL.png`가 추가 실제 증거다.
G4 범위 내 acceptance에서 미해결된 navigation/data case는 없다.
G3의 general origin 제한은 아래 I 항목과 같다.

실제 journeys:

| Journey | 결과 | 검사 |
| --- | --- | --- |
| J01 | COMPLETE | 전체에서 left single click, 동일 shell 확대 |
| J02 | COMPLETE | state, writer/readers |
| J03 | COMPLETE | put/get typed contact, 명시적 signal disclosure |
| J04 | COMPLETE | semantic summary와 source statement |
| J05 | COMPLETE | state 문맥의 명시적 RTL |
| J06 | COMPLETE | 검증된 contributor 선택 |
| J07 | COMPLETE | unmapped 이웃 mux 선택 |
| J08 | COMPLETE | 정확한 BSV state/viewport/disclosure 복원 |
| J09 | COMPLETE | Back으로 전체 |
| J10 | COMPLETE | Forward로 left 복원 |
| J11 | COMPLETE | 실제 parent로 Up |
| J12 | COMPLETE | breadcrumb parent |
| J13 | COMPLETE | 현재 shell 반복 선택, history 불변 |
| J14 | COMPLETE | accidental double-click, 추가 level 없음 |
| J15 | COMPLETE | pan 후 Back |
| J16 | COMPLETE | zoom, RTL Fit, Back |
| J17 | COMPLETE | transition 중 resize |
| J18 | COMPLETE | 실제 지연 left 응답과 right latest request |
| J19 | COMPLETE | pending build 중 Back |
| J20 | COMPLETE | light theme |
| J21 | COMPLETE | dark theme |
| J22 | COMPLETE | high contrast |
| J23 | COMPLETE | reduced motion, 동일 semantic result |

각 row는 scene kind, owner, selection, viewport, history, visible IDs, 실제 geometry,
provider/correspondence 상태를 검사한다. 전체 원본은
`../evidence/g4/final/browser/acceptance.json`에 있다.

## H. Tests — COMPLETE / 일부 도구 BLOCKED·NOT RUN

- **COMPLETE**: `npm run check`, exit 0.
- **COMPLETE**: `npm test`, **417/417 PASS**, fail 0.
- **COMPLETE**: scene 11, navigation 13, layout 4개의 새 단위 검증.
- **COMPLETE**: read-only HTTP host 경계 검사와 실제 Chrome pointer 테스트.
- **COMPLETE**: J01–J23 및 keyboard/width/stock/RHS/B/C 보충 journeys.
- **COMPLETE**: G4-0 연속 43/43, 43/43 및 preservation helper 5개.
- **COMPLETE**: G2/G3 ordered binding, aliases/constants, revisions, occurrence,
  hostile input, authorization, cancellation/latest-request, origin boundary 회귀.
- **COMPLETE**: 후보 review/source ZIP의 저장소 밖 fresh extraction replay.
  Node/Python만 PATH에 두고 compiler 없음, node_modules 없음,
  `--no-global-search-paths` 및 실제 `require.resolve` 실패를 확인했다.
  최종 ZIP도 같은 검증을 통과한 byte만 최종 이름으로 승격한다.
- **COMPLETE**: portable strict author preservation은 정확히 14개 companion
  부재를 나열하며 expected-fail. 입력이나 검사를 삭제하지 않았다.
- **COMPLETE**: PNG signature/크기/hash와 56개 원본 capture의 byte 동일 복사.
- **COMPLETE**: frontend mechanical detector 결과 `[]`, exit 0.
- **BLOCKED**: 독립 gate/시각 reviewer. OpenAI 인증 부재 및 Codex quota.
  네 시도 모두 tool 실행 전 종료; 승인으로 취급하지 않았다.
- **NOT RUN**: HTML/CSS LSP, Biome 미설치.
- **PARTIAL**: `hardware-layout.js`, `hardware-inspector.js`의 마지막 fresh LSP 응답은
  timeout. 이전 clean 진단과 별도로 기재한다. syntax/build/실제 browser 검사는 통과했고
  오류를 suppress하지 않았다. 나머지 새 주요 JS 모듈은 fresh diagnostics clean.

상세: `../evidence/g4/VALIDATION_SUMMARY.json`, `REVIEW_STATUS.md`.
최종 archive별 실행 명령·환경·exit code·CRC·SHA256·author 결과는 adjacent
`.zip.validation.json`이 authoritative receipt다.

재현:

```sh
# Compiler-free core, Node/Python standard libraries
node --no-global-search-paths --test test/hardware-*.test.js \
  experiments/hardware/g4/server.test.js

# 별도 G4 화면. 기존 production command가 아님.
node experiments/hardware/g4/server.js
# http://127.0.0.1:4179

# Browser lane: @playwright/test와 실제 Chrome 필요
node experiments/hardware/g4/acceptance.js

# Final dist를 덮어쓰지 않는 새 후보 ZIP/replay
node experiments/hardware/g4/package.js --stage
```

## I. Limitations — PARTIAL / NOT RUN

- **PARTIAL**: origin은 검증된 known contributors만. Complete set은 아직 없다.
- **PARTIAL**: Control 및 general reset/enable/mux/shared/merged transform의 cause는
  unresolved/unsupported. 주변 회로나 alias에서 추론하지 않는다.
- **PARTIAL**: aliases는 실제 ordered vector/connectivity로 보존하지만 origin lineage는 없음.
- **PARTIAL**: dense Fit의 node 가시성은 검증했다. 매우 큰 설계의 성능/가독성을
  일반화한 scalability benchmark는 **NOT RUN**. Overview에서는 확대로 상세 진입한다.
- **NOT RUN**: G4 native VS Code Extension Host 통합, production 교체,
  native editor reveal, 새 live compiler replay.
- **NOT RUN**: Lighthouse audit. 요청한 실제 scene/browser acceptance와 구분한다.
- **BLOCKED**: 독립 reviewer 승인. 근거는 H 및 REVIEW_STATUS.
- 최종 사용자 시각·디자인 acceptance: **PENDING**.

## J. Delivery state

G4 구현과 실행 가능한 검수 자료: **COMPLETE**.
독립 review 승인: **BLOCKED**, 사용자 디자인 승인: **PENDING**.

별도 전달 이름:

- `dist/bsv-lens-hardware-g4-review.zip`
- `dist/bsv-lens-hardware-g4-source.zip`
- 각 ZIP의 `.sha256`, `.validation.json`, `.validation.json.sha256`
- 이 보고서와 `../evidence/g4/final/index.json`
- 실제 화면과 transition sequence: `../evidence/g4/final/browser/`

ZIP 내부에는 보고서·제품 코드·offline checks·실제 compiled evidence·browser
증거가 함께 있다. 외부 도구 설치나 과거 companion을 조용히 요구하지 않는다.
Archive hash는 자기참조를 피하기 위해 ZIP 외부 adjacent checksum에 둔다.

```text
User visual/design acceptance: PENDING
Production replacement: NOT PERFORMED
G5: NOT STARTED
main merge: NOT PERFORMED
version bump: NOT PERFORMED
tag: NOT CREATED
GitHub Release: NOT PERFORMED
Marketplace publish: NOT PERFORMED
default command change: NOT PERFORMED
old UI deletion: NOT PERFORMED
repository commit/push: NOT PERFORMED
```

## 최종 제품 Acceptance Questions

아래 COMPLETE는 구현·관측 근거에 대한 engineering 판정이다.
사용자가 디자인을 승인했다는 뜻이 아니다.

| 질문 | 판정 | 근거 |
| --- | --- | --- |
| Q1 BSV만으로 hierarchy 파악 | COMPLETE | 전체 화면은 mkConnected/left/right와 BSV contact |
| Q2 single-click 내부 확대 | COMPLETE | J01, 동일 shell DOM/ID와 runtime frame |
| Q3 외부 contact와 내부 의미 연속 | COMPLETE | 동일 contact IDs, shell 경계 geometry 및 source relations |
| Q4 실제 이름·type | COMPLETE | state Reg, child definition, C symbolic/concrete 구분 |
| Q5 rule/method는 동작 설명 | COMPLETE | inspector/경계 relation; 별도 physical block 없음 |
| Q6 선이 구조를 압도하지 않음 | COMPLETE | A 3 summaries, left 2; 모든 원본 member 보존 |
| Q7 source statement·조건 확인 | COMPLETE | J04, behavior/predicate IDs, source ranges |
| Q8 RTL 명시적 진입 | COMPLETE | 기본 bsv, Implementation 버튼 |
| Q9 unmapped hardware 보존 | COMPLETE | J07, 실제 mux/접점 없는 vector/aliases 유지 |
| Q10 complete origin 과장 없음 | COMPLETE | contributor/partial/complete-not-established 분리 |
| Q11 RTL Back 정확 복원 | COMPLETE | J08/J16 complete visit deep equality |
| Q12 Back과 Up 구분 | COMPLETE | J09/J11 및 다른 sibling history unit case |
| Q13 반복 클릭 history 불변 | COMPLETE | J13, semantic visit-key 검증 |
| Q14 header/scene 일치 | COMPLETE | 모든 journey의 kind/owner/provider assertion |
| Q15 Unknown/Unsupported/Partial/None 구분 | COMPLETE | contact payload와 origin 상태 별도 |
| Q16 A/B/C 하드코딩 없는 제품 query | COMPLETE | 등록된 실제 captures와 제품 API |
| Q17 runtime geometry 연속성 | COMPLETE | 21 geometry frames, 23 CDP PNGs |
| Q18 reduced-motion 동일 결과 | COMPLETE | J23 scene identity 동일, duration 0 |
| Q19 layout이 G2/G3 truth 불변 | COMPLETE | frozen source/implementation 전후 동일, 417 regressions |
| Q20 구조·연결·코드·근거 수준 설명 | COMPLETE | BSV/RTL 분리, source inspection, provider와 partial scope |

**여기서 멈춘다. G5나 production 전환은 수행하지 않았다.**
