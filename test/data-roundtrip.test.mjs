import 'fake-indexeddb/auto';
import fs from 'node:fs';
if (!globalThis.FileReader){
  globalThis.FileReader = class { readAsDataURL(b){ b.arrayBuffer().then(x=>{
    this.result='data:'+(b.type||'')+';base64,'+Buffer.from(x).toString('base64'); this.onload&&this.onload(); }); } };
}
const DB = await import('../js/db.js');
const orig = JSON.parse(fs.readFileSync(process.env.PMT_BACKUP,'utf8'));
let fail=0; const ok=(c,m)=>{ console.log((c?'  PASS ':'  FAIL ')+m); if(!c) fail++; };

console.log('== 1. 구 백업(v3, cuts=기록단위) 가져오기 ==');
const s = await DB.importBackup(orig,'replace',()=>{});
console.log('  stats:', JSON.stringify(s));
ok(s.projects === 1, `프로젝트 1개 생성 (${s.projects})`);
ok(s.scenes === orig.cuts.length, `구 cuts[] → scenes ${s.scenes}/${orig.cuts.length}`);
ok(s.locations===3 && s.cameras===1 && s.assets===1, '나머지 스토어 이관');

const projects = await DB.listProjects();
ok(projects.length===1 && projects[0].name===orig.project.name, `프로젝트명 보존: ${projects[0].name}`);
const pid = projects[0].id;
ok(/^PRJ-/.test(pid), `프로젝트 ID ${pid}`);

console.log('== 2. 전 레코드 projectId 부여 ==');
for (const st of ['scenes','cuts','locations','cameras','assets','hdri']){
  const rows = await DB.listAll(st);
  const bad = rows.filter(r => r.projectId !== pid);
  ok(bad.length===0, `${st}: ${rows.length}건 전부 projectId 일치`);
}

console.log('== 3. 씬의 VFX 정보 → 컷으로 분리 ==');
const scenes = await DB.list('scenes');
const cuts = await DB.list('cuts');
const legacyWithVfx = orig.cuts.filter(c => c.vfxA||c.vfxB||c.workElement||c.vendor||c.filename);
ok(cuts.length === legacyWithVfx.length, `컷 ${cuts.length}개 생성 (VFX 정보 있던 구 레코드 ${legacyWithVfx.length}개)`);
ok(scenes.every(s => !('vfxA' in s) && !('vendor' in s)), '씬에서 VFX 필드 제거됨');
ok(cuts.every(c => scenes.some(s => s.id === c.sceneId)), '모든 컷이 유효한 씬에 연결됨');
ok(cuts.every(c => Array.isArray(c.takes)), '컷마다 takes 배열 존재');
const vendorSrc = legacyWithVfx.find(c=>c.vendor);
if (vendorSrc){ const mapped = cuts.find(c=>c.sceneId===vendorSrc.id);
  ok(mapped && mapped.vendor===vendorSrc.vendor, `벤더 이관 (${mapped&&mapped.vendor})`); }

console.log('== 4. 멀티 프로젝트 격리 ==');
const p2 = await DB.createProject({ name:'두번째 작품' });
ok((await DB.listProjects()).length===2, '프로젝트 2개');
ok((await DB.currentProjectId())===p2.id, '생성 즉시 현재 프로젝트로 전환');
ok((await DB.list('scenes')).length===0, '새 프로젝트는 빈 씬 목록');
ok((await DB.listAll('scenes')).length===scenes.length, '전체 조회로는 기존 씬 그대로 존재');
const refsShared = await DB.getRefs();
ok(refsShared.vfxTypes.length>0 && refsShared.episodes.length>0, '드롭다운 목록은 전역 공유');
await DB.put('scenes', { id:'S-X', episode:'EP01', scene:'1-1' });
ok((await DB.list('scenes')).length===1, '새 프로젝트에 씬 추가 → 격리됨');
await DB.setCurrentProject(pid);
ok((await DB.list('scenes')).length===scenes.length, '프로젝트 되돌리면 원래 씬만 보임');

console.log('== 5. 테이크 ==');
const c0 = cuts[0];
c0.takes = [
  { takeNo:'1', camRoll:'A027', clip:'C006', tc:'12:14:01:20', state:'OK', fps:'23.976', shutter:'180°', ei:'EI 800', wb:'4300K' },
  { takeNo:'2', camRoll:'A027', clip:'C007', tc:'12:16:02:11', state:'NG' },
];
await DB.put('cuts', c0);
const reloaded = await DB.get('cuts', c0.id);
ok(reloaded.takes.length===2, '테이크 2개 저장');
ok(reloaded.takes[0].clip==='C006' && reloaded.takes[0].tc==='12:14:01:20', '캠롤/클립/TC 보존');
ok((await DB.listCuts(c0.sceneId)).length>=1, 'listCuts 로 씬 하위 컷 조회');

console.log('== 6. export 라운드트립 ==');
const out = await DB.exportBackup(true, null);
ok(out.projects.length===2, `전체 백업에 프로젝트 2개`);
ok(out.scenes.length===scenes.length+1 && out.cuts.length===cuts.length, '씬/컷 수 일치');
const outCut = out.cuts.find(c=>c.id===c0.id);
ok(outCut && outCut.takes.length===2, '테이크가 백업에 포함됨');
const scoped = await DB.exportBackup(true, pid);
ok(scoped.projects.length===1 && scoped.scenes.length===scenes.length, '프로젝트 단위 백업 스코프 정확');

function countImgs(o){ let n=0; const w=(v)=>{ if(!v) return;
  if(Array.isArray(v)) return v.forEach(w);
  if(typeof v==='object'){ if(v.dataUrl) n++; else Object.values(v).forEach(w); } }; w(o); return n; }
const origImgs = countImgs({p:orig.project,l:orig.locations,c:orig.cameras,a:orig.assets,u:orig.cuts});
ok(countImgs(out)===origImgs, `이미지 ${countImgs(out)}/${origImgs} 무손실`);

console.log('== 7. 재가져오기 (멀티 포맷) ==');
const s2 = await DB.importBackup(out,'replace',()=>{});
ok(s2.projects===2 && s2.scenes===scenes.length+1 && s2.cuts===cuts.length, `멀티 백업 재가져오기 ${JSON.stringify({p:s2.projects,s:s2.scenes,c:s2.cuts})}`);
const rc = (await DB.listAll('cuts')).find(c=>c.id===c0.id);
ok(rc && rc.takes.length===2 && rc.takes[0].clip==='C006', '재가져오기 후 테이크 보존');

console.log('== 8. 프로젝트 삭제 = 하위 기록 동반 삭제 ==');
const before = (await DB.listAll('scenes')).length;
const target = (await DB.listProjects()).find(p=>p.name==='두번째 작품');
await DB.deleteProject(target.id);
ok((await DB.listProjects()).length===1, '프로젝트 1개 남음');
ok((await DB.listAll('scenes')).length===before-1, '해당 프로젝트 씬만 삭제됨');
ok((await DB.gcMedia())===0, '미디어 누수 없음');

console.log(fail?`\n### 실패 ${fail}건`:'\n### 전체 통과');
process.exit(fail?1:0);
