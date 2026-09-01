/* =====================================================================
 * Ribi Onset — ui.js
 * DOM 헬퍼 + 공용 위젯(토스트/시트/확인창) + 스키마 기반 폼 렌더러.
 * ===================================================================== */

import * as DB from './db.js';
import { ingest, ingestMany, pickFiles, fmtBytes, cropFromImage } from './media.js';

/* ---------------- DOM 헬퍼 ---------------- */

export function el(tag, attrs = {}, children = []){
  const n = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)){
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(children)){
    if (c === null || c === undefined || c === false) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}
export const $  = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export function clear(n){ while (n.firstChild) n.removeChild(n.firstChild); return n; }
export function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/** 예외를 사람이 읽을 문구로. Error 가 아닌 것(이벤트 객체 등)이 던져져도 undefined 가 뜨지 않게 한다. */
export function errText(e){
  if (!e) return '알 수 없는 오류';
  if (typeof e === 'string') return e;
  return e.message || e.name || e.type || String(e);
}

/* ---------------- 토스트 ---------------- */

let toastTimer = null;
export function toast(msg, kind = 'ok', ms = 2400){
  let t = $('#toast');
  if (!t){ t = el('div', { id:'toast', class:'toast' }); document.body.appendChild(t); }
  t.className = 'toast show ' + kind;
  t.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.className = 'toast', ms);
}

/* ---------------- 진행 오버레이 ---------------- */

export function progress(){
  const bar = el('div', { class:'pb-fill' });
  const label = el('div', { class:'pb-label', text:'준비 중…' });
  const box = el('div', { class:'pb-box' }, [label, el('div',{class:'pb-track'},[bar])]);
  const ov = el('div', { class:'overlay' }, [box]);
  document.body.appendChild(ov);
  return {
    set(msg, pct){ label.textContent = msg; bar.style.width = Math.max(0, Math.min(100, pct)) + '%'; },
    done(){ ov.remove(); }
  };
}

/* ---------------- 확인창 ---------------- */

export function confirmBox(title, body, okLabel = '확인', danger = false){
  return new Promise(res => {
    const close = (v) => { ov.remove(); res(v); };
    const ov = el('div', { class:'overlay', onclick:(e)=>{ if(e.target===ov) close(false); } }, [
      el('div', { class:'dialog' }, [
        el('h3', { text:title }),
        el('p', { class:'dim', text: body }),
        el('div', { class:'row end gap' }, [
          el('button', { class:'btn ghost', onclick:()=>close(false), text:'취소' }),
          el('button', { class:'btn ' + (danger ? 'danger' : 'primary'), onclick:()=>close(true), text:okLabel }),
        ])
      ])
    ]);
    document.body.appendChild(ov);
  });
}

/**
 * 암호 입력창. 확인란을 켜면 두 번 입력해 오타를 막는다 (암호를 잃으면 복구가 없다).
 * @returns {Promise<string|null>} 취소하면 null
 */
export function promptPassword({ title, body, okLabel = '확인', confirm = false, note = '' } = {}){
  return new Promise(res => {
    const close = (v) => { ov.remove(); res(v); };
    const pw1 = el('input', { class:'inp', type:'password', placeholder:'암호',
                              autocomplete:'off', autocapitalize:'off', spellcheck:'false' });
    const pw2 = confirm ? el('input', { class:'inp', type:'password', placeholder:'암호 다시 입력',
                                        autocomplete:'off', autocapitalize:'off', spellcheck:'false' }) : null;
    const err = el('div', { class:'tiny', style:'color:var(--err);min-height:16px' });
    const show = el('label', { class:'row gap tiny dim', style:'cursor:pointer' }, [
      el('input', { type:'checkbox', onchange:(e) => {
        const t = e.target.checked ? 'text' : 'password';
        pw1.type = t; if (pw2) pw2.type = t;
      }}),
      document.createTextNode('암호 보기'),
    ]);
    const submit = () => {
      const v = pw1.value;
      if (!v){ err.textContent = '암호를 입력하세요.'; return; }
      if (pw2 && v !== pw2.value){ err.textContent = '두 번 입력한 암호가 다릅니다.'; return; }
      close(v);
    };
    pw1.addEventListener('keydown', (e) => { if (e.key === 'Enter') (pw2 ? pw2 : { focus:submit }).focus(); });
    pw2 && pw2.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

    const ov = el('div', { class:'overlay', onclick:(e)=>{ if(e.target===ov) close(null); } }, [
      el('div', { class:'dialog' }, [
        el('h3', { text: title }),
        body ? el('p', { class:'dim', text: body }) : null,
        pw1, pw2, show, err,
        note ? el('p', { class:'tiny', style:'color:var(--warn)', text: note }) : null,
        el('div', { class:'row end gap' }, [
          el('button', { class:'btn ghost', onclick:()=>close(null), text:'취소' }),
          el('button', { class:'btn primary', onclick:submit, text: okLabel }),
        ])
      ])
    ]);
    document.body.appendChild(ov);
    setTimeout(() => pw1.focus(), 30);
  });
}

/** 마스터 암호 해시 — 암호 자체는 어디에도 저장하지 않는다 */
export async function hashMaster(pw){
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ribi-onset:' + String(pw)));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,'0')).join('');
}

/**
 * 게스트 모드일 때 파괴적 동작 앞에 세우는 관문.
 * 마스터 모드면 그냥 통과한다. 다시 말하지만 보안이 아니라 사고 방지다.
 * @returns {Promise<boolean>} 진행해도 되는지
 */
export async function requireMaster(what){
  const DB = await import('./db.js');
  if (!DB.isGuest()) return true;
  const want = DB.masterHash();
  if (!want){ toast('마스터 암호가 설정돼 있지 않습니다', 'err'); return false; }
  const pw = await promptPassword({
    title:'마스터 암호', body:`${what} — 마스터 암호가 필요합니다.`, okLabel:'확인' });
  if (pw === null) return false;
  if (await hashMaster(pw) !== want){ toast('암호가 다릅니다', 'err'); return false; }
  return true;
}

/* ---------------- 데이터리스트 (콤보 옵션) ---------------- */

let REFS = {};
export function setRefsCache(r){
  REFS = r;
  let host = $('#datalists');
  if (!host){ host = el('div', { id:'datalists', hidden:'' }); document.body.appendChild(host); }
  clear(host);
  for (const [k,v] of Object.entries(REFS)){
    host.appendChild(el('datalist', { id:'dl-'+k }, v.map(o => el('option', { value:o }))));
  }
}
export function refsCache(){ return REFS; }
export function refList(key){ return REFS[key] || []; }

/* ---------------- 사진 위젯 ---------------- */

/**
 * 사진 타일.
 *
 * 앱 안에서 카메라를 열지 않는다 — 그렇게 찍은 사진은 기기 갤러리에 남지 않기 때문이다.
 * 촬영은 태블릿 기본 카메라로 하고(갤러리에 정상 저장), 여기서는 그 사진을 불러온다.
 * opts.cropOnPick 이면 불러오는 즉시 자르기 화면을 띄운다 (모니터 두 대 중 한 대만 쓸 때).
 */
export function photoTile(getVal, setVal, preset, onDirty, opts = {}){
  const box = el('div', { class:'photo-tile' + (opts.big ? ' big' : '') });

  async function render(){
    clear(box);
    const v = getVal();
    if (v && v.mid){
      const url = await DB.mediaURL(v.mid);
      const img = el('img', { src: url || '', alt: v.name || '' });
      img.addEventListener('click', () => lightbox(url, v.name));
      box.appendChild(img);
      box.appendChild(el('div', { class:'photo-meta', text: `${v.width}×${v.height} · ${fmtBytes(v.compressedBytes||0)}` }));
      box.appendChild(el('button', {
        class:'photo-x', title:'삭제', text:'×',
        onclick: async (e) => { e.stopPropagation(); await DB.delMedia(v.mid); setVal(null); onDirty && onDirty(); render(); }
      }));
      if (opts.onShot){
        box.appendChild(el('button', {
          class:'photo-ocr', title:'모니터에서 캠 롤·클립 읽기', text:'⌁ OCR',
          onclick: (e) => { e.stopPropagation(); opts.onShot(v); }
        }));
      }
      // 이미 넣은 사진도 다시 잘라낼 수 있다 (모니터 두 대를 한 장에 찍은 경우 등)
      box.appendChild(el('button', {
        class:'photo-crop', title:'다시 자르기', text:'✂ 자르기',
        onclick: async (e) => {
          e.stopPropagation();
          const m = await DB.getMedia(v.mid);
          if (!m || !m.blob){ toast('원본을 찾을 수 없습니다', 'err'); return; }
          const out = await cropDialog(m.blob, { title:'사진 자르기' });
          if (!out || out === m.blob) return;
          const p = progress(); p.set('저장 중', 60);
          try {
            const ref = await ingest(out, preset);
            await DB.delMedia(v.mid);            // 자른 결과로 대체한다
            setVal(ref); onDirty && onDirty();
            await render();
          } catch (err){
            console.error('crop save failed', err);
            toast('저장 실패: ' + errText(err), 'err', 8000);
          }
          finally { p.done(); }
        }
      }));
    } else {
      box.appendChild(el('div', { class:'photo-empty' }, [
        el('button', { class:'btn tiny shot wide', title:'갤러리에서 사진 선택',
                       onclick:(e)=>{ e.stopPropagation(); grab(); } }, [
          el('span', { class:'cam-ico', text:'🖼' }),
          el('span', { class:'cam-lbl', text:'사진 선택' }),
        ]),
      ]));
    }
  }
  async function grab(){
    const files = await pickFiles({});
    if (!files.length) return;

    // 대표 이미지는 불러오자마자 자를 수 있게 한다.
    // 모니터 두 대를 한 장에 찍었으면 여기서 한 대만 떼어 낸다.
    let src = files[0];
    if (opts.cropOnPick){
      const out = await cropDialog(src, {
        title:'쓸 영역 자르기',
        desc:'자를 필요가 없으면 바로 「그대로 등록」. 모니터가 두 대면 「왼쪽 절반 / 오른쪽 절반」 으로 한 대만 잡으세요.',
      });
      if (!out) return;            // 취소하면 아무것도 넣지 않는다
      src = out;
    }

    const p = progress(); p.set('이미지 압축 중', 40);
    try {
      const ref = await ingest(src, preset);
      setVal(ref); onDirty && onDirty();
      await render();
    } catch (e){
      // 어떤 파일에서 났는지까지 남긴다. 이게 없으면 "또 오류" 로만 돌아온다.
      const info = `${files[0].name || '이름없음'} · ${files[0].type || '형식모름'} · ${fmtBytes(files[0].size||0)}`;
      console.error('photo ingest failed', info, e);
      toast('사진 등록 실패: ' + errText(e) + ' — ' + info, 'err', 8000);
    }
    finally { p.done(); }
  }
  render();
  return box;
}

/* ---------------- 이미지 크롭 ---------------- */

/**
 * 사진에서 쓸 영역만 잘라낸다.
 * 현장에서 모니터 두 대를 한 장에 찍고 A / B 를 따로 떼어 쓰는 게 주 용도라
 * "왼쪽 절반 / 오른쪽 절반" 을 버튼 하나로 잡을 수 있게 해 뒀다.
 *
 * @param {Blob} source  원본 (건드리지 않는다)
 * @returns {Promise<Blob|null>} 잘라낸 Blob, '전체 사용'이면 원본, 취소면 null
 */
export function cropDialog(source, opts = {}){
  return new Promise((res) => {
    const url = URL.createObjectURL(source);
    const img = el('img', { class:'crop-img', src:url });
    const box = el('div', { class:'crop-box', hidden:'' });
    for (const h of ['nw','ne','sw','se']) box.appendChild(el('i', { class:'crop-h ' + h, dataset:{ h } }));
    const stage = el('div', { class:'crop-stage' }, [img, box]);
    const hint = el('div', { class:'crop-hint',
      text:'자를 필요가 없으면 그냥 「그대로 등록」. 잘라 쓰려면 영역을 끌어서 잡으세요.' });

    let rect = null;              // 화면(축소) 좌표 기준
    let mode = null, startX = 0, startY = 0, base = null;

    const view = () => ({ w: img.clientWidth || img.naturalWidth, h: img.clientHeight || img.naturalHeight });
    const clampRect = (r) => {
      const v = view();
      const w = Math.max(20, Math.min(r.w, v.w));
      const h = Math.max(20, Math.min(r.h, v.h));
      return { x: Math.max(0, Math.min(r.x, v.w - w)), y: Math.max(0, Math.min(r.y, v.h - h)), w, h };
    };
    function paint(){
      // 영역을 안 잡았으면 주 버튼이 '그대로 등록' 이 된다 — 자르기가 필요 없는 사진은 한 번에 끝난다
      if (okBtn) okBtn.textContent = rect ? '이 영역 사용' : '그대로 등록';
      if (!rect){ box.hidden = true; return; }
      box.hidden = false;
      box.style.left = rect.x + 'px'; box.style.top = rect.y + 'px';
      box.style.width = rect.w + 'px'; box.style.height = rect.h + 'px';
    }
    function preset(which){
      const v = view();
      rect = which === 'left'  ? { x:0,        y:0, w:v.w/2, h:v.h }
           : which === 'right' ? { x:v.w/2,    y:0, w:v.w/2, h:v.h }
           : { x:0, y:0, w:v.w, h:v.h };
      paint();
    }

    const at = (e) => {
      const r = stage.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    stage.addEventListener('pointerdown', (e) => {
      const p = at(e);
      e.preventDefault();
      stage.setPointerCapture(e.pointerId);
      const handle = e.target.classList && e.target.classList.contains('crop-h') ? e.target.dataset.h : null;
      if (handle){ mode = 'resize:' + handle; base = { ...rect }; }
      else if (rect && !box.hidden && e.target === box){ mode = 'move'; base = { ...rect }; }
      else { mode = 'new'; rect = { x:p.x, y:p.y, w:0, h:0 }; }
      startX = p.x; startY = p.y;
    });
    stage.addEventListener('pointermove', (e) => {
      if (!mode) return;
      const p = at(e);
      const dx = p.x - startX, dy = p.y - startY;
      if (mode === 'new'){
        rect = { x: Math.min(startX, p.x), y: Math.min(startY, p.y),
                 w: Math.abs(dx), h: Math.abs(dy) };
      } else if (mode === 'move'){
        rect = clampRect({ ...base, x: base.x + dx, y: base.y + dy });
      } else {
        const h = mode.split(':')[1];
        let { x, y, w, hh } = { x:base.x, y:base.y, w:base.w, hh:base.h };
        if (h.includes('n')){ y = base.y + dy; hh = base.h - dy; }
        if (h.includes('s')){ hh = base.h + dy; }
        if (h.includes('w')){ x = base.x + dx; w = base.w - dx; }
        if (h.includes('e')){ w = base.w + dx; }
        rect = clampRect({ x, y, w, h: hh });
      }
      paint();
    });
    const end = () => {
      if (mode === 'new' && rect && (rect.w < 20 || rect.h < 20)) rect = null;
      else if (rect) rect = clampRect(rect);
      mode = null; paint();
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);

    const close = (v) => { setTimeout(() => URL.revokeObjectURL(url), 1000); ov.remove(); res(v); };

    async function apply(){
      if (!rect){ close(source); return; }               // 영역을 안 잡았으면 원본 그대로
      const v = view();
      const p = progress(); p.set('잘라내는 중', 40);
      try {
        // 블롭을 다시 디코드하지 않고, 지금 보고 있는 이미지에서 바로 떼어낸다
        const out = await cropFromImage(img, rect, v.w, v.h);
        close(out);
      } catch (e){
        console.error('crop failed', e);
        toast('자르기 실패: ' + errText(e), 'err', 5000);
        close(null);
      }
      finally { p.done(); }
    }

    const okBtn = el('button', { class:'btn primary big', text:'그대로 등록', onclick:apply });

    const ov = el('div', { class:'overlay', onclick:(e)=>{ if (e.target === ov) close(null); } }, [
      el('div', { class:'dialog wide' }, [
        el('h3', { text: opts.title || '영역 자르기' }),
        opts.desc ? el('p', { class:'dim tiny', text: opts.desc }) : null,
        el('div', { class:'row gap wrap' }, [
          el('button', { class:'btn', text:'◧ 왼쪽 절반', onclick:()=>preset('left') }),
          el('button', { class:'btn', text:'◨ 오른쪽 절반', onclick:()=>preset('right') }),
          el('button', { class:'btn ghost', text:'전체', onclick:()=>preset('all') }),
          el('button', { class:'btn ghost', text:'선택 해제', onclick:()=>{ rect = null; paint(); } }),
        ]),
        stage, hint,
        el('div', { class:'row end gap' }, [
          el('button', { class:'btn ghost', text:'취소', onclick:()=>close(null) }),
          okBtn,
        ]),
      ])
    ]);
    document.body.appendChild(ov);
    if (opts.preset) img.addEventListener('load', () => preset(opts.preset), { once:true });
  });
}

/* ---------------- 콤보 (드롭다운 + 직접 입력) ---------------- */

/** '직접 입력…' 을 고르면 이 값이 온다. 실제 값과 겹치지 않도록 제어문자를 쓴다. */
const COMBO_CUSTOM = ' custom';

/**
 * 목록에서 고르되, 없는 값은 직접 넣을 수 있는 입력.
 *
 * 예전에는 `<input list=datalist>` 였는데 안드로이드 Chrome 에서는
 * 화살표도 없고 탭해도 목록이 뜨지 않아 "고르는 칸"인 줄 알 수가 없었다.
 * 그래서 기본은 진짜 `<select>`(안드로이드는 네이티브 선택 목록이 뜬다) 로 보여주고,
 * 목록에 없는 값이 필요할 때만 입력칸으로 바꾼다. 새로 넣은 값은 레퍼런스에 편입된다.
 */
export function comboField(f, rec, onDirty, opts = {}){
  const cls = opts.mini ? 'inp mini cell' : 'inp';
  const wrap = el('div', { class:'combo' + (opts.mini ? ' mini' : '') });

  function draw(editing){
    clear(wrap);
    const cur = rec[f.k] || '';
    const list = refList(f.ref);

    if (editing){
      const inp = el('input', {
        class: cls, value: cur, autocomplete:'off',
        list: f.ref ? 'dl-'+f.ref : null, placeholder:'직접 입력',
      });
      inp.addEventListener('input', () => { rec[f.k] = inp.value; onDirty && onDirty(); });
      inp.addEventListener('change', async () => {
        const v = inp.value.trim();
        rec[f.k] = v; onDirty && onDirty();
        if (v && f.ref && !refList(f.ref).includes(v)){
          if (await DB.pushRef(f.ref, v)){
            setRefsCache(await DB.getRefs());
            toast(`"${v}" 을(를) 목록에 추가했습니다`, 'ok', 1600);
          }
        }
        draw(false);                       // 목록에 편입됐으니 다시 드롭다운으로
      });
      wrap.append(inp, el('button', {
        class:'btn tiny ghost combo-back', text:'☰', title:'목록에서 고르기',
        onclick: () => draw(false),
      }));
      try { inp.focus(); } catch {}
      return;
    }

    const sel = el('select', { class: cls });
    sel.appendChild(el('option', { value:'', text:'—' }));
    for (const o of list) sel.appendChild(el('option', { value:o, text:o }));
    // 목록에 없는 기존 값(구 데이터 등)도 잃지 않는다
    if (cur && !list.includes(cur)) sel.appendChild(el('option', { value:cur, text:cur }));
    sel.appendChild(el('option', { value:COMBO_CUSTOM, text:'✎ 직접 입력…' }));
    sel.value = cur;
    sel.addEventListener('change', () => {
      if (sel.value === COMBO_CUSTOM){ draw(true); return; }
      rec[f.k] = sel.value; onDirty && onDirty();
    });
    wrap.appendChild(sel);
  }

  draw(false);
  return wrap;
}

/**
 * 표 안에 넣는 작은 입력. TAKE_FIELDS 같은 인라인 편집용.
 * @param {object} f  { k, t, ref }
 */
export function miniField(f, rec, onDirty){
  if (f.t === 'combo') return comboField(f, rec, onDirty, { mini:true });
  if (f.t === 'select'){
    const sel = el('select', { class:'inp mini cell' });
    sel.appendChild(el('option', { value:'', text:'—' }));
    for (const o of refList(f.ref)) sel.appendChild(el('option', { value:o, text:o }));
    if (rec[f.k] && !refList(f.ref).includes(rec[f.k])) sel.appendChild(el('option',{value:rec[f.k],text:rec[f.k]}));
    sel.value = rec[f.k] || '';
    sel.addEventListener('change', () => { rec[f.k] = sel.value; onDirty && onDirty(); });
    return sel;
  }
  const inp = el('input', {
    class:'inp mini cell', value: rec[f.k] || '', autocomplete:'off',
    list: f.t === 'combo' ? 'dl-'+f.ref : null,
  });
  inp.addEventListener('input', () => { rec[f.k] = inp.value; onDirty && onDirty(); });
  return inp;
}

/* ---------------- S펜 필기 캔버스 ---------------- */

/** 필기 색상 팔레트. sketch 타입 필드는 전부 이걸 공유한다. */
export const PEN_COLORS = [
  { n:'검정', v:'#111418' },
  { n:'빨강', v:'#e5484d' },
  { n:'파랑', v:'#3b82f6' },
  { n:'초록', v:'#1a9c5b' },
  { n:'주황', v:'#f5a524' },
];

/**
 * 손으로 그린 메모를 PNG 로 저장한다.
 *  - S펜(pointerType 'pen')은 필압을 선 굵기에 반영한다.
 *  - 펜이 한 번이라도 감지되면 손가락 입력은 무시한다 (팜 리젝션).
 *    현장에서 태블릿을 손으로 짚고 쓰기 때문에 이게 없으면 낙서가 된다.
 *  - 획을 멈추면 1.2초 뒤 자동 저장. 이전 이미지는 지우고 교체한다.
 */
export function sketchPad(getVal, setVal, onDirty){
  const W = 1600, H = 620;
  const wrap = el('div', { class:'sketch' });
  const canvas = el('canvas', { class:'sketch-cv', width:W, height:H });
  const ctx = canvas.getContext('2d', { willReadFrequently:false });

  let penSeen = false, drawing = false, dirty = false, saveTimer = null;
  let mode = 'pen', size = 4;
  let color = localStorage.getItem('ribi-pen-color') || PEN_COLORS[0].v;
  const undo = [];

  function paintBg(){
    // 괘선 없는 백지. 지우개가 흰색으로 덮어쓰므로 배경도 흰색이어야 자국이 안 남는다.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
  }
  paintBg();

  // 기존 그림 불러오기
  (async () => {
    const v = getVal();
    if (v && v.mid){
      const url = await DB.mediaURL(v.mid);
      if (!url) return;
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, W, H);
      img.src = url;
    }
  })();

  function pos(e){
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  }
  function lineWidth(e){
    if (mode === 'eraser') return size * 9;
    const p = (e.pointerType === 'pen' && e.pressure > 0) ? e.pressure : 0.5;
    return Math.max(0.6, size * (0.35 + p * 1.5));
  }
  function ignore(e){
    if (e.pointerType === 'pen'){ penSeen = true; return false; }
    return penSeen && e.pointerType === 'touch';   // 펜을 쓰는 중이면 손바닥 무시
  }

  function down(e){
    if (ignore(e)) return;
    e.preventDefault();
    undo.push(ctx.getImageData(0, 0, W, H));
    if (undo.length > 12) undo.shift();
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = pos(e);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = mode === 'eraser' ? '#ffffff' : color;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y);
    ctx.lineWidth = lineWidth(e); ctx.stroke();
  }
  function move(e){
    if (!drawing || ignore(e)) return;
    e.preventDefault();
    const { x, y } = pos(e);
    ctx.lineWidth = lineWidth(e);
    ctx.lineTo(x, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y);
  }
  function up(){
    if (!drawing) return;
    drawing = false; dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 1200);
  }

  async function save(){
    if (!dirty) return;
    dirty = false;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    if (!blob) return;
    const old = getVal();
    const ref = await DB.putMedia(blob, { name:'sketch.png', width:W, height:H });
    setVal(ref);
    if (old && old.mid) await DB.delMedia(old.mid);
    onDirty && onDirty();
    status.textContent = '저장됨';
    setTimeout(() => { status.textContent = ''; }, 1500);
  }

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', up);

  const status = el('span', { class:'dim tiny' });

  function selectTool(btn, group){
    wrap.querySelectorAll('.' + group).forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
  }

  // --- 색상 ---
  const swatches = PEN_COLORS.map(c => {
    const b = el('button', {
      class:'sk-color' + (c.v === color ? ' on' : ''),
      style:`background:${c.v}`, title:c.n,
      onclick:(e) => {
        color = c.v; mode = 'pen';
        localStorage.setItem('ribi-pen-color', color);
        selectTool(e.currentTarget, 'sk-color');
        wrap.querySelectorAll('.sk-mode').forEach(x => x.classList.remove('on'));
        penBtn.classList.add('on');
      }
    });
    return b;
  });

  // --- 굵기 ---
  const sizeBtns = [2, 4, 8].map(n => el('button', {
    class:'btn tiny sk-size' + (n === size ? ' on' : ''), title:`굵기 ${n}`,
    onclick:(e) => { size = n; selectTool(e.currentTarget, 'sk-size'); }
  }, [ el('i', { class:'sk-dot', style:`width:${n+2}px;height:${n+2}px` }) ]));

  // --- 펜 / 지우개 ---
  const penBtn = el('button', {
    class:'btn tiny sk-mode on', text:'펜',
    onclick:(e) => { mode = 'pen'; selectTool(e.currentTarget, 'sk-mode'); }
  });
  const eraserBtn = el('button', {
    class:'btn tiny sk-mode', text:'지우개',
    onclick:(e) => { mode = 'eraser'; selectTool(e.currentTarget, 'sk-mode'); }
  });

  const bar = el('div', { class:'sketch-bar' }, [
    el('span', { class:'sk-swatches' }, swatches),
    el('span', { class:'sk-sep' }),
    ...sizeBtns,
    el('span', { class:'sk-sep' }),
    penBtn, eraserBtn,
    el('button', { class:'btn tiny ghost', text:'되돌리기', onclick: () => {
      const prev = undo.pop();
      if (!prev) return;
      ctx.putImageData(prev, 0, 0);
      dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(save, 600);
    }}),
    el('button', { class:'btn tiny danger', text:'전체 지우기', onclick: async () => {
      if (!await confirmBox('스케치 지우기', '그린 내용이 모두 사라집니다.', '지우기', true)) return;
      undo.push(ctx.getImageData(0, 0, W, H));
      paintBg(); dirty = true; save();
    }}),
    el('span', { class:'grow' }),
    status,
  ]);

  wrap.append(bar, canvas);
  return wrap;
}

export function lightbox(url, name){
  if (!url) return;
  const ov = el('div', { class:'overlay lightbox', onclick:()=>ov.remove() }, [
    el('img', { src:url, alt:name || '' }),
    el('div', { class:'lb-name', text: name || '' })
  ]);
  document.body.appendChild(ov);
}

/* ---------------- 모니터 OCR 확인창 ---------------- */

/**
 * 판독 결과를 보여주고 사용자가 고친 뒤 적용하게 한다.
 * OCR 은 100% 가 아니므로 절대 자동 적용하지 않는다.
 * @returns {Promise<object|null>} 적용할 { key: value } 또는 null(취소)
 */
export function ocrReview(fields, labels, rawText, confidence, opts = {}){
  return new Promise(res => {
    const keys = Object.keys(fields);
    const picked = {};
    const inputs = {};

    // 어느 컷에 넣을지 고르는 셀렉트 (모니터 촬영 → 테이크 자동 분류용)
    let targetSel = null;
    if (Array.isArray(opts.targets) && opts.targets.length){
      targetSel = el('select', { class:'inp' });
      for (const t of opts.targets) targetSel.appendChild(el('option', { value:t.value, text:t.label }));
      targetSel.value = opts.defaultTarget || opts.targets[0].value;
    }

    const rows = keys.map(k => {
      const chk = el('input', { type:'checkbox', class:'ocr-chk' });
      chk.checked = true;
      const inp = el('input', { class:'inp mini', value: fields[k] });
      inputs[k] = inp; picked[k] = chk;
      return el('label', { class:'ocr-row' }, [
        chk,
        el('span', { class:'ocr-k', text: labels[k] || k }),
        inp,
      ]);
    });

    const rawBox = el('pre', { class:'ocr-raw', text: rawText || '' , hidden:'' });

    const body = keys.length
      ? el('div', { class:'ocr-list' }, rows)
      : el('p', { class:'dim', text:'읽어낸 값이 없습니다. 오버레이가 잘리지 않게 다시 찍어보세요.' });

    const close = (v) => { ov.remove(); res(v); };
    const ov = el('div', { class:'overlay', onclick:(e)=>{ if(e.target===ov) close(null); } }, [
      el('div', { class:'dialog wide' }, [
        el('h3', { text:'모니터 판독 결과' }),
        el('p', { class:'dim tiny', text:
          `인식 신뢰도 ${confidence!=null ? confidence.toFixed(0)+'%' : '—'} · 값을 확인하고 고친 뒤 적용하세요. 체크 해제하면 그 항목은 건드리지 않습니다.` }),
        targetSel ? el('div', { class:'ocr-target' }, [
          el('label', { text: opts.targetLabel || '어느 컷에 넣을까요' }),
          targetSel,
        ]) : null,
        body,
        el('div', { class:'row between gap' }, [
          el('button', { class:'btn ghost tiny', text:'원문 보기', onclick:(e)=>{
            rawBox.hidden = !rawBox.hidden;
            e.target.textContent = rawBox.hidden ? '원문 보기' : '원문 숨기기';
          }}),
          el('div', { class:'row gap' }, [
            el('button', { class:'btn ghost', text:'취소', onclick:()=>close(null) }),
            // 대상 선택이 있으면 판독값이 하나도 없어도 진행할 수 있어야 한다
            // (사진은 남기고 값은 손으로 채우는 경우)
            el('button', { class:'btn primary', text:'적용', disabled: (keys.length || targetSel) ? null : '', onclick:()=>{
              const out = {};
              for (const k of keys) if (picked[k].checked && inputs[k].value.trim()) out[k] = inputs[k].value.trim();
              if (targetSel) out.__target = targetSel.value;
              close(out);
            }}),
          ])
        ]),
        rawBox,
      ])
    ]);
    document.body.appendChild(ov);
  });
}

/* ---------------- 역방향 연결 (읽기 전용) ---------------- */

/**
 * 반대편 엔티티에서 이 레코드를 연결한 결과를 보여준다.
 * 예) 씬에서 에셋을 고르면, 에셋 화면의 "연결 씬"에 자동으로 나타난다.
 * 여기서는 편집하지 않는다 — 연결은 항상 한쪽(씬)에서만 관리해야 어긋나지 않는다.
 * @param {object} f  { from:'scenes', via:'linkedAssetIds' }
 */
async function backlinkList(f, rec, ctx = {}){
  const wrap = el('div', { class:'link-wrap backlink' });
  const { ENTITIES } = await import('./schema.js');
  const cfg = ENTITIES[f.from];
  const rows = (await DB.list(f.from)).filter(r => {
    const v = r[f.via];
    return Array.isArray(v) ? v.includes(rec.id) : v === rec.id;
  });

  if (!rows.length){
    wrap.appendChild(el('span', { class:'dim tiny',
      text:`${cfg.labelKo} 페이지에서 연결하면 여기에 자동으로 표시됩니다.` }));
    return wrap;
  }
  const labelFor = (r) => cfg.titleFields.map(k => r[k]).filter(Boolean).join(' / ') || r.id;
  for (const r of rows){
    wrap.appendChild(el('button', {
      class:'chip link', title:'해당 ' + cfg.labelKo + '으로 이동',
      onclick: () => ctx.go && ctx.go(`${f.from}/${r.id}`),
    }, [ el('span', { text: labelFor(r) }) ]));
  }
  return wrap;
}

/* ---------------- 링크(다른 레코드 연결) 위젯 ---------------- */

async function linkWidget(field, rec, onDirty){
  const wrap = el('div', { class:'link-wrap' });
  const target = field.to;
  const store = target;
  const cfg = (await import('./schema.js')).ENTITIES[target];
  const labelFor = (r) => (cfg.titleFields.map(k => r[k]).filter(Boolean).join(' / ') || r.id);
  // 고르는 목록은 언제나 가나다순
  const all = (await DB.list(store)).slice()
    .sort((a,b) => labelFor(a).localeCompare(labelFor(b), 'ko', { numeric:true }));

  function cur(){
    const v = rec[field.k];
    if (!v) return [];
    return Array.isArray(v) ? v : [v];
  }
  function set(arr){ rec[field.k] = arr; onDirty && onDirty(); render(); }

  /**
   * 고른 것은 칩으로, 추가는 드롭다운으로.
   * 현장에서 다이얼로그를 띄웠다 닫는 것보다 한 번에 고르는 편이 빠르다.
   * 목록이 길어지면(30개 초과) 검색 다이얼로그를 함께 제공한다.
   */
  function render(){
    clear(wrap);

    // 고른 것은 칩으로 (한 줄에 모아 둔다)
    const picked = cur();
    if (picked.length){
      wrap.appendChild(el('div', { class:'chips' }, picked.map(id => {
        const r = all.find(x => x.id === id);
        return el('span', { class:'chip' }, [
          el('span', { text: r ? labelFor(r) : id }),
          el('button', { text:'×', onclick: () => set(cur().filter(x => x !== id)) })
        ]);
      })));
    }

    // 추가 드롭다운은 옆 칸(콤보/셀렉트)과 같은 크기여야 한다.
    // 예전엔 'inp mini' 라서 이 칸만 작고 폭이 들쭉날쭉했다.
    const rest = all.filter(r => !picked.includes(r.id));
    if (rest.length){
      const sel = el('select', { class:'inp link-add' });
      sel.appendChild(el('option', { value:'', text:`+ ${cfg.labelKo} 선택` }));
      for (const r of rest) sel.appendChild(el('option', { value:r.id, text: labelFor(r) }));
      sel.addEventListener('change', () => { if (sel.value) set([...cur(), sel.value]); });
      if (rest.length > 30){
        wrap.appendChild(el('div', { class:'row gap' }, [
          sel, el('button', { class:'btn ghost', text:'검색', onclick: pick }),
        ]));
      } else wrap.appendChild(sel);
    } else if (!all.length){
      wrap.appendChild(el('span', { class:'dim tiny', text:`${cfg.labelKo} 페이지에서 먼저 등록하세요.` }));
    }
  }

  function pick(){
    const inp = el('input', { class:'inp', placeholder:'검색…' });
    const listBox = el('div', { class:'pick-list' });
    const draw = () => {
      clear(listBox);
      const q = inp.value.trim().toLowerCase();
      all.filter(r => !q || labelFor(r).toLowerCase().includes(q) || r.id.toLowerCase().includes(q))
        .slice(0, 200)
        .forEach(r => listBox.appendChild(el('div', {
          class:'pick-row' + (cur().includes(r.id) ? ' on' : ''),
          onclick: () => {
            const c = cur();
            set(c.includes(r.id) ? c.filter(x => x !== r.id) : [...c, r.id]);
            draw();
          }
        }, [ el('b',{text:labelFor(r)}), el('small',{class:'dim',text:r.id}) ])));
    };
    inp.addEventListener('input', draw);
    const ov = el('div', { class:'overlay', onclick:(e)=>{ if(e.target===ov) ov.remove(); } }, [
      el('div', { class:'dialog wide' }, [
        el('h3', { text:`${cfg.label} 연결` }), inp, listBox,
        el('div', { class:'row end' }, [ el('button', { class:'btn primary', text:'닫기', onclick:()=>ov.remove() }) ])
      ])
    ]);
    document.body.appendChild(ov); draw(); inp.focus();
  }

  render();
  return wrap;
}

/* ---------------- 폼 렌더러 ---------------- */

/**
 * @param {object} rec        편집 대상 (직접 mutate)
 * @param {Array}  groups     schema groups
 * @param {string} entKey     엔티티 키 (콤보 신규값 레퍼런스 편입용)
 * @param {Function} onDirty
 * @param {object} ctx        { project } — 조건부 필드(when) 판정용
 */
export async function renderForm(rec, groups, entKey, onDirty, ctx = {}){
  const root = el('div', { class:'form' });

  for (const g of groups){
    const gridChildren = [];
    for (const f of g.fields){
      // when 이 있으면 프로젝트 상태에 따라 필드를 감춘다 (예: 에피소드는 드라마만)
      if (typeof f.when === 'function' && !f.when(ctx.project || {})) continue;
      // cam:true 는 현재 캠 탭(rec.cams.A.camRoll …), sub:true 는 현재 소장소 탭
      // (rec.subs.S1.subLocation …) 의 하위 레코드에 읽고 쓴다.
      const R = (f.cam && ctx.camRec) ? ctx.camRec
              : (f.sub && ctx.subRec) ? ctx.subRec : rec;
      const cell = el('div', { class:'field' + (f.full ? ' full' : '')
                             + ((f.cam || f.sub) ? ' camfield' : '') });
      if (g.cols){
        const sp = [];
        if (f.span)    sp.push(`grid-column:span ${f.span}`);
        if (f.rowSpan) sp.push(`grid-row:span ${f.rowSpan}`);
        if (sp.length) cell.setAttribute('style', sp.join(';'));
      }
      cell.appendChild(el('label', { text: f.label }));

      if (f.t === 'photo'){
        cell.appendChild(photoTile(
          () => R[f.k],
          (v) => { R[f.k] = v; },
          f.preset || 'thumb', onDirty, {
            big: f.full,
            cropOnPick: true,                                  // 대표 이미지는 고르면 바로 자르기
            onShot: (f.ocr && ctx.onOcr) ? (ref) => ctx.onOcr(f, R, ref) : null,
          }));

      } else if (f.t === 'sketch'){
        cell.appendChild(sketchPad(
          () => R[f.k],
          (v) => { R[f.k] = v; },
          onDirty));

      } else if (f.t === 'seg'){
        const seg = el('div', { class:'seg' });
        const opts = refList(f.ref);
        const draw = () => {
          clear(seg);
          for (const o of opts){
            seg.appendChild(el('button', {
              class:'seg-btn' + (R[f.k] === o ? ' on' : ''), text:o,
              onclick: () => { R[f.k] = o; onDirty && onDirty(); draw(); }
            }));
          }
        };
        draw();
        cell.appendChild(seg);

      } else if (f.t === 'photos'){
        const n = f.n || 2;
        if (!Array.isArray(R[f.k])) R[f.k] = new Array(n).fill(null);
        while (R[f.k].length < n) R[f.k].push(null);
        // 열 수를 사진 개수에 맞춰 고정한다. auto-fill 이면 화면폭에 따라
        // 마지막 줄에 한두 칸만 남아 어긋나 보인다.
        const per = f.perRow || n;
        const grid = el('div', {
          class:'photo-grid' + (per <= 8 ? ' fixed' : ''),
          style: per <= 8 ? `--pcols:${per}` : null,
        });
        for (let i = 0; i < n; i++){
          grid.appendChild(photoTile(
            () => R[f.k][i],
            (v) => { R[f.k][i] = v; },
            f.preset || 'photo', onDirty));
        }
        cell.appendChild(grid);

      } else if (f.t === 'link'){
        cell.appendChild(await linkWidget(f, R, onDirty));

      } else if (f.t === 'recordRef'){
        // 다른 페이지의 레코드를 하나 고른다. id 를 저장하므로 이름을 바꿔도 연결이 유지된다.
        // 로케이션처럼 소장소 탭이 있는 엔티티는 소장소 단위로 펼쳐서 고른다
        // ('그린힐테라스/거실'). 저장값은 'LOC-001::S1'.
        const { ENTITIES, refIndex } = await import('./schema.js');
        const sel = el('select', { class:'inp' });
        sel.appendChild(el('option', { value:'', text:'— 선택 —' }));
        // 등록 순서가 아니라 이름 가나다순으로 — 로케이션이 쌓이면 순서대로여야 찾는다
        const idx = refIndex(f.to, await DB.list(f.to));
        for (const o of idx.opts) sel.appendChild(el('option', { value:o.value, text:o.label }));
        if (R[f.k] && !idx.opts.some(o => o.value === R[f.k])){
          // 아직 마이그레이션 전이거나 지워진 소장소 — 이름을 알면 그대로 보여준다
          sel.appendChild(el('option', { value:R[f.k], text: idx.label(R[f.k]) || '(삭제된 항목)' }));
        }
        sel.value = R[f.k] || '';
        sel.addEventListener('change', () => { R[f.k] = sel.value; onDirty && onDirty(); });
        cell.appendChild(sel);
        if (!idx.opts.length){
          cell.appendChild(el('span', { class:'dim tiny',
            text:`${ENTITIES[f.to].labelKo} 페이지에서 먼저 등록하세요.` }));
        }

      } else if (f.t === 'backlink'){
        cell.appendChild(await backlinkList(f, rec, ctx));

      } else if (f.t === 'select'){
        const sel = el('select', { class:'inp' });
        sel.appendChild(el('option', { value:'', text:'—' }));
        for (const o of refList(f.ref)) sel.appendChild(el('option', { value:o, text:o }));
        if (R[f.k] && !refList(f.ref).includes(R[f.k])) sel.appendChild(el('option',{value:R[f.k],text:R[f.k]}));
        sel.value = R[f.k] || '';
        sel.addEventListener('change', () => { R[f.k] = sel.value; onDirty && onDirty(); });
        cell.appendChild(sel);

      } else if (f.t === 'combo'){
        cell.appendChild(comboField(f, R, onDirty));

      } else if (f.t === 'textarea'){
        const ta = el('textarea', { class:'inp ta', rows: f.rows || 3 });
        ta.value = R[f.k] || '';
        ta.addEventListener('input', () => { R[f.k] = ta.value; onDirty && onDirty(); });
        cell.appendChild(ta);

      } else {
        const type = f.t === 'date' ? 'date' : f.t === 'time' ? 'time' : 'text';
        const inp = el('input', { class:'inp', type, value: R[f.k] || '' });
        if (f.t === 'time') inp.step = 1;
        inp.addEventListener('input', () => { R[f.k] = inp.value; onDirty && onDirty(); });
        cell.appendChild(inp);
      }
      gridChildren.push(cell);
    }
    const grid = el('div', {
      class: 'grid' + (g.cols ? ' fixed' : ''),
      style: g.cols ? `--cols:${g.cols}` : null,
    }, gridChildren);
    root.appendChild(el('section', { class:'fgroup' }, [
      el('h4', { text: g.title }),
      grid
    ]));
  }
  return root;
}

/* ---------------- 기타 ---------------- */

export function nowDate(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function nowTime(){
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}
export { fmtBytes };
