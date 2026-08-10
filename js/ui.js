/* =====================================================================
 * Ribi Onset — ui.js
 * DOM 헬퍼 + 공용 위젯(토스트/시트/확인창) + 스키마 기반 폼 렌더러.
 * ===================================================================== */

import * as DB from './db.js';
import { ingest, ingestMany, pickFiles, fmtBytes } from './media.js';

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
 * 사진 타일. 빈 타일을 "탭하면 바로 카메라"가 열린다 (현장 속도 우선).
 * 갤러리에서 고르려면 우측 하단의 작은 🖼 버튼.
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
          class:'photo-ocr', title:'모니터 정보 읽기', text:'⌁',
          onclick: (e) => { e.stopPropagation(); opts.onShot(v); }
        }));
      }
    } else {
      // 촬영 / 갤러리 선택 둘 다 제공
      box.appendChild(el('div', { class:'photo-empty' }, [
        el('button', { class:'btn tiny shot', title:'카메라로 촬영', onclick:(e)=>{ e.stopPropagation(); grab(true); } }, [
          el('span', { class:'cam-ico', text:'📷' }),
          el('span', { class:'cam-lbl', text:'촬영' }),
        ]),
        el('button', { class:'btn tiny ghost shot', title:'갤러리에서 선택', onclick:(e)=>{ e.stopPropagation(); grab(false); } }, [
          el('span', { class:'cam-ico', text:'🖼' }),
          el('span', { class:'cam-lbl', text:'선택' }),
        ]),
      ]));
    }
  }
  async function grab(capture){
    const files = await pickFiles({ capture });
    if (!files.length) return;
    const p = progress(); p.set('이미지 압축 중', 40);
    try {
      const ref = await ingest(files[0], preset);
      setVal(ref); onDirty && onDirty();
      await render();
      if (opts.onShot) opts.onShot(ref);
    } catch (e){ toast('이미지 처리 실패: ' + e.message, 'err'); }
    finally { p.done(); }
  }
  render();
  return box;
}

/**
 * 표 안에 넣는 작은 입력. TAKE_FIELDS 같은 인라인 편집용.
 * @param {object} f  { k, t, ref }
 */
export function miniField(f, rec, onDirty){
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
export function ocrReview(fields, labels, rawText, confidence){
  return new Promise(res => {
    const keys = Object.keys(fields);
    const picked = {};
    const inputs = {};

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
        body,
        el('div', { class:'row between gap' }, [
          el('button', { class:'btn ghost tiny', text:'원문 보기', onclick:(e)=>{
            rawBox.hidden = !rawBox.hidden;
            e.target.textContent = rawBox.hidden ? '원문 보기' : '원문 숨기기';
          }}),
          el('div', { class:'row gap' }, [
            el('button', { class:'btn ghost', text:'취소', onclick:()=>close(null) }),
            el('button', { class:'btn primary', text:'적용', disabled: keys.length ? null : '', onclick:()=>{
              const out = {};
              for (const k of keys) if (picked[k].checked && inputs[k].value.trim()) out[k] = inputs[k].value.trim();
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

/* ---------------- 링크(다른 레코드 연결) 위젯 ---------------- */

async function linkWidget(field, rec, onDirty){
  const wrap = el('div', { class:'link-wrap' });
  const target = field.to;
  const store = target;
  const all = await DB.list(store);
  const cfg = (await import('./schema.js')).ENTITIES[target];

  const labelFor = (r) => (cfg.titleFields.map(k => r[k]).filter(Boolean).join(' / ') || r.id);

  function cur(){
    const v = rec[field.k];
    if (!v) return [];
    return Array.isArray(v) ? v : [v];
  }
  function set(arr){ rec[field.k] = arr; onDirty && onDirty(); render(); }

  function render(){
    clear(wrap);
    for (const id of cur()){
      const r = all.find(x => x.id === id);
      wrap.appendChild(el('span', { class:'chip' }, [
        el('span', { text: r ? labelFor(r) : id }),
        el('button', { text:'×', onclick: () => set(cur().filter(x => x !== id)) })
      ]));
    }
    wrap.appendChild(el('button', { class:'btn tiny ghost', text:'+ 연결', onclick: pick }));
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
      const cell = el('div', { class:'field' + (f.full ? ' full' : '') });
      if (g.cols){
        const sp = [];
        if (f.span)    sp.push(`grid-column:span ${f.span}`);
        if (f.rowSpan) sp.push(`grid-row:span ${f.rowSpan}`);
        if (sp.length) cell.setAttribute('style', sp.join(';'));
      }
      cell.appendChild(el('label', { text: f.label }));

      if (f.t === 'photo'){
        cell.appendChild(photoTile(
          () => rec[f.k],
          (v) => { rec[f.k] = v; },
          f.preset || 'thumb', onDirty, { big: f.full }));

      } else if (f.t === 'sketch'){
        cell.appendChild(sketchPad(
          () => rec[f.k],
          (v) => { rec[f.k] = v; },
          onDirty));

      } else if (f.t === 'seg'){
        const seg = el('div', { class:'seg' });
        const opts = refList(f.ref);
        const draw = () => {
          clear(seg);
          for (const o of opts){
            seg.appendChild(el('button', {
              class:'seg-btn' + (rec[f.k] === o ? ' on' : ''), text:o,
              onclick: () => { rec[f.k] = o; onDirty && onDirty(); draw(); }
            }));
          }
        };
        draw();
        cell.appendChild(seg);

      } else if (f.t === 'photos'){
        const n = f.n || 2;
        if (!Array.isArray(rec[f.k])) rec[f.k] = new Array(n).fill(null);
        while (rec[f.k].length < n) rec[f.k].push(null);
        const grid = el('div', { class:'photo-grid' });
        for (let i = 0; i < n; i++){
          grid.appendChild(photoTile(
            () => rec[f.k][i],
            (v) => { rec[f.k][i] = v; },
            f.preset || 'photo', onDirty));
        }
        cell.appendChild(grid);

      } else if (f.t === 'link'){
        cell.appendChild(await linkWidget(f, rec, onDirty));

      } else if (f.t === 'select'){
        const sel = el('select', { class:'inp' });
        sel.appendChild(el('option', { value:'', text:'—' }));
        for (const o of refList(f.ref)) sel.appendChild(el('option', { value:o, text:o }));
        if (rec[f.k] && !refList(f.ref).includes(rec[f.k])) sel.appendChild(el('option',{value:rec[f.k],text:rec[f.k]}));
        sel.value = rec[f.k] || '';
        sel.addEventListener('change', () => { rec[f.k] = sel.value; onDirty && onDirty(); });
        cell.appendChild(sel);

      } else if (f.t === 'combo'){
        const inp = el('input', { class:'inp', list:'dl-'+f.ref, value: rec[f.k] || '', autocomplete:'off' });
        inp.addEventListener('change', async () => {
          rec[f.k] = inp.value.trim();
          if (rec[f.k] && f.ref && !refList(f.ref).includes(rec[f.k])){
            if (await DB.pushRef(f.ref, rec[f.k])){
              setRefsCache(await DB.getRefs());
              toast(`"${rec[f.k]}" 을(를) 레퍼런스에 추가했습니다`, 'ok', 1600);
            }
          }
          onDirty && onDirty();
        });
        inp.addEventListener('input', () => { rec[f.k] = inp.value; });
        cell.appendChild(inp);

      } else if (f.t === 'textarea'){
        const ta = el('textarea', { class:'inp ta', rows: f.rows || 3 });
        ta.value = rec[f.k] || '';
        ta.addEventListener('input', () => { rec[f.k] = ta.value; onDirty && onDirty(); });
        cell.appendChild(ta);

      } else {
        const type = f.t === 'date' ? 'date' : f.t === 'time' ? 'time' : 'text';
        const inp = el('input', { class:'inp', type, value: rec[f.k] || '' });
        if (f.t === 'time') inp.step = 1;
        inp.addEventListener('input', () => { rec[f.k] = inp.value; onDirty && onDirty(); });
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
