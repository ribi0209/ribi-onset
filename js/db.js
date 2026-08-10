/* =====================================================================
 * Ribi Onset — db.js
 * IndexedDB 데이터 레이어 (v3 — 멀티 프로젝트 + 씬/컷/테이크)
 *
 * 설계 핵심
 *  - 모든 기록 레코드는 projectId 를 가진다. 화면은 항상 "현재 프로젝트" 만 본다.
 *  - 이미지는 레코드에 base64 로 넣지 않고 media 스토어에 Blob 으로 분리 저장.
 *    레코드에는 {mid,name,width,height,bytes} 참조만 들어간다.
 *  - 내보내기 시에만 Blob → dataURL 로 펼쳐 백업 포맷(v3)과 호환되게 만든다.
 *  - 테이크는 컷 레코드 안의 takes[] 배열 (작고 항상 컷과 함께 읽힘).
 * ===================================================================== */

import { DEFAULT_REFS, ENTITIES, VFX_TYPE_MAP } from './schema.js';

export const DB_NAME = 'pmt-onset';   // 내부 스토리지 키. 바꾸면 기존 기록이 유실되므로 유지한다.
export const DB_VER  = 4;
export const APP_ID  = 'Ribi Onset Management';
export const APP_VER = 7;

/** 프로젝트에 종속되는 기록 스토어 */
const RECORD_STORES = ['scenes','cuts','locations','cameras','assets','hdri'];

const LEGACY_STORE  = { cuts: 'scenes' };                       // v3 백업의 cuts[] → scenes
const LEGACY_FIELD  = { linkedCutIds:'linkedSceneIds', linkedCut:'linkedScene' };
const DROPPED_FIELD = ['cut','pDay','project'];

let _db = null;

export function open(){
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => upgrade(e.target.result, e.target.transaction, e.oldVersion);
    req.onsuccess = () => { _db = req.result; res(_db); };
    req.onerror   = () => rej(req.error);
  });
}

/* ---------------- 스키마 업그레이드 ---------------- */

function upgrade(db, t, oldVersion){
  if (!db.objectStoreNames.contains('kv'))       db.createObjectStore('kv', { keyPath:'key' });
  if (!db.objectStoreNames.contains('media'))    db.createObjectStore('media', { keyPath:'mid' });
  if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath:'id' });
  for (const s of RECORD_STORES){
    if (!db.objectStoreNames.contains(s)){
      const os = db.createObjectStore(s, { keyPath:'id' });
      os.createIndex('updatedAt','updatedAt');
      os.createIndex('projectId','projectId');
    } else if (!t.objectStore(s).indexNames.contains('projectId')){
      t.objectStore(s).createIndex('projectId','projectId');
    }
  }

  /* v1(컷 스토어) → v2(씬 스토어) */
  if (db.objectStoreNames.contains('cutsLegacy')) db.deleteObjectStore('cutsLegacy');
  if (oldVersion > 0 && oldVersion < 2 && db.objectStoreNames.contains('cuts')){
    // v1 의 'cuts' 는 기록 단위였다 → scenes 로 옮기고 스토어를 비운다
    const src = t.objectStore('cuts'), dst = t.objectStore('scenes');
    src.getAll().onsuccess = (ev) => {
      for (const r of (ev.target.result || [])) dst.put(normalizeLegacy(r));
      src.clear();
    };
    for (const s of ['assets','hdri']){
      const os = t.objectStore(s);
      os.getAll().onsuccess = (ev) => {
        for (const r of (ev.target.result || []))
          if (Object.keys(LEGACY_FIELD).some(k => k in r)) os.put(normalizeLegacy(r));
      };
    }
  }

  /* v3 → v4 : 로케이션의 촬영장소를 대장소로 합치고, 폐기된 서베이 사진을 정리 */
  if (oldVersion > 0 && oldVersion < 4 && db.objectStoreNames.contains('locations')){
    const os = t.objectStore('locations');
    os.getAll().onsuccess = (ev) => {
      for (const r of (ev.target.result || [])){
        let dirty = false;
        if (r.shootLocation){
          if (!r.mainLocation) r.mainLocation = r.shootLocation;   // 값 보존
          delete r.shootLocation; dirty = true;
        }
        if ('surveyPhotos' in r){ delete r.surveyPhotos; dirty = true; }
        if ('model3d' in r){ delete r.model3d; dirty = true; }
        if ('seasonStart' in r || 'seasonEnd' in r){ delete r.seasonStart; delete r.seasonEnd; dirty = true; }
        if (dirty) os.put(r);
      }
    };
  }

  /* v2 → v3 : 단일 프로젝트를 projects 레코드로 승격하고 모든 기록에 projectId 부여 */
  if (oldVersion > 0 && oldVersion < 3){
    const kv = t.objectStore('kv');
    kv.get('project').onsuccess = (ev) => {
      const legacy = ev.target.result ? ev.target.result.value : null;
      const pid = 'PRJ-' + Date.now().toString(16).toUpperCase().slice(-8);
      const proj = Object.assign({}, DEFAULT_PROJECT, legacy || {}, {
        id: pid, key: undefined,
        name: (legacy && legacy.name) || '프로젝트 1',
        createdAt: new Date().toISOString(),
      });
      delete proj.key;
      t.objectStore('projects').put(proj);
      kv.put({ key:'currentProjectId', value: pid });

      for (const s of RECORD_STORES){
        const os = t.objectStore(s);
        os.getAll().onsuccess = (ev2) => {
          for (const r of (ev2.target.result || [])){
            const rec = normalizeLegacy(r);
            rec.projectId = pid;
            if (s === 'scenes'){
              // 씬에 붙어 있던 VFX 정보는 컷 1개로 분리한다
              const hasVfx = rec.vfxA || rec.vfxB || rec.workElement || rec.vendor || rec.filename;
              if (hasVfx){
                t.objectStore('cuts').put({
                  id: 'CUT-' + Math.random().toString(16).slice(2,10).toUpperCase(),
                  projectId: pid, sceneId: rec.id,
                  cutNo: '1',
                  vfxType: VFX_TYPE_MAP[rec.vfxA] || VFX_TYPE_MAP[rec.vfxB] || '',
                  workElement: rec.workElement || rec.vfxB || '',
                  vendor: rec.vendor || '',
                  vfxShotId: rec.filename || '',
                  shotNote: rec.shotNote || '', plateNote: '',
                  thumbnail: null, photos: [null,null,null], takes: [],
                  createdAt: rec.createdAt, updatedAt: rec.updatedAt,
                });
              }
              delete rec.vfxA; delete rec.vfxB; delete rec.workElement;
              delete rec.vendor; delete rec.filename; delete rec.penNote;
            }
            os.put(rec);
          }
        };
      }
    };
  }
}

/** 레거시 레코드 정규화 (폐기 필드 제거 + 필드명 이관) */
function normalizeLegacy(rec){
  const o = {};
  for (const [k,v] of Object.entries(rec)){
    if (DROPPED_FIELD.includes(k)) continue;
    o[LEGACY_FIELD[k] || k] = v;
  }
  return o;
}

function tx(stores, mode='readonly'){ return _db.transaction(stores, mode); }
function wrap(req){
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

/* ---------------- kv ---------------- */

export async function getKV(key, fallback){
  await open();
  const r = await wrap(tx(['kv']).objectStore('kv').get(key));
  return r ? r.value : fallback;
}
export async function setKV(key, value){
  await open();
  await wrap(tx(['kv'],'readwrite').objectStore('kv').put({ key, value }));
  return value;
}

/* ---------------- 프로젝트 ---------------- */

export const DEFAULT_PROJECT = {
  name:'', type:'드라마', poster:null, season:'', episodeCount:'',
  crankIn:'', crankUp:'', productionCompany:'', distributor:'', deliveryDate:'',
  mainSchedule:'', director:'', cinematographer:'', productionDesigner:'',
  gaffer:'', producer:'', assistantDirector:'', bDirector:'',
  vfxSupervisor:'', aiSupervisor:'', vfxAssist:'',
  deliveryResolution:'', deliveryAspect:'', deliveryFps:'', deliveryColorSpace:'',
  workColorSpace:'', onsetLut:'',
  deliveryBitDepth:'', deliveryCodec:'', deliveryContainer:'', deliveryAudio:'',
  deliveryHandles:'', deliveryNaming:'', deliveryNotes:'',
};

export async function listProjects(){
  await open();
  const rows = await wrap(tx(['projects']).objectStore('projects').getAll());
  return rows.sort((a,b) => (a.createdAt||'').localeCompare(b.createdAt||''));
}

export async function currentProjectId(){
  await open();
  let id = await getKV('currentProjectId', null);
  const all = await listProjects();
  if (!all.length){
    const p = await createProject({ name:'새 프로젝트' }, false);
    return p.id;
  }
  if (!id || !all.some(p => p.id === id)){
    id = all[0].id;
    await setKV('currentProjectId', id);
  }
  return id;
}

export async function setCurrentProject(id){ return setKV('currentProjectId', id); }

export async function getProject(id){
  await open();
  const pid = id || await currentProjectId();
  const p = await wrap(tx(['projects']).objectStore('projects').get(pid));
  return Object.assign({}, DEFAULT_PROJECT, p || {}, { id: pid });
}

export async function setProject(p){
  await open();
  p.updatedAt = new Date().toISOString();
  if (!p.createdAt) p.createdAt = p.updatedAt;
  await wrap(tx(['projects'],'readwrite').objectStore('projects').put(p));
  return p;
}

/**
 * 새 프로젝트 생성. 드롭다운 목록(레퍼런스)은 전역 공유이므로 별도 복사 없이 그대로 쓰인다.
 * @param {boolean} switchTo  생성 후 현재 프로젝트로 전환
 */
export async function createProject(base = {}, switchTo = true){
  await open();
  const id = 'PRJ-' + (Date.now().toString(16) + Math.random().toString(16).slice(2,6)).slice(-10).toUpperCase();
  const p = Object.assign({}, DEFAULT_PROJECT, base, {
    id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  await wrap(tx(['projects'],'readwrite').objectStore('projects').put(p));
  if (switchTo) await setCurrentProject(id);
  return p;
}

export async function deleteProject(id){
  await open();
  for (const s of RECORD_STORES){
    for (const r of await listAll(s)) if (r.projectId === id) await del(s, r.id);
  }
  const p = await wrap(tx(['projects']).objectStore('projects').get(id));
  if (p) await releaseMediaOf(p);
  await wrap(tx(['projects'],'readwrite').objectStore('projects').delete(id));
  const rest = await listProjects();
  await setCurrentProject(rest.length ? rest[0].id : null);
}

/* ---------------- 레퍼런스 (전역 공유) ---------------- */

export async function getRefs(){
  const saved = await getKV('references', null);
  const out = {};
  for (const k of Object.keys(DEFAULT_REFS)) out[k] = (saved && saved[k]) ? saved[k].slice() : DEFAULT_REFS[k].slice();
  if (saved) for (const k of Object.keys(saved)) if (!out[k]) out[k] = saved[k].slice();
  return out;
}
export async function setRefs(r){ return setKV('references', r); }

export async function pushRef(refKey, value){
  if (!refKey || !value) return false;
  const refs = await getRefs();
  if (!refs[refKey]) refs[refKey] = [];
  if (refs[refKey].includes(value)) return false;
  refs[refKey].push(value);
  await setRefs(refs);
  return true;
}

/* ---------------- 기록 CRUD (프로젝트 스코프) ---------------- */

/** 전체(프로젝트 무관) — 백업/정리용 */
export async function listAll(store){
  await open();
  return wrap(tx([store]).objectStore(store).getAll());
}

/** 현재(또는 지정) 프로젝트의 레코드만 */
export async function list(store, projectId){
  await open();
  const pid = projectId || await currentProjectId();
  const rows = await wrap(tx([store]).objectStore(store).getAll());
  return rows.filter(r => r.projectId === pid);
}

/** 특정 씬에 속한 컷 (컷 번호순) */
export async function listCuts(sceneId){
  const rows = await listAll('cuts');
  return rows.filter(r => r.sceneId === sceneId)
             .sort((a,b) => String(a.cutNo||'').localeCompare(String(b.cutNo||''), 'ko', { numeric:true })
                          || (a.createdAt||'').localeCompare(b.createdAt||''));
}

export async function get(store, id){
  await open();
  return wrap(tx([store]).objectStore(store).get(id));
}

export async function put(store, rec){
  await open();
  if (!rec.projectId) rec.projectId = await currentProjectId();
  rec.updatedAt = new Date().toISOString();
  if (!rec.createdAt) rec.createdAt = rec.updatedAt;
  await wrap(tx([store],'readwrite').objectStore(store).put(rec));
  return rec;
}

export async function del(store, id){
  await open();
  const rec = await get(store, id);
  if (rec) await releaseMediaOf(rec);
  // 씬을 지우면 하위 컷도 함께
  if (store === 'scenes'){
    for (const c of await listCuts(id)) await del('cuts', c.id);
  }
  await wrap(tx([store],'readwrite').objectStore(store).delete(id));
}

export async function clearStore(store){
  await open();
  await wrap(tx([store],'readwrite').objectStore(store).clear());
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
    width: meta.width || 0, height: meta.height || 0,
    originalBytes: meta.originalBytes || blob.size,
    compressedBytes: blob.size,
    createdAt: new Date().toISOString(),
  };
  await wrap(tx(['media'],'readwrite').objectStore('media').put(rec));
  return { mid, name:rec.name, width:rec.width, height:rec.height,
           originalBytes:rec.originalBytes, compressedBytes:rec.compressedBytes };
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
  await wrap(tx(['media'],'readwrite').objectStore('media').delete(mid));
}

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

export async function gcMedia(){
  await open();
  const used = new Set();
  for (const s of RECORD_STORES) (await listAll(s)).forEach(r => midsOf(r).forEach(m => used.add(m)));
  (await listProjects()).forEach(p => midsOf(p).forEach(m => used.add(m)));
  const all = await wrap(tx(['media']).objectStore('media').getAllKeys());
  let n = 0;
  for (const mid of all) if (!used.has(mid)){ await delMedia(mid); n++; }
  return n;
}

/* ---------------- ID ---------------- */

function rand4(){ return Math.random().toString(16).slice(2,6).toUpperCase(); }
function pad(n){ return String(n).padStart(2,'0'); }

export function makeSceneId(projectName){
  const abbr = String(projectName || '').replace(/[^A-Za-z0-9가-힣]/g,'').slice(0,3).toUpperCase() || 'SCN';
  const d = new Date();
  return `${abbr}-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-` +
         `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${rand4()}`;
}
export function makeId(prefix){
  return `${prefix}-${(Date.now().toString(16)+rand4()).slice(-8).toUpperCase()}`;
}

/** 파일명에 쓸 프로젝트 약칭 */
export function slugOf(name){
  return (String(name || '')
    .replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 24)) || 'ONSET';
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

async function inflate(v){
  if (!v) return v;
  if (Array.isArray(v)) return Promise.all(v.map(inflate));
  if (typeof v === 'object'){
    if (v.mid){
      const m = await getMedia(v.mid);
      if (!m) return null;
      return { dataUrl: await blobToDataUrl(m.blob), name:m.name,
               originalBytes:m.originalBytes, compressedBytes:m.compressedBytes,
               width:m.width, height:m.height };
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
function stripMedia(rec){
  const o = {};
  for (const [k,v] of Object.entries(rec)){
    if (v && typeof v === 'object' && v.mid) { o[k] = null; continue; }
    if (Array.isArray(v) && v.some(x => x && x.mid)) { o[k] = v.map(x => (x && x.mid) ? null : x); continue; }
    o[k] = v;
  }
  return o;
}

/**
 * @param {boolean} withMedia    이미지 포함 여부
 * @param {string|null} scope    프로젝트 id (null 이면 전체 프로젝트)
 */
export async function exportBackup(withMedia = true, scope = null){
  await open();
  const projects = await listProjects();
  const keep = scope ? projects.filter(p => p.id === scope) : projects;
  const out = {
    app: APP_ID, version: 3, appVersion: APP_VER,
    exportedAt: new Date().toISOString(),
    projects: withMedia ? await Promise.all(keep.map(inflateRec)) : keep.map(stripMedia),
    references: await getRefs(),
    scenes: [], cuts: [], locations: [], cameras: [], assets: [], hdri: [],
  };
  const ids = new Set(keep.map(p => p.id));
  for (const s of RECORD_STORES){
    const rows = (await listAll(s)).filter(r => ids.has(r.projectId));
    out[s] = withMedia ? await Promise.all(rows.map(inflateRec)) : rows.map(stripMedia);
  }
  // 단일 프로젝트 백업은 예전처럼 project 키도 채워 호환성 유지
  if (keep.length === 1) out.project = out.projects[0];
  return out;
}

/* ---------------- 백업 import ---------------- */

async function deflate(v){
  if (!v) return v;
  if (Array.isArray(v)) return Promise.all(v.map(deflate));
  if (typeof v === 'object'){
    if (v.mid) return v;
    if (v.dataUrl){
      return putMedia(dataUrlToBlob(v.dataUrl), {
        name:v.name, width:v.width, height:v.height, originalBytes:v.originalBytes });
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
 * 백업 가져오기. 아래 세 가지 포맷을 모두 받는다.
 *   - 구 PMT Onset v3 : { project, cuts[] , ... }      → 프로젝트 1개 + 씬으로 이관
 *   - 씬 단위 백업     : { project, scenes[], ... }
 *   - 현행 멀티        : { projects[], scenes[], cuts[], ... }
 */
export async function importBackup(json, mode = 'replace', onProgress = () => {}){
  await open();
  if (!json || typeof json !== 'object') throw new Error('JSON 형식이 아닙니다.');

  if (mode === 'replace'){
    onProgress('기존 데이터 삭제 중', 2);
    for (const s of RECORD_STORES) await clearStore(s);
    await clearStore('projects'); await clearStore('media');
    _urlCache.forEach(u => URL.revokeObjectURL(u)); _urlCache.clear();
  }

  const stats = { projects:0, references:0, media:0 };
  for (const s of RECORD_STORES) stats[s] = 0;

  /* 레퍼런스 */
  if (json.references){
    const base = await getRefs();
    for (const [k,v] of Object.entries(json.references)){
      if (!Array.isArray(v) || !(k in DEFAULT_REFS)) continue;
      base[k] = mode === 'replace' ? v.slice() : Array.from(new Set([...(base[k]||[]), ...v]));
      stats.references++;
    }
    await setRefs(base);
  }

  /* 프로젝트 */
  onProgress('프로젝트 정보', 6);
  const rawProjects = Array.isArray(json.projects) && json.projects.length
    ? json.projects
    : (json.project ? [json.project] : []);
  let firstPid = null;
  for (const raw of rawProjects){
    const p = await deflateRec(Object.assign({}, DEFAULT_PROJECT, raw));
    delete p.key;
    if (!p.id) p.id = 'PRJ-' + (Date.now().toString(16)+rand4()).slice(-10).toUpperCase();
    if (!p.createdAt) p.createdAt = new Date().toISOString();
    p.updatedAt = p.updatedAt || p.createdAt;
    await wrap(tx(['projects'],'readwrite').objectStore('projects').put(p));
    if (!firstPid) firstPid = p.id;
    stats.projects++;
  }
  if (!firstPid){
    const p = await createProject({ name:'가져온 프로젝트' }, false);
    firstPid = p.id; stats.projects++;
  }

  /* 기록 — 구 백업의 cuts[] 는 기록 단위였으므로 scenes 로 받는다 */
  const isLegacy = !Array.isArray(json.scenes) && Array.isArray(json.cuts);
  const srcOf = (s) => {
    if (s === 'scenes' && isLegacy) return json.cuts || [];
    if (s === 'cuts'   && isLegacy) return [];
    return json[s] || [];
  };
  const total = RECORD_STORES.reduce((a,s) => a + srcOf(s).length, 0) || 1;
  let done = 0;
  const spawned = [];

  for (const s of RECORD_STORES){
    for (const raw of srcOf(s)){
      const rec = normalizeLegacy(await deflateRec(raw));
      if (!rec.id) rec.id = (s === 'scenes') ? makeSceneId(rawProjects[0]?.name)
                                             : makeId(ENTITIES[s]?.idPrefix || 'REC');
      if (!rec.projectId) rec.projectId = firstPid;
      if (!rec.createdAt) rec.createdAt = new Date().toISOString();
      rec.updatedAt = rec.updatedAt || rec.createdAt;

      if (s === 'scenes' && isLegacy){
        const hasVfx = rec.vfxA || rec.vfxB || rec.workElement || rec.vendor || rec.filename;
        if (hasVfx){
          spawned.push({
            id: makeId('CUT'), projectId: rec.projectId, sceneId: rec.id, cutNo:'1',
            vfxType: VFX_TYPE_MAP[rec.vfxA] || VFX_TYPE_MAP[rec.vfxB] || '',
            workElement: rec.workElement || rec.vfxB || '',
            vendor: rec.vendor || '',
            vfxShotId: rec.filename || '', shotNote: rec.shotNote || '', plateNote:'',
            thumbnail:null, photos:[null,null,null], takes:[],
            createdAt: rec.createdAt, updatedAt: rec.updatedAt,
          });
        }
        for (const k of ['vfxA','vfxB','workElement','vendor','filename','penNote']) delete rec[k];
      }
      if (s === 'cuts' && !Array.isArray(rec.takes)) rec.takes = [];

      await wrap(tx([s],'readwrite').objectStore(s).put(rec));
      stats[s]++; done++;
      if (done % 5 === 0 || done === total)
        onProgress(`${ENTITIES[s]?.label || s} ${stats[s]}건`, 8 + Math.round(done/total*88));
    }
  }
  for (const c of spawned){
    await wrap(tx(['cuts'],'readwrite').objectStore('cuts').put(c));
    stats.cuts++;
  }

  if (mode === 'merge'){ onProgress('미사용 이미지 정리', 98); await gcMedia(); }
  await setCurrentProject(firstPid);
  stats.media = await wrap(tx(['media']).objectStore('media').count());
  onProgress('완료', 100);
  return stats;
}

/* ---------------- 저장소 ---------------- */

export async function storageInfo(){
  const out = { usage:0, quota:0, media:0, records:{}, projects:0 };
  if (navigator.storage && navigator.storage.estimate){
    const e = await navigator.storage.estimate();
    out.usage = e.usage || 0; out.quota = e.quota || 0;
  }
  await open();
  out.media = await wrap(tx(['media']).objectStore('media').count());
  out.projects = (await listProjects()).length;
  for (const s of RECORD_STORES) out.records[s] = (await list(s)).length;
  return out;
}

export async function requestPersist(){
  if (navigator.storage && navigator.storage.persist){
    if (await navigator.storage.persisted()) return true;
    return navigator.storage.persist();
  }
  return false;
}

export { RECORD_STORES };
