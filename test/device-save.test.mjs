/* 촬영 원본을 기기에 남기는 기능 검증
 *
 * 배경: 웹 앱은 갤러리(DCIM)에 직접 쓸 수 없다. capture 로 연 카메라는 사진을
 * 임시 파일로 앱에 넘기고 끝나서 기기에 아무것도 남지 않는다.
 * 그래서 원본을 Download 로 한 벌 더 내려받는다. 파일명이 엉키면 나중에 못 찾으므로 고정한다.
 */
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k,v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
globalThis.document = { createElement: () => ({ style:{}, click(){}, remove(){} }),
                        body: { appendChild(){} } };
globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL(){} };

const { deviceFileName, deviceSaveEnabled, setDeviceSave, saveToDevice } = await import('../js/media.js');
let fail=0; const ok=(c,m)=>{ console.log((c?'  PASS ':'  FAIL ')+m); if(!c) fail++; };

console.log('== 기본값 ==');
ok(deviceSaveEnabled() === true, '처음에는 켜져 있다 (현장에서 원본이 남아야 한다)');
setDeviceSave(false);
ok(deviceSaveEnabled() === false, '끄면 꺼진다');
setDeviceSave(true);
ok(deviceSaveEnabled() === true, '다시 켜진다');

console.log('== 파일명 ==');
{
  const when = new Date(2026, 7, 12, 14, 30, 5);   // 2026-08-12 14:30:05
  ok(deviceFileName(['EP01','1-1','모니터'], when) === 'Ribi_EP01_1-1_모니터_20260812-143005.jpg',
     deviceFileName(['EP01','1-1','모니터'], when));
  ok(deviceFileName([], when) === 'Ribi_20260812-143005.jpg', '정보가 없으면 시각만');
  ok(deviceFileName(['', null, '씬'], when) === 'Ribi_씬_20260812-143005.jpg', '빈 값은 건너뛴다');
  // 파일명에 못 쓰는 문자가 씬 번호 등에 섞여도 저장이 깨지면 안 된다
  const bad = deviceFileName(['A/B', 'C:D', '공백 있음'], when);
  ok(!/[\\/:*?"<>|]/.test(bad), `금지 문자 제거 (${bad})`);
  ok(!/ /.test(bad), '공백은 밑줄로');
  ok(bad.endsWith('.jpg'), '확장자 유지');
}

console.log('== 저장 호출 ==');
ok(saveToDevice(new Blob(['x']), 'a.jpg') === true, '원본을 내려받는다');
ok(saveToDevice(null, 'a.jpg') === false, '파일이 없으면 조용히 실패 (앱 기록에는 영향 없음)');

console.log(fail?`\n### 실패 ${fail}건`:'\n### 전체 통과');
process.exit(fail?1:0);
