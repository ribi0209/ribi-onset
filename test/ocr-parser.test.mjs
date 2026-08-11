import { parseMonitor } from '../js/ocr.js';
const refs = {
  fps:['23.976','24','25','29.97','30','48','50','59.94','60','96','120'],
  shutters:['11.25°','22.5°','45°','90°','144°','172.8°','180°','270°','360°'],
  tStops:['T1.4','T2','T2.8','T4','T5.6','T8','T11','T16'],
  isoEi:['EI 400','EI 640','EI 800','EI 1280','EI 1600','EI 2500'],
  whiteBalance:['3200K','4300K','5600K','6500K','Custom'],
  ndFilters:['-','ND0.3','ND0.6','ND0.9','ND1.2','ND1.5','ND1.8','ND2.1'],
  focalLengths:['18mm','21mm','24mm','27mm','32mm','35mm','40mm','50mm','65mm','75mm','85mm','100mm','135mm'],
};
let fail=0; const ok=(c,m)=>{ console.log((c?'  PASS ':'  FAIL ')+m); if(!c) fail++; };

const CASES = [
 ['실제 OCR 출력 (전체 이미지)',
  `FPS23.976 SHUTTER 180.0 IRIS - EI800 ND - WB 4300K +0.0CC A
sol | - a
CAM | . we
FCL = BAT 14.5V A027 C006 © REC CARD 0:22 h TC12:14:01:20`],
 ['오인식 변형 1 (FP$ / Tc)',
  `FP$23.976 SHUTTER 180.0 IRIS - EI800 ND - WB 4300K +0.0CC A
FCL - BAT 14.5V A027 C006 ®OREC CARD 0:22 h Tc12:14:01:20`],
 ['오인식 변형 2 (FP5 / OREC)',
  `FP523.976 SHUTTER 180.0 IRIS - EI800 ND - WB 4300K +0.0CC A
FCL - BAT 14.5V A027 C006 OREC CARD 0:22 TC12:14:01:20`],
];
for (const [label, txt] of CASES){
  const f = parseMonitor(txt, refs);
  console.log(`\n--- ${label} ---`);
  console.log('  ', JSON.stringify(f));
  ok(f.fps==='23.976', `FPS = ${f.fps}`);
  ok(f.shutter==='180°', `셔터 = ${f.shutter} (레퍼런스 표기로 스냅)`);
  ok(f.ei==='EI 800', `EI = ${f.ei}`);
  ok(f.wb==='4300K', `WB = ${f.wb}`);
  ok(f.nd==='-', `ND = ${f.nd}`);
  ok(f.camRoll==='A027', `캠 롤 = ${f.camRoll}`);
  ok(f.clip==='C006', `클립 = ${f.clip}`);
  ok(f.tc==='12:14:01:20', `TC = ${f.tc}`);
  ok(f.cc==='+0.0', `CC = ${f.cc}`);
  ok(!('iris' in f), 'IRIS "-" 는 값 없음으로 처리');
}

console.log('\n--- 다른 카메라 표기 ---');
const v = parseMonitor('FPS 25 SHUTTER 172.8 IRIS T2.8 EI 1600 ND 0.9 WB 5600 K -1.5CC B003 C112 TC 01:02:03;04 35mm', refs);
console.log('  ', JSON.stringify(v));
ok(v.fps==='25' && v.shutter==='172.8°', 'FPS/셔터');
ok(v.iris==='T2.8', `IRIS = ${v.iris}`);
ok(v.ei==='EI 1600', `EI = ${v.ei}`);
ok(v.nd==='ND0.9', `ND = ${v.nd}`);
ok(v.wb==='5600K', `WB = ${v.wb}`);
ok(v.camRoll==='B003' && v.clip==='C112', `롤/클립 = ${v.camRoll} ${v.clip}`);
ok(v.tc==='01:02:03:04', `드롭프레임 TC 정규화 = ${v.tc}`);
ok(v.lens==='35mm', `렌즈 = ${v.lens}`);

console.log('\n--- 오검출 방지 ---');
const n = parseMonitor('BAT 14.5V CARD 0:22 h FCL - REC', refs);
console.log('  ', JSON.stringify(n));
ok(!n.tc, '카드 잔여시간 0:22 을 TC 로 오인하지 않음');
ok(!n.fps && !n.ei, '없는 값은 만들어내지 않음');
const e = parseMonitor('', refs);
ok(Object.keys(e).length===0, '빈 입력 → 빈 결과');


console.log('\n--- 실제 ARRI 모니터 오버레이 (A/B캠 동시) ---');
{
  // 현장에서 찍은 실제 화면. 하단에 캠 롤 + 클립, 상단에 노출값이 뜬다.
  const B = 'FPS 23.976 SHUTTER 180.0 IRIS - EI 800 ND - WB 4300 K +0.0 CC B\n'
          + 'SDI Look CAM 4K U LOG LDS WRS\n'
          + 'FCL 75.0mm BAT 14.7V B027 C001 REC CARD 0:27 h TC 12:01:21:03';
  const A = 'FPS 23.976 SHUTTER 180.0 IRIS - EI 800 ND - WB 4300 K +0.0 CC A\n'
          + 'SDI Look CAM 4K U LOG LDS WRS\n'
          + 'FCL - BAT 14.8V A027 C002 REC CARD 0:25 h TC 11:54:33:18';

  const b = parseMonitor(B, refs);
  console.log('   B:', JSON.stringify(b));
  ok(b.camRoll==='B027', `B캠 롤 = ${b.camRoll}`);
  ok(b.clip==='C001', `B캠 클립 = ${b.clip}`);
  ok(b.tc==='12:01:21:03', `B캠 TC = ${b.tc}`);
  ok(b.fps==='23.976' && b.shutter==='180°' && b.ei==='EI 800' && b.wb==='4300K', '노출값 일괄 판독');
  ok(b.nd==='-', "ND 없음('-') 도 값으로 인식");
  ok(b.cc==='+0.0', `CC = ${b.cc}`);
  ok(b.lens==='75mm', `FCL 75.0mm → ${b.lens} (소수점 초점거리)`);
  ok(b.camRoll[0]==='B', '캠 롤 첫 글자로 캠 유닛 판별 가능');

  const a = parseMonitor(A, refs);
  console.log('   A:', JSON.stringify(a));
  ok(a.camRoll==='A027', `A캠 롤 = ${a.camRoll}`);
  ok(a.clip==='C002', `A캠 클립 = ${a.clip}`);
  ok(a.tc==='11:54:33:18', `A캠 TC = ${a.tc}`);
  ok(!a.lens, "FCL '-' 는 초점거리로 만들어내지 않음");
  ok(a.camRoll[0]!==b.camRoll[0], '두 장이 서로 다른 캠으로 분류됨');
  // BAT 14.8V 의 숫자를 초점거리로 오인하면 안 된다
  ok(a.lens!=='14mm' && b.lens!=='14mm', '배터리 전압을 렌즈로 오인하지 않음');
}

console.log(fail?`\n### 실패 ${fail}건`:'\n### 전체 통과');
process.exit(fail?1:0);
