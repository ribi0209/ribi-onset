import { JSDOM } from 'jsdom';
import fs from 'node:fs';
const dom = new JSDOM(fs.readFileSync('../index.html','utf8'),
  { url:'https://example.test/', pretendToBeVisual:true, runScripts:'outside-only' });
const w = dom.window;
w.HTMLElement.prototype.scrollIntoView = function(){};
for (const k of ['window','document','HTMLElement','Node','Event','CustomEvent','Image','Blob','File','localStorage','getComputedStyle','requestAnimationFrame'])
  if (w[k]!==undefined && globalThis[k]===undefined) globalThis[k]=w[k];
globalThis.window=w; globalThis.document=w.document;
Object.defineProperty(globalThis,'navigator',{ value:{ storage:{ estimate:async()=>({usage:1,quota:100}), persist:async()=>true, persisted:async()=>false } }, configurable:true });
const FDB = await import('fake-indexeddb');
globalThis.indexedDB = new FDB.IDBFactory(); globalThis.IDBKeyRange = FDB.IDBKeyRange;
globalThis.FileReader = class { readAsDataURL(b){ b.arrayBuffer().then(x=>{ this.result='data:;base64,'+Buffer.from(x).toString('base64'); this.onload&&this.onload(); }); } };

const errs=[]; process.on('unhandledRejection', r=>errs.push('unhandledRejection: '+(r&&r.stack||r)));
w.addEventListener('error', e=>errs.push('error: '+e.message));

const DB = await import('../js/db.js');
const UI = await import('../js/ui.js');
const V  = await import('../js/views.js');
const E  = await import('../js/export.js');

const orig = JSON.parse(fs.readFileSync(process.env.PMT_BACKUP,'utf8'));
await DB.importBackup(orig,'replace',()=>{});
UI.setRefsCache(await DB.getRefs());

let fail=0; const ok=(c,m)=>{ console.log((c?'  PASS ':'  FAIL ')+m); if(!c) fail++; };
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const main = w.document.getElementById('main');
const ev = (n,t='click')=>n.dispatchEvent(new w.Event(t,{bubbles:true}));

console.log('== Overview ==');
await V.overviewView(main, ()=>{}); await wait(150);
ok(main.querySelectorAll('.stat').length===6, `스탯 6개 (${main.querySelectorAll('.stat').length})`);
ok(main.querySelectorAll('.card').length>=5, `집계 카드 ${main.querySelectorAll('.card').length}개`);
ok(!main.textContent.includes('상태별'), 'Overview 에서 상태별 집계 제거');
ok(!main.querySelector('.progress'), '완료 진행률 바 제거');
ok(main.textContent.includes('작업 타입별 컷 수'), 'VFX 타입 집계 표시');
ok(main.textContent.includes('Cut (VFX 물량)'), '컷 물량 카운터');

console.log('== Project (멀티) ==');
await V.projectView(main, ()=>{}); await wait(150);
ok(main.querySelectorAll('.fgroup').length===3, `3블록 (기본/키스탭/딜리버리) — ${main.querySelectorAll('.fgroup').length}`);
ok(!!main.querySelector('.seg'), '영화/드라마 세그먼트 토글 존재');
const segBtns = main.querySelectorAll('.seg-btn');
ok(segBtns.length===2 && segBtns[0].textContent==='영화' && segBtns[1].textContent==='드라마', '세그먼트 = 영화/드라마');
ok(main.querySelectorAll('.field').length>=30, `프로젝트 필드 ${main.querySelectorAll('.field').length}개`);
ok(main.textContent.includes('VFX 슈퍼바이저') && main.textContent.includes('작업 컬러스페이스'), '보완 필드 추가됨');
ok(main.textContent.includes('AI 슈퍼바이저') && main.textContent.includes('VFX 어시스트'), 'AI 슈퍼바이저 / VFX 어시스트 추가');
ok(!main.textContent.includes('VFX 프로듀서'), 'VFX 프로듀서 제거됨');
ok(!!main.querySelector('.photo-tile img'), '포스터가 이미 있으면 이미지로 표시');
ev(segBtns[0]); await wait(700);
ok((await DB.getProject()).type==='영화', '세그먼트 클릭 → 저장');

console.log('== 리스트 페이지 (표) ==');
let routed = null; const go = (p)=>{ routed = p; };
await V.entityListView(main,'scenes',go); await wait(300);
ok(!main.querySelector('.split'), '좌우 분할 레이아웃 제거됨');
ok(!!main.querySelector('.page-head'), '페이지 헤더');
ok(!!main.querySelector('.eyebrow'), '섹션 번호 eyebrow');
ok(!!main.querySelector('table.dtable'), '표 형태 리스트');
const ths = Array.from(main.querySelectorAll('.dtable thead th')).map(t=>t.textContent);
ok(ths[0]==='NO' && ths[1]==='썸네일', `표 헤더 시작 ${ths.slice(0,2).join(' / ')}`);
ok(ths.includes('컷 / 테이크'), '씬 표에 컷/테이크 열');
const drows = main.querySelectorAll('tr.drow');
ok(drows.length===2, `데이터 행 ${drows.length}개`);
ok(!!main.querySelector('.tcell-img'), '썸네일 셀');
ok(main.querySelector('tr.drow .c-go').textContent==='›', '행마다 진입 화살표');

// 행 클릭 → 상세로 라우팅
ev(drows[0]); await wait(100);
ok(/^scenes\/[A-Za-z0-9-]+$/.test(routed||''), `행 클릭 → 상세 경로 (${routed})`);
const detailId = routed.split('/')[1];

console.log('== 상세 페이지 ==');
await V.entityDetailView(main,'scenes',detailId,go); await wait(400);
ok(!!main.querySelector('.detail-page'), '상세 페이지 렌더');
const backBtn = Array.from(main.querySelectorAll('button')).find(b=>b.textContent==='← 목록');
ok(!!backBtn, '← 목록 버튼');
ok(!!main.querySelector('.detail-head .idline code'), '상세에 ID 표시');
ok(Array.from(main.querySelectorAll('button')).some(b=>b.textContent==='삭제'), '삭제 버튼');
routed = null; ev(backBtn); await wait(150);
ok(routed==='scenes', `← 목록 → 리스트로 복귀 (${routed})`);
await V.entityDetailView(main,'scenes',detailId,go); await wait(400);
ok(!!main.querySelector('.cuts-sec'), '씬 에디터에 CUTS 섹션');
const cutCards = main.querySelectorAll('.cut-card');
ok(cutCards.length===1, `기존 컷 카드 ${cutCards.length}개`);
const shotBtns = main.querySelectorAll('.photo-empty .btn.shot');
ok(shotBtns.length>=2, `빈 썸네일에 버튼 ${shotBtns.length}개`);
ok(shotBtns[0].textContent.includes('촬영') && shotBtns[1].textContent.includes('선택'), '촬영 / 선택 둘 다 제공');

const addCutBtn = Array.from(main.querySelectorAll('.cuts-sec button')).find(b=>b.textContent==='+ 컷');
ok(!!addCutBtn, '+ 컷 버튼');
const sceneId = main.querySelector('.detail-head .idline code').textContent;
ev(addCutBtn); await wait(500);
const cutsNow = await DB.listCuts(sceneId);
ok(cutsNow.length===2, `컷 추가 1→2 (${cutsNow.length})`);
ok(cutsNow[1].vfxType===cutsNow[0].vfxType, '직전 컷 값 상속(타입)');
ok(main.querySelectorAll('.cut-card').length===2, '카드 2개로 리렌더');

const addTake = Array.from(main.querySelectorAll('.takes-head button')).find(b=>b.textContent==='+ 테이크');
ok(!!addTake, '+ 테이크 버튼');
ev(addTake); await wait(200); ev(addTake); await wait(800);
const afterCuts = await DB.listCuts(sceneId);
const totalTakes = afterCuts.reduce((a,c)=>a+(c.takes||[]).length,0);
ok(totalTakes===2, `테이크 2개가 DB에 저장됨 (총 ${totalTakes}, 컷별 ${afterCuts.map(c=>(c.takes||[]).length).join('/')})`);
const withTakes = afterCuts.find(c=>(c.takes||[]).length);
ok(withTakes && withTakes.takes[0].takeNo==='1' && withTakes.takes[1].takeNo==='2', '테이크 번호 자동 증가');
ok(main.querySelectorAll('.take-row').length===3, '테이크 표 = 헤더1 + 행2');
const monTiles = main.querySelectorAll('.tk-mon .photo-tile');
ok(monTiles.length===2, '테이크마다 모니터 사진 타일');

console.log('== 새 기본값 / 조건부 필드 ==');
{
  // 코드에 선언된 기본값 자체를 검사한다
  const { DEFAULT_REFS } = await import('../js/schema.js');
  const D = DEFAULT_REFS;
  ok(D.episodes.length===12 && D.episodes[11]==='EP12', `에피소드 EP01~EP12 (${D.episodes.length}개)`);
  ok(JSON.stringify(D.scenes)===JSON.stringify(['1-1','2-1']), `씬 ${JSON.stringify(D.scenes)}`);
  ok(JSON.stringify(D.units)===JSON.stringify(['A','B','C']), `유닛 ${JSON.stringify(D.units)}`);
  ok(D.tod.includes('SUNRISE') && D.tod.includes('SUNSET'), `시간대 ${D.tod.join(',')}`);
  ok(D.vfxTypes.includes('PREP'), `작업 타입 ${D.vfxTypes.join(',')}`);
  ok(JSON.stringify(D.vendors)===JSON.stringify(['WSWG','HI','4D','미정']), `벤더 ${JSON.stringify(D.vendors)}`);
  ok(JSON.stringify(D.assetTypes)===JSON.stringify(['캐릭터','프랍','차량','환경']), `에셋 타입 ${JSON.stringify(D.assetTypes)}`);
  ok(D.hdriCameras.includes('RICOH THETA'), 'HDRI 카메라에 RICOH THETA');
  for (const k of ['statuses','taskStates','propMethods','lidarOptions','assetMaterials','seasons'])
    ok(!(k in D), `폐기 목록 ${k} 없음`);
}
{
  // 구 백업을 가져오면 저장된 목록이 기본값을 가린다 (알려진 동작) → 복구 버튼으로 해소되는지
  const before = await DB.getRefs();
  ok(before.episodes.length === 20, `구 백업 가져오기 직후에는 저장된 목록이 우선 (에피소드 ${before.episodes.length}개)`);

  await V.settingsView(main); await wait(150);
  const fill = Array.from(main.querySelectorAll('button')).find(b=>b.textContent==='없는 기본 항목만 채우기');
  ev(fill); await wait(400);
  const filled = await DB.getRefs();
  ok(filled.tod.includes('SUNRISE') && filled.tod.includes('SUNSET'), '채우기 → SUNRISE/SUNSET 추가됨');
  ok(filled.vendors.includes('HI') && filled.vendors.includes('4D'), '채우기 → 새 벤더 추가됨');
  ok(filled.vendors.includes('DEXTER'), '채우기는 기존 항목을 지우지 않는다');
  ok(filled.hdriCameras.includes('RICOH THETA'), '채우기 → RICOH THETA 추가됨');

  await DB.setRefs(JSON.parse(JSON.stringify((await import('../js/schema.js')).DEFAULT_REFS)));
  UI.setRefsCache(await DB.getRefs());
  const reset = await DB.getRefs();
  ok(reset.episodes.length===12 && !reset.vendors.includes('DEXTER'), '완전 초기화 → 기본값만 남음');
}
{ // 영화로 바꾸면 에피소드 입력란이 사라진다
  const p = await DB.getProject(); p.type='드라마'; await DB.setProject(p);
  const one = (await DB.list('scenes'))[0];
  await V.entityDetailView(main,'scenes',one.id,()=>{}); await wait(300);
  ok(!!main.querySelector('input[list="dl-episodes"]'), '드라마 → 에피소드 입력란 있음');
  ok(!main.textContent.includes('상태'), '씬 폼에서 상태 제거');
  await V.entityListView(main,'scenes',()=>{}); await wait(200);
  ok(Array.from(main.querySelectorAll('.dtable thead th')).some(t=>t.textContent==='에피소드'), '드라마 → 표에 에피소드 열');
  const p2 = await DB.getProject(); p2.type='영화'; await DB.setProject(p2);
  await V.entityDetailView(main,'scenes',one.id,()=>{}); await wait(300);
  ok(!main.querySelector('input[list="dl-episodes"]'), '영화 → 에피소드 입력란 숨김');
  await V.entityListView(main,'scenes',()=>{}); await wait(200);
  ok(!Array.from(main.querySelectorAll('.dtable thead th')).some(t=>t.textContent==='에피소드'), '영화 → 표에서도 에피소드 열 숨김');
  const p3 = await DB.getProject(); p3.type='드라마'; await DB.setProject(p3);
}

console.log('== 나머지 엔티티 (리스트 + 상세) ==');
for (const k of ['locations','assets','cameras','hdri']){
  await V.entityListView(main,k,go); await wait(200);
  ok(!!main.querySelector('.page-head h1'), `${k} 리스트 헤더: ${main.querySelector('.page-head h1').textContent}`);
  ok(!main.querySelector('.split'), `${k}: 분할 레이아웃 아님`);
  const rs = await DB.list(k);
  if (rs.length){
    ok(main.querySelectorAll('tr.drow').length===rs.length, `${k} 행 ${rs.length}개`);
    await V.entityDetailView(main,k,rs[0].id,go); await wait(250);
    ok(!!main.querySelector('.detail-page .fgroup'), `${k} 상세 폼 렌더`);
  } else {
    ok(!!main.querySelector('.empty'), `${k}: 빈 목록 안내`);
  }
}
{ // 리스트에서 추가 → 새 레코드 상세로 이동
  await V.entityListView(main,'locations',go); await wait(200);
  const before = (await DB.list('locations')).length;
  const addBtn = Array.from(main.querySelectorAll('.page-head button')).find(b=>b.textContent.startsWith('+ '));
  ok(!!addBtn, `추가 버튼: ${addBtn && addBtn.textContent}`);
  routed = null; ev(addBtn); await wait(400);
  ok((await DB.list('locations')).length===before+1, '레코드 생성됨');
  ok(/^locations\//.test(routed||''), `생성 후 상세로 이동 (${routed})`);
}
await V.settingsView(main); await wait(150);
ok(main.querySelectorAll('.ref-card').length>=40, `Setting 레퍼런스 카드 ${main.querySelectorAll('.ref-card').length}개`);
ok(main.textContent.includes('드롭다운 기본값'), 'Setting 에 기본값 복구 섹션');
const fillBtn = Array.from(main.querySelectorAll('button')).find(b=>b.textContent==='없는 기본 항목만 채우기');
ok(!!fillBtn, '없는 기본 항목만 채우기 버튼');
await V.backupView(main, ()=>{}); await wait(150);
ok(main.textContent.includes('전체 프로젝트'), 'Backup 화면');

console.log('== 내보내기 ==');
let blob=null; const origC=globalThis.URL.createObjectURL;
globalThis.URL.createObjectURL=(b)=>{ blob=b; return 'blob:x'; };
w.HTMLAnchorElement.prototype.click=function(){};
await E.exportCSV('scenes', await DB.list('scenes')); await wait(200);
const csv = await blob.text();
ok(csv.includes('컷 번호') && csv.includes('OK 테이크'), 'Scene CSV 가 컷 단위로 펼쳐짐');
ok(!csv.split('\r\n')[0].includes('상태'), 'CSV 헤더에서 상태 열 제거');
ok(csv.split('\r\n').length-1 === (await DB.list('cuts')).length, `CSV 행 = 컷 수 ${(await DB.list('cuts')).length}`);
globalThis.URL.createObjectURL=origC;
await E.exportBreakdown(await DB.list('scenes')); await wait(500);
const pr = w.document.getElementById('printroot');
ok(!!pr && pr.querySelectorAll('.bd-card').length===2, `브레이크다운 씬 블록 ${pr?pr.querySelectorAll('.bd-card').length:0}`);
ok(pr.querySelectorAll('.bd-cuts tbody tr').length>=2, '브레이크다운에 컷 표 포함');
pr.remove(); w.document.body.classList.remove('printing');

console.log('== 콘솔 에러 ==');
ok(errs.length===0, `런타임 에러 ${errs.length}건 ${errs.slice(0,2).join(' | ')}`);
console.log(fail?`\n### 실패 ${fail}건`:'\n### 전체 통과');
process.exit(fail?1:0);
