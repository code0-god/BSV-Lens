# 최종 전달: G6 Workspace Usability

자동 소스 발견, 구조 개요, 단일 클릭 내부 탐색, 원문 왕복, 실패 복구와 Native 설치본 검수를 완료했습니다. **review/source 두 ZIP의 fresh replay도 PASS**입니다. 사용자 시각·디자인 승인은 **PENDING**입니다.

이 문서는 ZIP 생성 후 작성한 종료 기록입니다. ZIP 안의 [상세 보고서](FOLLOWUP_REPORT.md)는 포장 전 기록을 보존하며, 최종 재생 결과는 아래 외부 영수증이 증명합니다.

| 산출물 | 크기 | 검증 |
|---|---:|---|
| [VSIX](../../../dist/bsv-lens-0.4.1-e600679639f90e1f.vsix) | 708,341 B | 설치본과 동일 bytes |
| [Review ZIP](../../../dist/bsv-lens-hardware-g6-usability-review.zip) | 317,161,175 B | [fresh 영수증](../../../dist/bsv-lens-hardware-g6-usability-review.zip.validation.json) |
| [Source ZIP](../../../dist/bsv-lens-hardware-g6-usability-source.zip) | 300,924,499 B | [fresh 영수증](../../../dist/bsv-lens-hardware-g6-usability-source.zip.validation.json) |

[Checksum 목록](../../../dist/bsv-lens-hardware-g6-usability-SHA256SUMS) · [전달 영수증](../../../dist/bsv-lens-hardware-g6-usability-delivery.json) · [격리 설치·사용 절차](USER_INSTALL.md)

VSIX SHA-256: `fbedafa9fbf4435c305da01e0fb2279ad5288049f439bec6200d266d96800bbf`

전체 source/test/tool inventory: **431파일**, `70e25382999765718a6d285ba8c2871f75dfb8bbccc495889cdb6eaad7aba1e7`. Git HEAD만으로 이 미커밋 구현을 식별하지 않습니다. Branch `feat/hardware-schematic`, HEAD `c6b9a5c642d105ad4117535c1d85366f1c02ec1c`, package/lock **0.4.1** 유지.

- 전체 repository core: **841 tests / 838 pass / 0 fail / 3 분리 skip**. 이후 검수 helper 수정은 **10/10** 및 실제 설치 사전 재생으로 검증했습니다.
- 각 최종 ZIP의 shipped/core replay: **533 tests / 530 pass / 0 fail / 3 분리 skip**, 패키지·decoder 검사 **20/20**. 전체 repository suite와 다른 범위입니다. 분리 lane **8/8**도 별도 검증했습니다.
- 각 추출본에서 공개 query **12개+75개**, 두 source entry 입력, 실제 VSIX 설치·자동 발견·선택·원문·Back·설계 전환 PASS. 원래 strict cross-build identity 비교 FAIL은 보존하고 검증된 파생 ID 대응 후 전체 의미 결과를 비교했습니다.
- 원본 **151,399개** 검사: 허용한 기존 파일 변경 **41개**, 무단 변경·과거 run 변경·원본 workspace 변경 **0개**. 두 archive 원본 inventory도 재생 전후 일치합니다.
- PNG **120개**, trace **107개** 포함. JSON 122개·before DOM 6개·inventory 2개는 모든 원문 값·순서·bytes/SHA를 정확히 재구성합니다. 원본 PNG/trace 편집 없음. 최대 확장 크기 **799,762,197 B**, 기존 **768 MiB** 상한 유지.
- author companion **14개** 미제공 시의 명시적 expected-fail 유지. 선택적 historical companion과 구분하며, shipped/core 재생은 과거 ZIP 없이 동작합니다.

[독립 최종 전달 감사](../../../.build/hardware/runs/g6-usability-terminal-audit-VWJFa0/g6-usability/terminal-audit.json) · [원본 보존 검사](../../../.build/hardware/runs/g6-usability-preservation-2Rt4QQ/g6-usability/preservation.json) · [fresh 원본 화면 검토](../../../.build/hardware/runs/g6-usability-fresh-visual-b8axaU/g6-usability/visual.json)

큰 개요의 모든 storage 이름을 동시에 표시하지 않습니다. 선택·Inspector·실제 키보드 접근으로 상세를 읽습니다. 기존 원문/RTL 미대응, 큰 RTL·M complete-cone 제한은 남습니다. 검증 환경은 **macOS arm64 / VS Code 1.136.1 local**입니다. Remote/virtual·다른 OS 검수와 live compiler는 수행하지 않았습니다. LSP는 기존 미설치 상태이며 설치 승인 없이 변경하지 않았습니다.

Workspace auto discovery, 실제 source-only navigation, overview/interface disclosure, failure recovery/state consistency: **COMPLETE**. Installed native 및 두 ZIP fresh replay: **PASS**. User visual/design acceptance: **PENDING**.

Production 기본 화면 교체, commit/push/merge, version/tag/Release/Marketplace, G7: **NOT PERFORMED**.
