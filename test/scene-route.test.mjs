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

console.log(fail?`\n### 실패 ${fail}건`:'\n### 전체 통과');
process.exit(fail?1:0);
