# PMT Onset — 촬영 현장 매니지먼트 툴

로컬 우선(local-first) PWA. 서버 없음, 계정 없음, 오프라인 100% 동작.
데이터는 기기 IndexedDB 에 저장되고 JSON 으로 내보내기/가져오기 한다.

---

## 1. 배포 (GitHub Pages)

1. GitHub 에서 새 저장소 생성 — 이름 예: `pmt-onset` (Public)
2. 이 폴더의 **내용물 전체**를 저장소 루트에 업로드
   (웹 UI: `Add file → Upload files` 에 폴더째 드래그)
3. `Settings → Pages → Build and deployment`
   - Source: **Deploy from a branch**
   - Branch: **main / (root)** → Save
4. 1~2분 후 주소 생성: `https://<계정>.github.io/pmt-onset/`

### 갤럭시탭 설치
Chrome 으로 위 주소 접속 → 우상단 ⋮ → **홈 화면에 추가**
→ 주소창 없는 앱으로 실행되고, 기내모드에서도 열린다.

첫 실행 시 `백업 → 영구 저장 요청` 을 한 번 눌러라.
브라우저가 저장공간 부족 시 데이터를 임의 삭제하는 것을 막는다.

---

## 2. 기존 데이터 이전

`백업` 탭 → **덮어쓰기 가져오기** → `PMT_온셋_전체백업_2026-08-06.json` 선택.

기존 백업(v3)의 project / references / locations / cameras / assets / **cuts** 를
필드·이미지 바이트까지 손실 없이 읽는다. (테스트로 검증됨)

이때 **기록 단위는 컷 → 씬으로 이관**된다:

| 구 백업 | 현 스키마 |
|---|---|
| `cuts[]` 배열 | `scenes[]` 스토어로 이관 (ID·필드·이미지 그대로) |
| `cut` 필드 | 제거 |
| `pDay` 필드 / `pDays` 레퍼런스 | 제거 |
| `cuts` 레퍼런스(컷 번호) | 제거 |
| `assets.linkedCutIds` | `linkedSceneIds` 로 이관 |

이미 이 앱 v1(컷 단위)로 기록한 데이터가 태블릿에 있다면, 앱을 열기만 하면
IndexedDB 업그레이드로 자동 이관된다(별도 조작 없음).

---

## 3. 구조

```
index.html              앱 셸
css/app.css             전체 스타일 (다크 / 야외 고대비 2모드)
js/schema.js            ★ 엔티티·필드·드롭다운 전부 여기서 선언
js/db.js                IndexedDB + 백업 import/export
js/media.js             카메라 촬영 → 리사이즈/압축 → 저장
js/ui.js                DOM 헬퍼 + 스키마 기반 폼 렌더러
js/views.js             리스트/에디터/대시보드/레퍼런스/백업 화면
js/export.js            CSV / VFX 브레이크다운 / PDF 인쇄
sw.js                   오프라인 캐시 (수정 시 CACHE 버전 올릴 것)
test/                   자동 검증 스크립트
```

### 수정 지점 (중요)

거의 모든 요구사항 변경은 **`js/schema.js` 한 파일**에서 끝난다.

- 필드 추가 → 해당 엔티티 `groups[].fields[]` 에 한 줄 추가
- 드롭다운 항목 변경 → `DEFAULT_REFS` (또는 앱 안 `레퍼런스` 탭에서 바로 편집)
- 리스트에 보이는 컬럼 → `listCols`
- CSV 컬럼/순서 → `csvCols`
- 새 씬 만들 때 직전 값 상속할 필드 → `inherit`
- 필터 드롭다운 → `filters`

필드 타입: `text` `textarea` `date` `time` `combo` `select` `photo` `photos(n)` `link`

새 엔티티(탭)를 통째로 추가하려면 `ENTITIES` 에 항목 추가 + `ENTITY_ORDER` 에 키 추가 +
`js/db.js` 의 `RECORD_STORES` 에 스토어명 추가 + `DB_VER` 를 1 올리면 된다.
기존 사용자 데이터가 있는 상태에서 스토어/필드명을 바꿀 때는 `db.js` 의
`onupgradeneeded` 마이그레이션 블록과 `LEGACY_FIELD` / `DROPPED_FIELD` 를 함께 갱신할 것.

---

## 4. 현장 입력 동작

- 기록 단위는 **씬**이다. 한 레코드 = 한 씬.
- `+ 새 씬` → 직전 씬의 EP/씬번호/유닛/INT-EXT/시간대/로케이션/벤더/상태를 상속하고
  촬영일·시각을 자동 기록, ID 는 `PMT-YYYYMMDD-HHMMSS-XXXX` 규칙으로 생성
- `📷 촬영 + 등록` → 카메라 바로 열림, 촬영 즉시 압축 후 새 씬 생성
- 모든 입력은 **0.5초 자동 저장** (저장 버튼 없음, ID 옆 점이 초록으로 깜빡임)
- 콤보 박스에 목록에 없는 값을 입력하면 레퍼런스에 자동 편입
- 이미지는 대표 1280px / 현장 1920px / 플레이트·HDRI 2560px 로 JPEG 재압축
  (원본 3MB → 통상 100~300KB)

## 5. 내보내기

| 버튼 | 결과 |
|---|---|
| CSV | 현재 필터 결과, UTF-8 BOM (엑셀에서 한글 정상) |
| 브레이크다운 | 썸네일 + VFX 정보 카드 시트 → 인쇄 대화상자에서 **PDF로 저장** |
| PDF 인쇄 | 표 형태 리스트 → 동일하게 PDF 저장 |
| 전체 백업 | 이미지 포함 JSON (기존 v3 호환) |
| 경량 백업 | 이미지 제외 JSON — 메신저로 넘기기 좋은 크기 |

---

## 6. 검증 스크립트

```bash
cd test
npm install
PMT_BACKUP=/경로/PMT_온셋_전체백업_2026-08-06.json npm test
```

- `data-roundtrip.test.mjs` — 실제 백업 import → 레코드/필드/이미지 바이트 무손실,
  cuts→scenes 이관, 폐기 필드 제거, export 라운드트립, merge 중복 방지, 미디어 누수 검사
- `ui-render.test.mjs` — jsdom 으로 전 화면 렌더, 자동저장, 값 상속,
  CSV/브레이크다운 출력, 런타임 에러 0건 확인
- `db-migration.test.mjs` — v1(컷 스토어) DB 를 만들어 놓고 앱 코드로 열어
  v2(씬 스토어) 자동 업그레이드가 데이터 손실 없이 되는지 확인

---

## 7. 한계 (알고 쓸 것)

- 데이터는 **이 기기에만** 있다. 여러 명이 동시에 기록하려면 각자 기록 후
  경량/전체 백업 JSON 을 병합 가져오기 해야 한다 (동일 ID 는 덮어씀).
- iOS Safari 는 IndexedDB 용량 정책이 달라 대용량에서 불리하다. 갤럭시탭 Chrome 권장.
- 코드를 수정한 뒤에는 `sw.js` 의 `CACHE = 'pmt-onset-v2'` 숫자를 올려야
  태블릿이 캐시된 구버전 대신 새 버전을 받는다.
