# Source discovery / design selection correction

사용자 화면의 오류를 실제 IM2P.sim workspace에서 재현하고 수정했습니다. 새 설치본은 [bsv-lens-0.4.1-a228fae2d8f9c6b0.vsix](../../../dist/bsv-lens-0.4.1-a228fae2d8f9c6b0.vsix)입니다. [SHA-256](../../../dist/bsv-lens-0.4.1-a228fae2d8f9c6b0.vsix.sha256) · [실행 영수증](../../../dist/bsv-lens-0.4.1-a228fae2d8f9c6b0.vsix.validation.json)

## 확인한 원인과 변경

- 기존 e600은 파일을 찾은 뒤 설계 선택창이 닫히면 발견 상태를 버려 `No BSV files found`를 표시했습니다. 이제 발견 파일 수와 **설계 선택 / Choose a design** 버튼을 유지합니다. 실제 취소·superseded 요청은 예전 작업의 안내를 게시하지 못합니다.
- 설정에서 제외된 build 복사본 958개가 1,024 candidate 한도를 먼저 소모했습니다. 이로 인해 실제 소스 67개 중 마지막 파일 하나가 누락됐습니다. 기본 탐색은 안전한 디렉터리 제외 규칙을 검색 단계에서 적용합니다. 한도를 높이거나 원본 source를 삭제하지 않았습니다.
- 명시적 include가 있거나 glob 의미가 모호하면 기존 후처리를 유지합니다. 이 경우 기존 bounded/partial 한계도 유지됩니다. 외부 root 권한, symlink 차단, source revision, query 의미는 변경하지 않았습니다.

## 실제 검증

- 관련 회귀 **100/100 PASS**, syntax/CSP/branding 검사 PASS. LSP는 기존 미설치 상태 유지.
- 실제 설치본: BSV **67개 발견·67개 index**, 누락 0, `ready`, `truncated=false`. 설계 정의 66개, root 후보 46개이며 첫 후보를 임의로 선택하지 않습니다.
- 선택창 Escape 2회, 버튼 재시도, panel 숨김·재사용, `mkExecuteController`, `stateReg` writer, 실제 에디터 원문 범위, Back PASS. 선택한 설계 분석은 관련 소스 2개 범위입니다.
- 원문 `ExecuteController.bsv`의 UTF-16 `[2244,2836)`, editor 0-based `70:4–87:13` 선택 확인. BSV 67개와 workspace 설정 SHA 불변.
- macOS arm64 / VS Code 1.136.1 격리 설치본에서 수행. 일반 사용자 profile 설치·설정은 변경하지 않았습니다.

[수정 전 실제 화면](../../../.build/hardware/runs/g6-discovery-cancel-before-5ct59z/g6/02-cancelled-before.png) · [수정 후 재선택 화면](../../../.build/hardware/runs/g6-discovery-cancel-after-cMdIEH/g6/02-cancelled-after.png) · [실제 모듈 화면](../../../.build/hardware/runs/g6-discovery-cancel-after-cMdIEH/g6/03-execute-controller.png)

## 적용

VS Code의 **Extensions → … → Install from VSIX…**에서 위 새 파일을 선택하고 **Developer: Reload Window**를 실행하세요. Hardware Schematic을 연 뒤 **Choose a design / 설계 선택**에서 `mkExecuteController`를 고르면 됩니다. 소스 폴더 수동 등록이나 compiler 설정은 필요 없습니다.

기존 e600 VSIX와 G6 source/review ZIP·영수증은 그대로 보존했습니다. 이번 수정에 이전 전체 suite·archive replay 수치를 재사용하지 않습니다. Package version **0.4.1**, extension ID **code0-god.bsv-lens** 유지. Commit/push/merge/release, compiler 실행 없음. 사용자 디자인 승인은 **PENDING**입니다.
