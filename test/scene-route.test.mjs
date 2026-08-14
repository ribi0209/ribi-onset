/* 씬 상세 진입 회귀 테스트
 *
 * 실제로 났던 버그: 프로젝트명이 한글이면 씬 ID 도 한글로 시작한다(프로젝-2026…).
 * 브라우저는 location.hash 를 퍼센트 인코딩해서 돌려주므로, 디코드하지 않으면
 * DB 조회가 빗나가 "기록을 찾을 수 없습니다" 가 떴다.
 * Location(LOC-) / HDRI(HDR-) 는 ASCII 라 멀쩡했기 때문에 눈에 안 띄었다.
 */
globalThis.RIBI_TEST = true;

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

let fail=0; const ok=(c,m)=>{ console.log((c?'  PASS ':'  FAIL ')+m); if(!c) fail++; };
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));

const DB = await import('../js/db.js');
const UI = await import('../js/ui.js');
const V  = await import('../js/views.js');
const { parseRoute } = await import('../js/app.js');

console.log('== 해시 라우트 파싱 ==');
{
  const koId = '프로젝-20260811-101010-AB12';
  // 브라우저가 실제로 돌려주는 형태를 그대로 만든다
  const u = new URL('https://example.test/'); u.hash = '#/scenes/' + koId;
  ok(u.hash.includes('%'), `브라우저가 해시를 인코딩함 (${u.hash.slice(0,24)}…)`);

  const r = parseRoute(u.hash);
  ok(r.k === 'scenes', `엔티티 ${r.k}`);
  ok(r.id === koId, `한글 씬 ID 복원 (${r.id})`);

  ok(parseRoute('#/locations/LOC-CD4CB54D').id === 'LOC-CD4CB54D', 'ASCII ID 는 그대로');
  ok(parseRoute('#/overview').id === null, 'id 없는 경로');
  ok(parseRoute('#/없는페이지').k === 'overview', '모르는 경로는 Overview 로');
}

console.log('== 씬 생성 → 상세 진입 ==');
{
  await DB.open();
  const p = await DB.getProject();
  p.name = '프로젝트 1'; p.type = '드라마';
  await DB.setProject(p);
  UI.setRefsCache(await DB.getRefs());

  const sceneId = DB.makeSceneId(p.name);
  ok(/^[가-힣]/.test(sceneId), `한글 프로젝트명 → 한글 씬 ID (${sceneId})`);

  const main = w.document.getElementById('main');

  // 목록에서 "+ 씬 추가" 를 눌러 실제 생성 경로를 탄다
  let routed = null;
  await V.entityListView(main, 'scenes', (path)=>{ routed = path; });
  await wait(120);
  const addBtn = Array.from(main.querySelectorAll('button')).find(b => b.textContent.includes('추가'));
  ok(!!addBtn, '씬 추가 버튼 존재');
  addBtn.dispatchEvent(new w.Event('click', { bubbles:true }));
  await wait(250);
  ok(!!routed && routed.startsWith('scenes/'), `생성 후 상세로 이동 (${routed})`);

  // 라우터를 통과시킨다 — 여기가 버그가 났던 지점
  const u2 = new URL('https://example.test/'); u2.hash = '#/' + routed;
  const r2 = parseRoute(u2.hash);
  const rec = await DB.get('scenes', r2.id);
  ok(!!rec, `라우터가 준 id 로 레코드 조회 성공 (${r2.id})`);

  await V.entityDetailView(main, 'scenes', r2.id, ()=>{});
  await wait(300);
  ok(!main.textContent.includes('기록을 찾을 수 없습니다'), '"기록을 찾을 수 없습니다" 가 뜨지 않음');
  ok(!!main.querySelector('.detail-page'), '씬 상세 페이지 렌더');
  ok(main.textContent.includes('로케이션'), '로케이션 필드 존재');
  ok(main.textContent.includes('시제'), '시제 필드 존재');
  ok(main.textContent.includes('벤더'), '벤더 필드 존재');
  ok(main.textContent.includes('촬영 유닛'), '촬영 유닛 필드 존재');
  ok(main.textContent.includes('캠 롤') && main.textContent.includes('클립'), '캠 롤 / 클립 필드 존재');
  ok(!!main.querySelector('.sketch-cv'), 'S펜 캔버스 존재');
  ok(main.querySelectorAll('.photo-grid .photo-tile').length >= 14, '현장 사진 14칸');
  ok(main.querySelectorAll('.cam-tab').length === 4, '캠 탭 A~D');
  ok(!main.querySelector('.cuts-sec'), 'CUTS 섹션 없음');
}

console.log('== 캠 탭 전환 ==');
{
  const main = w.document.getElementById('main');
  const scene = (await DB.list('scenes'))[0];

  const tabs = main.querySelectorAll('.cam-tab');
  ok(tabs[0].classList.contains('on'), '기본 선택은 A');
  ok(!tabs[1].classList.contains('on'), 'B 는 비선택');

  // 새로 만든 씬은 cams 골격이 미리 있어야 한다 (탭 전환 시 undefined 접근 방지)
  ok(scene.cams && ['A','B','C','D'].every(c => scene.cams[c]), '생성 시 cams A~D 초기화');

  // 값이 있는 캠은 탭에 표시된다
  scene.cams.C.camRoll = 'C012';
  scene.cams.C.clip = 'C099';
  await DB.put('scenes', scene.id ? scene : scene);
  await V.entityDetailView(main, 'scenes', scene.id, ()=>{});
  await wait(300);
  const tabs2 = main.querySelectorAll('.cam-tab');
  ok(tabs2[2].classList.contains('on'), '값이 있는 캠이 기본 선택 (C)');
  ok(tabs2[2].classList.contains('filled'), '값이 있는 탭은 filled 표시');
  ok(tabs2[2].querySelector('.cam-sub').textContent === 'C012 C099',
     `탭에 캠 롤·클립 요약 (${tabs2[2].querySelector('.cam-sub').textContent})`);
}

console.log('== 촬영 유닛은 캠별로 독립 ==');
{
  const main = w.document.getElementById('main');
  const scene = (await DB.list('scenes'))[0];
  await V.entityDetailView(main, 'scenes', scene.id, ()=>{});
  await wait(300);

  // 촬영 유닛은 콤보 → 드롭다운으로 렌더된다
  const unitSel = () => Array.from(main.querySelectorAll('.field'))
    .find(f => f.querySelector('label') && f.querySelector('label').textContent.startsWith('촬영 유닛'))
    .querySelector('.combo select');
  const tab = (i) => main.querySelectorAll('.cam-tab')[i];

  // 현재 열려 있는 탭(C: 값이 있어 기본 선택) 대신 A 부터 시작한다
  tab(0).dispatchEvent(new w.Event('click',{bubbles:true})); await wait(250);
  ok(!!unitSel(), '콤보가 드롭다운으로 렌더됨');
  const ua = unitSel();
  ua.value = 'A'; ua.dispatchEvent(new w.Event('change',{bubbles:true}));
  await wait(700);

  tab(1).dispatchEvent(new w.Event('click',{bubbles:true})); await wait(250);
  ok(unitSel().value === '', `A 에서 유닛을 바꿔도 B 는 비어 있음 (${JSON.stringify(unitSel().value)})`);
  const ub = unitSel();
  ub.value = 'B'; ub.dispatchEvent(new w.Event('change',{bubbles:true}));
  await wait(700);

  const rec = await DB.get('scenes', scene.id);
  ok(rec.cams.A.unit === 'A' && rec.cams.B.unit === 'B',
     `A/B 유닛이 각각 저장 (A=${rec.cams.A.unit} B=${rec.cams.B.unit})`);
  ok(!('unit' in rec), '레코드 최상단에 유닛이 남지 않음');

  tab(0).dispatchEvent(new w.Event('click',{bubbles:true})); await wait(250);
  ok(unitSel().value === 'A', 'A 로 돌아오면 A 값 그대로');
}

console.log('== 목록: 캠 기록 열 / 대표 이미지 A 우선 ==');
{
  const main = w.document.getElementById('main');
  await V.entityListView(main, 'scenes', ()=>{});
  await wait(300);
  const ths = Array.from(main.querySelectorAll('.dtable thead th')).map(t=>(t.querySelector('span')||t).textContent);
  ok(!ths.includes('촬영 유닛'), `목록에 촬영 유닛 열 없음 (${ths.join('/')})`);
  ok(ths.includes('캠 기록'), '캠 기록 열 존재');
  // 썸네일·NO 다음이 에피소드·씬·캠기록 순이어야 한다 (촬영 유닛이 있던 자리)
  ok(ths[2]==='에피소드' && ths[3]==='씬' && ths[4]==='캠 기록',
     `캠 기록이 촬영 유닛 자리에 (${ths.slice(2,6).join(' / ')})`);
  ok(!ths.includes('INT / EXT') && !ths.includes('시제'), `INT/EXT · 시제 열 제거 (${ths.join('/')})`);
  // NO · 썸네일 · 에피소드 · 씬 · 캠 기록 · 로케이션 · 씬 노트 · 벤더
  ok(ths[5]==='로케이션', `로케이션 (${ths[5]})`);
  ok(ths[6]==='씬 노트', `INT/EXT·시제 자리에 씬 노트 (${ths[6]})`);
  ok(ths[7]==='벤더', `벤더는 그대로 마지막 (${ths[7]})`);

  const { thumbOf } = await import('../js/schema.js');
  const mk = (cams) => ({ cams });
  ok(thumbOf('scenes', mk({ A:{thumbnail:{mid:'mA'}}, B:{thumbnail:{mid:'mB'}} })).mid === 'mA',
     'A 와 B 둘 다 있으면 A 가 대표');
  ok(thumbOf('scenes', mk({ A:{}, B:{thumbnail:{mid:'mB'}} })).mid === 'mB',
     'A 가 비어 있으면 다음 캠으로');
  ok(thumbOf('scenes', mk({ A:{}, B:{}, C:{thumbnail:{mid:'mC'}} })).mid === 'mC',
     'C 만 있으면 C');
  ok(thumbOf('scenes', mk({ A:{}, B:{} })) === null, '아무 캠에도 없으면 null');
}

console.log('== 자동 저장 유실 방지 ==');
{
  // 실제로 났던 문제 두 가지
  //  1) 콤보 입력은 포커스를 뺄 때만 저장돼서, 치고 바로 탭을 옮기면 값이 사라졌다
  //  2) 화면을 떠날 때 대기 중인 저장을 "취소"해 버렸다 (이름은 flush 인데 버리고 있었다)
  const main = w.document.getElementById('main');
  const scene = (await DB.list('scenes'))[0];
  await V.entityDetailView(main, 'scenes', scene.id, ()=>{});
  await wait(300);

  const sceneField = () => Array.from(main.querySelectorAll('.field'))
    .find(f => f.querySelector('label') && f.querySelector('label').textContent === '씬');
  // 목록에 없는 씬 번호 → '직접 입력' 으로 전환해서 친다
  const sel = sceneField().querySelector('.combo select');
  const custom = Array.from(sel.options).find(o=>o.textContent.includes('직접 입력'));
  sel.value = custom.value; sel.dispatchEvent(new w.Event('change',{bubbles:true}));
  await wait(120);
  const inp = sceneField().querySelector('.combo input');
  ok(!!inp, "'직접 입력' 을 고르면 자유 입력칸");
  inp.value = '7-3';
  inp.dispatchEvent(new w.Event('input',{bubbles:true}));   // change(포커스 이탈) 없이 input 만

  // 저장 타이머(0.5초)가 돌기 전에 화면을 떠난다
  await V.flushAll();
  const rec = await DB.get('scenes', scene.id);
  ok(rec.scene === '7-3', `콤보 입력이 즉시 커밋됨 (${rec.scene})`);
}

console.log('== 목록 정렬 ==');
{
  const main = w.document.getElementById('main');
  const p = await DB.getProject();

  // 씬 번호를 섞어 넣는다 (1-10 이 1-2 보다 뒤로 가야 정상)
  for (const v of ['2-1','1-10','1-2']){
    const r = { id: DB.makeSceneId(p.name) + v, projectId: p.id, scene: v,
                cams:{A:{},B:{},C:{},D:{}} };
    await DB.put('scenes', r);
  }
  await V.entityListView(main, 'scenes', ()=>{});
  await wait(300);

  const ths = Array.from(main.querySelectorAll('.dtable thead th'));
  const sceneTh = ths.find(t => (t.querySelector('span')||t).textContent === '씬');
  ok(!!sceneTh && sceneTh.classList.contains('sortable'), '표 머리를 눌러 정렬할 수 있음');

  // 열 위치를 하드코딩하지 않는다 (컬럼 구성이 바뀌면 조용히 엉뚱한 열을 보게 된다)
  const sceneIdx = ths.indexOf(sceneTh);
  const colVals = () => Array.from(main.querySelectorAll('tr.drow'))
    .map(tr => tr.children[sceneIdx].textContent).filter(v => v && v !== '—');

  sceneTh.dispatchEvent(new w.Event('click',{bubbles:true})); await wait(250);
  const asc = colVals();
  ok(sceneTh.classList.contains('on') || main.querySelector('th.sortable.on'), '정렬 중인 열이 표시됨');
  ok(asc.indexOf('1-2') < asc.indexOf('1-10'), `숫자 순서대로 정렬 (${asc.join(' < ')})`);
  ok(asc.indexOf('1-10') < asc.indexOf('2-1'), '1-10 이 2-1 보다 앞');

  const th2 = Array.from(main.querySelectorAll('.dtable thead th'))
    .find(t => (t.querySelector('span')||t).textContent === '씬');
  th2.dispatchEvent(new w.Event('click',{bubbles:true})); await wait(250);
  const desc = colVals();
  ok(desc[0] === asc[asc.length-1], `한 번 더 누르면 역순 (${desc.join(' > ')})`);

  // 빈 값은 방향과 무관하게 뒤로
  const all = Array.from(main.querySelectorAll('tr.drow')).map(tr => tr.children[sceneIdx].textContent);
  const firstEmpty = all.indexOf('—');
  ok(firstEmpty === -1 || all.slice(firstEmpty).every(v => v === '—'), '빈 값은 항상 마지막');
}

console.log('== VFX 작업 타입 (캠별) ==');
{
  const main = w.document.getElementById('main');
  const scene = (await DB.list('scenes'))[0];
  await V.entityDetailView(main, 'scenes', scene.id, ()=>{});
  await wait(300);

  ok(!main.textContent.includes('HDRI'), '씬에서 HDRI 연결 제거됨');
  const vfxField = () => Array.from(main.querySelectorAll('.field'))
    .find(f => f.querySelector('label') && f.querySelector('label').textContent.startsWith('작업 타입'));
  ok(!!vfxField(), 'HDRI 자리에 작업 타입');
  ok(vfxField().classList.contains('camfield'), '작업 타입은 캠별 필드');

  const tab = (i) => main.querySelectorAll('.cam-tab')[i];
  tab(0).dispatchEvent(new w.Event('click',{bubbles:true})); await wait(250);
  const sel = vfxField().querySelector('select');
  sel.value = '3D'; sel.dispatchEvent(new w.Event('change',{bubbles:true}));
  await wait(700);

  tab(1).dispatchEvent(new w.Event('click',{bubbles:true})); await wait(250);
  ok(vfxField().querySelector('select').value === '', 'B 캠은 별도 (A 의 3D 가 안 넘어옴)');
  const selB = vfxField().querySelector('select');
  selB.value = '2D'; selB.dispatchEvent(new w.Event('change',{bubbles:true}));
  await wait(700);

  const rec = await DB.get('scenes', scene.id);
  ok(rec.cams.A.vfxType === '3D' && rec.cams.B.vfxType === '2D',
     `A=3D / B=2D 로 각각 저장 (${rec.cams.A.vfxType}/${rec.cams.B.vfxType})`);
  ok(!('linkedHdriIds' in rec), '씬의 HDRI 연결 데이터도 정리됨');

  // Overview 물량 = 작업 타입이 지정된 캠 기록 수
  const { usedCams } = await import('../js/schema.js');
  const vfxCount = (await DB.list('scenes'))
    .flatMap(s => usedCams('scenes', s).map(c => (s.cams[c]||{}).vfxType))
    .filter(Boolean).length;
  ok(vfxCount >= 2, `VFX 물량 ${vfxCount}건 (캠 단위로 셈)`);

  const hdris = await DB.list('hdri');
  ok(hdris.every(h => !('linkedScene' in h)), 'HDRI 쪽 연결 씬도 제거됨');
}

console.log('== 찍지 않은 캠은 세지 않는다 ==');
{
  const { usedCams } = await import('../js/schema.js');

  // 촬영 유닛은 직전 씬에서 자동 상속된다 → 이것만으로는 "찍은 캠"이 아니다
  ok(usedCams('scenes', { cams:{ A:{unit:'A'}, B:{unit:'A'}, C:{unit:'A'}, D:{unit:'A'} } }).length === 0,
     '유닛만 채워진 캠은 기록 아님');
  ok(usedCams('scenes', { cams:{ A:{unit:'A',camRoll:'A027'}, B:{unit:'A'}, C:{unit:'A'}, D:{unit:'A'} } })
       .join('') === 'A',
     'v20 유닛 복사가 남아 있어도 실제로 찍은 A 만 셈');
  // 실제 촬영 흔적은 전부 근거가 된다
  for (const [k, v] of [['camRoll','A027'], ['clip','C001'], ['vfxType','3D']])
    ok(usedCams('scenes', { cams:{ A:{[k]:v}, B:{}, C:{}, D:{} } }).join('') === 'A', `${k} 만 있어도 기록으로 셈`);
  ok(usedCams('scenes', { cams:{ A:{thumbnail:{mid:'m1'}}, B:{}, C:{}, D:{} } }).join('') === 'A',
     '모니터 사진만 있어도 기록');

  // 이미 뿌려진 데이터 복구
  const p = await DB.getProject();
  const bad = { id: DB.makeSceneId(p.name)+'FAN', projectId: p.id, scene:'9-9',
                cams:{ A:{unit:'A',camRoll:'A100'}, B:{unit:'A'}, C:{unit:'A'}, D:{unit:'A'} } };
  await DB.put('scenes', bad);
  const fixed = await DB.repairCamUnitFanout(true);
  const got = await DB.get('scenes', bad.id);
  ok(fixed >= 1, `복구 대상 ${fixed}건`);
  ok(got.cams.A.unit === 'A', '찍은 캠의 유닛은 남는다');
  ok(!got.cams.B.unit && !got.cams.C.unit && !got.cams.D.unit,
     `안 찍은 캠의 유닛은 지운다 (B=${got.cams.B.unit} C=${got.cams.C.unit} D=${got.cams.D.unit})`);

  // 사람이 서로 다른 유닛을 넣은 경우는 건드리지 않는다
  const mine = { id: DB.makeSceneId(p.name)+'MINE', projectId: p.id, scene:'9-8',
                 cams:{ A:{unit:'A'}, B:{unit:'B'}, C:{}, D:{} } };
  await DB.put('scenes', mine);
  await DB.repairCamUnitFanout(true);
  const got2 = await DB.get('scenes', mine.id);
  ok(got2.cams.A.unit === 'A' && got2.cams.B.unit === 'B', '값이 서로 다르면 사람 입력 → 보존');
}

console.log('== 목록의 로케이션 표기 / 노트 셀 ==');
{
  const { displayName } = await import('../js/schema.js');
  const loc = { mainLocation:'조양체육관', subLocation:'2층 복도', setId:'SET-012' };
  ok(displayName('locations', loc) === '조양체육관 — 2층 복도',
     `대장소 — 소장소 만 (${displayName('locations', loc)})`);
  ok(!displayName('locations', loc).includes('SET-012'), 'SET ID 는 빠진다');
  ok(displayName('locations', { mainLocation:'팔복사무실' }) === '팔복사무실', '소장소가 없으면 대장소만');

  // Location 페이지 자체 목록에는 SET ID 가 그대로 있어야 한다
  const { ENTITIES } = await import('../js/schema.js');
  ok(ENTITIES.locations.listCols.includes('setId'), 'Location 페이지에는 SET ID 유지');

  const main = w.document.getElementById('main');
  const scene = (await DB.list('scenes'))[0];
  scene.shotNote = '와이어 3개\n뒤쪽 간판 지워야 함';
  await DB.put('scenes', scene);
  await V.entityListView(main, 'scenes', ()=>{});
  await wait(300);
  const noteTd = main.querySelector('tr.drow td.note');
  ok(!!noteTd, '노트 칸에 클램프 클래스가 붙는다');
  ok(noteTd.getAttribute('title') === scene.shotNote, '잘린 내용은 툴팁으로 전체 확인 가능');
  const css = fs.readFileSync('../css/app.css','utf8').replace(/\s+/g,'');
  ok(/td\.note\{[^}]*text-overflow:ellipsis/.test(css), '한 줄로 두고 넘치면 … 로 끊는다');
}

console.log(fail?`\n### 실패 ${fail}건`:'\n### 전체 통과');
process.exit(fail?1:0);
