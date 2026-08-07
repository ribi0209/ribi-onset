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
    // 구형 폴백
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url;
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

/** 숨은 input 하나로 카메라/갤러리 모두 처리 */
export function pickFiles({ multiple = false, capture = false } = {}){
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    if (multiple) inp.multiple = true;
    if (capture) inp.setAttribute('capture', 'environment');
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
