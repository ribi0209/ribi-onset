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
ok(main.querySelectorAll('.card').length===6, `집계 카드 6개 (${main.querySelectorAll('.card').length})`);
ok(main.textContent.includes('작업 타입별 컷 수'), 'VFX 타입 집계 표시');
ok(!!main.querySelector('.progress'), '진행률 바');
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

console.log('== Scene List → 컷 → 테이크 ==');
await V.entityView(main,'scenes'); await wait(250);
const rec1 = main.querySelector('.reclist .rec');
ok(!!rec1, '씬 리스트 렌더');
ok(main.querySelector('.rec .tag.t-cut')!==null, '리스트에 컷 수 뱃지 표시');
ev(rec1); await wait(400);
ok(!!main.querySelector('.cuts-sec'), '씬 에디터에 CUTS 섹션');
const cutCards = main.querySelectorAll('.cut-card');
ok(cutCards.length===1, `기존 컷 카드 ${cutCards.length}개`);
const shotBtns = main.querySelectorAll('.photo-empty .btn.shot');
ok(shotBtns.length>=2, `빈 썸네일에 버튼 ${shotBtns.length}개`);
ok(shotBtns[0].textContent.includes('촬영') && shotBtns[1].textContent.includes('선택'), '촬영 / 선택 둘 다 제공');

const addCutBtn = Array.from(main.querySelectorAll('.cuts-sec button')).find(b=>b.textContent==='+ 컷');
ok(!!addCutBtn, '+ 컷 버튼');
const sceneId = main.querySelector('.edit-head code').textContent;
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

console.log('== 나머지 화면 ==');
for (const k of ['locations','assets','cameras','hdri']){
  await V.entityView(main,k); await wait(150);
  ok(!!main.querySelector('.split'), `${k} 렌더`);
}
await V.settingsView(main); await wait(150);
ok(main.querySelectorAll('.ref-card').length>=45, `Setting 레퍼런스 카드 ${main.querySelectorAll('.ref-card').length}개`);
await V.backupView(main, ()=>{}); await wait(150);
ok(main.textContent.includes('전체 프로젝트'), 'Backup 화면');

console.log('== 내보내기 ==');
let blob=null; const origC=globalThis.URL.createObjectURL;
globalThis.URL.createObjectURL=(b)=>{ blob=b; return 'blob:x'; };
w.HTMLAnchorElement.prototype.click=function(){};
await E.exportCSV('scenes', await DB.list('scenes')); await wait(200);
const csv = await blob.text();
ok(csv.includes('컷 번호') && csv.includes('OK 테이크'), 'Scene CSV 가 컷 단위로 펼쳐짐');
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
