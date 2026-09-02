# BSV Architecture Explorer

VS Code 안에서 Bluespec SystemVerilog(`.bsv`) 소스를 분석해 **아키텍처 수준의 구조도**로 보여주는 범용 확장입니다. 특정 프로젝트나 가속기 이름에 종속되지 않으며, 일반 BSV 작업공간에서 다음 설계 구조를 탐색하는 데 초점을 둡니다.

- package, module, interface, function, typedef 구조
- module 인스턴스 계층과 생성자(`mk...`) 연결
- rule / method와 Reg, FIFO, BRAM, Wire 접근 관계
- utility package의 타입과 함수 흐름
- 소스 디렉터리 기반 subsystem grouping
- 설계자가 추가한 host, DMA, NoC, external memory, data/control path

이 확장은 BSC 또는 Yosys가 없어도 동작하는 **소스 기반 Architecture Explorer**입니다. 합성된 게이트/netlist schematic 대신, 설계자가 코드를 읽을 때 필요한 L0–L2 구조를 빠르게 보여줍니다.

![BSV architecture preview](media/preview.png)

## 제공 기능

- 작업공간의 `.bsv` 파일 자동 탐색
- `hw/bsv/src`, `bsv/src`, `src` source root 자동 감지
- System view와 Current file view
- package/module/function 단위 drill-down
- module → instantiated module hierarchy 연결
- rule/method → Reg/FIFO/instance 접근 관계 표시
- package-only utility 파일의 타입과 함수 흐름 표시
- 노드 클릭 시 inspector와 관계 강조
- `Enter` 또는 **Open source**로 원본 선언 이동
- drag pan, pointer 중심 wheel zoom, `Fit`, 검색
- package/import/rule/primitive 표시 필터
- SVG 구조도와 JSON Architecture IR 내보내기
- BSV Document Symbols와 CodeLens
- `.bsv-arch.json` 기반 grouping, label, virtual node, manual edge
- BSV 저장 및 설정 변경 시 자동 refresh
- 멀티루트 VS Code 작업공간 선택

## 설치

### VSIX 설치

릴리스에 포함된 `bsv-architecture-explorer-0.2.0.vsix`를 사용합니다.

```bash
code --install-extension bsv-architecture-explorer-0.2.0.vsix
```

또는 VS Code의 **Extensions: Install from VSIX...** 명령을 실행해 파일을 선택합니다.

### 소스에서 실행

1. 이 저장소를 VS Code로 엽니다.
2. `F5`를 눌러 Extension Development Host를 실행합니다.
3. 개발 호스트에서 BSV 작업공간을 엽니다.
4. Command Palette에서 **BSV Architecture: Open Workspace**를 실행합니다.

## 빠른 시작

작업공간 루트에서 다음 명령을 사용합니다.

1. **BSV Architecture: Create .bsv-arch.json**
2. 필요하면 entrypoint, subsystem group, virtual node를 조정
3. **BSV Architecture: Open Workspace**

설정 파일은 선택 사항입니다. 설정이 없으면 감지된 source root와 디렉터리 구조를 이용해 바로 분석합니다.

`.bsv` 파일을 열어둔 상태에서는 editor title의 architecture 버튼, 상태 표시줄의 **BSV Arch**, 또는 다음 단축키를 사용할 수 있습니다.

- Windows/Linux: `Ctrl+Alt+A`
- macOS: `Cmd+Alt+A`

## 명령

| 명령 | 용도 |
|---|---|
| `BSV Architecture: Open Workspace` | 현재 BSV 작업공간의 System view 열기 |
| `BSV Architecture: Open Current File` | 선택한 `.bsv`의 package/file view 열기 |
| `BSV Architecture: Open Symbol` | CodeLens가 지정한 module/function으로 이동 |
| `BSV Architecture: Refresh` | 소스를 다시 분석하고 열린 구조도 갱신 |
| `BSV Architecture: Create .bsv-arch.json` | 감지된 source root를 포함한 범용 설정 생성 |
| `BSV Architecture: Export Architecture JSON` | 전체 Architecture IR 저장 |

## 화면 조작

| 조작 | 동작 |
|---|---|
| 노드 클릭 | 노드 선택 및 관련 edge 강조 |
| 노드 더블클릭 | package/module/function 내부로 drill-down |
| 노드에서 `Enter` | 해당 BSV 선언으로 이동 |
| 빈 공간 drag | pan |
| mouse wheel | pointer 위치 기준 zoom |
| `0` | diagram fit |
| `+` / `-` | zoom in/out |
| `Esc` / `Alt+Left` | 상위 architecture로 이동 |
| `Ctrl/Cmd+F` | 노드 검색 |

## `.bsv-arch.json`

자동 분석만으로 알 수 없는 L0 subsystem 의미와 논문/문서용 data path는 작업공간 루트의 `.bsv-arch.json`으로 보강합니다.

```jsonc
{
  "version": 1,
  "title": "Tensor Accelerator Architecture",
  "sourceRoots": ["hw/bsv/src"],
  "exclude": ["**/tb/**", "**/experimental/**"],
  "entrypoints": ["mkAcceleratorTop"],

  "groups": [
    {
      "id": "control",
      "label": "Control Plane",
      "match": "hw/bsv/src/control/**",
      "order": 10
    },
    {
      "id": "memory",
      "label": "Memory Subsystem",
      "match": "hw/bsv/src/memory/**",
      "order": 20
    },
    {
      "id": "compute",
      "label": "Compute Engine",
      "match": "hw/bsv/src/compute/**",
      "order": 30
    }
  ],

  "nodes": {
    "mkVectorQuantizer": {
      "label": "Vector Quantizer",
      "group": "compute"
    },
    "mkAcceleratorTop": {
      "label": "Accelerator Top",
      "entry": true
    }
  },

  "virtualNodes": [
    {
      "id": "host-runtime",
      "label": "Host Runtime",
      "kind": "host",
      "group": "control",
      "description": "Command and tensor provider"
    }
  ],

  "edges": [
    {
      "from": "host-runtime",
      "to": "mkAcceleratorTop",
      "kind": "control",
      "label": "commands"
    },
    {
      "from": "mkVectorQuantizer",
      "to": "mkSystolicArray",
      "kind": "data",
      "label": "quantized activations"
    }
  ],

  "view": {
    "direction": "LR",
    "showPackages": false,
    "showImports": false,
    "showPrimitives": false
  }
}
```

`BSV Architecture: Create .bsv-arch.json`으로 생성되는 기본 설정은 특정 폴더 체계를 강제하지 않습니다. source root만 자동 감지하며, `groups`는 빈 배열로 생성됩니다. 명시적 group이 없을 때는 파일의 상위 디렉터리 이름을 subsystem 이름으로 사용합니다.

### Node reference

`nodes`, `entrypoints`, `edges.from`, `edges.to`에는 다음 중 하나를 사용할 수 있습니다.

- 완전한 Architecture IR ID: `module:AcceleratorTop.mkAcceleratorTop`
- 선언 이름: `mkAcceleratorTop`
- package-qualified 이름: `AcceleratorTop.mkAcceleratorTop`
- virtual node ID: `host-runtime` 또는 `virtual:host-runtime`

이름이 여러 package에서 중복될 때는 완전한 ID를 사용하는 것이 안전합니다. JSON으로 내보낸 Architecture IR에서 정확한 ID를 확인할 수 있습니다.

### Source annotation

설정 파일 대신 BSV 선언 바로 위에 annotation을 둘 수도 있습니다.

```bsv
// @arch.group compute
// @arch.label Vector Quantizer
// @arch.entry
module mkVectorQuantizer(VectorQuantizerIfc);
    // ...
endmodule
```

지원 annotation:

- `@arch.group <id>`
- `@arch.label <text>`
- `@arch.kind <kind>`
- `@arch.description <text>`
- `@arch.entry`
- `@arch.hide`

## Package-only utility 표시

`LocalAddress.bsv`처럼 module이 없는 파일을 하드웨어 module block으로 잘못 표현하지 않습니다. package를 drill-down하면 다음처럼 선언 구조가 나타납니다.

- `LocalRegion` enum
- `LocalAddress`, `BankedRow` struct
- `mapGlobalRow()`
- `offsetBankedAddress()`

함수 inspector에는 parameter, local value, 호출 함수, `/`, `%`, `*`, `+`, 비교 연산이 요약됩니다. 즉, 저수준 논리 셀을 펼치는 대신 주소 mapping의 소스 수준 의미를 보여줍니다.

## VS Code 설정

| 설정 | 기본값 | 설명 |
|---|---:|---|
| `bsvArchitecture.autoRefresh` | `true` | BSV/설정 변경 시 열린 diagram 갱신 |
| `bsvArchitecture.enableCodeLens` | `true` | package/module/function 위 navigation link 표시 |
| `bsvArchitecture.defaultView` | `system` | 초기 view |
| `bsvArchitecture.showPrimitives` | `false` | Reg/FIFO/Wire/BRAM 기본 표시 여부 |
| `bsvArchitecture.maxFiles` | `750` | 작업공간당 최대 분석 파일 수 |
| `bsvArchitecture.exclude` | build 경로 제외 | 추가 제외 glob |

## 분석 범위와 한계

이 버전은 **BSV source architecture explorer**입니다. comment와 string을 masking하고 delimiter depth를 추적해 다중 행 선언을 분석하지만, BSC compiler의 완전한 parser/elaborator를 재구현하지는 않습니다.

자동 분석 범위:

- package/import/export
- interface method와 subinterface
- module 및 return interface
- `<- mk...` 인스턴스
- Reg/FIFO/BRAM/Wire/Vector primitive 분류
- rule, method, local/top-level function
- enum/struct/union/alias typedef
- direct instance access와 workspace 내 함수 호출

설정 또는 향후 compiler adapter가 필요한 범위:

- type-level 계산으로 생성되는 정확한 instance 수
- conditional generation 이후의 elaborated hierarchy
- macro/preprocessor 결과에만 존재하는 선언
- 동일 이름이 여러 package에 존재하는 모호한 reference
- 암묵적 protocol 의미와 논문용 subsystem 명칭

L1/L2 소스 구조는 자동 분석하고, L0 설계 architecture는 `groups`, `virtualNodes`, `edges`, source annotation으로 보강하는 방식입니다. 합성 후 RTL schematic이 필요할 때는 별도 BSC/Yosys 흐름을 사용해야 합니다.

## 예제

`examples/bsv-mini-accelerator`는 바로 열어볼 수 있는 작은 범용 BSV fixture입니다.

- `LocalAddress` utility package
- controller와 command FIFO
- activation/weight/accumulator scratchpad
- vector quantizer
- systolic array
- top module과 host virtual node

예제는 parser와 visualization 검증용이며 합성을 목표로 하지 않습니다.

## 0.1.x 실험 버전에서 변경된 점

0.2.0부터 확장 ID, 명령 ID, 설정 namespace가 범용 이름으로 변경되었습니다.

- 확장 ID: `code0-god.bsv-architecture-explorer`
- 명령 namespace: `bsvArchitecture.*`
- 설정 namespace: `bsvArchitecture.*`
- 프로젝트 설정 파일: `.bsv-arch.json` 형식 유지

이전 실험용 VSIX가 설치되어 있다면 VS Code Extensions 화면에서 기존 항목을 제거한 뒤 0.2.0 VSIX를 설치하는 편이 안전합니다.

## 개발 및 검증

Node.js 22 이상을 권장합니다. 외부 npm package는 사용하지 않습니다.

```bash
npm run check
npm test
npm run package
```

생성 결과:

- `dist/bsv-architecture-explorer-0.2.0.vsix`
- `dist/bsv-architecture-explorer-repository-0.2.0.zip`
- `dist/SHA256SUMS.txt`

테스트는 parser, guarded method, primitive classification, hierarchy resolution, manual edge, JSONC, generic starter config, command registration, archive manifest를 검증합니다.

## 내부 구조

```text
src/
├── extension.js
├── architecture/
│   ├── analyzer.js
│   ├── config.js
│   ├── graph-builder.js
│   ├── parser.js
│   └── source-utils.js
└── panel/
    ├── architecture-panel.js
    └── html.js

media/
├── webview.js
├── webview.css
└── icon.png
```

자세한 내부 설계는 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), 설정 형식은 [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md)를 참고합니다.

## License

MIT
