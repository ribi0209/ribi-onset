/* =====================================================================
 * PMT Onset — db.js
 * IndexedDB 데이터 레이어.
 *
 * 설계 핵심
 *  - 이미지는 레코드 안에 base64 로 넣지 않고 media 스토어에 Blob 으로 분리 저장.
 *    레코드에는 {mid,name,width,height,bytes} 참조만 들어간다.
 *    → 수백 컷 × 다중 사진에서도 메모리/직렬화 비용이 터지지 않음.
 *  - 내보내기 시에만 Blob → dataURL 로 펼쳐서 백업 v3 포맷과 100% 호환되게 만든다.
 *  - 가져오기는 v3(dataUrl 내장) / v4(이 앱 포맷) 둘 다 받는다.
 * ===================================================================== */

import { DEFAULT_REFS, ENTITIES } from './schema.js';

export const DB_NAME = 'pmt-onset';
export const DB_VER  = 2;
export const APP_ID  = 'PMT Onset Offline';
export const APP_VER = 5;

const RECORD_STORES = ['scenes','locations','cameras','assets','hdri'];

/** 구 백업(v3, 기록 단위 = 컷) → 현 스키마(기록 단위 = 씬) 매핑 */
const LEGACY_STORE = { cuts: 'scenes' };
const LEGACY_FIELD = { linkedCutIds: 'linkedSceneIds', linkedCut: 'linkedScene' };
const DROPPED_FIELD = ['cut', 'pDay'];

let _db = null;

export function open(){
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const t  = e.target.transaction;
      if (!db.objectStoreNames.contains('kv'))    db.createObjectStore('kv', { keyPath:'key' });
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath:'mid' });
      for (const s of RECORD_STORES){
        if (!db.objectStoreNames.contains(s)){
          const os = db.createObjectStore(s, { keyPath:'id' });
          os.createIndex('updatedAt','updatedAt');
        }
      }
      // v1(컷 단위) → v2(씬 단위) 마이그레이션: 기존 레코드를 옮기고 폐기 필드 정리
      if (db.objectStoreNames.contains('cuts')){
        const src = t.objectStore('cuts');
        const dst = t.objectStore('scenes');
        src.getAll().onsuccess = (ev) => {
          for (const r of (ev.target.result || [])) dst.put(migrateRecord(r));
          db.deleteObjectStore('cuts');
        };
        // 연결 필드명도 함께 이관 (assets.linkedCutIds, hdri.linkedCut)
        for (const s of ['assets','hdri']){
          const os = t.objectStore(s);
          os.getAll().onsuccess = (ev) => {
            for (const r of (ev.target.result || []))
              if (Object.keys(LEGACY_FIELD).some(k => k in r)) os.put(migrateRecord(r));
          };
        }
      }
    };
    req.onsuccess = () => { _db = req.result; res(_db); };
    req.onerror   = () => rej(req.error);
  });
}

/** 레거시 레코드를 현 스키마로 정규화 (폐기 필드 제거 + 필드명 이관) */
function migrateRecord(rec){
  const o = {};
  for (const [k,v] of Object.entries(rec)){
    if (DROPPED_FIELD.includes(k)) continue;
    o[LEGACY_FIELD[k] || k] = v;
  }
  return o;
}

function tx(stores, mode='readonly'){
  return _db.transaction(stores, mode);
}
function wrap(req){
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

/* ---------------- 기본 CRUD ---------------- */

export async function list(store){
  await open();
  const rows = await wrap(tx([store]).objectStore(store).getAll());
  return rows;
}
export async function get(store, id){
  await open();
  return wrap(tx([store]).objectStore(store).get(id));
}
export async function put(store, rec){
  await open();
  rec.updatedAt = new Date().toISOString();
  if (!rec.createdAt) rec.createdAt = rec.updatedAt;
  const t = tx([store],'readwrite');
  await wrap(t.objectStore(store).put(rec));
  return rec;
}
export async function bulkPut(store, recs){
  await open();
  const t = tx([store],'readwrite');
  const os = t.objectStore(store);
  for (const r of recs) os.put(r);
  return new Promise((res,rej)=>{ t.oncomplete=()=>res(recs.length); t.onerror=()=>rej(t.error); });
}
export async function del(store, id){
  await open();
  const rec = await get(store, id);
  if (rec) await releaseMediaOf(rec);
  const t = tx([store],'readwrite');
  await wrap(t.objectStore(store).delete(id));
}
export async function clearStore(store){
  await open();
  const t = tx([store],'readwrite');
  await wrap(t.objectStore(store).clear());
}

/* ---------------- kv (프로젝트 / 레퍼런스) ---------------- */

export async function getKV(key, fallback){
  await open();
  const r = await wrap(tx(['kv']).objectStore('kv').get(key));
  return r ? r.value : fallback;
}
export async function setKV(key, value){
  await open();
  const t = tx(['kv'],'readwrite');
  await wrap(t.objectStore('kv').put({ key, value }));
  return value;
}

export const DEFAULT_PROJECT = {
  key:'project', name:'', type:'', poster:null,
  crankIn:'', crankUp:'', productionCompany:'', distributor:'', deliveryDate:'',
  mainSchedule:'', director:'', cinematographer:'', productionDesigner:'',
  gaffer:'', producer:'', assistantDirector:'', bDirector:'',
  deliveryResolution:'', deliveryAspect:'', deliveryFps:'', deliveryColorSpace:'',
  deliveryBitDepth:'', deliveryCodec:'', deliveryContainer:'', deliveryAudio:'',
  deliveryHandles:'', deliveryNaming:'', deliveryNotes:'',
};

export async function getProject(){
  return Object.assign({}, DEFAULT_PROJECT, await getKV('project', {}));
}
export async function setProject(p){ return setKV('project', p); }

export async function getRefs(){
  const saved = await getKV('references', null);
  const out = {};
  for (const k of Object.keys(DEFAULT_REFS)) out[k] = (saved && saved[k]) ? saved[k].slice() : DEFAULT_REFS[k].slice();
  if (saved) for (const k of Object.keys(saved)) if (!out[k]) out[k] = saved[k].slice();
  return out;
}
export async function setRefs(r){ return setKV('references', r); }

/** 콤보에 새 값이 입력되면 레퍼런스에 자동 편입 */
export async function pushRef(refKey, value){
  if (!refKey || !value) return;
  const refs = await getRefs();
  if (!refs[refKey]) refs[refKey] = [];
  if (!refs[refKey].includes(value)){
    refs[refKey].push(value);
    await setRefs(refs);
    return true;
  }
  return false;
}

/* ---------------- media ---------------- */

const _urlCache = new Map();

export function newMid(){
  return 'M-' + Date.now().toString(36).toUpperCase() + '-' +
         Math.random().toString(36).slice(2,8).toUpperCase();
}

export async function putMedia(blob, meta = {}){
  await open();
  const mid = meta.mid || newMid();
  const rec = {
    mid, blob,
    name: meta.name || 'image.jpg',
    width: meta.width || 0,
    height: meta.height || 0,
    originalBytes: meta.originalBytes || blob.size,
    compressedBytes: blob.size,
    createdAt: new Date().toISOString(),
  };
  const t = tx(['media'],'readwrite');
  await wrap(t.objectStore('media').put(rec));
  return {
    mid, name: rec.name, width: rec.width, height: rec.height,
    originalBytes: rec.originalBytes, compressedBytes: rec.compressedBytes,
  };
}

export async function getMedia(mid){
  await open();
  return wrap(tx(['media']).objectStore('media').get(mid));
}

export async function mediaURL(mid){
  if (!mid) return null;
  if (_urlCache.has(mid)) return _urlCache.get(mid);
  const m = await getMedia(mid);
  if (!m || !m.blob) return null;
  const url = URL.createObjectURL(m.blob);
  _urlCache.set(mid, url);
  return url;
}

export async function delMedia(mid){
  if (!mid) return;
  await open();
  if (_urlCache.has(mid)){ URL.revokeObjectURL(_urlCache.get(mid)); _urlCache.delete(mid); }
  const t = tx(['media'],'readwrite');
  await wrap(t.objectStore('media').delete(mid));
}

/** 레코드에서 참조하는 모든 mid 수집 */
export function midsOf(rec){
  const out = [];
  const scan = (v) => {
    if (!v) return;
    if (Array.isArray(v)) { v.forEach(scan); return; }
    if (typeof v === 'object'){ if (v.mid) out.push(v.mid); else Object.values(v).forEach(scan); }
  };
  Object.values(rec || {}).forEach(scan);
  return out;
}
async function releaseMediaOf(rec){
  for (const mid of midsOf(rec)) await delMedia(mid);
}

/** 어떤 레코드에서도 참조되지 않는 media 정리 */
export async function gcMedia(){
  await open();
  const used = new Set();
  for (const s of RECORD_STORES) (await list(s)).forEach(r => midsOf(r).forEach(m => used.add(m)));
  midsOf(await getProject()).forEach(m => used.add(m));
  const all = await wrap(tx(['media']).objectStore('media').getAllKeys());
  let n = 0;
  for (const mid of all) if (!used.has(mid)){ await delMedia(mid); n++; }
  return n;
}

/* ---------------- ID 생성 ---------------- */

function rand4(){ return Math.random().toString(16).slice(2,6).toUpperCase(); }
function pad(n){ return String(n).padStart(2,'0'); }

export function makeSceneId(projectName){
  const abbr = (projectName || 'PMT').replace(/[^A-Za-z0-9가-힣]/g,'').slice(0,3).toUpperCase() || 'PMT';
  const d = new Date();
  return `${abbr}-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-` +
         `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${rand4()}`;
}
export function makeId(prefix){
  return `${prefix}-${(Date.now().toString(16)+rand4()).slice(-8).toUpperCase()}`;
}

/* ---------------- dataURL <-> Blob ---------------- */

export function dataUrlToBlob(dataUrl){
  const [head, b64] = dataUrl.split(',');
  const mime = (head.match(/data:([^;]+)/) || [,'image/jpeg'])[1];
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}
export function blobToDataUrl(blob){
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}

/* ---------------- 백업 export ---------------- */

/** 레코드 안의 {mid,...} 를 {dataUrl,...} 로 펼친다 (백업 v3 호환) */
async function inflate(v){
  if (!v) return v;
  if (Array.isArray(v)) return Promise.all(v.map(inflate));
  if (typeof v === 'object'){
    if (v.mid){
      const m = await getMedia(v.mid);
      if (!m) return null;
      return {
        dataUrl: await blobToDataUrl(m.blob),
        name: m.name, originalBytes: m.originalBytes,
        compressedBytes: m.compressedBytes, width: m.width, height: m.height,
      };
    }
    if (v.dataUrl) return v;
    const o = {}; for (const [k,val] of Object.entries(v)) o[k] = await inflate(val);
    return o;
  }
  return v;
}

async function inflateRec(rec){
  const o = {};
  for (const [k,v] of Object.entries(rec)) o[k] = await inflate(v);
  return o;
}

/**
 * @param {boolean} withMedia  false 면 이미지를 제외한 경량 백업
 */
export async function exportBackup(withMedia = true){
  await open();
  const project = await getProject();
  const out = {
    app: APP_ID,
    version: 3,                 // 기존 백업과 상호 호환되는 버전 태그
    appVersion: APP_VER,
    exportedAt: new Date().toISOString(),
    project: withMedia ? await inflateRec(project) : stripMedia(project),
    references: await getRefs(),
    locations: [], cameras: [], assets: [], scenes: [], hdri: [],
  };
  for (const s of RECORD_STORES){
    const rows = await list(s);
    out[s] = withMedia ? await Promise.all(rows.map(inflateRec)) : rows.map(stripMedia);
  }
  return out;
}

function stripMedia(rec){
  const o = {};
  for (const [k,v] of Object.entries(rec)){
    if (v && typeof v === 'object' && v.mid) { o[k] = null; continue; }
    if (Array.isArray(v) && v.some(x => x && x.mid)) { o[k] = v.map(x => (x && x.mid) ? null : x); continue; }
    o[k] = v;
  }
  return o;
}

/* ---------------- 백업 import ---------------- */

/** {dataUrl,...} 를 media 스토어에 넣고 {mid,...} 참조로 접는다 */
async function deflate(v){
  if (!v) return v;
  if (Array.isArray(v)) return Promise.all(v.map(deflate));
  if (typeof v === 'object'){
    if (v.mid) return v;                       // 이미 접힌 형태
    if (v.dataUrl){
      const blob = dataUrlToBlob(v.dataUrl);
      return putMedia(blob, {
        name: v.name, width: v.width, height: v.height, originalBytes: v.originalBytes,
      });
    }
    const o = {}; for (const [k,val] of Object.entries(v)) o[k] = await deflate(val);
    return o;
  }
  return v;
}
async function deflateRec(rec){
  const o = {};
  for (const [k,v] of Object.entries(rec)) o[k] = await deflate(v);
  return o;
}

/**
 * @param {object} json  백업 JSON
 * @param {'replace'|'merge'} mode  replace = 전체 초기화 후 삽입
 * @param {(msg:string,pct:number)=>void} onProgress
 */
export async function importBackup(json, mode = 'replace', onProgress = () => {}){
  await open();
  if (!json || typeof json !== 'object') throw new Error('JSON 형식이 아닙니다.');

  if (mode === 'replace'){
    onProgress('기존 데이터 삭제 중', 2);
    for (const s of RECORD_STORES) await clearStore(s);
    await clearStore('media');
    _urlCache.forEach(u => URL.revokeObjectURL(u)); _urlCache.clear();
  }

  const stats = { project:0, references:0, media:0 };
  for (const s of RECORD_STORES) stats[s] = 0;

  if (json.references){
    const base = await getRefs();
    for (const [k,v] of Object.entries(json.references)){
      if (!Array.isArray(v)) continue;
      if (!(k in DEFAULT_REFS)) continue;          // 폐기된 목록(cuts, pDays 등)은 무시
      base[k] = mode === 'replace' ? v.slice() : Array.from(new Set([...(base[k]||[]), ...v]));
      stats.references++;
    }
    await setRefs(base);
  }
  onProgress('프로젝트 정보', 6);
  if (json.project){
    const p = await deflateRec(Object.assign({}, DEFAULT_PROJECT, json.project, { key:'project' }));
    await setProject(p);
    stats.project = 1;
  }

  // 구 백업은 기록 단위가 cuts 였다 → scenes 로 받는다
  const srcOf = (s) => {
    const legacy = Object.keys(LEGACY_STORE).find(k => LEGACY_STORE[k] === s);
    return json[s] || (legacy ? json[legacy] : null) || [];
  };
  const total = RECORD_STORES.reduce((a,s) => a + srcOf(s).length, 0) || 1;
  let done = 0;
  for (const s of RECORD_STORES){
    const rows = srcOf(s);
    for (const raw of rows){
      const rec = migrateRecord(await deflateRec(raw));
      if (!rec.id) rec.id = (s === 'scenes') ? makeSceneId(json?.project?.name) : makeId(ENTITIES[s].idPrefix || 'REC');
      if (!rec.createdAt) rec.createdAt = new Date().toISOString();
      rec.updatedAt = rec.updatedAt || rec.createdAt;
      const t = tx([s],'readwrite');
      await wrap(t.objectStore(s).put(rec));
      stats[s]++; done++;
      if (done % 5 === 0 || done === total) onProgress(`${ENTITIES[s]?.label || s} ${stats[s]}건`, 8 + Math.round(done/total*90));
    }
  }
  // 병합 시 덮어써진 레코드의 이전 이미지가 고아로 남으므로 정리
  if (mode === 'merge'){ onProgress('미사용 이미지 정리', 98); await gcMedia(); }
  stats.media = await wrap(tx(['media']).objectStore('media').count());
  onProgress('완료', 100);
  return stats;
}

/* ---------------- 저장소 사용량 ---------------- */
export async function storageInfo(){
  const out = { usage:0, quota:0, media:0, records:{} };
  if (navigator.storage && navigator.storage.estimate){
    const e = await navigator.storage.estimate();
    out.usage = e.usage || 0; out.quota = e.quota || 0;
  }
  await open();
  out.media = await wrap(tx(['media']).objectStore('media').count());
  for (const s of RECORD_STORES) out.records[s] = await wrap(tx([s]).objectStore(s).count());
  return out;
}

/** 브라우저가 데이터를 임의로 비우지 못하게 요청 (현장 필수) */
export async function requestPersist(){
  if (navigator.storage && navigator.storage.persist){
    if (await navigator.storage.persisted()) return true;
    return navigator.storage.persist();
  }
  return false;
}

export { RECORD_STORES };
