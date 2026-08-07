# Tesseract OCR 엔진 (오프라인 번들)

카메라 모니터 사진 판독용. `js/ocr.js` 가 첫 사용 시에만 불러온다.
앱 첫 로딩을 무겁게 하지 않으려고 서비스워커 프리캐시(SHELL)에서는 제외했고,
한 번 사용하면 런타임 캐시에 들어가 그 뒤로는 오프라인에서도 동작한다.

| 파일 | 출처 | 용도 |
|---|---|---|
| tesseract.esm.min.js | tesseract.js@5 | 메인 모듈 |
| worker.min.js | tesseract.js@5 | 웹워커 |
| tesseract-core-simd-lstm.wasm.js | tesseract.js-core | WASM 코어 (SIMD 지원 기기) |
| tesseract-core-lstm.wasm.js | tesseract.js-core | WASM 코어 (SIMD 미지원 폴백) |
| eng.traineddata.gz | @tesseract.js-data/eng 4.0.0_best_int | 영문 인식 모델 |

모델은 표준(10.9MB) 대신 best_int(2.95MB)를 쓴다. 실제 모니터 사진으로 비교했을 때
판독 결과가 동일했다.
