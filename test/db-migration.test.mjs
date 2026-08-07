/* v1(컷 스토어) → v2(씬 스토어) IndexedDB 업그레이드 검증 */
import * as FDB from 'fake-indexeddb';
globalThis.indexedDB = new FDB.IDBFactory();
globalThis.IDBKeyRange = FDB.IDBKeyRange;

let fail=0; const ok=(c,m)=>{ console.log((c?'  PASS ':'  FAIL ')+m); if(!c) fail++; };
const w = (r)=>new Promise((res,rej)=>{ r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });

// --- 구버전 DB 를 직접 만든다 (v1 스키마) ---
await new Promise((res,rej)=>{
  const req = indexedDB.open('pmt-onset', 1);
  req.onupgradeneeded = (e)=>{
    const db = e.target.result;
    db.createObjectStore('kv',{keyPath:'key'});
    db.createObjectStore('media',{keyPath:'mid'});
    for (const s of ['cuts','locations','cameras','assets','hdri'])
      db.createObjectStore(s,{keyPath:'id'}).createIndex('updatedAt','updatedAt');
  };
  req.onsuccess = async ()=>{
    const db = req.result;
    const t = db.transaction(['cuts','assets'],'readwrite');
    t.objectStore('cuts').put({ id:'PMT-20260801-101010-AAAA', episode:'EP01', scene:'2-8',
      cut:'3', pDay:'12', unit:'A', location:'조양 체육관', status:'기록 중', createdAt:'2026-08-01T00:00:00.000Z' });
    t.objectStore('cuts').put({ id:'PMT-20260801-101011-BBBB', episode:'EP02', scene:'3-1', cut:'A', pDay:'13' });
    t.objectStore('assets').put({ id:'AST-1', name:'말', linkedCutIds:['PMT-20260801-101010-AAAA'] });
    t.oncomplete = ()=>{ db.close(); res(); };
    t.onerror = ()=>rej(t.error);
  };
  req.onerror = ()=>rej(req.error);
});
console.log('== v1 DB 생성 완료 (컷 2건) ==');

// --- 앱 코드로 열면 v2 로 업그레이드된다 ---
const DB = await import('../js/db.js');
const db = await DB.open();
ok(db.version === 2, `DB 버전 ${db.version} → 2`);
ok(db.objectStoreNames.contains('scenes'), 'scenes 스토어 생성됨');
ok(!db.objectStoreNames.contains('cuts'), '구 cuts 스토어 제거됨');

const scenes = await DB.list('scenes');
ok(scenes.length === 2, `기존 컷 2건이 씬으로 이관 (${scenes.length})`);
const a = scenes.find(s=>s.id==='PMT-20260801-101010-AAAA');
ok(!!a, 'ID 보존');
ok(a.episode==='EP01' && a.scene==='2-8' && a.unit==='A' && a.location==='조양 체육관', '나머지 필드 보존');
ok(!('cut' in a) && !('pDay' in a), '폐기 필드(cut, pDay) 제거됨');
const asset = (await DB.list('assets'))[0];
ok(!('linkedCutIds' in asset) && Array.isArray(asset.linkedSceneIds)
   && asset.linkedSceneIds[0]==='PMT-20260801-101010-AAAA', 'assets.linkedCutIds → linkedSceneIds 이관 (값 보존)');

console.log(fail?`\n### 실패 ${fail}건`:'\n### 전체 통과');
process.exit(fail?1:0);
