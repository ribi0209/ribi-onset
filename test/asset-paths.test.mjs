/* 코드가 참조하는 파일이 실제로 존재하는지 검사한다.
   (js/ocr.js 의 동적 import 가 js/ 기준으로 풀려 404 났던 버그를 다시 못 내게 하는 가드) */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = new URL('..', import.meta.url).pathname;
let fail = 0;
const ok = (c,m)=>{ console.log((c?'  PASS ':'  FAIL ')+m); if(!c) fail++; };
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

console.log('== js/ocr.js 가 참조하는 엔진 파일 ==');
const ocr = fs.readFileSync(path.join(ROOT,'js/ocr.js'),'utf8');

const vendorLine = ocr.match(/const VENDOR = ([^;]+);/)[1];
ok(/import\.meta\.url/.test(vendorLine),
   'VENDOR 가 import.meta.url 기준 절대 URL 이다 (상대경로면 페이지/모듈 기준이 엇갈려 404)');
const rel = vendorLine.match(/'([^']+)'/)[1];
ok(rel === '../vendor/tesseract/', `기준 경로 ${rel} — js/ 에서 한 단계 위`);

const needed = [
  'tesseract.esm.min.js', 'worker.min.js',
  'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js',
  'eng.traineddata.gz',
];
for (const f of needed) ok(exists('vendor/tesseract/'+f), `vendor/tesseract/${f} 존재`);

// 코드에 하드코딩된 파일명이 전부 실제로 있는지
const refs = [...ocr.matchAll(/VENDOR \+ '([^']+)'/g)].map(m=>m[1]);
ok(refs.length>0, `ocr.js 가 참조하는 엔진 파일 ${refs.length}개 발견`);
for (const f of refs) ok(exists('vendor/tesseract/'+f), `참조 → vendor/tesseract/${f}`);

console.log('== sw.js SHELL 목록 ==');
const sw = fs.readFileSync(path.join(ROOT,'sw.js'),'utf8');
const shell = [...sw.matchAll(/'\.\/([^']*)'/g)].map(m=>m[1]).filter(Boolean);
for (const f of shell) ok(exists(f), `SHELL: ${f}`);
ok(!sw.includes("'./vendor/"), 'OCR 엔진은 SHELL 프리캐시에서 제외 (첫 로딩 무겁지 않게)');

console.log('== index.html 참조 ==');
const html = fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
for (const m of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) ok(exists(m[1]), `index.html → ${m[1]}`);

console.log('== js 모듈 간 import ==');
for (const f of fs.readdirSync(path.join(ROOT,'js'))){
  if (!f.endsWith('.js')) continue;
  const src = fs.readFileSync(path.join(ROOT,'js',f),'utf8');
  for (const m of src.matchAll(/from '(\.\/[^']+)'|import\('(\.\/[^']+)'\)/g)){
    const t = m[1] || m[2];
    ok(exists(path.join('js', t)), `js/${f} → ${t}`);
  }
}
console.log(fail?`\n### 실패 ${fail}건`:'\n### 전체 통과');
process.exit(fail?1:0);
