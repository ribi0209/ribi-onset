/* v2(단일 프로젝트 · 씬 스토어) → v3(멀티 프로젝트 · 씬/컷) 업그레이드 검증 */
import * as FDB from 'fake-indexeddb';
globalThis.indexedDB = new FDB.IDBFactory(); globalThis.IDBKeyRange = FDB.IDBKeyRange;
let fail=0; const ok=(c,m)=>{ console.log((c?'  PASS ':'  FAIL ')+m); if(!c) fail++; };

/* --- v2 DB 를 손으로 만든다 --- */
await new Promise((res,rej)=>{
  const req = indexedDB.open('pmt-onset', 2);
  req.onupgradeneeded = (e)=>{
    const db = e.target.result;
    db.createObjectStore('kv',{keyPath:'key'});
    db.createObjectStore('media',{keyPath:'mid'});
    for (const s of ['scenes','locations','cameras','assets','hdri'])
      db.createObjectStore(s,{keyPath:'id'}).createIndex('updatedAt','updatedAt');
  };
  req.onsuccess = ()=>{
    const db = req.result;
    const t = db.transaction(['kv','scenes','locations','assets'],'readwrite');
    t.objectStore('kv').put({ key:'project', value:{
      key:'project', name:'PMT (프로모터)', type:'드라마', director:'이종석',
      deliveryFps:'23.976', crankIn:'2026-07-27' }});
    t.objectStore('scenes').put({ id:'PMT-20260801-101010-AAAA', episode:'EP01', scene:'2-8',
      unit:'A', location:'조양 체육관', intExt:'INT', tod:'DAY',
      vfxA:'WIRE REMOVAL', vfxB:'2D VFX', workElement:'wire', vendor:'WSWG',
      status:'기록 중', filename:'PMT_EP01_S28_C01', shotNote:'와이어 3개',
      createdAt:'2026-08-01T00:00:00.000Z' });
    t.objectStore('scenes').put({ id:'PMT-20260801-101011-BBBB', episode:'EP02', scene:'3-1',
      vfxA:'3D VFX', vendor:'DEXTER', status:'완료' });
    t.objectStore('scenes').put({ id:'PMT-20260801-101012-CCCC', episode:'EP03', scene:'1-1' }); // VFX 없음
    t.objectStore('locations').put({ id:'LOC-1', shootLocation:'팔복사무실', setType:'Location' });
    t.objectStore('assets').put({ id:'AST-1', name:'말', linkedSceneIds:['PMT-20260801-101010-AAAA'] });
    t.oncomplete = ()=>{ db.close(); res(); };
    t.onerror = ()=>rej(t.error);
  };
  req.onerror = ()=>rej(req.error);
});
console.log('== v2 DB 준비 완료 (씬 3건, VFX 정보 2건) ==');

const DB = await import('../js/db.js');
const db = await DB.open();
ok(db.version===3, `DB 버전 ${db.version} → 3`);
ok(db.objectStoreNames.contains('projects'), 'projects 스토어 생성');
ok(db.objectStoreNames.contains('cuts'), 'cuts 스토어 생성');

const projects = await DB.listProjects();
ok(projects.length===1, `단일 프로젝트가 projects 레코드로 승격 (${projects.length})`);
ok(projects[0].name==='PMT (프로모터)', `프로젝트명 보존: ${projects[0].name}`);
ok(projects[0].director==='이종석' && projects[0].deliveryFps==='23.976', '프로젝트 세부 필드 보존');
ok(!('key' in projects[0]), "레거시 'key' 필드 제거");
const pid = projects[0].id;
ok((await DB.currentProjectId())===pid, '현재 프로젝트로 설정됨');

const scenes = await DB.list('scenes');
ok(scenes.length===3, `씬 3건 유지 (${scenes.length})`);
ok(scenes.every(s=>s.projectId===pid), '모든 씬에 projectId 부여');
ok((await DB.list('locations')).every(r=>r.projectId===pid), '로케이션도 projectId');
ok((await DB.list('assets')).every(r=>r.projectId===pid), '에셋도 projectId');

const cuts = await DB.list('cuts');
ok(cuts.length===2, `VFX 정보가 있던 씬 2건만 컷 생성 (${cuts.length})`);
const a = cuts.find(c=>c.sceneId==='PMT-20260801-101010-AAAA');
ok(!!a, '컷이 원래 씬에 연결됨');
ok(a.vfxType==='2D', `vfxA 'WIRE REMOVAL' → vfxType '${a.vfxType}' (통계 축 정규화)`);
ok(a.workElement==='wire' && a.vendor==='WSWG', '작업요소/벤더 이관');
ok(!('status' in a), '폐기된 상태 필드는 컷에 만들지 않음');
ok(a.vfxShotId==='PMT_EP01_S28_C01', 'filename → VFX 샷 ID 이관');
ok(Array.isArray(a.takes) && a.takes.length===0, 'takes 배열 초기화');
const b = cuts.find(c=>c.sceneId==='PMT-20260801-101011-BBBB');
ok(b && b.vfxType==='3D', `'3D VFX' → '${b&&b.vfxType}'`);

const s1 = scenes.find(s=>s.id==='PMT-20260801-101010-AAAA');
ok(!('vfxA' in s1) && !('vendor' in s1) && !('filename' in s1), '씬에서 VFX 필드 제거');
ok(s1.episode==='EP01' && s1.location==='조양 체육관' && s1.shotNote==='와이어 3개', '씬 고유 필드는 그대로');

const asset = (await DB.list('assets'))[0];
ok(asset.linkedSceneIds[0]==='PMT-20260801-101010-AAAA', '에셋-씬 연결 유지');

console.log(fail?`\n### 실패 ${fail}건`:'\n### 전체 통과');
process.exit(fail?1:0);
