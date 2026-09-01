/* =====================================================================
 * Ribi Onset — crypto.js
 * 백업 파일 암호화. 외부 팀에 넘기는 파일이 제3자에게 흘러도 못 열게 한다.
 *
 * 이것만이 이 앱에서 '진짜' 자물쇠다.
 *   - 앱 진입 암호는 검사 코드가 상대 기기에서 돌기 때문에 우회된다 (가드레일).
 *   - 파일 암호화는 브라우저 내장 Web Crypto 로 실제 암호화하므로 우회할 수 없다.
 *
 * 되돌릴 방법이 없다는 뜻이기도 하다 — 암호를 잃으면 그 파일은 영구히 못 연다.
 * 백도어를 일부러 넣지 않았다. 넣는 순간 자물쇠가 아니게 된다.
 *
 * 파일 포맷 (.ronset, 바이너리)
 *   0  ..7    매직 'RIBIONS1'
 *   8  ..11   헤더 길이 (uint32 LE)
 *   12 ..     헤더 JSON (UTF-8) { enc, kdf, iter, salt, iv, exportedAt, hint }
 *   그 뒤     AES-GCM 암호문 (마지막 16바이트가 인증 태그)
 *
 * JSON 안에 base64 로 넣지 않는 이유: 백업에는 이미 base64 이미지가 들어 있어
 * 한 번 더 감싸면 파일이 1.8배가 된다. 바이너리로 두면 그대로다.
 * ===================================================================== */

export const MAGIC   = 'RIBIONS1';
export const ENC     = 'AES-GCM-256';
export const KDF     = 'PBKDF2-SHA256';
/** 태블릿에서 1초 안팎. 헤더에 적어 두므로 나중에 올려도 옛 파일이 열린다. */
export const KDF_ITER = 250000;

const enc8 = new TextEncoder();
const dec8 = new TextDecoder();

function subtle(){
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error('이 브라우저는 암호화를 지원하지 않습니다 (https 접속인지 확인하세요)');
  return c.subtle;
}

function randomBytes(n){
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/* base64 — salt/iv 같은 작은 값에만 쓴다 (헤더용) */
function b64(bytes){
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
}
function unb64(str){
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(password, salt, iter){
  const pw = String(password || '');
  if (!pw) throw new Error('암호가 비어 있습니다');
  const base = await subtle().importKey('raw', enc8.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name:'PBKDF2', salt, iterations: iter, hash:'SHA-256' },
    base,
    { name:'AES-GCM', length:256 },
    false,
    ['encrypt','decrypt']
  );
}

/**
 * 파일 앞 8바이트만 보고 암호화 파일인지 판별한다.
 * @param {ArrayBuffer|Uint8Array} buf
 */
export function isEncryptedFile(buf){
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b.length < MAGIC.length) return false;
  for (let i = 0; i < MAGIC.length; i++) if (b[i] !== MAGIC.charCodeAt(i)) return false;
  return true;
}

/** 암호 없이 읽을 수 있는 부분 (언제 만든 파일인지, 암호 힌트) */
export function readHeader(buf){
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (!isEncryptedFile(b)) throw new Error('Ribi Onset 암호화 백업 파일이 아닙니다');
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const hlen = view.getUint32(MAGIC.length, true);
  const start = MAGIC.length + 4;
  if (hlen <= 0 || start + hlen > b.length) throw new Error('백업 파일이 손상됐습니다 (헤더)');
  let head;
  try { head = JSON.parse(dec8.decode(b.subarray(start, start + hlen))); }
  catch { throw new Error('백업 파일이 손상됐습니다 (헤더 해석 실패)'); }
  return { head, bodyAt: start + hlen };
}

/**
 * 백업 객체를 암호화해 바이너리로 만든다.
 * @param {object} data      exportBackup() 결과
 * @param {string} password
 * @param {{hint?:string}} [opts]  hint 는 평문으로 남는다 — 암호 자체를 적지 말 것
 * @returns {Promise<Blob>}
 */
export async function encryptBackup(data, password, opts = {}){
  const salt = randomBytes(16);
  const iv   = randomBytes(12);
  const key  = await deriveKey(password, salt, KDF_ITER);

  const plain = enc8.encode(JSON.stringify(data));
  const ct    = new Uint8Array(await subtle().encrypt({ name:'AES-GCM', iv }, key, plain));

  const head = enc8.encode(JSON.stringify({
    app:'ribi-onset', enc:ENC, kdf:KDF, iter:KDF_ITER,
    salt: b64(salt), iv: b64(iv),
    exportedAt: new Date().toISOString(),
    hint: String(opts.hint || '').slice(0, 80) || undefined,
  }));

  const prefix = new Uint8Array(MAGIC.length + 4);
  for (let i = 0; i < MAGIC.length; i++) prefix[i] = MAGIC.charCodeAt(i);
  new DataView(prefix.buffer).setUint32(MAGIC.length, head.length, true);

  return new Blob([prefix, head, ct], { type:'application/octet-stream' });
}

/**
 * 암호화 백업을 풀어 원래 객체로 되돌린다.
 * 암호가 틀리면 AES-GCM 의 인증 태그 검사에서 실패한다 — 조용히 깨진 값을 주지 않는다.
 * @returns {Promise<object>}
 */
export async function decryptBackup(buf, password){
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const { head, bodyAt } = readHeader(b);
  if (head.enc !== ENC) throw new Error(`알 수 없는 암호화 방식입니다 (${head.enc})`);

  const key = await deriveKey(password, unb64(head.salt), head.iter || KDF_ITER);
  let plain;
  try {
    plain = await subtle().decrypt(
      { name:'AES-GCM', iv: unb64(head.iv) }, key, b.subarray(bodyAt));
  } catch {
    // 암호가 틀렸거나 파일이 변조됐다. 둘을 구분할 방법은 없다 (그게 정상이다).
    throw new Error('암호가 다르거나 파일이 손상됐습니다');
  }
  try { return JSON.parse(dec8.decode(new Uint8Array(plain))); }
  catch { throw new Error('백업 내용을 읽을 수 없습니다'); }
}
