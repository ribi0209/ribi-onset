import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const dom = new JSDOM(fs.readFileSync('../index.html','utf8'),
  { url:'https://example.test/', pretendToBeVisual:true, runScripts:'outside-only' });
const w = dom.window;

// --- 브라우저 API 셰임 ---
w.URL.createObjectURL = (b)=> 'blob:fake/'+Math.random().toString(36).slice(2);
w.URL.revokeObjectURL = ()=>{};
w.HTMLElement.prototype.scrollIntoView = function(){};
w.matchMedia = w.matchMedia || (()=>({matches:false,addListener(){},removeListener(){}}));

for (const k of ['window','document','HTMLElement','Node','Event','CustomEvent','CSS','Image','FileReader','Blob','File','localStorage','getComputedStyle','requestAnimationFrame','DOMParser'])
  if (w[k] !== undefined && globalThis[k] === undefined) globalThis[k] = w[k];
globalThis.window = w; globalThis.document = w.document;
Object.defineProperty(globalThis,'navigator',{ value:{ storage:{ estimate:async()=>({usage:1,quota:100}), persist:async()=>true, persisted:async()=>false } }, configurable:true });

const FDB = await import('fake-indexeddb');
globalThis.indexedDB = new FDB.IDBFactory();
for (const k of ['IDBKeyRange','IDBRequest','IDBTransaction','IDBDatabase','IDBObjectStore','IDBIndex','IDBCursor'])
  if (FDB[k]) globalThis[k] = FDB[k];
globalThis.FileReader = class { readAsDataURL(blob){ blob.arrayBuffer().then(b=>{ this.result='data:'+(blob.type||'')+';base64,'+Buffer.from(b).toString('base64'); this.onload&&this.onload(); }); } };

const errs = [];
w.addEventListener('error', e => errs.push('window.error: '+e.message));
process.on('unhandledRejection', r => errs.push('unhandledRejection: '+(r && r.stack || r)));

const DB = await import('../js/db.js');
const UI = await import('../js/ui.js');
const V  = await import('../js/views.js');
const { ENTITY_ORDER } = await import('../js/schema.js');

const orig = JSON.parse(fs.readFileSync(process.env.PMT_BACKUP,'utf8'));
await DB.importBackup(orig,'replace',()=>{});
UI.setRefsCache(await DB.getRefs());

let fail=0; const ok=(c,m)=>{ console.log((c?'  PASS ':'  FAIL ')+m); if(!c) fail++; };
const wait = (ms)=>new Promise(r=>setTimeout(r,ms));
const main = w.document.getElementById('main');

console.log('== 뷰 렌더링 ==');
await V.dashView(main, ()=>{}); await wait(60);
ok(main.querySelectorAll('.stat').length >= 6, `대시보드 렌더 (스탯 ${main.querySelectorAll('.stat').length}개)`);
ok(main.textContent.includes('PMT'), '대시보드에 프로젝트명 표시');
ok(!!main.querySelector('.poster'), '포스터 이미지 노드 생성');

for (const k of ENTITY_ORDER){
  await V.entityView(main, k); await wait(120);
  const recs = main.querySelectorAll('.reclist .rec').length;
  const flt  = main.querySelectorAll('.filterbar select').length;
  ok(!!main.querySelector('.split'), `${k}: 분할 레이아웃`);
  ok(flt > 0, `${k}: 필터 ${flt}개`);
  console.log(`       레코드 ${recs}건`);
}

console.log('== 컷 에디터 (레코드 선택 → 폼) ==');
await V.entityView(main,'scenes'); await wait(150);
const firstRec = main.querySelector('.reclist .rec');
ok(!!firstRec, '씬 리스트 항목 존재');
firstRec.dispatchEvent(new w.Event('click',{bubbles:true})); await wait(250);
const fields = main.querySelectorAll('.edit-pane .field').length;
const groups = main.querySelectorAll('.edit-pane .fgroup').length;
ok(groups === 6, `씬 폼 그룹 ${groups}/6`);
ok(fields === 21, `씬 폼 필드 ${fields}/21개 렌더 (cut·pDay 제거)`);
ok(!!main.querySelector('.edit-pane .idline code'), '씬 ID 표시');
ok(!main.querySelector('.edit-pane input[list="dl-pDays"]'), 'P-Day 입력란 없음');
ok(!main.querySelector('.edit-pane input[list="dl-cuts"]'), '컷 입력란 없음');
ok(main.querySelectorAll('.edit-pane .photo-tile').length >= 4, '사진 타일(대표1+현장3) 렌더');
ok(!!main.querySelector('.edit-pane input[list="dl-episodes"]'), '콤보가 datalist 에 연결됨');

console.log('== 입력 → 자동저장 ==');
const sceneInp = main.querySelector('.edit-pane input[list="dl-scenes"]');
const sceneId = main.querySelector('.edit-pane .idline code').textContent;
sceneInp.value = '9-9';
sceneInp.dispatchEvent(new w.Event('input',{bubbles:true}));
sceneInp.dispatchEvent(new w.Event('change',{bubbles:true}));
await wait(900);
const saved = await DB.get('scenes', sceneId);
ok(saved.scene === '9-9', `자동저장 확인 (scene=${saved.scene})`);
const refs2 = await DB.getRefs();
ok(refs2.scenes.includes('9-9'), '신규 콤보 값이 레퍼런스에 자동 편입');

console.log('== 신규 컷 생성 + 값 상속 ==');
const before = (await DB.list('scenes')).length;
main.querySelector('.actionbar .btn.primary').dispatchEvent(new w.Event('click',{bubbles:true}));
await wait(400);
const after = await DB.list('scenes');
ok(after.length === before+1, `씬 생성 ${before}→${after.length}`);
const nu = after.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
ok(!!nu.shootDate && !!nu.shootTime, `자동 타임스탬프 ${nu.shootDate} ${nu.shootTime}`);
ok(nu.unit && nu.status, `이전 씬 값 상속 (unit=${nu.unit}, status=${nu.status}, vendor=${nu.vendor})`);
ok(/^PMT-\d{8}-\d{6}-/.test(nu.id), `ID 규칙 ${nu.id}`);

console.log('== 프로젝트 / 레퍼런스 / 백업 뷰 ==');
await V.projectView(main); await wait(100);
ok(main.querySelectorAll('.field').length >= 26, `프로젝트 필드 ${main.querySelectorAll('.field').length}개`);
await V.refsView(main); await wait(100);
ok(main.querySelectorAll('.ref-card').length >= 45, `레퍼런스 카드 ${main.querySelectorAll('.ref-card').length}개`);
ok(main.querySelectorAll('.chips .chip').length > 300, `레퍼런스 항목 ${main.querySelectorAll('.chips .chip').length}개 렌더`);
await V.backupView(main, ()=>{}); await wait(100);
ok(main.textContent.includes('저장소 사용량'), '백업 뷰 렌더');

console.log('== 내보내기 ==');
const E = await import('../js/export.js');
const cuts = await DB.list('scenes');
let csvBlob=null;
const origCreate = globalThis.URL.createObjectURL;
globalThis.URL.createObjectURL = (b)=>{ csvBlob=b; return 'blob:x'; };
w.HTMLAnchorElement.prototype.click = function(){};
await E.exportCSV('scenes', cuts); await wait(50);
ok(csvBlob && csvBlob.size > 100, `CSV 생성 (${csvBlob && csvBlob.size} bytes)`);
const csvText = await csvBlob.text();
const csvBytes = new Uint8Array(await csvBlob.arrayBuffer());
ok(csvBytes[0]===0xEF && csvBytes[1]===0xBB && csvBytes[2]===0xBF, 'CSV UTF-8 BOM (엑셀 한글 깨짐 방지)');
ok(csvText.split('\r\n').length === cuts.length+1, `CSV 행 수 ${csvText.split('\r\n').length-1}/${cuts.length}`);
globalThis.URL.createObjectURL = origCreate;

await E.exportBreakdown(cuts); await wait(300);
const pr = w.document.getElementById('printroot');
ok(!!pr, '브레이크다운 인쇄 DOM 생성');
ok(pr.querySelectorAll('.bd-card').length === cuts.length, `브레이크다운 카드 ${pr.querySelectorAll('.bd-card').length}/${cuts.length}`);
ok(w.document.body.classList.contains('printing'), '인쇄 모드 활성');
pr.remove(); w.document.body.classList.remove('printing');

await E.exportPrint('locations', await DB.list('locations')); await wait(200);
const pr2 = w.document.getElementById('printroot');
ok(pr2.querySelectorAll('.ptable tbody tr').length === 3, '로케이션 인쇄 표 3행');

console.log('== 콘솔 에러 ==');
ok(errs.length===0, `런타임 에러 ${errs.length}건 ${errs.slice(0,3).join(' | ')}`);

console.log(fail ? `\n### 실패 ${fail}건` : '\n### 전체 통과');
process.exit(fail?1:0);
