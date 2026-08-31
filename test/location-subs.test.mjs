/* 로케이션 소장소(subs) 구조 — 스키마 헬퍼 + v9 병합 마이그레이션
 *
 * 검증하는 것
 *  1) 대장소가 같은 기록들이 한 레코드의 소장소 탭으로 합쳐진다
 *  2) 씬/HDRI 의 locationId 가 'LOC-001::S2' 로 다시 걸린다
 *  3) 두 번 돌려도 결과가 그대로다 (idempotent)
 *  4) 공유 필드(주소·세트 타입)는 값이 있는 쪽에서 살아남는다
 *  5) 되돌릴 수 있게 _fromId 가 남는다
 *  6) 대장소 이름이 비면 합치지 않는다
 */
import * as FDB from 'fake-indexeddb';
globalThis.indexedDB = new FDB.IDBFactory(); globalThis.IDBKeyRange = FDB.IDBKeyRange;
let fail = 0;
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; };

const S  = await import('../js/schema.js');
const DB = await import('../js/db.js');

/** 스토어를 비운다 — 마이그레이션 케이스마다 깨끗한 상태에서 시작 */
async function reset(){
  for (const st of ['locations','scenes','hdri']){
    for (const r of await DB.listAll(st)) await DB.del(st, r.id);
  }
  return DB.getProject();
}

/* ---------- 1. 스키마 헬퍼 ---------- */
{
  const r = {
    id:'LOC-1', mainLocation:'그린힐테라스',
    subOrder:['S1','S2'],
    subs:{ S1:{ subLocation:'거실', intExt:'INT' }, S2:{ subLocation:'마당', intExt:'EXT' } },
  };
  ok(S.hasSubs('locations') === true, 'locations 는 소장소 엔티티');
  ok(S.hasSubs('scenes') === false,   'scenes 는 아님 (캠 탭)');
  ok(S.subIds('locations', r).join(',') === 'S1,S2', '탭 순서는 subOrder');
  ok(S.subName('locations', r, 'S2') === '마당', '탭 이름');
  ok(S.subDisplayName('locations', r, 'S2') === '그린힐테라스/마당', '한 줄 표기');
  ok(S.nextSubId('locations', r) === 'S3', '다음 소장소 id');
  ok(S.subFieldLine('locations', r, 'intExt') === '거실: INT · 마당: EXT', '값이 다르면 소장소 이름을 붙인다');
  ok(S.subSummaryLine('locations', r) === '거실 · 마당', '소장소 열');

  // 값이 모두 같으면 접어서 한 번만
  const same = { ...r, subs:{ S1:{subLocation:'거실',intExt:'INT'}, S2:{subLocation:'안방',intExt:'INT'} } };
  ok(S.subFieldLine('locations', same, 'intExt') === 'INT', '값이 같으면 한 번만');

  // subOrder 가 깨져도 subs 키로 보정
  const broken = { ...r, subOrder:['S9'] };
  ok(S.subIds('locations', broken).join(',') === 'S1,S2', 'subOrder 가 어긋나도 복구');

  // 대표 이미지는 소장소를 순서대로 훑는다
  const withImg = { ...r, subs:{ S1:{subLocation:'거실'}, S2:{subLocation:'마당', thumbnail:{mid:'m2'}} } };
  ok((S.thumbOf('locations', withImg) || {}).mid === 'm2', '이미지 있는 첫 소장소가 대표');

  const { opts, map } = S.refIndex('locations', [r]);
  ok(opts.length === 2, '드롭다운은 소장소 단위로 펼친다');
  ok(opts[0].value === 'LOC-1::S1', '저장값은 레코드id::소장소id');
  ok(map['LOC-1'] === '그린힐테라스/거실', '예전 값(레코드 id)도 이름이 나온다');
  ok(S.splitRef('LOC-1::S2').sid === 'S2', 'splitRef');
  ok(S.splitRef('LOC-1').sid === '', '구분자 없는 예전 값');
}

/* ---------- 2. 마이그레이션 ---------- */
const seed = async () => {
  await DB.open();
  const p = await reset();
  const put = (store, r) => DB.put(store, { projectId:p.id, ...r });

  await put('locations', { id:'LOC-A', mainLocation:'그린힐테라스', subLocation:'거실',
                           intExt:'INT', setType:'', path:'', createdAt:'2026-01-01' });
  await put('locations', { id:'LOC-B', mainLocation:'그린힐테라스', subLocation:'안방',
                           intExt:'INT', setType:'Location', path:'경기도 파주',
                           description:'2층', createdAt:'2026-01-02' });
  await put('locations', { id:'LOC-C', mainLocation:'조양체육관', subLocation:'',
                           intExt:'EXT', createdAt:'2026-01-03' });
  await put('locations', { id:'LOC-D', mainLocation:'', subLocation:'무명',
                           createdAt:'2026-01-04' });

  await put('scenes', { id:'SC-1', scene:'1-1', locationId:'LOC-A' });
  await put('scenes', { id:'SC-2', scene:'1-2', locationId:'LOC-B' });
  await put('scenes', { id:'SC-3', scene:'1-3', locationId:'LOC-C' });
  await put('hdri',   { id:'HD-1', locationId:'LOC-B' });
  return p;
};

await seed();
const n = await DB.mergeLocationSubs();

let locs = await DB.list('locations');
ok(locs.length === 3, `4개 → 3개로 병합 (${locs.length})`);
ok(n === 1, `흡수된 기록 1건 (${n})`);

const green = locs.find(l => l.mainLocation === '그린힐테라스');
ok(!!green, '그린힐테라스가 남았다');
ok(green.id === 'LOC-A', '먼저 등록된 쪽 id 를 유지 (LOC-A)');
ok(S.subIds('locations', green).join(',') === 'S1,S2', '소장소 2개');
ok(S.subName('locations', green, 'S1') === '거실' &&
   S.subName('locations', green, 'S2') === '안방', '소장소 이름이 순서대로');
ok(green.path === '경기도 파주', '주소는 값이 있는 쪽에서 살아남는다');
ok(green.setType === 'Location', '세트 타입도 마찬가지');
ok(green.subLocation === undefined && green.intExt === undefined,
   '소장소 필드는 레코드 최상단에서 제거');
ok(green.subs.S2.description === '2층', '소장소 고유 값 보존');
ok(green.subs.S2._fromId === 'LOC-B', '되돌릴 수 있게 원래 id 를 남긴다');

const noname = locs.find(l => !l.mainLocation);
ok(!!noname && S.subIds('locations', noname).length === 1,
   '대장소 이름이 비면 합치지 않는다');

const sc = Object.fromEntries((await DB.list('scenes')).map(r => [r.id, r.locationId]));
ok(sc['SC-1'] === 'LOC-A::S1', `씬 연결 이관 SC-1 (${sc['SC-1']})`);
ok(sc['SC-2'] === 'LOC-A::S2', `흡수된 기록을 쓰던 씬도 이관 SC-2 (${sc['SC-2']})`);
ok(sc['SC-3'].startsWith('LOC-C::'), `혼자인 기록도 소장소를 가리킨다 (${sc['SC-3']})`);
ok((await DB.get('hdri','HD-1')).locationId === 'LOC-A::S2', 'HDRI 연결도 이관');

// 이름 해석이 실제로 되는지 — 씬 목록에 '—' 로 뜨면 안 된다
const idx = S.refIndex('locations', await DB.list('locations'));
ok(idx.label('LOC-A::S2') === '그린힐테라스/안방', `연결된 이름 표시 (${idx.label('LOC-A::S2')})`);

/* ---------- 3. 두 번 돌려도 그대로 ---------- */
const before = JSON.stringify((await DB.list('locations')).map(l => [l.id, l.subOrder]));
const again  = await DB.mergeLocationSubs();
const after  = JSON.stringify((await DB.list('locations')).map(l => [l.id, l.subOrder]));
ok(again === 0 && before === after, '다시 돌려도 아무것도 바뀌지 않는다');

const sc2 = Object.fromEntries((await DB.list('scenes')).map(r => [r.id, r.locationId]));
ok(sc2['SC-2'] === 'LOC-A::S2', '재실행 후에도 씬 연결 유지');

/* ---------- 4. 새 포맷과 옛 포맷이 섞여도 (백업 '병합' 가져오기) ---------- */
{
  const p = await reset();
  await DB.put('locations', { projectId:p.id, id:'LOC-X', mainLocation:'세트장',
                              subOrder:['S1'], subs:{ S1:{ subLocation:'A동' } } });
  await DB.put('locations', { projectId:p.id, id:'LOC-Y', mainLocation:'세트장', subLocation:'B동' });
  await DB.put('scenes',    { projectId:p.id, id:'SC-9', locationId:'LOC-Y' });
  await DB.mergeLocationSubs();
  const list = await DB.list('locations');
  ok(list.length === 1, `변환된 기록에 옛 기록이 소장소로 붙는다 (${list.length}건)`);
  ok(list[0].id === 'LOC-X', '이미 변환된 쪽을 살린다 (기존 소장소 id 보존)');
  ok(S.subIds('locations', list[0]).join(',') === 'S1,S2', '기존 S1 유지 + 새 S2');
  ok(S.subName('locations', list[0], 'S2') === 'B동', '새로 붙은 소장소 이름');
  ok((await DB.get('scenes','SC-9')).locationId === 'LOC-X::S2', '씬 연결도 새 소장소로');
  ok(await DB.mergeLocationSubs() === 0, '한 번 더 돌리면 변화 없음');
}


/* ---------- 5. 화면 통합 (jsdom) ----------
 * 실제 현장 순서 그대로 확인한다.
 *   로케이션 상세에서 소장소 추가 → 이름 입력 → 씬 상세의 로케이션 드롭다운에 나온다
 */
{
  const { JSDOM } = await import('jsdom');
  const fs = await import('node:fs');
  const dom = new JSDOM(fs.readFileSync('../index.html','utf8'),
    { url:'https://example.test/', pretendToBeVisual:true, runScripts:'outside-only' });
  const w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = function(){};
  for (const k of ['window','document','HTMLElement','Node','Event','CustomEvent','Image','Blob','File','localStorage','getComputedStyle','requestAnimationFrame'])
    if (w[k] !== undefined && globalThis[k] === undefined) globalThis[k] = w[k];
  globalThis.window = w; globalThis.document = w.document;
  Object.defineProperty(globalThis,'navigator',{ value:{ storage:{ estimate:async()=>({usage:1,quota:100}) } }, configurable:true });
  w.HTMLCanvasElement.prototype.getContext = function(){
    const noop = () => {};
    return { fillRect:noop, strokeRect:noop, beginPath:noop, moveTo:noop, lineTo:noop, stroke:noop,
             drawImage:noop, getImageData:()=>({data:[]}), putImageData:noop,
             set fillStyle(v){}, set strokeStyle(v){}, set lineWidth(v){},
             set lineCap(v){}, set lineJoin(v){}, set imageSmoothingQuality(v){} };
  };
  w.HTMLCanvasElement.prototype.toBlob = function(cb){ cb(new w.Blob([new Uint8Array([1])],{type:'image/png'})); };

  const UI = await import('../js/ui.js');
  const V  = await import('../js/views.js');
  UI.setRefsCache(await DB.getRefs());

  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const ev   = (n, t='click') => n.dispatchEvent(new w.Event(t, { bubbles:true }));
  const main = w.document.getElementById('main');

  const p = await reset();
  await DB.put('locations', { projectId:p.id, id:'LOC-Z', mainLocation:'그린힐테라스',
                              setType:'Location', path:'경기도 파주',
                              subOrder:['S1'], subs:{ S1:{ subLocation:'거실', intExt:'INT' } } });
  const sc = { projectId:p.id, id:'SC-UI', scene:'1-1', cams:{ A:{}, B:{}, C:{}, D:{} } };
  await DB.put('scenes', sc);

  // --- 로케이션 상세: 소장소 추가 + 이름 입력 ---
  await V.entityDetailView(main, 'locations', 'LOC-Z', ()=>{}); await wait(400);
  const tabs = () => Array.from(main.querySelectorAll('.cam-tab')).filter(b => !b.classList.contains('add'));
  ok(tabs().length === 1 && tabs()[0].textContent.includes('거실'), `소장소 탭 1개 (${tabs()[0].textContent})`);

  ev(main.querySelector('.cam-tab.add')); await wait(400);
  ok(tabs().length === 2, `소장소 추가 후 2개 (${tabs().length})`);

  const nameInput = Array.from(main.querySelectorAll('.field')).find(f =>
    f.querySelector('label') && f.querySelector('label').textContent === '소장소').querySelector('input');
  nameInput.value = '마당'; ev(nameInput, 'input'); ev(nameInput, 'change'); await wait(900);
  ok(tabs()[1].textContent.includes('마당'), `이름을 넣으면 탭 이름이 따라 바뀐다 (${tabs()[1].textContent})`);

  const savedLoc = await DB.get('locations','LOC-Z');
  ok(S.subIds('locations', savedLoc).length === 2, '저장까지 반영');
  ok(savedLoc.mainLocation === '그린힐테라스' && savedLoc.path === '경기도 파주',
     '대장소·주소는 소장소를 옮겨도 그대로 (공유 필드)');
  ok(savedLoc.subs.S1.intExt === 'INT' && !savedLoc.subs.S2.intExt,
     'INT/EXT 는 소장소마다 따로 (A/B 캠과 같은 방식)');

  // --- 씬 상세: 로케이션 드롭다운이 소장소 단위 ---
  await V.entityDetailView(main, 'scenes', 'SC-UI', ()=>{}); await wait(500);
  const locSel = Array.from(main.querySelectorAll('select.inp'))
    .find(s => Array.from(s.options).some(o => o.value.startsWith('LOC-Z::')));
  ok(!!locSel, '씬의 로케이션 드롭다운에 소장소가 펼쳐진다');
  const labels = Array.from(locSel.options).map(o => o.textContent).filter(t => t.includes('그린힐'));
  ok(labels.join(',') === '그린힐테라스/거실,그린힐테라스/마당', `표기 (${labels.join(' / ')})`);

  locSel.value = 'LOC-Z::S2'; ev(locSel, 'change'); await wait(900);
  ok((await DB.get('scenes','SC-UI')).locationId === 'LOC-Z::S2', '씬에 소장소까지 저장');

  // --- 목록: 대장소 한 줄 + 소장소 요약 ---
  await V.entityListView(main, 'locations', ()=>{}); await wait(400);
  const rowsUI = main.querySelectorAll('tr.drow');
  ok(rowsUI.length === 1, `대장소가 같으면 목록은 한 줄 (${rowsUI.length})`);
  ok(rowsUI[0].textContent.includes('거실 · 마당'), `소장소 열에 요약 (${rowsUI[0].textContent})`);

  await V.entityListView(main, 'scenes', ()=>{}); await wait(400);
  ok(main.querySelector('tr.drow').textContent.includes('그린힐테라스/마당'),
     '씬 목록 로케이션 칸에 대장소/소장소');
}

console.log(fail ? `### 실패 ${fail}건` : '### 전체 통과');
process.exit(fail ? 1 : 0);
