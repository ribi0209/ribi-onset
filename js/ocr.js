/* =====================================================================
 * Ribi Onset — ocr.js
 * 카메라 모니터 사진에서 오버레이 정보를 읽어 테이크 필드로 변환한다.
 *
 * 방식
 *  - Tesseract 로 사진 전체를 한 번 읽고, 결과 텍스트를 정규식으로 파싱한다.
 *    고정 좌표로 자르지 않으므로 모니터를 비스듬히/부분적으로 찍어도 견딘다.
 *  - OCR 은 글자를 자주 헷갈린다 (FPS→FP$/FP5, TC→Tc, O↔0, I↔1).
 *    → 정규식에 흔한 오인식을 미리 넣고, 값은 레퍼런스 목록에 스냅한다.
 *  - 절대 자동 저장하지 않는다. 읽은 값을 사용자가 확인·수정한 뒤 적용한다.
 *
 * 엔진 파일은 vendor/tesseract/ 에 들어 있고 첫 사용 시에만 불러온다.
 * (앱 첫 로딩을 무겁게 하지 않기 위해 서비스워커 프리캐시에서 제외)
 * ===================================================================== */

/**
 * 반드시 절대 URL 로 만든다.
 *  - 동적 import() 는 "이 모듈 파일(js/ocr.js)" 기준으로 상대경로를 푼다  → js/vendor/... (틀림)
 *  - tesseract 의 workerPath/corePath/langPath 는 "페이지 URL" 기준으로 푼다 → vendor/... (맞음)
 * 기준이 서로 달라서 상대경로를 쓰면 한쪽이 반드시 404 난다.
 */
const VENDOR = new URL('../vendor/tesseract/', import.meta.url).href;

let _worker = null;
let _loading = null;

function hasSimd(){
  try {
    return WebAssembly.validate(new Uint8Array([
      0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11
    ]));
  } catch { return false; }
}

/** 엔진 로드 (첫 호출에만 네트워크 필요, 이후 서비스워커 캐시) */
export function loadEngine(onProgress = () => {}){
  if (_worker) return Promise.resolve(_worker);
  if (_loading) return _loading;

  _loading = (async () => {
    onProgress('OCR 엔진 불러오는 중', 5);

    // 파일이 실제로 있는지 먼저 확인해 원인을 분명히 남긴다
    const probe = await fetch(VENDOR + 'tesseract.esm.min.js', { method:'GET' }).catch(() => null);
    if (!probe || !probe.ok){
      throw new Error(`엔진 파일을 찾을 수 없습니다 (${probe ? probe.status : '네트워크 오류'})\n${VENDOR}`);
    }

    const mod = await import(VENDOR + 'tesseract.esm.min.js');
    const createWorker = mod.createWorker || (mod.default && mod.default.createWorker);
    if (!createWorker) throw new Error('tesseract 모듈을 찾을 수 없습니다');

    const core = VENDOR + (hasSimd() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js');
    _worker = await createWorker('eng', 1, {
      workerPath: VENDOR + 'worker.min.js',
      corePath: core,
      langPath: VENDOR,
      gzip: true,
      cacheMethod: 'none',       // 자체 캐시 대신 서비스워커 캐시를 쓴다
      logger: (m) => {
        if (m.status === 'loading tesseract core')      onProgress('엔진 로딩', 20);
        else if (m.status === 'loading language traineddata') onProgress('언어 데이터 로딩', 45);
        else if (m.status === 'initializing api')       onProgress('초기화', 70);
        else if (m.status === 'recognizing text')       onProgress('사진 판독 중', 70 + m.progress * 28);
      },
    });
    return _worker;
  })();

  _loading.catch(() => { _loading = null; });
  return _loading;
}

export function isEngineReady(){ return !!_worker; }

/** 모니터 사진 → { text, fields } */
export async function readMonitor(source, onProgress = () => {}){
  const w = await loadEngine(onProgress);
  onProgress('사진 판독 중', 72);
  const { data } = await w.recognize(source);
  return { text: data.text, confidence: data.confidence, fields: parseMonitor(data.text) };
}

/* ---------------- 파서 ---------------- */

/** OCR 이 흔히 헷갈리는 글자를 정리 */
function tidy(s){
  return String(s || '')
    .replace(/[｜|]/g, ' ')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ');
}

/** 값이 레퍼런스 목록에 있으면 그 표기로 맞춘다 */
function snap(value, list, normalize = (x) => x){
  if (!value || !Array.isArray(list)) return value;
  const target = normalize(value);
  for (const o of list) if (normalize(o) === target) return o;
  return value;
}
const numOf = (x) => {
  const m = String(x).match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
};
const sameNum = (a, b) => {
  const na = numOf(a), nb = numOf(b);
  return Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) < 0.005;
};
function snapNum(value, list){
  if (!value || !Array.isArray(list)) return value;
  for (const o of list) if (sameNum(o, value)) return o;
  return value;
}

/**
 * @param {string} raw   OCR 원문
 * @param {object} refs  { fps, shutters, tStops, isoEi, whiteBalance, ndFilters, focalLengths } (선택)
 * @returns {object}     테이크 필드 후보 + 원문 스니펫
 */
export function parseMonitor(raw, refs = {}){
  const t = tidy(raw);
  const out = {};

  // FPS — FPS / FP$ / FP5 / FPs 오인식 허용
  let m = t.match(/F\s?P\s?[S$5s]\s*[:=]?\s*(\d{1,3}(?:[.,]\d{1,3})?)/i);
  if (m) out.fps = snapNum(m[1].replace(',', '.'), refs.fps);

  // SHUTTER — 각도(180.0) 또는 1/48 같은 초 단위
  m = t.match(/SH?U?T?T?E?R\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)\s*°?/i);
  if (m && /SHUT/i.test(t)) out.shutter = snapNum(m[1], refs.shutters) || m[1] + '°';
  if (out.shutter && /^\d/.test(out.shutter) && !/[°/]/.test(out.shutter)) out.shutter += '°';

  // IRIS / T-STOP
  m = t.match(/(?:IRIS|IRIB|1RIS)\s*[:=]?\s*T?\s*(\d{1,2}(?:\.\d)?)/i);
  if (m) out.iris = snap('T' + m[1], refs.tStops, s => s.toUpperCase().replace(/\s/g,''));

  // EI / ISO
  m = t.match(/\bE\s?[I1l]\s*[:=]?\s*(\d{2,5})/i) || t.match(/\bISO\s*[:=]?\s*(\d{2,5})/i);
  if (m) out.ei = snap('EI ' + m[1], refs.isoEi, s => s.toUpperCase().replace(/\s/g,''));

  // ND — 숫자 또는 '-'(없음)
  m = t.match(/\bND\s*[:=]?\s*(\d\.\d{1,2}|\d{1,2}|-)/i);
  if (m) out.nd = m[1] === '-' ? '-' : snap('ND' + m[1], refs.ndFilters, s => s.toUpperCase().replace(/\s/g,''));

  // WB — 4300K / 4300 K
  m = t.match(/\bW\s?B\s*[:=]?\s*(\d{3,5})\s*[KX]?/i);
  if (m) out.wb = snap(m[1] + 'K', refs.whiteBalance, s => s.toUpperCase().replace(/\s/g,''));

  // CC (색보정 축)
  m = t.match(/([+-]\s?\d{1,2}(?:\.\d)?)\s*CC/i);
  if (m) out.cc = m[1].replace(/\s/g,'');

  // 캠 롤 + 클립 — A027 C006 / A027C006
  m = t.match(/\b([A-Z])\s?(\d{3,4})\s*[- ]?\s*([CcOo0])\s?(\d{3,4})\b/);
  if (m){
    out.camRoll = (m[1] + m[2]).toUpperCase();
    out.clip = 'C' + m[4];
  } else {
    const r = t.match(/\b([A-Z]\d{3,4})\b(?!\s*[KVv])/);
    if (r) out.camRoll = r[1].toUpperCase();
    const c = t.match(/\bC\s?(\d{3,4})\b/i);
    if (c) out.clip = 'C' + c[1];
  }

  // 타임코드 — TC 12:14:01:20 / Tc12:14:01;20
  m = t.match(/\bT\s?[Cc]\s*[:=]?\s*(\d{2}\s?:\s?\d{2}\s?:\s?\d{2}\s?[:;]\s?\d{2})/)
   || t.match(/\b(\d{2}:\d{2}:\d{2}[:;]\d{2})\b/);
  if (m) out.tc = m[1].replace(/\s/g,'').replace(/;/g, ':');

  // 렌즈 초점거리 — ARRI 는 하단에 'FCL 75.0mm' 로 뜬다 (렌즈 없으면 'FCL -')
  // 소수점이 붙으므로 \d{2,3}mm 만으로는 잡히지 않는다
  m = t.match(/\bF\s?C\s?[LI1]\s*[:=]?\s*(\d{1,3})(?:\.\d+)?\s*m\s?m\b/i)
   || t.match(/\b(\d{1,3})(?:\.\d+)?\s?m\s?m\b/i);
  if (m) out.lens = snap(m[1] + 'mm', refs.focalLengths, s => s.toLowerCase().replace(/\s/g,''));

  return out;
}

/** 화면에 보여줄 라벨 */
export const OCR_LABELS = {
  camRoll:'캠 롤', clip:'클립', tc:'TC', fps:'FPS', shutter:'셔터',
  iris:'IRIS', ei:'EI', nd:'ND', wb:'WB', cc:'CC', lens:'렌즈',
};

/** 테이크 레코드에 실제로 넣을 키만 추림 (cc 는 노트로 간다) */
export const TAKE_KEYS = ['camRoll','clip','tc','fps','shutter','iris','ei','nd','wb','lens'];

export async function terminate(){
  if (_worker){ try { await _worker.terminate(); } catch {} _worker = null; _loading = null; }
}
