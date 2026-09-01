/* 두 기기 왕복 — 외부 팀에게 넘기고 받아서 합치는 실제 흐름
 *
 *   [나]  프로젝트 만들고 암호화 백업 전달
 *   [상대] 가져오기(덮어쓰기) → 현장 기록 → 암호화 백업 반환
 *   [나]  병합 가져오기 → 내 기록과 합쳐진다
 *
 * 여기서 반드시 지켜야 할 것
 *   1) 암호 없이는 못 연다
 *   2) 기기 표식 덕에 새 기록의 id 가 겹치지 않는다
 *   3) 같은 씬을 양쪽이 건드려도, 서로 다른 캠이면 둘 다 살아남는다
 *   4) 같은 캠을 양쪽이 건드리면 나중에 손댄 쪽만 남는다 (조용히 덮지 않고 세어서 알려 준다)
 *   5) 내가 나중에 고친 기록이 상대의 옛 값으로 되돌아가지 않는다
 *   6) 양쪽이 각자 만든 같은 이름의 대장소가 한 줄로 합쳐진다
 */
import * as FDB from 'fake-indexeddb';
globalThis.btoa ||= (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ||= (s) => Buffer.from(s, 'base64').toString('binary');
if (typeof Blob === 'undefined') globalThis.Blob = (await import('node:buffer')).Blob;

let fail = 0;
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; };

const C = await import('../js/crypto.js');

/** 기기 한 대 = IndexedDB 하나. 모듈은 전역 indexedDB 를 보므로 갈아 끼운다. */
function useDevice(store){
  globalThis.indexedDB = store.idb;
  globalThis.IDBKeyRange = FDB.IDBKeyRange;
}
const mkDevice = () => ({ idb: new FDB.IDBFactory() });

const A = mkDevice();   // 나 (마스터)
const B = mkDevice();   // 외부 팀

// db.js 는 한 번만 로드되고 내부 커넥션을 캐시하므로, 기기를 바꿀 때마다 새로 import 한다
const loadDB = async (dev, tag) => {
  useDevice(dev);
  const mod = await import(`../js/db.js?dev=${tag}`);
  await mod.open();
  return mod;
};

const PW = '프로모터-2026-현장';
const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
const T = (iso) => iso;   // 가독성용

console.log('== [나] 프로젝트 준비 ==');
const dbA = await loadDB(A, 'A');
await dbA.setDeviceTag('A');
const proj = await dbA.getProject();
proj.name = 'PMT'; await dbA.setProject(proj);

const sceneId = dbA.makeSceneId(proj.name);
ok(sceneId.startsWith('PMT-A-'), `씬 id 에 기기 표식 (${sceneId})`);
ok(dbA.makeId('LOC').startsWith('LOC-A'), '로케이션 id 에도 표식');

await dbA.put('scenes', { id: sceneId, projectId: proj.id, scene:'1-1',
  cams:{ A:{ camRoll:'A027', clip:'C002', _u:T('2026-09-01T09:00:00.000Z') }, B:{}, C:{}, D:{} },
  createdAt:T('2026-09-01T09:00:00.000Z'), updatedAt:T('2026-09-01T09:00:00.000Z') });
await dbA.put('locations', { id:'LOC-A1', projectId: proj.id, mainLocation:'그린힐테라스',
  setType:'Location', subOrder:['S1'],
  subs:{ S1:{ subLocation:'거실', path:'파주 1동', _u:T('2026-09-01T09:00:00.000Z') } },
  createdAt:T('2026-09-01T09:00:00.000Z'), updatedAt:T('2026-09-01T09:00:00.000Z') });

const handoff = await C.encryptBackup(await dbA.exportBackup(false, proj.id), PW,
                                      { hint:'작품명 + 연도' });
const handoffBuf = await bytes(handoff);

console.log('== [상대] 암호 없이는 못 연다 ==');
{
  let threw = null;
  try { await C.decryptBackup(handoffBuf, '아무거나'); } catch (e){ threw = e; }
  ok(!!threw, `암호 틀리면 거부 (${threw && threw.message})`);
  ok(C.isEncryptedFile(handoffBuf), '파일은 암호화 상태로 전달된다');
}

console.log('== [상대] 가져와서 현장 기록 ==');
const dbB = await loadDB(B, 'B');
await dbB.importBackup(await C.decryptBackup(handoffBuf, PW), 'replace', () => {});
await dbB.setDeviceTag('B');

{
  const got = await dbB.get('scenes', sceneId);
  ok(!!got && got.cams.A.clip === 'C002', '내 기록이 그대로 넘어갔다');
  const locs = await dbB.list('locations');
  ok(locs.length === 1 && locs[0].mainLocation === '그린힐테라스', '로케이션도 넘어갔다');
}

// 상대가 같은 씬의 B캠을 적는다 (A캠은 안 건드림)
{
  const sc = await dbB.get('scenes', sceneId);
  sc.cams.B = { camRoll:'B027', clip:'C001', _u:T('2026-09-01T14:00:00.000Z') };
  sc.updatedAt = T('2026-09-01T14:00:00.000Z');
  await dbB.put('scenes', sc);
}
// 상대가 자기 씬을 새로 만든다
const bSceneId = dbB.makeSceneId('PMT');
ok(bSceneId.startsWith('PMT-B-'), `상대 씬 id (${bSceneId})`);
ok(bSceneId !== sceneId, 'id 가 겹치지 않는다');
await dbB.put('scenes', { id:bSceneId, projectId: proj.id, scene:'2-1',
  cams:{ A:{ camRoll:'A028', clip:'C010' }, B:{}, C:{}, D:{} },
  createdAt:T('2026-09-01T15:00:00.000Z'), updatedAt:T('2026-09-01T15:00:00.000Z') });
// 상대가 같은 이름의 대장소를 따로 만든다 (내 LOC-A1 을 모르고)
await dbB.put('locations', { id:'LOC-B9', projectId: proj.id, mainLocation:'그린힐테라스',
  subOrder:['S1'], subs:{ S1:{ subLocation:'주방', path:'파주 1동' } },
  createdAt:T('2026-09-01T15:10:00.000Z'), updatedAt:T('2026-09-01T15:10:00.000Z') });

const backBuf = await bytes(await C.encryptBackup(await dbB.exportBackup(false, proj.id), PW));

console.log('== [나] 그 사이 내 기록도 진행 ==');
useDevice(A);
{
  // 나는 같은 씬의 A캠을 더 늦게 고쳤다 → 내 값이 이겨야 한다
  const sc = await dbA.get('scenes', sceneId);
  sc.cams.A = { camRoll:'A027', clip:'C002', focalLength:'75.0mm', _u:T('2026-09-01T18:00:00.000Z') };
  sc.updatedAt = T('2026-09-01T18:00:00.000Z');
  await dbA.put('scenes', sc);
}

console.log('== [나] 병합 ==');
const stats = await dbA.importBackup(await C.decryptBackup(backBuf, PW), 'merge', () => {});
const m = stats.merge;
ok(!!m, '병합 내역이 반환된다');
ok(m.added >= 2, `새로 추가 ${m.added}건 (상대 씬 + 상대 로케이션)`);
ok(m.updated + m.kept >= 1, `기존과 겹친 기록 ${m.updated + m.kept}건`);

{
  const sc = await dbA.get('scenes', sceneId);
  ok(sc.cams.A.focalLength === '75.0mm',
     `내가 나중에 고친 A캠이 살아남는다 (${sc.cams.A.focalLength})`);
  ok(sc.cams.B.clip === 'C001',
     `상대가 적은 B캠도 같이 살아남는다 (${sc.cams.B.clip})`);
  ok(!!await dbA.get('scenes', bSceneId), '상대가 새로 만든 씬도 들어왔다');
}

console.log('== 중복 대장소 정리 ==');
{
  const locs = await dbA.list('locations');
  ok(locs.length === 1, `'그린힐테라스' 가 한 줄로 합쳐졌다 (${locs.length}건)`);
  const S = await import('../js/schema.js');
  const names = S.subIds('locations', locs[0]).map(sid => S.subName('locations', locs[0], sid));
  ok(names.join(' · ') === '거실 · 주방', `소장소 두 개가 탭으로 (${names.join(' · ')})`);
  ok(typeof m.dedupedLocations === 'number' && m.dedupedLocations === 1,
     `합친 건수 보고 (${m.dedupedLocations})`);
}

console.log('== 되돌아가기 방지 ==');
{
  // 상대의 옛 백업을 다시 병합해도 내 최신 값이 밀리면 안 된다
  const again = await dbA.importBackup(await C.decryptBackup(backBuf, PW), 'merge', () => {});
  const sc = await dbA.get('scenes', sceneId);
  ok(sc.cams.A.focalLength === '75.0mm', '옛 백업을 다시 병합해도 내 값 유지');
  ok(again.merge.kept >= 1, `건너뛴 기록 ${again.merge.kept}건 (조용히 덮지 않는다)`);
  ok((await dbA.list('locations')).length === 1, '대장소도 다시 늘어나지 않는다');
}


console.log('== 게스트 모드는 사고 방지용 ==');
{
  const { hashMaster } = await import('../js/ui.js');
  useDevice(B);
  await dbB.setMasterHash(await hashMaster('master-pw'));
  await dbB.setGuest(true);
  ok(dbB.isGuest() === true, '게스트 모드 켜짐');
  ok(dbB.masterHash().length === 64, '암호가 아니라 SHA-256 해시만 저장');
  ok(dbB.masterHash() !== 'master-pw', '암호 평문이 저장되지 않는다');
  ok(await hashMaster('master-pw') === dbB.masterHash(), '같은 암호는 같은 해시');
  ok(await hashMaster('master-pW') !== dbB.masterHash(), '다른 암호는 다른 해시');

  // 게스트 설정은 기기 로컬이므로 백업에 실려 나가지 않아야 한다
  const out = await dbB.exportBackup(false, proj.id);
  const dump = JSON.stringify(out);
  ok(!dump.includes('masterHash') && !dump.includes('guestMode'),
     '게스트 설정·마스터 해시는 백업에 포함되지 않는다');
  ok(!dump.includes('deviceTag'), '기기 표식도 백업에 포함되지 않는다');
  await dbB.setGuest(false);
}

console.log(fail ? `### 실패 ${fail}건` : '### 전체 통과');
process.exit(fail ? 1 : 0);
