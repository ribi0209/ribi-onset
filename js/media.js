/* =====================================================================
 * Ribi Onset — media.js
 * 촬영/선택한 이미지를 현장용으로 압축해 media 스토어에 넣는다.
 * EXIF 회전은 createImageBitmap(imageOrientation:'from-image') 으로 처리 (Chrome/Android).
 * ===================================================================== */

import { putMedia } from './db.js';

export const PRESETS = {
  thumb: { maxEdge: 1280, quality: 0.70 },   // 대표 이미지
  photo: { maxEdge: 1920, quality: 0.78 },   // 현장 사진 / 서베이
  plate: { maxEdge: 2560, quality: 0.85 },   // 플레이트 / HDRI 소스
};

async function loadBitmap(file){
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    // 구형 폴백. 여기서 실패할 때 이벤트 객체로 거부하면 e.message 가 undefined 라
    // 화면에 "실패: undefined" 만 뜨고 원인을 알 수 없다 → 반드시 Error 로 던진다.
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload  = () => res(i);
        i.onerror = () => rej(new Error(`이미지를 읽지 못했습니다 (형식: ${file.type || '알 수 없음'})`));
        i.src = url;
      });
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}

/** File/Blob → 압축 Blob */
export async function compress(file, preset = 'photo'){
  const { maxEdge, quality } = PRESETS[preset] || PRESETS.photo;
  const bmp = await loadBitmap(file);
  const w0 = bmp.width, h0 = bmp.height;
  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();

  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
  return { blob, width: w, height: h, originalBytes: file.size || blob.size };
}

/**
 * 화면에 보이는 좌표(축소된 이미지 기준)를 원본 픽셀 좌표로 옮긴다.
 * 이미지가 화면에 맞춰 줄어든 상태로 드래그하므로, 이 변환을 빠뜨리면
 * 엉뚱한 데가 잘린다. 경계를 벗어나지 않게 잘라 맞춘다.
 */
export function mapCropRect(rect, dispW, dispH, natW, natH){
  if (!dispW || !dispH) return { x:0, y:0, w:natW, h:natH };
  const sx = natW / dispW, sy = natH / dispH;
  let x = Math.round(rect.x * sx);
  let y = Math.round(rect.y * sy);
  let w = Math.round(rect.w * sx);
  let h = Math.round(rect.h * sy);
  x = Math.max(0, Math.min(x, natW - 1));
  y = Math.max(0, Math.min(y, natH - 1));
  w = Math.max(1, Math.min(w, natW - x));
  h = Math.max(1, Math.min(h, natH - y));
  return { x, y, w, h };
}

/**
 * 자르기 화면에 **이미 떠 있는 <img>** 에서 지정 영역만 떼어낸다.
 *
 * 블롭을 다시 디코드하지 않는 게 핵심이다.
 *  - 화면에 보였다는 건 브라우저가 이미 디코드했다는 뜻이다. 한 번 더 할 이유가 없다
 *  - createImageBitmap 이 실패하면 폴백까지 줄줄이 실패해 원인 없는 오류가 났었다
 *  - 12MP 사진을 두 번 디코드하지 않으니 태블릿에서 더 빠르고 메모리도 덜 쓴다
 * EXIF 회전은 <img> 가 이미 반영한 상태라 naturalWidth/Height 와 drawImage 가 서로 맞는다.
 */
export async function cropFromImage(imgEl, rect, dispW, dispH, quality = 0.92){
  const natW = imgEl && (imgEl.naturalWidth || imgEl.width);
  const natH = imgEl && (imgEl.naturalHeight || imgEl.height);
  if (!natW || !natH) throw new Error('이미지가 아직 다 열리지 않았습니다. 잠시 뒤 다시 시도하세요.');

  const r = mapCropRect(rect, dispW || natW, dispH || natH, natW, natH);
  const canvas = document.createElement('canvas');
  canvas.width = r.w; canvas.height = r.h;
  const ctx = canvas.getContext('2d', { alpha:false });
  if (!ctx) throw new Error('캔버스를 만들지 못했습니다');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imgEl, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);

  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error(`잘라낸 이미지를 만들지 못했습니다 (${r.w}×${r.h})`);
  return blob;
}

/** File → media 스토어 저장 후 레코드에 넣을 참조 반환 */
export async function ingest(file, preset = 'photo'){
  const { blob, width, height, originalBytes } = await compress(file, preset);
  return putMedia(blob, { name: file.name || 'capture.jpg', width, height, originalBytes });
}

/** 여러 장 순차 처리 (동시 처리 시 태블릿에서 메모리 스파이크) */
export async function ingestMany(files, preset = 'photo', onEach = () => {}){
  const out = [];
  for (let i = 0; i < files.length; i++){
    out.push(await ingest(files[i], preset));
    onEach(i + 1, files.length);
  }
  return out;
}

/**
 * 기기 갤러리/파일에서 사진을 고른다.
 *
 * 앱 안에서 카메라를 여는 capture 속성은 쓰지 않는다.
 * 그렇게 찍으면 사진이 앱으로만 전달되고 기기 갤러리에는 남지 않기 때문이다.
 * 촬영은 태블릿 기본 카메라로 하고(= 갤러리에 정상 저장), 여기서는 그걸 불러오기만 한다.
 */
export function pickFiles({ multiple = false } = {}){
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    if (multiple) inp.multiple = true;
    inp.style.position = 'fixed'; inp.style.left = '-9999px';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      const files = Array.from(inp.files || []);
      inp.remove();
      res(files);
    }, { once: true });
    // 취소 감지 (Android Chrome 은 change 가 안 옴)
    window.addEventListener('focus', () => {
      setTimeout(() => { if (document.body.contains(inp) && !(inp.files||[]).length){ inp.remove(); res([]); } }, 800);
    }, { once: true });
    inp.click();
  });
}

export function fmtBytes(n){
  if (!n) return '0 B';
  const u = ['B','KB','MB','GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
}
