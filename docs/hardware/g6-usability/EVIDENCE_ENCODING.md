# 검수 데이터의 손실 없는 중복 제거

Trace ZIP과 PNG는 촬영·기록한 원본 그대로 포함한다. 설치 영수증과 acceptance 주 보고서도 원본이다. 반복되는 큰 JSON/JSONL 진단과 초기 보존 inventory만 아래 평문 JSON 표현을 사용할 수 있다. 원본 run 파일은 수정·삭제하지 않는다.

각 표현은 원본 상대 경로·byte 수·SHA-256을 가진다. Decoder는 모든 값·배열 순서·객체 키 순서·원본 공백/LF 형식까지 복원한 뒤 원본 SHA와 비교한다. 파일을 줄여서 PASS로 만드는 방식이 아니며, 재구성 실패·참조 누락·값 변경은 archive 검증 실패다. 압축, base64, 재귀 참조는 사용하지 않는다.

| Index `diagnostics.kind` | 보존 방식 | 검증 도구 |
| --- | --- | --- |
| `lossless-native-transport` | Before DOM의 누적 Host/post/state 배열을 한 번 저장하고 정확한 prefix 길이로 각 DOM 복원 | `diagnostics.cjs` |
| `lossless-file-inventory` | Directory·content descriptor 표와 원래 순서의 `[directoryIndex, basename, contentIndex]` 행 | `inventory-tables.cjs` |
| `lossless-json-interning` | 반복 원값을 평문 atom 표에 한 번 저장. 각 문서에는 원래 구조와 disjoint typed path/null hole을 보존 | `json-interning.cjs` |

Interning의 atom은 원본 객체·배열·문자열 값이다. Atom 내부의 `$ref` 같은 문자열/필드는 데이터이며 추가 참조로 해석하지 않는다. 문서의 명시적 hole만 복원한다. 경로는 object의 실제 own key 또는 array의 유효 정수 index여야 한다. 중복·ancestor/descendant 충돌·존재하지 않는 경로·null이 아닌 대상·prototype 경로를 거부한다. JSONL도 원래 record 순서와 각 line의 정확한 JSON/LF를 보존한다.

Decoded member는 **64 MiB**, 모든 재구성 진단의 합은 **768 MiB** 이하다. Interning은 추가로 문서 128개, atom/hole/JSONL row 100,000개, 깊이 128, node 방문 4,000,000개와 준비 직렬화 작업 768 MiB 한도를 둔다. 복원 전에 atom 크기·들여쓰기 깊이·참조 횟수로 decoded 크기를 계산하여 reference bomb을 거부한다. 실제 archive의 기존 64/768 MiB 한도는 별도로 그대로 적용한다.

Index의 물리 attachment 목록과 재구성된 논리 원본 목록을 구분한다. Native 캡처가 가리키는 `.measurement.json` 또는 `native-events.jsonl`이 공유 표현에 있을 때도 모든 측정값과 메시지가 원본 byte 단위로 남아 있다. 이는 historical companion이나 누락된 검수 항목이 아니다. 중복된 `.state.json`의 기존 명시적 생략 정책과도 다르다.

Fresh extraction은 원래 입력/attachment hash를 확인하고, 각각의 decoder를 실제 실행하여 같은 원본 SHA를 재현한다. 검수자는 다음 도구로 재검증할 수 있다.

```sh
node experiments/hardware/g6-usability/diagnostics.cjs --verify TRANSPORT_MANIFEST.json
node experiments/hardware/g6-usability/inventory-tables.cjs --verify INVENTORY_TABLE.json
node experiments/hardware/g6-usability/json-interning.cjs --verify INTERNING_MANIFEST.json
```

저장 공간 때문에 측정값·메시지·현재 필수 native proof를 제외하지 않는다. 해당 표현의 한도나 정확한 roundtrip 조건을 만족하지 못하면 원본을 유지하고 예산 문제를 별도로 보고한다.
