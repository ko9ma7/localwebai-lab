# LocalWebAI Lab Data Guide

LocalWebAI Lab은 GitHub Pages에서 별도 DB 없이 동작하도록 `site/data/`를 **Static Data Store**로 사용합니다. UI가 필요한 데이터는 `fetch('./data/...json')`으로 읽으며, 배포 시 `dist/data/`에 그대로 복사됩니다.

## 데이터 원칙

- **공식 upstream 데이터**와 **LocalWebAI Lab 자체 데이터**를 구분합니다.
- Hugging Face 공식 수치는 `source_url`, `published_at`, `verified_at` 등 provenance를 함께 기록합니다.
- Kernel의 `category`는 검색 편의를 위한 LocalWebAI Lab 파생 분류이며 Hugging Face의 공식 taxonomy가 아닙니다.
- `hardware-profiles.json`은 UI/오류 상태 테스트용 합성 데이터이며 실제 GPU 성능표가 아닙니다.
- 사용자 실측 benchmark 기록은 정적 JSON이 아니라 브라우저 `LocalStorage`에 저장됩니다.

## 파일 목록

| 파일 | 용도 | 성격 |
|---|---|---|
| `data-manifest.json` | 전체 데이터 인덱스 | Local |
| `localwebai-complete.json` | 모든 공개 데이터를 하나로 묶은 단일 JSON | Aggregate |
| `project.json` | 원본 아이디어, 서비스 메타, 샘플 dashboard | Local |
| `kernel-catalog.json` | Hugging Face `webgpu-kernels` 207개 repository 목록 | Upstream + derived category |
| `kernel-catalog.csv` | 동일 207개 목록의 스프레드시트용 CSV | Export |
| `benchmark-presets.json` | Quick/Balanced/Large/Stress preset 및 입력 limit | Local |
| `readiness-rubric.json` | WebAI Ready 100점 계산 규칙 | Local |
| `reference-benchmarks.json` | Hugging Face 공개 Apple M4 비교 수치 | Upstream reference |
| `compatibility.json` | WebGPU 런타임 체크리스트 | Local guidance |
| `hardware-profiles.json` | UI regression용 합성 장치 상태 | Synthetic |
| `roadmap.json` | Embedding/Image/Vision/Classification 확장 계획 | Local |
| `faq.json` | 사용자 FAQ | Local |
| `sources.json` | 공식 출처 URL 및 검증 범위 | Provenance |
| `schemas/benchmark-result.schema.json` | export benchmark JSON Schema | Local schema |
| `schemas/kernel-catalog.schema.json` | 207 kernel catalog JSON Schema | Local schema |

## 207 Kernel Catalog

`kernel-catalog.json`에는 다음 필드를 가진 207개 항목이 들어 있습니다.

```json
{
  "index": 44,
  "id": "webgpu-kernels/ai.onnx.Add",
  "namespace": "ai.onnx",
  "operation": "Add",
  "platform": "WebGPU",
  "category": "math",
  "kernel_contract_version": 1,
  "hub_url": "https://huggingface.co/kernels/webgpu-kernels/ai.onnx.Add"
}
```

`namespace` 분포는 현재 스냅샷 기준 `ai.onnx` 175개, `com.microsoft` 32개입니다. 목록은 2026-09-07에 Hugging Face 공개 조직 페이지와 대조했습니다.

## Reference Benchmark 데이터

`reference-benchmarks.json`은 Hugging Face의 2026-09-01 공개 글에 나온 비교 수치만 기록합니다. 해당 글의 방법론은 **GPU work timing**이며 kernel loading, session creation, upload, shader compilation, readback 같은 setup 비용을 제외합니다.

LocalWebAI Lab의 기본 CPU vs WebGPU 화면은 브라우저에서 호출이 끝날 때까지의 end-to-end 경로를 측정하므로 이 수치와 직접 동일 비교하지 않습니다.

## WebAI Ready Score

점수는 공식 표준이 아니라 이 프로젝트의 진단 휴리스틱입니다. `readiness-rubric.json`의 점수 합은 정확히 100점이며 `site/js/readiness.js` 구현과 일치합니다.

- WebGPU API: 45
- Adapter: 15
- Device: 10
- shader-f16: 5
- max buffer ≥ 256 MiB: 10
- max workgroups ≥ 65,535: 8
- Hugging Face loader: 4
- kernel 실행 확인: 3

## 사용자 실측 데이터

Benchmark 실행 결과는 다음 구조로 브라우저 LocalStorage에 최대 20개 저장됩니다.

```json
{
  "createdAt": "2026-09-07T00:00:00.000Z",
  "rows": 1024,
  "cols": 1024,
  "warmup": 2,
  "iterations": 5,
  "cpuMs": 12.34,
  "gpuMs": 2.51,
  "speedup": 4.91,
  "score": 100,
  "engine": "Hugging Face @huggingface/kernels",
  "kernel": "webgpu-kernels/ai.onnx.Add"
}
```

UI의 **JSON 내보내기** 기능으로 이 기록을 파일로 저장할 수 있습니다.

## 데이터 수정 후 검증

```bash
npm run build
npm run check
```

`npm run check`는 다음을 자동 검증합니다.

- 데이터 JSON parse 가능 여부
- kernel 항목이 정확히 207개인지
- kernel ID 중복 여부
- `ai.onnx` / `com.microsoft` namespace 합계
- WebAI Ready rubric 점수 합이 100인지
- manifest가 참조하는 모든 파일이 실제로 존재하는지
- 필수 GitHub Pages/PWA asset 존재 여부
