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
  ok(main.textContent.includes('캠 유닛'), '캠 유닛 필드 존재');
  ok(!!main.querySelector('.sketch-cv'), 'S펜 캔버스 존재');
  ok(main.querySelectorAll('.photo-grid .photo-tile').length >= 14, '현장 사진 14칸');
}

console.log('== 컷: A/B캠 동시 촬영 ==');
{
  const main = w.document.getElementById('main');
  const abBtn = Array.from(main.querySelectorAll('button')).find(b => b.textContent.includes('A/B캠 동시'));
  ok(!!abBtn, 'A/B캠 동시 버튼 존재');
  abBtn.dispatchEvent(new w.Event('click', { bubbles:true }));
  await wait(300);

  const scene = (await DB.list('scenes'))[0];
  const cuts = await DB.listCuts(scene.id);
  ok(cuts.length === 2, `컷 2개 생성 (${cuts.length})`);
  ok(cuts[0].camUnit === 'A' && cuts[1].camUnit === 'B', `캠 A / B (${cuts.map(c=>c.camUnit).join(',')})`);
  ok(cuts[0].cutNo === cuts[1].cutNo, `같은 컷 번호 (${cuts[0].cutNo})`);
  ok(cuts[0].slate && cuts[0].slate === cuts[1].slate, `슬레이트 공유 (${cuts[0].slate})`);
  ok(cuts[0].id !== cuts[1].id, '별개의 레코드 = 별개의 VFX 물량');

  // 한 번 더 누르면 컷 번호가 올라가야 한다 (개수 기준으로 세면 2 를 건너뛴다)
  const abBtn2 = Array.from(main.querySelectorAll('button')).find(b => b.textContent.includes('A/B캠 동시'));
  abBtn2.dispatchEvent(new w.Event('click', { bubbles:true }));
  await wait(300);
  const cuts2 = await DB.listCuts(scene.id);
  const nos = Array.from(new Set(cuts2.map(c=>c.cutNo))).sort();
  ok(cuts2.length === 4, `컷 4개 (${cuts2.length})`);
  ok(nos.join(',') === '1,2', `컷 번호가 1,2 로 증가 (${nos.join(',')})`);
}

console.log('== 모니터 촬영 → 어느 컷에 넣을지 판단 ==');
{
  const { planMonitorTake } = await import('../js/schema.js');

  // 아직 컷이 없는 상태 — B027 을 찍었다
  {
    const { targets, defaultTarget } = planMonitorTake([], 'B');
    ok(defaultTarget === '__new', '컷이 없으면 새 컷이 기본값');
    ok(targets.length === 1 && targets[0].label.includes('B캠'), `후보 1개 (${targets[0].label})`);
  }

  // A캠 C1 만 있는 상태에서 B027 을 찍었다 → "C1 과 동시" 가 기본값이어야 한다
  {
    const cuts = [{ id:'CUT-A1', cutNo:'1', camUnit:'A', slate:'1-1' }];
    const { targets, defaultTarget } = planMonitorTake(cuts, 'B');
    ok(defaultTarget === 'pair:CUT-A1', `A캠 C1 이 있으면 동시 촬영이 기본값 (${defaultTarget})`);
    ok(targets[0].label.includes('동시'), `첫 후보 = ${targets[0].label}`);
    ok(targets.some(t => t.value === '__new'), '새 컷 만들기도 선택 가능');
  }

  // A/B 짝이 이미 있는 상태에서 B027 을 또 찍었다 → 그 B캠 컷에 테이크 추가가 기본값
  {
    const cuts = [
      { id:'CUT-A1', cutNo:'1', camUnit:'A', slate:'1-1' },
      { id:'CUT-B1', cutNo:'1', camUnit:'B', slate:'1-1' },
    ];
    const { targets, defaultTarget } = planMonitorTake(cuts, 'B');
    ok(defaultTarget === 'CUT-B1', `이어 찍으면 같은 B캠 컷에 추가 (${defaultTarget})`);
    ok(!targets.some(t => t.value === 'pair:CUT-A1'), '이미 짝이 있으면 동시 생성 후보를 만들지 않음');
  }

  // 같은 캠 컷이 여러 개면 마지막 것이 기본값
  {
    const cuts = [
      { id:'CUT-B1', cutNo:'1', camUnit:'B' },
      { id:'CUT-B2', cutNo:'2', camUnit:'B' },
    ];
    const { defaultTarget } = planMonitorTake(cuts, 'B');
    ok(defaultTarget === 'CUT-B2', `가장 최근 컷이 기본값 (${defaultTarget})`);
  }

  // 캠 롤을 못 읽었을 때 — 억지로 캠을 정하지 않고 기존 컷 중에서 고르게 한다
  {
    const cuts = [{ id:'CUT-A1', cutNo:'1', camUnit:'A' }];
    const { targets, defaultTarget } = planMonitorTake(cuts, '');
    ok(defaultTarget === 'CUT-A1', '판독 실패 시 마지막 컷이 기본값');
    ok(!targets.some(t => String(t.value).startsWith('pair:')), '캠을 모르면 동시 촬영 후보를 만들지 않음');
  }
}

console.log(fail?`\n### 실패 ${fail}건`:'\n### 전체 통과');
process.exit(fail?1:0);
