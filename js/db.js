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
export const DB_VER  = 7;
export const APP_ID  = 'Ribi Onset Management';
export const APP_VER = 8;

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
    req.onsuccess = async () => {
      _db = req.result;
      try { await postMigrate(); } catch (e){ console.warn('postMigrate', e); }
      res(_db);
    };
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

  /* v5 → v6 (씬 로케이션의 레코드 연결화) 는 여기서 하지 않는다.
     versionchange 트랜잭션 안에서 여러 스토어를 오가면 요청 순서에 따라
     v2→v3 단계의 씬 쓰기에 덮어써질 수 있다. postMigrate 에서 처리한다. */

  /* v4 → v5 : 에셋에서 폐기한 필드 정리 (씬과의 연결 이관은 postMigrate 에서) */
  if (oldVersion > 0 && oldVersion < 5 && db.objectStoreNames.contains('assets')){
    const os = t.objectStore('assets');
    os.getAll().onsuccess = (ev) => {
      for (const a of (ev.target.result || [])){
        let dirty = false;
        for (const k of ['path','memo','propMethod','lidar','hdri','model3d','material',
                         'imagePhotos','surveyPhotos','platePhotos']){
          if (k in a){ delete a[k]; dirty = true; }
        }
        if (dirty) os.put(a);
      }
    };
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

/**
 * 업그레이드 트랜잭션 밖에서 한 번만 도는 후처리.
 * versionchange 트랜잭션 안에서 여러 스토어를 오가며 읽고 쓰면
 * 요청 순서가 다른 마이그레이션 단계와 뒤엉켜 결과가 덮어써진다.
 * 그래서 "다른 스토어를 참조해야 하는" 이관은 여기서 처리한다.
 */
let _postDone = false;
async function postMigrate(){
  if (_postDone) return;
  _postDone = true;

  // 이관 단계마다 플래그를 따로 둔다. 하나로 묶으면 새 단계를 추가했을 때
  // 이미 플래그가 켜진 기기에서는 영영 실행되지 않는다.
  const flag = await wrap(tx(['kv']).objectStore('kv').get('assetLinkMigrated'));
  if (!(flag && flag.value)) await migrateAssetLinks();

  await linkScenesToLocations();
  await moveHdriLinksToScenes();
  await migrateSceneCams();
  await migrateSceneUnitToCams();
}

/**
 * 촬영 유닛이 씬 공통에서 캠별 값으로 바뀌었다.
 * 예전에는 씬 하나에 유닛 하나였으므로, 그 값을 모든 캠에 복사한 뒤 최상단에서 지운다.
 * (지우지 않으면 화면에 안 보이는 값이 백업에만 남아 나중에 혼란을 준다)
 */
export async function migrateSceneUnitToCams(){
  const CAMS = (ENTITIES.scenes && ENTITIES.scenes.cams) || ['A','B','C','D'];
  const scenes = await wrap(tx(['scenes']).objectStore('scenes').getAll());
  let n = 0;
  for (const s of scenes){
    if (!('unit' in s)) continue;
    const v = s.unit;
    if (!s.cams) s.cams = {};
    for (const c of CAMS){
      if (!s.cams[c]) s.cams[c] = {};
      if (v && !s.cams[c].unit) s.cams[c].unit = v;
    }
    delete s.unit;
    await wrap(tx(['scenes'],'readwrite').objectStore('scenes').put(s));
    n++;
  }
  return n;
}

/**
 * v6 → v7 : 기록 단위가 "씬 + 컷" 에서 "씬 + 캠(A~D) 탭" 으로 바뀌었다.
 *  - 씬 최상단의 대표 이미지/현장 사진 → cams.A
 *  - 컷의 캠(camUnit)과 첫 테이크의 캠 롤·클립 → 해당 캠
 * 컷 레코드 자체는 지우지 않는다. 화면에서 안 보일 뿐 백업에는 남아 있어야 한다.
 * cams 가 이미 있는 씬은 건드리지 않으므로 여러 번 돌아도 안전하다.
 */
export async function migrateSceneCams(){
  const CAMS = (ENTITIES.scenes && ENTITIES.scenes.cams) || ['A','B','C','D'];
  const scenes = await wrap(tx(['scenes']).objectStore('scenes').getAll());
  const targets = scenes.filter(s => !s.cams || typeof s.cams !== 'object');
  if (!targets.length) return 0;

  const cuts = await wrap(tx(['cuts']).objectStore('cuts').getAll());
  const byScene = {};
  for (const c of cuts) (byScene[c.sceneId] = byScene[c.sceneId] || []).push(c);

  let n = 0;
  for (const s of targets){
    const cams = {};
    for (const c of CAMS) cams[c] = {};

    // 씬에 직접 붙어 있던 이미지는 A캠으로 옮긴다 (복사가 아니라 이동 — mid 중복 참조 방지)
    if (s.thumbnail && s.thumbnail.mid){ cams.A.thumbnail = s.thumbnail; delete s.thumbnail; }
    if (Array.isArray(s.photos) && s.photos.some(x => x && x.mid)){ cams.A.photos = s.photos; delete s.photos; }

    // 컷에 기록돼 있던 캠 롤·클립을 끌어온다 (이미지는 컷 쪽에 그대로 둔다)
    for (const c of (byScene[s.id] || [])){
      const tk = (c.takes || [])[0] || {};
      const cam = String(c.camUnit || tk.camRoll || '').toUpperCase().slice(0,1);
      if (!CAMS.includes(cam)) continue;
      if (!cams[cam].camRoll && tk.camRoll) cams[cam].camRoll = tk.camRoll;
      if (!cams[cam].clip    && tk.clip)    cams[cam].clip    = tk.clip;
    }

    s.cams = cams;
    await wrap(tx(['scenes'],'readwrite').objectStore('scenes').put(s));
    n++;
  }
  return n;
}

async function migrateAssetLinks(){
  // 에셋에 남아 있던 정방향 연결(linkedSceneIds)을 씬 쪽(linkedAssetIds)으로 옮긴다
  const assets = await wrap(tx(['assets']).objectStore('assets').getAll());
  const pend = [];
  for (const a of assets){
    if (Array.isArray(a.linkedSceneIds) && a.linkedSceneIds.length){
      for (const sid of a.linkedSceneIds) pend.push([sid, a.id]);
    }
    if ('linkedSceneIds' in a){
      delete a.linkedSceneIds;
      await wrap(tx(['assets'],'readwrite').objectStore('assets').put(a));
    }
  }
  for (const [sid, aid] of pend){
    const s = await wrap(tx(['scenes']).objectStore('scenes').get(sid));
    if (!s) continue;
    if (!Array.isArray(s.linkedAssetIds)) s.linkedAssetIds = [];
    if (!s.linkedAssetIds.includes(aid)){
      s.linkedAssetIds.push(aid);
      await wrap(tx(['scenes'],'readwrite').objectStore('scenes').put(s));
    }
  }
  await wrap(tx(['kv'],'readwrite').objectStore('kv').put({ key:'assetLinkMigrated', value:true }));
}

/** Location 레코드를 이름으로 찾는다. "대장소 소장소" 형태까지 맞춰본다. */
function matchLocation(name, locations){
  const norm = (s) => String(s || '').replace(/\s+/g,'').toLowerCase();
  const q = norm(name);
  if (!q) return null;
  return locations.find(l => norm([l.mainLocation, l.subLocation].filter(Boolean).join('')) === q)
      || locations.find(l => norm(l.mainLocation) === q)
      || locations.find(l => q && norm(l.mainLocation) && q.startsWith(norm(l.mainLocation)))
      || null;
}

/**
 * 씬에 문자열로만 남아 있던 로케이션 이름을 Location 레코드에 연결한다.
 * 이름이 안 맞으면 legacyLocationName 을 남겨 둔다 — 조용히 버리면 어디였는지 알 수 없게 된다.
 */
export async function linkScenesToLocations(){
  const locations = await wrap(tx(['locations']).objectStore('locations').getAll());
  const scenes = await wrap(tx(['scenes']).objectStore('scenes').getAll());
  let n = 0;
  for (const s of scenes){
    let dirty = false;

    // 1) 구 스키마의 자유 입력 문자열을 이름 보관 필드로 옮긴다
    if (typeof s.location === 'string' && s.location){
      if (!s.locationId && !s.legacyLocationName) s.legacyLocationName = s.location;
      delete s.location; dirty = true;
    }
    if ('subLocation' in s){
      // 소장소는 Location 레코드가 들고 있다 — 씬에서는 중복이므로 이름에만 합쳐 둔다
      if (s.subLocation && s.legacyLocationName && !s.legacyLocationName.includes(s.subLocation))
        s.legacyLocationName += ' ' + s.subLocation;
      delete s.subLocation; dirty = true;
    }

    // 2) 이름으로 Location 레코드를 찾아 연결한다. 못 찾으면 이름을 남겨 둔다
    //    (조용히 버리면 그 씬이 어디였는지 알 수 없게 된다)
    if (!s.locationId && s.legacyLocationName && locations.length){
      const hit = matchLocation(s.legacyLocationName, locations.filter(l => l.projectId === s.projectId))
               || matchLocation(s.legacyLocationName, locations);
      if (hit){ s.locationId = hit.id; delete s.legacyLocationName; dirty = true; n++; }
    }

    if (dirty) await wrap(tx(['scenes'],'readwrite').objectStore('scenes').put(s));
  }
  return n;
}

/** HDRI 쪽에 있던 씬 연결을 씬 쪽(linkedHdriIds)으로 옮긴다. 연결의 주인은 씬 하나뿐이어야 한다. */
export async function moveHdriLinksToScenes(){
  const hdris = await wrap(tx(['hdri']).objectStore('hdri').getAll());
  let n = 0;
  for (const h of hdris){
    if (!('linkedScene' in h)) continue;
    const ids = Array.isArray(h.linkedScene) ? h.linkedScene : (h.linkedScene ? [h.linkedScene] : []);
    for (const sid of ids){
      const s = await wrap(tx(['scenes']).objectStore('scenes').get(sid));
      if (!s) continue;
      if (!Array.isArray(s.linkedHdriIds)) s.linkedHdriIds = [];
      if (!s.linkedHdriIds.includes(h.id)){
        s.linkedHdriIds.push(h.id);
        await wrap(tx(['scenes'],'readwrite').objectStore('scenes').put(s));
        n++;
      }
    }
    delete h.linkedScene;
    await wrap(tx(['hdri'],'readwrite').objectStore('hdri').put(h));
  }
  return n;
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

/**
 * 스토어별 정규화. DB 업그레이드와 백업 가져오기가 같은 규칙을 쓰도록 한 곳에 모은다.
 * (예전에는 업그레이드에만 있어서, 구 백업을 새로 가져오면 대장소가 비어 있었다)
 */
function normalizeStore(store, r){
  if (store === 'scenes'){
    // 구 백업의 로케이션은 문자열이었다 → 이름만 보존하고 레코드 연결은 import 끝에 붙인다
    if (typeof r.location === 'string' && r.location){
      if (!r.locationId) r.legacyLocationName = r.location;
      delete r.location;
    }
    if (r.subLocation){
      if (r.legacyLocationName) r.legacyLocationName += ' ' + r.subLocation;
      delete r.subLocation;
    }
    delete r.subLocation;
  }
  if (store === 'locations'){
    if (r.shootLocation){
      if (!r.mainLocation) r.mainLocation = r.shootLocation;
      delete r.shootLocation;
    }
    delete r.surveyPhotos; delete r.model3d;
    delete r.seasonStart; delete r.seasonEnd;
  }
  if (store === 'assets'){
    for (const k of ['path','memo','propMethod','lidar','hdri','model3d','material',
                     'imagePhotos','surveyPhotos','platePhotos']) delete r[k];
  }
  if (store === 'hdri'){
    delete r.shootDate; delete r.shootTime; delete r.subLocation;
    // 구 백업의 로케이션은 문자열이었다 → 이름만 남겨두고 연결은 사용자가 다시 고른다
    if (typeof r.location === 'string' && r.location && !r.locationId){
      r.legacyLocationName = r.location;
    }
    delete r.location;
  }
  return r;
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
  // 컷 번호 → 캠(A,B,…) 순. 동시 촬영 쌍이 나란히 붙어 보여야 한다.
  return rows.filter(r => r.sceneId === sceneId)
             .sort((a,b) => String(a.cutNo||'').localeCompare(String(b.cutNo||''), 'ko', { numeric:true })
                          || String(a.camUnit||'').localeCompare(String(b.camUnit||''), 'ko', { numeric:true })
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
      const rec = normalizeStore(s, normalizeLegacy(await deflateRec(raw)));
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

  // 에셋에 남아 있는 정방향 연결을 씬 쪽으로 옮긴다 (연결의 주인은 씬)
  for (const a of await listAll('assets')){
    if (!Array.isArray(a.linkedSceneIds) || !a.linkedSceneIds.length){
      if ('linkedSceneIds' in a){
        delete a.linkedSceneIds;
        await wrap(tx(['assets'],'readwrite').objectStore('assets').put(a));
      }
      continue;
    }
    for (const sid of a.linkedSceneIds){
      const sc = await wrap(tx(['scenes']).objectStore('scenes').get(sid));
      if (!sc) continue;
      if (!Array.isArray(sc.linkedAssetIds)) sc.linkedAssetIds = [];
      if (!sc.linkedAssetIds.includes(a.id)){
        sc.linkedAssetIds.push(a.id);
        await wrap(tx(['scenes'],'readwrite').objectStore('scenes').put(sc));
      }
    }
    delete a.linkedSceneIds;
    await wrap(tx(['assets'],'readwrite').objectStore('assets').put(a));
  }

  // 씬의 로케이션 이름 → Location 레코드 연결, HDRI 쪽 씬 연결 → 씬으로 이관
  onProgress('연결 정리', 96);
  await linkScenesToLocations();
  await moveHdriLinksToScenes();
  await migrateSceneCams();
  await migrateSceneUnitToCams();

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
