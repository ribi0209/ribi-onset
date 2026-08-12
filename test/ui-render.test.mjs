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
w.HTMLCanvasElement.prototype.getContext = function(){
  const noop = ()=>{};
  return { fillRect:noop, strokeRect:noop, beginPath:noop, moveTo:noop, lineTo:noop,
           stroke:noop, drawImage:noop, getImageData:()=>({data:[]}), putImageData:noop,
           set fillStyle(v){}, set strokeStyle(v){}, set lineWidth(v){},
           set lineCap(v){}, set lineJoin(v){}, set imageSmoothingQuality(v){} };
};
w.HTMLCanvasElement.prototype.toBlob = function(cb){ cb(new w.Blob([new Uint8Array([1,2,3])],{type:'image/png'})); };
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
ok(main.querySelectorAll('.stat').length===5, `스탯 5개 (${main.querySelectorAll('.stat').length})`);
ok(main.querySelectorAll('.card').length>=5, `집계 카드 ${main.querySelectorAll('.card').length}개`);
ok(!main.textContent.includes('상태별'), 'Overview 에서 상태별 집계 제거');
ok(!main.querySelector('.progress'), '완료 진행률 바 제거');
ok(main.textContent.includes('캠 기록'), '캠 기록 카운터');
ok(main.textContent.includes('카메라별 기록 수'), '카메라별 집계');
ok(!main.textContent.includes('Cut (VFX 물량)'), '컷 카운터 제거됨');

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
const ths = Array.from(main.querySelectorAll('.dtable thead th')).map(t=>(t.querySelector('span')||t).textContent);
ok(ths[0]==='NO' && ths[1]==='썸네일', `표 헤더 시작 ${ths.slice(0,2).join(' / ')}`);
ok(ths.includes('캠 기록'), '씬 표에 캠 기록 열');
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
ok(!main.querySelector('.cuts-sec'), 'CUTS 섹션 제거됨');
ok(main.querySelector('.detail-head h2').textContent==='Scene List', '상세 상단 제목 = Scene List');

const camTabs = main.querySelectorAll('.cam-tab');
ok(camTabs.length===4, `캠 탭 A~D 4개 (${camTabs.length})`);
ok(Array.from(camTabs).map(t=>t.querySelector('b').textContent).join('')==='ABCD', '탭 라벨 A B C D');
ok(camTabs[0].classList.contains('on'), '첫 탭이 선택 상태');
ok(Array.from(main.querySelectorAll('.cam-tabs button')).some(b=>b.textContent.includes('모니터 촬영')),
   '모니터 촬영 버튼');

const shotBtns = main.querySelectorAll('.photo-empty .btn.shot');
ok(shotBtns.length>=2, `빈 썸네일에 버튼 ${shotBtns.length}개`);
ok(shotBtns[0].textContent.includes('촬영') && shotBtns[1].textContent.includes('선택'), '촬영 / 선택 둘 다 제공');

const sceneId = main.querySelector('.detail-head .idline code').textContent;

console.log('== 캠 탭: 값이 캠별로 분리 저장되는가 ==');
{
  const camRollInp = Array.from(main.querySelectorAll('.field'))
    .find(f => f.querySelector('label') && f.querySelector('label').textContent.startsWith('캠 롤'))
    .querySelector('input');
  camRollInp.value = 'A027';
  camRollInp.dispatchEvent(new w.Event('input',{bubbles:true}));
  await wait(700);

  let rec = await DB.get('scenes', sceneId);
  ok(rec.cams && rec.cams.A && rec.cams.A.camRoll==='A027', `A탭 값이 cams.A 에 저장 (${rec.cams&&rec.cams.A&&rec.cams.A.camRoll})`);
  ok(!rec.camRoll, '레코드 최상단은 오염되지 않음');

  // B 탭으로 전환하면 입력칸이 비어 있어야 한다
  ev(camTabs[1]); await wait(300);
  const bInp = Array.from(main.querySelectorAll('.field'))
    .find(f => f.querySelector('label') && f.querySelector('label').textContent.startsWith('캠 롤'))
    .querySelector('input');
  ok(bInp.value==='', `B 탭은 빈 값 (${JSON.stringify(bInp.value)})`);
  bInp.value = 'B027';
  bInp.dispatchEvent(new w.Event('input',{bubbles:true}));
  await wait(700);

  rec = await DB.get('scenes', sceneId);
  ok(rec.cams.A.camRoll==='A027' && rec.cams.B.camRoll==='B027',
     `A/B 가 각각 보존 (A=${rec.cams.A.camRoll} B=${rec.cams.B.camRoll})`);

  const { usedCams, camSummaryLine } = await import('../js/schema.js');
  ok(usedCams('scenes', rec).join('')==='AB', `사용 중인 캠 ${usedCams('scenes', rec).join(',')}`);
  ok(camSummaryLine('scenes', rec)==='A: A027 · B: B027', `리스트 요약 "${camSummaryLine('scenes', rec)}"`);

  // 씬 공통 필드는 탭과 무관해야 한다
  const noteTa = Array.from(main.querySelectorAll('.field'))
    .find(f => f.querySelector('label') && f.querySelector('label').textContent==='씬 노트')
    .querySelector('textarea');
  noteTa.value = '공통 노트';
  noteTa.dispatchEvent(new w.Event('input',{bubbles:true}));
  await wait(700);
  ev(main.querySelectorAll('.cam-tab')[0]); await wait(300);
  const noteAfter = Array.from(main.querySelectorAll('.field'))
    .find(f => f.querySelector('label') && f.querySelector('label').textContent==='씬 노트')
    .querySelector('textarea');
  ok(noteAfter.value==='공통 노트', '씬 노트는 탭을 바꿔도 유지 (씬 공통)');
  rec = await DB.get('scenes', sceneId);
  ok(rec.shotNote==='공통 노트' && !rec.cams.A.shotNote, '공통 필드는 cams 밑으로 새지 않음');
}

console.log('== 에셋 / HDRI 드롭다운 선택 ==');
{
  const assetField = Array.from(main.querySelectorAll('.field'))
    .find(f => f.querySelector('label') && f.querySelector('label').textContent==='에셋');
  ok(!!assetField, '에셋 필드 존재');
  const sel = assetField.querySelector('select.link-add');
  ok(!!sel, '드롭다운으로 고른다 (다이얼로그 아님)');
  if (sel && sel.options.length>1){
    sel.value = sel.options[1].value;
    sel.dispatchEvent(new w.Event('change',{bubbles:true}));
    await wait(700);
    const rec2 = await DB.get('scenes', sceneId);
    ok((rec2.linkedAssetIds||[]).length===1, `선택 시 연결됨 (${JSON.stringify(rec2.linkedAssetIds)})`);
    ok(!!assetField.querySelector('.chip'), '선택한 항목은 칩으로 표시');
  }
}

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
  const epField = () => Array.from(main.querySelectorAll('.field'))
    .find(f => f.querySelector('label') && f.querySelector('label').textContent === '에피소드');
  ok(!!epField(), '드라마 → 에피소드 칸 있음');
  ok(!!epField().querySelector('.combo select'), '콤보는 드롭다운(select) 으로 렌더');
  ok(!main.textContent.includes('상태'), '씬 폼에서 상태 제거');
  await V.entityListView(main,'scenes',()=>{}); await wait(200);
  ok(Array.from(main.querySelectorAll('.dtable thead th')).some(t=>(t.querySelector('span')||t).textContent==='에피소드'), '드라마 → 표에 에피소드 열');
  const p2 = await DB.getProject(); p2.type='영화'; await DB.setProject(p2);
  await V.entityDetailView(main,'scenes',one.id,()=>{}); await wait(300);
  ok(!Array.from(main.querySelectorAll('.field'))
      .some(f => f.querySelector('label') && f.querySelector('label').textContent === '에피소드'),
     '영화 → 에피소드 칸 숨김');
  await V.entityListView(main,'scenes',()=>{}); await wait(200);
  ok(!Array.from(main.querySelectorAll('.dtable thead th')).some(t=>(t.querySelector('span')||t).textContent==='에피소드'), '영화 → 표에서도 에피소드 열 숨김');
  const p3 = await DB.getProject(); p3.type='드라마'; await DB.setProject(p3);
}

console.log('== 로케이션 개편 ==');
{
  const { ENTITIES } = await import('../js/schema.js');
  const L = ENTITIES.locations;
  const g0 = L.groups[0].fields.map(f=>f.k);
  ok(JSON.stringify(g0)===JSON.stringify(['thumbnail','mainLocation','subLocation','setId','setType','intExt','path']),
     `기본정보 순서 ${g0.join(' → ')}`);
  ok(L.groups[0].cols===4, `기본정보 고정 ${L.groups[0].cols}열`);
  const sp = Object.fromEntries(L.groups[0].fields.map(f=>[f.k, f.span]));
  // 6열 기준: 1행 썸(1)+대장소(2)+소장소(2)+SETID(1)=6 / 2행 세트타입(2)+INT-EXT(2) / 3행 주소(5)
  ok(sp.thumbnail===1 && sp.mainLocation===1 && sp.subLocation===1 && sp.setId===1,
     `1행 = 썸네일+대장소+소장소+SETID 각 1칸 (합 ${sp.thumbnail+sp.mainLocation+sp.subLocation+sp.setId} = 4)`);
  ok(sp.setType===1 && sp.intExt===1, '2행: 세트 타입 · INT/EXT 도 각 1칸');
  const widths = new Set([sp.mainLocation, sp.subLocation, sp.setId, sp.setType, sp.intExt]);
  ok(widths.size===1, `입력칸 5개 폭이 모두 동일 (${[...widths]}칸)`);
  ok(sp.path===3, `3행: 주소 ${sp.path}칸 (썸네일 옆 전체)`);
  ok(L.groups[0].fields.find(f=>f.k==='thumbnail').rowSpan===3, '썸네일이 3행 관통');
  ok(!L.groups.some(g=>g.fields.some(f=>f.k==='shootLocation')), '촬영장소 필드 제거');
  const sk = L.groups.find(g=>g.title==='내용').fields.find(f=>f.t==='sketch');
  ok(!!sk, `S펜 스케치 필드 추가 (${sk && sk.label})`);
  const ph = L.groups.find(g=>g.title==='사진').fields;
  ok(ph.length===2, `사진 그룹 ${ph.length}종 (서베이 제거)`);
  const nC = ph.find(f=>f.k==='conceptPhotos').n, nL = ph.find(f=>f.k==='locationPhotos').n;
  ok(nC===7 && nL===7, `컨셉 ${nC}장 / 현장 ${nL}장 (동일)`);
  ok(!ph.some(f=>f.k==='surveyPhotos'), '서베이 사진 제거');
  ok(L.titleFields[0]==='mainLocation', '리스트 제목 = 대장소');

  const loc = (await DB.list('locations'))[0];
  await V.entityDetailView(main,'locations',loc.id,()=>{}); await wait(350);
  const g = main.querySelector('.grid.fixed');
  ok(!!g, '고정 격자 렌더');
  ok(g.getAttribute('style').includes('--cols:4'), `열 수 지정 (${g.getAttribute('style')})`);
  const st = k => main.querySelector('.grid.fixed').children;
  const cells = Array.from(g.children);
  ok(cells[1].getAttribute('style')==='grid-column:span 1', `대장소 span (${cells[1].getAttribute('style')})`);
  ok(cells[0].getAttribute('style').includes('grid-row:span 3'), `썸네일 rowSpan (${cells[0].getAttribute('style')})`);
  ok(cells[6].getAttribute('style')==='grid-column:span 3', `주소 span (${cells[6].getAttribute('style')})`);
  ok(!!main.querySelector('.sketch canvas'), '상세에 스케치 캔버스 렌더');
  const { PEN_COLORS } = await import('../js/ui.js');
  const sw = main.querySelectorAll('.sk-color');
  ok(sw.length===PEN_COLORS.length && sw.length===5, `색상 스와치 ${sw.length}개`);
  ok(sw[0].classList.contains('on'), '기본 색상 선택 표시');
  ok(sw[1].getAttribute('style').includes(PEN_COLORS[1].v), `2번째 = ${PEN_COLORS[1].n} ${PEN_COLORS[1].v}`);
  ev(sw[2]); await wait(80);
  ok(sw[2].classList.contains('on') && !sw[0].classList.contains('on'), '색상 선택 전환');
  ok(w.localStorage.getItem('ribi-pen-color')===PEN_COLORS[2].v, '선택한 색상 기억');
  ok(main.querySelectorAll('.sk-size').length===3, '굵기 3단계');
  ok(main.querySelectorAll('.sk-mode').length===2, '펜 / 지우개');
  const eraser = Array.from(main.querySelectorAll('.sk-mode')).find(b=>b.textContent==='지우개');
  ev(eraser); await wait(60);
  ok(eraser.classList.contains('on'), '지우개 선택 표시');
  ev(sw[0]); await wait(60);
  ok(!eraser.classList.contains('on'), '색을 고르면 펜 모드로 복귀');
  const { sketchPad } = await import('../js/ui.js');
  ok(typeof sketchPad === 'function', 'sketchPad 공용 위젯 export');
  const tiles = main.querySelectorAll('.photo-grid');
  ok(tiles.length===2, `사진 그리드 2개 (${tiles.length})`);
  ok(tiles[0].children.length===7 && tiles[1].children.length===7,
     `컨셉 ${tiles[0].children.length}칸 / 현장 ${tiles[1].children.length}칸`);
  ok(tiles[0].classList.contains('fixed') && tiles[1].classList.contains('fixed'), '사진 격자 열 수 고정');
  ok(tiles[0].getAttribute('style')==='--pcols:7' && tiles[1].getAttribute('style')==='--pcols:7',
     `열 수 = 사진 개수 (${tiles[0].getAttribute('style')}) → 항상 한 행에 딱 맞음`);
  await V.entityListView(main,'locations',()=>{}); await wait(250);
  const ths = Array.from(main.querySelectorAll('.dtable thead th')).map(t=>(t.querySelector('span')||t).textContent);
  ok(ths.includes('대장소') && ths.includes('소장소') && ths.includes('SET ID'), `표 헤더 ${ths.join(' / ')}`);
  ok(ths.includes('설명'), '목록에 설명 열 추가');
  ok(!ths.includes('3D 스캔') && !ths.includes('HDRI'), '목록에서 3D 스캔 / HDRI 제거');
}

console.log('== 촬영+추가 버튼 제거 ==');
for (const k of ['scenes','locations','assets','cameras','hdri']){
  await V.entityListView(main,k,()=>{}); await wait(180);
  const btns = Array.from(main.querySelectorAll('.page-head button')).map(b=>b.textContent);
  ok(!btns.some(t=>t.includes('촬영')), `${k}: 촬영+추가 없음 (${btns.join('/')})`);
}

console.log('== 에셋 개편 ==');
{
  const { ENTITIES } = await import('../js/schema.js');
  const A = ENTITIES.assets;
  const keys = A.groups.flatMap(g=>g.fields.map(f=>f.k));
  for (const dead of ['path','memo','propMethod','lidar','hdri','model3d','material',
                      'imagePhotos','surveyPhotos','platePhotos'])
    ok(!keys.includes(dead), `제거됨: ${dead}`);
  ok(!A.groups.some(g=>g.title==='데이터 취득'), '데이터 취득 그룹 제거');
  const sk = A.groups.find(g=>g.title==='내용').fields.find(f=>f.t==='sketch');
  ok(!!sk, `S펜 추가 (${sk && sk.label})`);
  const bl = keys.includes('linkedSceneIds') && A.groups.flatMap(g=>g.fields).find(f=>f.k==='linkedSceneIds');
  ok(bl && bl.t==='backlink' && bl.from==='scenes' && bl.via==='linkedAssetIds',
     `연결 씬 = 역방향 자동 (${bl && bl.t})`);
  const sp = A.groups.find(g=>g.title==='소스 사진').fields[0];
  ok(sp.k==='sourcePhotos' && sp.n===21 && sp.perRow===7, `소스 사진 ${sp.n}칸 / 한 줄 ${sp.perRow}개`);
  // 씬 쪽에 연결 에셋 필드
  const S2 = ENTITIES.scenes.groups.flatMap(g=>g.fields).find(f=>f.k==='linkedAssetIds');
  ok(S2 && S2.t==='link' && S2.to==='assets', '씬에서 에셋을 연결한다 (link)');
}
{ // 실제 동작: 씬에서 에셋 연결 → 에셋 화면에 자동 표시
  const scene = (await DB.list('scenes'))[0];
  const asset = (await DB.list('assets'))[0];
  scene.linkedAssetIds = [asset.id];
  await DB.put('scenes', scene);

  let jumped = null;
  await V.entityDetailView(main,'assets',asset.id,(p)=>{ jumped = p; }); await wait(350);
  const chips = main.querySelectorAll('.backlink .chip.link');
  ok(chips.length===1, `에셋 화면에 연결 씬 ${chips.length}개 자동 표시`);
  ev(chips[0]); await wait(80);
  ok(jumped===`scenes/${scene.id}`, `칩 클릭 → 해당 씬으로 이동 (${jumped})`);
  const grids = main.querySelectorAll('.photo-grid');
  ok(grids.length===1 && grids[0].children.length===21, `소스 사진 ${grids[0].children.length}칸`);
  ok(grids[0].getAttribute('style')==='--pcols:7', `한 줄 7개 (${grids[0].getAttribute('style')})`);
  scene.linkedAssetIds = []; await DB.put('scenes', scene);
  await V.entityDetailView(main,'assets',asset.id,()=>{}); await wait(300);
  ok(main.querySelectorAll('.backlink .chip.link').length===0, '연결 해제하면 사라짐');
}

console.log('== HDRI 개편 ==');
{
  const { ENTITIES } = await import('../js/schema.js');
  const H = ENTITIES.hdri;
  ok(H.labelKo==='HDRI' && H.title==='HDRI 정보', `이름에서 '조명' 제거 (${H.labelKo} / ${H.title})`);
  const keys = H.groups.flatMap(g=>g.fields.map(f=>f.k));
  ok(!keys.includes('shootDate') && !keys.includes('shootTime'), '촬영일/촬영시각 제거');
  ok(!keys.includes('subLocation'), '세부 장소 제거');
  ok(!H.autoStamp, '자동 타임스탬프 해제');
  const g0 = H.groups[0];
  ok(g0.cols===4, `기본정보 ${g0.cols}열`);
  const sp = Object.fromEntries(g0.fields.map(f=>[f.k,f.span]));
  ok(sp.hdriId===1 && sp.locationId===2, '1행: HDRI ID · 로케이션');
  ok(sp.intExt===1 && sp.tod===1, '2행: INT/EXT · 시간대');
  const loc = g0.fields.find(f=>f.k==='locationId');
  ok(loc.t==='recordRef' && loc.to==='locations', `로케이션 = 로케이션 페이지 연동 (${loc.t} → ${loc.to})`);
  const ph = H.groups.find(g=>g.title==='사진 / 메모').fields;
  ok(ph.find(f=>f.k==='hdriPhotos').n===8, `HDRI 소스 ${ph.find(f=>f.k==='hdriPhotos').n}칸`);
  const sk = ph.find(f=>f.t==='sketch');
  ok(!!sk, 'S펜 추가');
  ok(ph.map(f=>f.k).indexOf('notes') < ph.map(f=>f.k).indexOf('sketch'), '비고 다음에 S펜');
}
{ // 실제 동작: 로케이션 드롭다운 + 이름 표시
  const { displayName } = await import('../js/schema.js');
  const hdri = await DB.list('hdri');
  let rec = hdri[0];
  if (!rec){
    rec = { id:'HDR-TEST01', projectId:(await DB.getProject()).id, hdriId:'H-01' };
    await DB.put('hdri', rec);
  }
  await V.entityDetailView(main,'hdri',rec.id,()=>{}); await wait(350);
  const locs = await DB.list('locations');
  const sel = Array.from(main.querySelectorAll('select.inp'))
    .find(s => Array.from(s.options).some(o => locs.some(l => l.id === o.value)));
  ok(!!sel, '로케이션 드롭다운이 Location 레코드로 채워짐');
  ok(sel.options.length === locs.length + 1, `옵션 ${sel.options.length-1}개 = 로케이션 ${locs.length}건`);
  sel.value = locs[0].id; ev(sel,'change'); await wait(800);
  const saved = await DB.get('hdri', rec.id);
  ok(saved.locationId === locs[0].id, `id 로 저장됨 (${saved.locationId})`);

  // 목록에서는 id 가 아니라 이름으로 보인다
  await V.entityListView(main,'hdri',()=>{}); await wait(300);
  const rowTxt = main.querySelector('tr.drow').textContent;
  ok(!rowTxt.includes('LOC-'), '목록에 id 노출 안 함');
  ok(rowTxt.includes(displayName('locations', locs[0]).split(' — ')[0]), `목록에 로케이션 이름 표시: ${displayName('locations', locs[0])}`);
  const grids = () => main.querySelectorAll('.photo-grid');
  await V.entityDetailView(main,'hdri',rec.id,()=>{}); await wait(350);
  ok(grids()[0].children.length===8, `HDRI 소스 ${grids()[0].children.length}칸 렌더`);
  ok(!!main.querySelector('.sketch canvas'), 'S펜 캔버스 렌더');
}

console.log('== 카메라: 목록형 (상세 없음) ==');
{
  const { ENTITIES } = await import('../js/schema.js');
  ok(ENTITIES.cameras.inline === true, 'cameras.inline = true');
  ok(Array.isArray(ENTITIES.cameras.inlineFields) && ENTITIES.cameras.inlineFields.length >= 10,
     `inlineFields ${ENTITIES.cameras.inlineFields.length}개`);

  let routed = null;
  await V.entityListView(main,'cameras',(p)=>{ routed = p; }); await wait(300);
  ok(!main.querySelector('table.dtable'), '표가 아니라 목록형');
  ok(!!main.querySelector('.inline-list'), '인라인 목록 렌더');
  const cams = await DB.list('cameras');
  const rowsN = main.querySelectorAll('.inline-row');
  ok(rowsN.length===cams.length, `카메라 ${rowsN.length}행`);
  ok(rowsN[0].querySelector('.inline-no').textContent==='1', 'NO 표시');
  ok(!!rowsN[0].querySelector('.inline-thumb .photo-tile'), '행마다 썸네일');
  const labels = Array.from(rowsN[0].querySelectorAll('.inline-cell > label')).map(l=>l.textContent);
  ok(labels[0]==='Cam Roll' && labels[1]==='카메라 이름', `라벨 순서 ${labels.slice(0,4).join(' / ')}`);
  ok(rowsN[0].querySelectorAll('.inline-cell .inp').length>=10, '행에서 바로 입력 가능');

  // 행을 눌러도 상세로 가지 않는다
  ev(rowsN[0]); await wait(120);
  ok(routed===null, `행 클릭해도 상세 이동 없음 (${routed})`);

  // 목록에서 바로 편집 → 저장 (콤보는 드롭다운, 없는 값은 '직접 입력' 으로)
  const sel = rowsN[0].querySelector('.inline-cell .combo select');
  ok(!!sel, '인라인 콤보도 드롭다운');
  const customOpt = Array.from(sel.options).find(o=>o.textContent.includes('직접 입력'));
  ok(!!customOpt, "'직접 입력…' 선택지 제공");
  sel.value = customOpt.value; ev(sel,'change'); await wait(120);
  const inp = rowsN[0].querySelector('.inline-cell .combo input');
  ok(!!inp, '직접 입력을 고르면 입력칸으로 바뀜');
  inp.value = 'Z9'; ev(inp,'input'); ev(inp,'change'); await wait(800);
  const after = (await DB.list('cameras')).find(c=>c.id===cams[0].id) ||
                (await DB.list('cameras')).find(c=>c.camRoll==='Z9');
  ok(!!(await DB.list('cameras')).some(c=>c.camRoll==='Z9'), `목록에서 편집 → 저장됨`);

  // 추가
  const before = cams.length;
  const addBtn = Array.from(main.querySelectorAll('.page-head button')).find(b=>b.textContent.startsWith('+ '));
  ev(addBtn); await wait(500);
  ok((await DB.list('cameras')).length===before+1, '목록에서 바로 추가');
  ok(main.querySelectorAll('.inline-row').length===before+1, '행이 즉시 늘어남');
}

console.log('== 나머지 엔티티 (리스트 + 상세) ==');
for (const k of ['locations','assets','hdri']){
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
ok(csv.includes('캠') && csv.includes('캠 롤') && csv.includes('클립'), 'Scene CSV 가 캠 단위로 펼쳐짐');
ok(!csv.includes('컷 번호') && !csv.includes('OK 테이크'), 'CSV 에서 컷/테이크 열 제거');
ok(!csv.split('\r\n')[0].includes('상태'), 'CSV 헤더에서 상태 열 제거');
{
  const { usedCams } = await import('../js/schema.js');
  const scs = await DB.list('scenes');
  const want = scs.reduce((a,s)=>a + Math.max(1, usedCams('scenes', s).length), 0);
  ok(csv.split('\r\n').length-1 === want, `CSV 행 = 캠 기록 수 ${want}`);
  ok(csv.includes('A027') && csv.includes('B027'), '캠 롤이 실제로 실려 나감');
}
globalThis.URL.createObjectURL=origC;
await E.exportBreakdown(await DB.list('scenes')); await wait(500);
const pr = w.document.getElementById('printroot');
ok(!!pr && pr.querySelectorAll('.bd-card').length===2, `브레이크다운 씬 블록 ${pr?pr.querySelectorAll('.bd-card').length:0}`);
ok(pr.querySelectorAll('.bd-cuts tbody tr').length>=2, '브레이크다운에 캠 표 포함');
pr.remove(); w.document.body.classList.remove('printing');

console.log('== 콘솔 에러 ==');
ok(errs.length===0, `런타임 에러 ${errs.length}건 ${errs.slice(0,2).join(' | ')}`);
console.log(fail?`\n### 실패 ${fail}건`:'\n### 전체 통과');
process.exit(fail?1:0);
