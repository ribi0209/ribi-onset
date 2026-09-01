/* 백업 암호화 — 이게 이 앱에서 유일하게 '진짜' 자물쇠이므로 가장 촘촘히 본다.
 *
 *  1) 왕복: 암호화 → 복호화 하면 원본과 완전히 같다
 *  2) 틀린 암호는 반드시 실패한다 (조용히 깨진 값을 돌려주면 안 된다)
 *  3) 파일이 1바이트라도 변조되면 실패한다 (AES-GCM 인증 태그)
 *  4) 암호 없이 읽히는 건 헤더뿐 — 내용은 파일 어디에도 평문으로 없다
 *  5) 매번 다른 salt/iv → 같은 데이터·같은 암호라도 파일이 달라진다
 */
let fail = 0;
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; };

// 브라우저 전역 흉내 (node 는 crypto.subtle 을 이미 가지고 있다)
globalThis.btoa ||= (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ||= (s) => Buffer.from(s, 'base64').toString('binary');
if (typeof Blob === 'undefined') globalThis.Blob = (await import('node:buffer')).Blob;

const C = await import('../js/crypto.js');

const PW   = 'ribi-onset-2026!';
const DATA = {
  app:'ribi-onset', version:3,
  projects:[{ id:'PRJ-1', name:'PMT (프로모터)', director:'이종석' }],
  scenes:[
    { id:'PMT-A-20260901-101010-AAAA', scene:'1-1', shotNote:'와이어 3개\n간판 지움',
      cams:{ A:{ camRoll:'A027', clip:'C002', focalLength:'75.0mm' } } },
    { id:'PMT-A-20260901-101011-BBBB', scene:'1-2', shotNote:'' },
  ],
  locations:[{ id:'LOC-1', mainLocation:'그린힐테라스',
               subOrder:['S1'], subs:{ S1:{ subLocation:'거실', path:'파주 1동 101호' } } }],
  references:{ vendors:['WSWG','HI'] },
};

const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());

console.log('== 왕복 ==');
const blob = await C.encryptBackup(DATA, PW, { hint:'프로젝트 이름 + 연도' });
const buf  = await bytes(blob);

ok(C.isEncryptedFile(buf), '매직으로 암호화 파일 판별');
ok(!C.isEncryptedFile(new TextEncoder().encode('{"app":"ribi-onset"}')),
   '평문 JSON 은 암호화 파일이 아니다');

const back = await C.decryptBackup(buf, PW);
ok(JSON.stringify(back) === JSON.stringify(DATA), '복호화 결과가 원본과 완전히 동일');
ok(back.scenes[0].cams.A.clip === 'C002', '중첩된 캠 값까지 보존');
ok(back.scenes[0].shotNote.includes('\n'), '줄바꿈 보존');
ok(back.locations[0].subs.S1.subLocation === '거실', '한글 보존');

console.log('== 틀린 암호 ==');
for (const wrong of ['ribi-onset-2026', 'RIBI-ONSET-2026!', '', 'x']){
  let threw = null;
  try { await C.decryptBackup(buf, wrong); } catch (e){ threw = e; }
  ok(!!threw, `'${wrong}' 거부됨 (${threw && threw.message})`);
}

console.log('== 변조 감지 ==');
{
  const t = buf.slice();
  t[t.length - 1] ^= 0x01;                    // 암호문 마지막 1비트
  let threw = null;
  try { await C.decryptBackup(t, PW); } catch (e){ threw = e; }
  ok(!!threw, '암호문 1비트 변조 → 실패');
}
{
  const t = buf.slice();
  t[t.length - 20] ^= 0x01;                   // 태그가 아닌 본문 쪽
  let threw = null;
  try { await C.decryptBackup(t, PW); } catch (e){ threw = e; }
  ok(!!threw, '본문 1비트 변조 → 실패 (인증 태그가 잡는다)');
}
{
  let threw = null;
  try { C.readHeader(new TextEncoder().encode('그냥 텍스트')); } catch (e){ threw = e; }
  ok(!!threw, '엉뚱한 파일은 헤더 단계에서 거부');
}

console.log('== 평문 노출 여부 ==');
{
  // 파일 전체를 latin1 로 훑어 원문 조각이 보이는지 확인한다
  const raw = Buffer.from(buf).toString('latin1');
  const utf = Buffer.from(buf).toString('utf8');
  const secrets = ['프로모터', '이종석', 'A027', 'C002', '그린힐테라스', '와이어', '파주 1동'];
  const leaked = secrets.filter(s => raw.includes(s) || utf.includes(s));
  ok(leaked.length === 0, `내용이 파일에 평문으로 없다 (노출: ${leaked.join(',') || '없음'})`);

  const { head } = C.readHeader(buf);
  ok(head.enc === 'AES-GCM-256' && head.kdf === 'PBKDF2-SHA256', '헤더에 방식 명시');
  ok(head.iter >= 100000, `반복 횟수 ${head.iter} (무차별 대입 비용)`);
  ok(head.hint === '프로젝트 이름 + 연도', '암호 힌트는 평문 (암호 자체를 적으면 안 된다)');
  ok(!('password' in head) && !('key' in head), '헤더에 암호·키가 없다');
  ok(!JSON.stringify(head).includes('프로모터'), '헤더에 프로젝트 내용이 없다');
}

console.log('== 매번 다른 파일 ==');
{
  const a = await bytes(await C.encryptBackup(DATA, PW));
  const b = await bytes(await C.encryptBackup(DATA, PW));
  ok(Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0,
     '같은 데이터·같은 암호라도 salt/iv 가 달라 파일이 다르다');
  ok(JSON.stringify(await C.decryptBackup(a, PW)) === JSON.stringify(await C.decryptBackup(b, PW)),
     '그래도 둘 다 같은 내용으로 풀린다');
}

console.log('== 크기 ==');
{
  const plainSize = new TextEncoder().encode(JSON.stringify(DATA)).length;
  const grow = buf.length - plainSize;
  ok(grow < 400, `평문 대비 ${grow}바이트만 증가 (base64 로 감싸지 않는다)`);
}

console.log(fail ? `### 실패 ${fail}건` : '### 전체 통과');
process.exit(fail ? 1 : 0);
