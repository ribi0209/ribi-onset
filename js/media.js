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

/** 원본 Blob 에서 지정 영역만 잘라낸 Blob 을 만든다 (원본은 건드리지 않는다) */
export async function cropBlob(source, rect, quality = 0.9){
  const bmp = await loadBitmap(source);
  const r = mapCropRect(rect, rect.dispW || bmp.width, rect.dispH || bmp.height, bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = r.w; canvas.height = r.h;
  const ctx = canvas.getContext('2d', { alpha:false });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  if (bmp.close) bmp.close();
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
  // ingest 가 파일명을 참조하므로 붙여 둔다
  try { blob.name = 'crop.jpg'; } catch {}
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

/* ---------------- 기기에 원본 남기기 ---------------- */

/**
 * 웹 앱은 기기 갤러리(DCIM)에 직접 쓸 수 없다.
 * capture 로 연 카메라는 사진을 임시 파일로 넘기고 끝나서 갤러리에 남지 않는다.
 * 그래서 촬영 원본을 다운로드로 한 벌 더 내려받아 둔다 —
 * 갤럭시탭 기준 Download 폴더에 들어가고 갤러리의 'Download' 앨범에 뜬다.
 */
const SAVE_KEY = 'ribi-save-device';
export function deviceSaveEnabled(){ return localStorage.getItem(SAVE_KEY) !== '0'; }
export function setDeviceSave(on){ localStorage.setItem(SAVE_KEY, on ? '1' : '0'); }

/** 파일명 — 나중에 찾을 수 있게 프로젝트·씬·캠을 붙인다 */
export function deviceFileName(parts = [], when = new Date()){
  const p = (n) => String(n).padStart(2,'0');
  const stamp = `${when.getFullYear()}${p(when.getMonth()+1)}${p(when.getDate())}`
              + `-${p(when.getHours())}${p(when.getMinutes())}${p(when.getSeconds())}`;
  const clean = parts
    .map(x => String(x || '').trim())
    .filter(Boolean)
    .map(x => x.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_'))
    .slice(0, 4);
  return ['Ribi', ...clean, stamp].join('_') + '.jpg';
}

/** 원본 파일을 기기에 저장. 실패해도 앱 기록에는 영향이 없다. */
export function saveToDevice(file, name){
  if (!file) return false;
  try {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = name || deviceFileName();
    a.style.position = 'fixed'; a.style.left = '-9999px';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 5000);
    return true;
  } catch { return false; }
}

export function fmtBytes(n){
  if (!n) return '0 B';
  const u = ['B','KB','MB','GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
}
