# Hardware Schematic 사용하기

최종 VSIX 파일·SHA-256·설치 검수 결과는 [FOLLOWUP_REPORT](FOLLOWUP_REPORT.md)를 따른다. 같은 `0.4.1`이라도 빌드가 다르므로 파일명과 SHA를 함께 확인한다.

## 일반 설정을 건드리지 않고 설치

아래는 실제 검수에 사용한 **로컬 macOS arm64 / VS Code 1.136.1** CLI 경로와 격리 방식이다. `code` 명령을 PATH에 등록할 필요 없다. 다른 컴퓨터에서는 확인한 VS Code 실행본 경로로 바꾼다. 다른 OS·remote·virtual 환경의 검증 여부는 최종 보고서에 따로 표시한다.

zsh에서 VSIX와 workspace 경로를 실제 경로로 바꾼다.

```sh
g6_app="$HOME/Projects/bsv-architecture-explorer/.vscode-test/vscode-darwin-arm64-1.136.1/Visual Studio Code.app"
g6_cli="$g6_app/Contents/Resources/app/bin/code"
g6_vsix='/absolute/path/to/final-build.vsix'
g6_workspace="$HOME/aisa-lab/DynDNN/AQuA"
g6_trial=$(mktemp -d /tmp/bsv-lens.XXXXXX)
mkdir "$g6_trial/user-data" "$g6_trial/extensions" "$g6_trial/shared-data"
g6_flags=("--user-data-dir=$g6_trial/user-data"
          "--extensions-dir=$g6_trial/extensions"
          "--shared-data-dir=$g6_trial/shared-data")

/usr/bin/shasum -a 256 "$g6_vsix"
"$g6_cli" "${g6_flags[@]}" --version
"$g6_cli" "${g6_flags[@]}" --install-extension "$g6_vsix" --force
"$g6_cli" "${g6_flags[@]}" --list-extensions --show-versions
"$g6_cli" "${g6_flags[@]}" --new-window "$g6_workspace"
```

출력 SHA가 제공된 checksum과 같고, 설치 목록에 `code0-god.bsv-lens@0.4.1`이 있어야 한다. 세 디렉터리 옵션은 재실행·설치·목록 확인에도 모두 유지한다. 이 VS Code 버전의 공유 신뢰 저장소도 별도로 격리한다. 짧은 `/tmp` 경로는 macOS 소켓 경로 길이 제한을 피한다. 이 창에서는 Settings Sync를 켜지 않는다.

GUI로 설치하려면 마지막 명령으로 격리 창을 먼저 연 뒤, **확장(Extensions) → … → Install from VSIX…**에서 최종 파일을 선택한다. 이는 [공식 GUI 설치 경로](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace#_install-from-a-vsix)이며, 기록된 설치 검수는 위 CLI 방식으로 수행했다. 일반 사용 중인 다른 VS Code 창에서 설치하면 이 격리가 적용되지 않는다.

한국어 Language Pack을 설치한 직후 영어로 보이면, 같은 격리 창을 한 번 정상 실행한 뒤 닫고 같은 profile로 다시 연다. source 등록이나 compiler 설정은 필요 없다.

## 바로 구조 열기

1. Command Palette(`⇧⌘P`)에서 **BSV Lens: Open Hardware Schematic (Experimental)** 실행.
2. 현재 workspace의 BSV 파일이 자동으로 발견된다. Source 폴더 등록·입력 이름·manifest·compiler 설정은 필요 없다.
3. 설계 후보가 여러 개면 원하는 설계를 고른다. 하나라면 자동으로 열린다. 이는 소스에서 찾은 설계이며 실제 compiler top 확정과는 다르다.
4. 패널 **설정(Settings)**을 열어 표시된 Build ID를 최종 보고서와 대조한다. 버전 번호만 같고 Build ID가 다르면 다른 설치본이다.

AQuA에서는 원하는 설계로 `mkAquaMemorySubsystem` 또는 `mkAquaLoopMatmul`을 선택한다. 여러 workspace folder가 있으면 해당 프로젝트를 고른다. 독립된 설계를 하나의 회로로 합치지 않는다.

이 정적 소스 분석은 Restricted Mode에서도 사용할 수 있다. 분석을 위해 신뢰 설정을 바꿀 필요 없으며 compiler나 workspace script를 실행하지 않는다.

## 블록과 코드 읽기

- **모듈 몸체·제목 한 번 클릭**: 해당 내부로 이동. 정보 버튼은 이동 없이 설명을 연다.
- **storage 선택**: 선언과 readers/writers, 관련 동작·코드 확인.
- **interface 선택**: 필요한 하위 interface·method만 펼쳐 확인.
- **연결선 선택**: 양끝·관계 종류·원문 근거 확인. 요약된 관계의 원본 목록도 Inspector에서 읽는다.
- **원문 열기**: 검증된 BSV 범위를 실제 에디터에서 선택. **뒤로(Back)**로 앞서 보던 분석·선택으로 돌아간다.
- **상위(Up)**는 실제 부모 계층, **전체 구조 맞춤**은 현재 표시 범위의 개요, **선택 대상 맞춤**은 선택과 관련 범위에 사용한다.

개요에서 storage 이름이 접혀 있으면 **Tab**으로 대상을 이동하고 **Enter**로 선택한다. Inspector에서 전체 이름과 원문을 읽거나 선택 대상 맞춤으로 확인할 수 있다.

배치가 보류된 연결과 접힌 상세는 서로 다른 상태다. 일부 연결 배치가 실패했다면 연결 목록과 문제 상세를 확인한다. 설계 전환이 실패하면 유지 중인 화면의 이름을 확인하고 다시 시도한다.

## 소스 갱신·RTL·설정

기본 화면은 **저장된 BSV 소스 분석**이다. 미저장 변경은 자동 저장하지 않는다. 현재 버전과 다른 원문 위치를 열 때는 이전 캡처를 명시한 읽기 전용 문서를 제공하거나 stale/unavailable 상태를 알린다. 과거 범위를 수정된 문서에 그대로 적용하지 않는다.

파일 저장·생성·삭제 등의 변경은 열린 패널에서 자동 갱신된다. 필요한 경우 설정에서 수동 새로고침을 사용할 수 있다. 좁은 화면에서는 Inspector를 닫아 구조를 넓게 본 뒤 다시 연다.

RTL은 선택 사항이다. **RTL 결과 연결** 또는 설정의 artifact 등록으로 기존 결과를 명시적으로 연결한다. 후보 발견만으로 import·BSV 대응이 확정되지는 않는다. 대응 metadata나 revision 근거가 없으면 소스와 RTL을 별도로 표시한다. compiler·task·Makefile을 자동 실행하지 않는다.

설정의 **Workspace source settings**에서 **Workspace** 탭을 선택하면 현재 workspace 범위를 조정할 수 있다. **User** 탭은 그 격리 profile의 여러 프로젝트에 적용된다. 현재 include/exclude 설정은 window 범위이므로 multi-root의 **Folder** 탭 override가 적용된다고 가정하지 않는다.

- `bsvArchitecture.hardwareAutoDiscover`: 명령 실행 시 자동 탐색.
- `bsvArchitecture.hardwareInclude`, `bsvArchitecture.exclude`: 추가 포함·제외 glob.
- `bsvArchitecture.autoRefresh`: 열린 화면의 자동 갱신.

Multi-root에서 폴더별 범위가 필요하면 해당 폴더의 기존 `.bsv-arch.json`에서 `sourceRoots`/`exclude`를 지정한다. **Source inventory and exclusions**에서 실제 포함·제외 결과를 확인한다. 명시적 include는 일반 제외 규칙의 예외가 될 수 있지만, workspace 밖 경로·symlink·캐시/검수 evidence·자원 한도를 허용하는 권한은 아니다.

기존 Architecture/Source 명령은 그대로 사용 가능하다. Hardware Schematic 패널을 닫으면 기존 화면으로 돌아갈 수 있다. 검수 후 격리 창을 모두 닫고, 이번에 생성한 `$g6_trial` 디렉터리만 Finder에서 삭제하면 된다. 일반 profile과 원본 workspace는 삭제 대상이 아니다.
