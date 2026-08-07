import 'fake-indexeddb/auto';
import fs from 'node:fs';

// --- 브라우저 전용 API 최소 셰임 ---

if (!globalThis.FileReader){
  globalThis.FileReader = class {
    readAsDataURL(blob){
      blob.arrayBuffer().then(buf => {
        const b64 = Buffer.from(buf).toString('base64');
        this.result = `data:${blob.type||'application/octet-stream'};base64,${b64}`;
        this.onload && this.onload();
      });
    }
  };
}

const DB = await import('../js/db.js');
const SRC = process.env.PMT_BACKUP;
const orig = JSON.parse(fs.readFileSync(SRC,'utf8'));

let fail = 0;
const ok = (c,m)=>{ console.log((c?'  PASS ':'  FAIL ')+m); if(!c) fail++; };

console.log('== 1. importBackup (replace) ==');
const stats = await DB.importBackup(orig, 'replace', ()=>{});
console.log('  stats:', JSON.stringify(stats));
ok(stats.scenes === orig.cuts.length,         `구 백업 cuts → scenes 이관 ${stats.scenes}/${orig.cuts.length}`);
ok(stats.locations === orig.locations.length, `로케이션 ${stats.locations}/${orig.locations.length}`);
ok(stats.cameras === orig.cameras.length,     `카메라 ${stats.cameras}/${orig.cameras.length}`);
ok(stats.assets === orig.assets.length,       `에셋 ${stats.assets}/${orig.assets.length}`);

// 원본 이미지 개수 세기
function countImgs(o){ let n=0; const w=(v)=>{ if(!v) return;
  if(Array.isArray(v)) return v.forEach(w);
  if(typeof v==='object'){ if(v.dataUrl) n++; else Object.values(v).forEach(w); } };
  w(o); return n; }
const origImgs = countImgs({p:orig.project,l:orig.locations,c:orig.cameras,a:orig.assets,u:orig.cuts});
ok(stats.media === origImgs, `이미지 ${stats.media}/${origImgs}`);

console.log('== 2. 레퍼런스 보존 ==');
const refs = await DB.getRefs();
const DROPPED_REFS = ['cuts','pDays'];
const keptRefs = Object.keys(orig.references).filter(k => !DROPPED_REFS.includes(k));
const refBad = keptRefs.filter(k => JSON.stringify(refs[k]) !== JSON.stringify(orig.references[k]));
ok(refBad.length===0, `레퍼런스 ${keptRefs.length}종 일치 (불일치: ${refBad})`);
ok(DROPPED_REFS.every(k => !(k in refs)), '폐기 레퍼런스 2종 미도입');

console.log('== 3. 프로젝트 필드 보존 ==');
const proj = await DB.getProject();
const projMismatch = Object.entries(orig.project).filter(([k,v]) => k!=='poster' && proj[k]!==v);
ok(projMismatch.length===0, `프로젝트 필드 일치 (불일치 ${projMismatch.length}: ${projMismatch.map(x=>x[0])})`);
ok(!!(proj.poster && proj.poster.mid), '포스터 이미지 → media 참조로 변환됨');

console.log('== 4. export 라운드트립 ==');
const out = await DB.exportBackup(true);
ok(out.scenes.length===orig.cuts.length && out.locations.length===orig.locations.length
   && out.assets.length===orig.assets.length && out.cameras.length===orig.cameras.length, '레코드 수 동일');
ok(out.cuts === undefined, '내보내기는 scenes 키만 사용 (cut 개념 제거)');
const outImgs = countImgs({p:out.project,l:out.locations,c:out.cameras,a:out.assets,u:out.scenes});
ok(outImgs===origImgs, `이미지 수 동일 ${outImgs}/${origImgs}`);

// 바이트 단위 이미지 동일성 — id 로 매칭해 전 레코드 전수 비교
function imgList(o){ const r=[]; const w=(v)=>{ if(!v) return;
  if(Array.isArray(v)) return v.forEach(w);
  if(typeof v==='object'){ if(v.dataUrl){r.push(v);} else Object.values(v).forEach(w);} }; w(o); return r; }
let imgChecked=0, imgBad=[];
for (const store of ['locations','cameras','assets','cuts']){
  const outStore = store==='cuts' ? 'scenes' : store;
  const outById = Object.fromEntries(out[outStore].map(r=>[r.id,r]));
  for (const rec of orig[store]){
    const A = imgList(rec), B = imgList(outById[rec.id]||{});
    if (A.length !== B.length){ imgBad.push(`${rec.id}: 장수 ${A.length}!=${B.length}`); continue; }
    for (let i=0;i<A.length;i++){
      imgChecked++;
      if (A[i].dataUrl !== B[i].dataUrl) imgBad.push(`${rec.id}[${i}] 바이트 불일치`);
      else if (A[i].name!==B[i].name || A[i].width!==B[i].width || A[i].height!==B[i].height
               || A[i].originalBytes!==B[i].originalBytes || A[i].compressedBytes!==B[i].compressedBytes)
        imgBad.push(`${rec.id}[${i}] 메타 불일치`);
    }
  }
}
const pA = imgList(orig.project), pB = imgList(out.project);
imgChecked += pA.length;
if (pA.length!==pB.length || pA.some((x,i)=>x.dataUrl!==pB[i].dataUrl)) imgBad.push('project.poster 불일치');
ok(imgBad.length===0, `이미지 ${imgChecked}장 바이트+메타 무손실 (문제 ${imgBad.length}: ${imgBad.slice(0,3)})`);

// 컷 필드 전수 비교
const outCutById = Object.fromEntries(out.scenes.map(c=>[c.id,c]));
let cutDiff = [];
for (const c of orig.cuts){
  const o2 = outCutById[c.id];
  if (!o2){ cutDiff.push(c.id+':missing'); continue; }
  for (const [k,v] of Object.entries(c)){
    if (['photos','thumbnail','updatedAt','cut','pDay'].includes(k)) continue;
    if (o2[k] !== v) cutDiff.push(`${c.id}.${k}`);
  }
}
ok(cutDiff.length===0, `씬 필드 전수 일치 (불일치 ${cutDiff.length}: ${cutDiff.slice(0,5)})`);
const anyLegacy = out.scenes.some(r => 'cut' in r || 'pDay' in r);
ok(!anyLegacy, '폐기 필드(cut, pDay)가 레코드에서 완전히 제거됨');
ok(!('cuts' in refs) && !('pDays' in refs), '폐기 레퍼런스(cuts, pDays) 미도입');
ok(out.assets.every(a => !('linkedCutIds' in a) ), 'assets.linkedCutIds → linkedSceneIds 이관');

console.log('== 5. merge 모드 / GC ==');
const s2 = await DB.importBackup(orig, 'merge', ()=>{});
const cuts2 = await DB.list('scenes');
ok(cuts2.length===orig.cuts.length, `merge 시 동일 id 중복 생성 안 함 (${cuts2.length})`);
ok(s2.media === origImgs, `merge 후 미디어 수 ${s2.media}/${origImgs} (고아 자동 정리됨)`);
const gc = await DB.gcMedia();
ok(gc === 0, `추가 GC 대상 ${gc}건 = 0 (누수 없음)`);
const afterGc = await DB.exportBackup(true);
ok(countImgs({p:afterGc.project,l:afterGc.locations,c:afterGc.cameras,a:afterGc.assets,u:afterGc.scenes})===origImgs, 'GC 후에도 사용 중 이미지 무손실');

console.log('== 6. 신규 ID 생성 ==');
ok(/^PMT-\d{8}-\d{6}-[0-9A-F]{4}$/.test(DB.makeSceneId('PMT (프로모터)')), 'makeSceneId 포맷 = 기존 규칙과 동일');
ok(/^LOC-[0-9A-F]{8}$/.test(DB.makeId('LOC')), 'makeId 포맷');

console.log(fail ? `\n### 실패 ${fail}건` : '\n### 전체 통과');
process.exit(fail?1:0);
