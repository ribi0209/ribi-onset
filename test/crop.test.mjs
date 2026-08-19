/* 크롭 좌표 변환 검증
 *
 * 사진은 화면 크기에 맞춰 줄여서 보여 주고 그 위에서 영역을 끈다.
 * 이 변환을 빠뜨리면 원본에서 엉뚱한 데가 잘린다. 눈으로는 "왜 이상하지" 정도로만 보인다.
 */
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="main"></div>', { url:'https://example.test/' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
const FDB = await import('fake-indexeddb');
globalThis.indexedDB = new FDB.IDBFactory(); globalThis.IDBKeyRange = FDB.IDBKeyRange;
import { mapCropRect } from '../js/media.js';
let fail=0; const ok=(c,m)=>{ console.log((c?'  PASS ':'  FAIL ')+m); if(!c) fail++; };
const eq = (a,b) => JSON.stringify(a) === JSON.stringify(b);

console.log('== 축소해서 본 화면 좌표 → 원본 픽셀 ==');
{
  // 2600x1950 사진을 2000x1500 으로 줄여 보고 있는 상황 (실제 첨부 사진 크기)
  const D = [2000, 1500], N = [2600, 1950];
  ok(eq(mapCropRect({x:0,y:0,w:1000,h:750}, ...D, ...N), {x:0,y:0,w:1300,h:975}),
     '왼쪽 절반 → 원본 좌측 1300px');
  ok(eq(mapCropRect({x:1000,y:0,w:1000,h:750}, ...D, ...N), {x:1300,y:0,w:1300,h:975}),
     '오른쪽 절반 → 원본 우측 1300px');
  ok(eq(mapCropRect({x:0,y:0,w:2000,h:1500}, ...D, ...N), {x:0,y:0,w:2600,h:1950}),
     '전체 선택 → 원본 전체');
}

console.log('== 경계 처리 ==');
{
  const D = [2000, 1500], N = [2600, 1950];
  const r = mapCropRect({x:1900,y:1400,w:500,h:500}, ...D, ...N);
  ok(r.x + r.w <= 2600 && r.y + r.h <= 1950, `밖으로 나가면 안쪽으로 자름 (${JSON.stringify(r)})`);
  const neg = mapCropRect({x:-50,y:-50,w:200,h:200}, ...D, ...N);
  ok(neg.x >= 0 && neg.y >= 0, `음수 좌표는 0 으로 (${JSON.stringify(neg)})`);
  const zero = mapCropRect({x:0,y:0,w:0,h:0}, ...D, ...N);
  ok(zero.w >= 1 && zero.h >= 1, '0 크기여도 최소 1px (canvas 오류 방지)');
  ok(eq(mapCropRect({x:0,y:0,w:10,h:10}, 0, 0, 2600, 1950), {x:0,y:0,w:2600,h:1950}),
     '표시 크기를 모르면 원본 전체로 (0 나눗셈 방지)');
}

console.log('== 확대해서 보는 경우도 맞는가 ==');
{
  // 400x300 짜리 작은 사진을 800x600 으로 키워 놓고 끌었을 때 → 배율 0.5
  const r = mapCropRect({x:400,y:300,w:200,h:150}, 800, 600, 400, 300);
  ok(eq(r, {x:200,y:150,w:100,h:75}),
     `키워서 볼 때도 원본 좌표로 정확히 환산 (${JSON.stringify(r)})`);
}

console.log('== 오류 문구가 undefined 로 새지 않는가 ==');
{
  // 실제로 났던 문제: 이미지 로드 실패를 이벤트 객체로 거부해서
  // "자르기 실패: undefined" 만 뜨고 원인을 알 수 없었다.
  const { errText } = await import('../js/ui.js');
  ok(errText(new Error('사진을 읽지 못했습니다')) === '사진을 읽지 못했습니다', 'Error 는 메시지 그대로');
  ok(errText({ type:'error' }) === 'error', '이벤트 객체는 type 으로');
  ok(errText('문자열 오류') === '문자열 오류', '문자열도 그대로');
  ok(errText(undefined) === '알 수 없는 오류', 'undefined 여도 문구가 나온다');
  ok(errText(null) === '알 수 없는 오류', 'null 여도 문구가 나온다');
  ok(!String(errText({})).includes('undefined'), '빈 객체여도 undefined 가 안 보인다');

  const src = ['../js/ui.js','../js/views.js','../js/export.js']
    .map(f => fs.readFileSync(f,'utf8')).join('\n')
    .replace(/return e\.message \|\| e\.name[^;]*;/, '');   // errText 본체는 제외
  ok(!/\+ ?e(rr)?\.message/.test(src),
     '화면에 띄우는 오류는 전부 errText 를 거친다 (원시 .message 직접 사용 없음)');
}

console.log('== 자르지 않아도 등록되는가 ==');
{
  // 실제로 났던 문제: 영역을 안 잡으면 원본을 그대로 ingest 했는데,
  // 그 경로가 createImageBitmap 을 쓰고 있어서 "이미지 처리 실패" 가 났다.
  // 자를 때는 화면의 <img> 를 쓰니 통과, 안 자를 때만 실패 — 증상이 정확히 그랬다.
  const media = fs.readFileSync('../js/media.js','utf8');
  const loadBitmap = media.slice(media.indexOf('async function loadBitmap'));
  const body = loadBitmap.slice(0, loadBitmap.indexOf('\n}'));
  const imgAt = body.indexOf('loadImageEl');
  const bmpAt = body.indexOf('createImageBitmap');
  ok(imgAt >= 0 && bmpAt >= 0, '두 방식 모두 준비돼 있다');
  ok(imgAt < bmpAt, '<img> 를 먼저 쓴다 (화면에 뜨는 사진이면 무조건 통과)');

  ok(/naturalWidth \|\| bmp\.width/.test(media) || /bmp\.naturalWidth/.test(media),
     'compress 가 <img> 의 실제 크기를 읽는다');
  ok(/이미지 크기를 읽지 못했습니다/.test(media), '크기를 못 읽으면 원인이 보이는 오류');

  const ui = fs.readFileSync('../js/ui.js','utf8');
  ok(/그대로 등록/.test(ui), "영역을 안 잡으면 주 버튼이 '그대로 등록' 으로 바뀐다");
  ok(!/자르지 않고 사용/.test(ui.split('const okBtn')[0] || ''), '중복되는 별도 버튼은 없앴다');
}

console.log(fail?`\n### 실패 ${fail}건`:'\n### 전체 통과');
process.exit(fail?1:0);
