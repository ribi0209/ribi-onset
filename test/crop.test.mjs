/* 크롭 좌표 변환 검증
 *
 * 사진은 화면 크기에 맞춰 줄여서 보여 주고 그 위에서 영역을 끈다.
 * 이 변환을 빠뜨리면 원본에서 엉뚱한 데가 잘린다. 눈으로는 "왜 이상하지" 정도로만 보인다.
 */
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

console.log(fail?`\n### 실패 ${fail}건`:'\n### 전체 통과');
process.exit(fail?1:0);
