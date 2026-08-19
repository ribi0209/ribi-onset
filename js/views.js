/* =====================================================================
 * Ribi Onset — views.js
 * 화면: Project / Overview / 엔티티 리스트+에디터 / Setting / Backup
 * ===================================================================== */

import * as DB from './db.js';
import {
  ENTITIES, PROJECT_SCHEMA, REF_GROUPS, TAKE_FIELDS, DEFAULT_REFS, NAV, BUILD,
  fieldMap, labelOf, displayName, allFields, thumbOf, camSummaryLine, camFieldLine, usedCams, camValues
} from './schema.js';
import {
  el, $, clear, toast, confirmBox, progress, renderForm, setRefsCache,
  refList, nowDate, nowTime, fmtBytes, lightbox, photoTile, miniField, ocrReview, cropDialog, errText
} from './ui.js';
import { ingest, pickFiles } from './media.js';
import { exportCSV, exportBreakdown, exportPrint } from './export.js';

const PAGE = 60;
const STATE = {};
function st(ent){
  if (!STATE[ent]) STATE[ent] = { q:'', filters:{}, selected:null, limit:PAGE,
                                  sort:{ key:'updatedAt', dir:'desc' } };
  return STATE[ent];
}

/* ---------------- 자동 저장 ---------------- */

const timers  = new Map();
const pending = new Map();   // 아직 기록되지 않은 변경

function autosave(store, rec, after){
  const key = store + ':' + rec.id;
  clearTimeout(timers.get(key));
  pending.set(key, { store, rec, after });
  timers.set(key, setTimeout(() => commit(key), 500));
}

async function commit(key){
  const job = pending.get(key);
  if (!job) return;
  clearTimeout(timers.get(key));
  timers.delete(key); pending.delete(key);
  await DB.put(job.store, job.rec);
  const dot = $('#saveDot'); if (dot){ dot.classList.add('on'); setTimeout(()=>dot.classList.remove('on'), 900); }
  job.after && job.after();
}

/**
 * 대기 중인 자동 저장을 전부 지금 기록한다. 화면을 떠나기 전에 부른다.
 * 예전에는 타이머만 취소했는데, 그러면 입력 후 0.5초 안에 목록으로 나가면 그 변경이 사라졌다.
 */
export async function flushAll(){
  for (const key of Array.from(pending.keys())) await commit(key);
}

/* ===================== 엔티티 : 리스트 페이지 ===================== */

/** 리스트 → 클릭 → 상세 페이지 (좌우 분할 아님) */
export async function entityListView(root, entKey, go){
  const cfg = ENTITIES[entKey];
  if (cfg.inline) return entityInlineView(root, entKey);
  const S = st(entKey);
  clear(root);

  const project = await DB.getProject();
  const rows = await DB.list(cfg.store);

  const navNo = String(NAV.findIndex(n => n.k === entKey) + 1).padStart(2,'0');

  /* ---- 헤더 ---- */
  const head = el('header', { class:'page-head' }, [
    el('div', { class:'grow' }, [
      el('div', { class:'eyebrow', text:`${navNo} · ${cfg.label.toUpperCase()}` }),
      el('h1', { text: cfg.title || cfg.label }),
      cfg.desc ? el('p', { class:'dim', text: cfg.desc }) : null,
    ]),
    el('div', { class:'row gap wrap' }, [
      el('button', { class:'btn ghost', text:'CSV', onclick: () => exportCSV(entKey, filtered()) }),
      entKey === 'scenes'
        ? el('button', { class:'btn ghost', text:'Breakdown', onclick: () => exportBreakdown(filtered()) }) : null,
      el('button', { class:'btn ghost', text:'PDF', onclick: () => exportPrint(entKey, filtered()) }),
      el('button', { class:'btn primary', text:`+ ${cfg.labelKo} 추가`, onclick: () => addNew(false) }),
    ])
  ]);

  /* ---- 검색 / 필터 ---- */
  const search = el('input', { class:'inp search', placeholder:`${cfg.labelKo} 검색`, value:S.q });
  search.addEventListener('input', () => { S.q = search.value; draw(); });

  const filterBar = el('div', { class:'filterbar' });
  function buildFilters(){
    clear(filterBar);
    filterBar.appendChild(search);
    for (const f of (cfg.filters || [])){
      if (typeof f.when === 'function' && !f.when(project)) continue;
      const sel = el('select', { class:'inp mini' });
      sel.appendChild(el('option', { value:'', text:f.label }));
      const fd = fieldMap(entKey)[f.k];
      const seen = rows.flatMap(r => fd && fd.cam ? camValues(cfg, r, f.k) : [r[f.k]]).filter(Boolean);
      const vals = Array.from(new Set([...(refList(f.ref)||[]), ...seen]));
      for (const val of vals) sel.appendChild(el('option', { value:val, text:val }));
      sel.value = S.filters[f.k] || '';
      if (sel.value) sel.classList.add('on');
      sel.addEventListener('change', () => { S.filters[f.k] = sel.value; draw(); buildFilters(); });
      filterBar.appendChild(sel);
    }
    // 시간 기준 정렬. 컬럼 정렬(표 머리 클릭)과 같은 상태를 쓴다.
    const sortSel = el('select', { class:'inp mini', title:'정렬' }, [
      el('option', { value:'updatedAt:desc', text:'최신 수정순' }),
      el('option', { value:'createdAt:asc',  text:'등록 오래된순' }),
      el('option', { value:'createdAt:desc', text:'등록 최신순' }),
    ]);
    const cur = S.sort.key + ':' + S.sort.dir;
    if (!Array.from(sortSel.options).some(o => o.value === cur)){
      // 컬럼으로 정렬 중이면 그 상태를 보여준다
      sortSel.appendChild(el('option', { value:cur,
        text:`${labelOf(entKey, S.sort.key)} ${S.sort.dir === 'asc' ? '↑' : '↓'}` }));
    }
    sortSel.value = cur;
    sortSel.addEventListener('change', () => {
      const [key, dir] = sortSel.value.split(':');
      S.sort = { key, dir }; draw(); buildFilters();
    });
    filterBar.appendChild(sortSel);
    if (Object.values(S.filters).some(Boolean) || S.q){
      filterBar.appendChild(el('button', { class:'btn tiny ghost', text:'초기화', onclick: () => {
        S.filters = {}; S.q = ''; search.value = ''; draw(); buildFilters();
      }}));
    }
  }

  function filtered(){
    const q = (S.q || '').trim().toLowerCase();
    let out = rows.filter(r => {
      for (const [k,val] of Object.entries(S.filters)){
        if (!val) continue;
        const fd = fieldMap(entKey)[k];
        // 캠별 필드는 어느 한 캠이라도 일치하면 통과시킨다
        if (fd && fd.cam){ if (!camValues(cfg, r, k).includes(val)) return false; }
        else if ((r[k] || '') !== val) return false;
      }
      if (!q) return true;
      const hay = [
        ...Object.values(r),
        ...Object.values(r.cams || {}).flatMap(d => Object.values(d || {})),
      ];
      return hay.some(val => typeof val === 'string' && val.toLowerCase().includes(q));
    });
    return sortRows(out);
  }

  /* ---- 표 ---- */
  const cols = (cfg.listCols || []).filter(k => {
    const f = fieldMap(entKey)[k];
    return !(f && typeof f.when === 'function' && !f.when(project));
  });
  // recordRef 열은 id 대신 이름으로 보여준다
  const refMaps = {};
  for (const k of cols){
    const f = fieldMap(entKey)[k];
    if (f && f.t === 'recordRef'){
      refMaps[k] = Object.fromEntries((await DB.list(f.to)).map(r => [r.id, displayName(f.to, r)]));
    }
  }
  const cellText = (r, k) => k === '__cams' ? camSummaryLine(entKey, r)
                           : k === '__vfx'  ? camFieldLine(entKey, r, 'vfxType')
                           : refMaps[k] ? (refMaps[k][r[k]] || '') : r[k];

  /** 표에 보이는 문자열 기준으로 정렬한다 (로케이션은 id 가 아니라 이름으로 정렬돼야 한다).
      씬 번호 '1-1' vs '1-10' 처럼 숫자가 섞인 값은 numeric 비교로 사람이 기대하는 순서가 된다. */
  function sortRows(list){
    const { key, dir } = S.sort;
    const mul = dir === 'desc' ? -1 : 1;
    const val = (r) => (key === 'updatedAt' || key === 'createdAt')
      ? String(r[key] || '')
      : String(cellText(r, key) ?? '');
    return list.sort((a,b) => {
      const x = val(a), y = val(b);
      // 빈 값은 방향과 무관하게 항상 뒤로 보낸다
      if (!x && y) return 1;
      if (x && !y) return -1;
      return mul * x.localeCompare(y, 'ko', { numeric:true, sensitivity:'base' });
    });
  }

  function toggleSort(k){
    S.sort = (S.sort.key === k)
      ? { key:k, dir: S.sort.dir === 'asc' ? 'desc' : 'asc' }
      : { key:k, dir:'asc' };
    draw(); buildFilters();
  }

  const tableWrap = el('div', { class:'table-wrap' });
  const countEl = el('div', { class:'dim tiny count' });

  async function draw(){
    const list = filtered();
    countEl.textContent = `${list.length} / ${rows.length}`;
    clear(tableWrap);
    if (!list.length){
      tableWrap.appendChild(el('div', { class:'empty', text:`등록된 ${cfg.labelKo}이(가) 없습니다.` }));
      return;
    }
    const body = el('tbody');
    const table = el('table', { class:'dtable' }, [
      el('thead', {}, [ el('tr', {}, [
        el('th', { class:'c-no', text:'NO' }),
        el('th', { class:'c-thumb', text:'썸네일' }),
        ...cols.map(k => el('th', {
          class:'sortable col-' + k.replace(/^__/,'') + (S.sort.key === k ? ' on' : ''),
          title:'눌러서 정렬',
          onclick: () => toggleSort(k),
        }, [
          el('span', { text: labelOf(entKey, k) }),
          el('i', { class:'sort-ar', text: S.sort.key === k ? (S.sort.dir === 'asc' ? '▲' : '▼') : '↕' }),
        ])),
        el('th', { class:'c-go' }),
      ])]),
      body
    ]);
    tableWrap.appendChild(table);

    let i = 0;
    for (const r of list){
      i++;
      const thumb = el('div', { class:'tcell-img' });
      const tv = thumbOf(entKey, r);
      if (tv && tv.mid){
        const url = await DB.mediaURL(tv.mid);
        if (url) thumb.appendChild(el('img', { src:url }));
      } else thumb.appendChild(el('span', { class:'noimg', text:'NO IMG' }));

      const tds = cols.map((k, idx) => {
        const txt = cellText(r, k);
        const f = fieldMap(entKey)[k];
        // 노트류는 길고 줄바꿈도 들어간다 → 두 줄로 자르고 전체는 툴팁으로
        const cls = 'col-' + k.replace(/^__/,'') + ' '
                  + (k === '__cams' ? (txt ? 'mono tiny' : 'dim')
                  : (f && f.t === 'textarea') ? (txt ? 'note' : 'dim')
                  : idx === 0 ? 'strong' : (txt ? '' : 'dim'));
        return el('td', { class: cls, text: txt || '—', title: (f && f.t === 'textarea' && txt) ? txt : null });
      });

      body.appendChild(el('tr', {
        class:'drow', onclick: () => go(`${entKey}/${r.id}`)
      }, [
        el('td', { class:'c-no', text:String(i) }),
        el('td', { class:'c-thumb' }, [thumb]),
        ...tds,
        el('td', { class:'c-go', text:'›' }),
      ]));
    }
  }

  async function addNew(){
    const rec = await makeRecord(entKey, cfg, project, rows);
    go(`${entKey}/${rec.id}`);
  }

  buildFilters();
  root.appendChild(el('div', { class:'pane single list-page' }, [ head, filterBar, countEl, tableWrap ]));
  await draw();
}

/* ===================== 엔티티 : 목록형 (상세 없음) ===================== */

/**
 * 상세 페이지 없이 목록에서 바로 편집한다 (카메라처럼 항목이 적고 비교가 중요한 것).
 * 한 행 = 썸네일 + 라벨/입력 짝을 2열로 배치.
 */
export async function entityInlineView(root, entKey){
  const cfg = ENTITIES[entKey];
  clear(root);

  const project = await DB.getProject();
  let rows = await DB.list(cfg.store);
  const navNo = String(NAV.findIndex(n => n.k === entKey) + 1).padStart(2,'0');
  const listEl = el('div', { class:'inline-list' });

  const head = el('header', { class:'page-head' }, [
    el('div', { class:'grow' }, [
      el('div', { class:'eyebrow', text:`${navNo} · ${cfg.label.toUpperCase()}` }),
      el('h1', { text: cfg.title || cfg.label }),
      cfg.desc ? el('p', { class:'dim', text: cfg.desc }) : null,
    ]),
    el('div', { class:'row gap wrap' }, [
      el('button', { class:'btn ghost', text:'CSV', onclick: () => exportCSV(entKey, rows) }),
      el('button', { class:'btn ghost', text:'PDF', onclick: () => exportPrint(entKey, rows) }),
      el('button', { class:'btn primary', text:`+ ${cfg.labelKo} 추가`, onclick: async () => {
        await makeRecord(entKey, cfg, project, rows);
        rows = await DB.list(cfg.store);
        await draw();
      }}),
    ])
  ]);

  function sortRows(list){
    return list.slice().sort((a,b) =>
      String(a.camRoll||'').localeCompare(String(b.camRoll||''), 'ko', { numeric:true })
      || (a.createdAt||'').localeCompare(b.createdAt||''));
  }

  async function draw(){
    clear(listEl);
    const list = sortRows(rows);
    if (!list.length){
      listEl.appendChild(el('div', { class:'empty', text:`등록된 ${cfg.labelKo}이(가) 없습니다.` }));
      return;
    }
    let i = 0;
    for (const rec of list){ i++; listEl.appendChild(card(rec, i)); }
  }

  function card(rec, no){
    const save = () => autosave(cfg.store, rec);
    const grid = el('div', { class:'inline-grid' });

    for (const f of (cfg.inlineFields || [])){
      const cell = el('div', { class:'inline-cell' + (f.full ? ' full' : '') }, [
        el('label', { text:f.label }),
      ]);
      if (f.t === 'textarea'){
        const ta = el('textarea', { class:'inp ta small', rows:2 });
        ta.value = rec[f.k] || '';
        ta.addEventListener('input', () => { rec[f.k] = ta.value; save(); });
        cell.appendChild(ta);
      } else {
        cell.appendChild(miniField(f, rec, save));
      }
      grid.appendChild(cell);
    }

    return el('article', { class:'inline-row' }, [
      el('div', { class:'inline-no', text:String(no) }),
      el('div', { class:'inline-thumb' }, [
        photoTile(() => rec[cfg.thumbField], (v) => { rec[cfg.thumbField] = v; }, 'thumb', save)
      ]),
      grid,
      el('button', { class:'btn tiny danger inline-del', text:'삭제', onclick: async () => {
        const nm = cfg.titleFields.map(k=>rec[k]).filter(Boolean).join(' ') || rec.id;
        if (!await confirmBox(`${cfg.labelKo} 삭제`, `${nm} 을(를) 삭제합니다.`, '삭제', true)) return;
        await DB.del(cfg.store, rec.id);
        rows = await DB.list(cfg.store);
        await draw(); toast('삭제 완료', 'warn');
      }}),
    ]);
  }

  root.appendChild(el('div', { class:'pane single list-page' }, [ head, listEl ]));
  await draw();
}

/** 필드 타입별 빈 값 */
function emptyOf(f){
  return (f.t === 'photos') ? new Array(f.n||2).fill(null)
       : (f.t === 'photo')  ? null
       : (f.t === 'link')   ? [] : '';
}

/** 새 레코드 생성 (리스트/상세 공용) */
async function makeRecord(entKey, cfg, project, rows){
  const base = { projectId: project.id };
  for (const g of cfg.groups) for (const f of g.fields){
    if (f.cam) continue;                    // 캠 종속 필드는 cams 아래로
    base[f.k] = emptyOf(f);
  }
  // 캠 탭이 있는 엔티티는 캠별 하위 레코드를 미리 만들어 둔다
  if (Array.isArray(cfg.cams)){
    base.cams = {};
    for (const c of cfg.cams){
      const o = {};
      for (const g of cfg.groups) for (const f of g.fields) if (f.cam) o[f.k] = emptyOf(f);
      base.cams[c] = o;
    }
  }
  if (cfg.inherit && rows && rows.length){
    const last = rows.slice().sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''))[0];
    const fm = fieldMap(entKey);
    if (last) for (const k of cfg.inherit){
      // 캠별 필드는 같은 캠끼리 물려받는다 (A캠 유닛 → A캠 유닛)
      if (fm[k] && fm[k].cam && Array.isArray(cfg.cams)){
        for (const c of cfg.cams){
          const v = ((last.cams || {})[c] || {})[k];
          if (v) base.cams[c][k] = v;
        }
      } else if (last[k]) base[k] = last[k];
    }
  }
  base.id = (entKey === 'scenes') ? DB.makeSceneId(project.name) : DB.makeId(cfg.idPrefix || 'REC');
  if (cfg.autoStamp){
    base[cfg.autoStamp.date] = nowDate();
    base[cfg.autoStamp.time] = nowTime();
  }
  await DB.put(cfg.store, base);
  return base;
}

/* ===================== 엔티티 : 상세 페이지 ===================== */

export async function entityDetailView(root, entKey, id, go){
  const cfg = ENTITIES[entKey];
  clear(root);
  const project = await DB.getProject();
  const rec = await DB.get(cfg.store, id);

  if (!rec){
    root.appendChild(el('div', { class:'pane single' }, [
      el('div', { class:'empty', text:'기록을 찾을 수 없습니다.' }),
      el('div', { class:'row' }, [ el('button', { class:'btn', text:'← 목록', onclick:()=>go(entKey) }) ])
    ]));
    return;
  }

  const title = cfg.titleFields.map(k => rec[k]).filter(Boolean).join(' · ') || `(${cfg.labelKo} 미입력)`;

  const head = el('header', { class:'detail-head' }, [
    el('button', { class:'btn ghost', text:'← 목록', onclick: async () => { await flushAll(); go(entKey); } }),
    el('div', { class:'detail-title' }, [
      el('div', { class:'eyebrow', text:`${(project.name || 'PROJECT').toUpperCase()} ONSET DATABASE` }),
      el('h2', { text: cfg.title || `${cfg.labelKo} 입력` }),
      el('div', { class:'idline' }, [
        el('code', { text: rec.id }),
        el('span', { id:'saveDot', class:'savedot', title:'자동 저장됨' }),
      ]),
      el('div', { class:'dim tiny', text: title }),
    ]),
    el('div', { class:'row gap' }, [
      el('button', { class:'btn ghost', text:'복제', onclick: async () => {
        const copy = JSON.parse(JSON.stringify(rec));
        copy.id = entKey === 'scenes' ? DB.makeSceneId(project.name) : DB.makeId(cfg.idPrefix||'REC');
        // 이미지는 복제하지 않는다 (같은 mid 를 둘이 참조하면 한쪽을 지울 때 다른 쪽이 깨진다)
        for (const g of cfg.groups) for (const f of g.fields){
          if (f.t !== 'photo' && f.t !== 'photos') continue;
          if (f.cam && copy.cams){
            for (const c of (cfg.cams || [])) if (copy.cams[c]) copy.cams[c][f.k] = emptyOf(f);
          } else {
            copy[f.k] = emptyOf(f);
          }
        }
        delete copy.createdAt; delete copy.updatedAt;
        if (cfg.autoStamp){ copy[cfg.autoStamp.date] = nowDate(); copy[cfg.autoStamp.time] = nowTime(); }
        await DB.put(cfg.store, copy);
        toast('복제 완료'); go(`${entKey}/${copy.id}`);
      }}),
      el('button', { class:'btn danger', text:'삭제', onclick: async () => {
        if (!await confirmBox(`${cfg.labelKo} 삭제`, '사진을 포함해 되돌릴 수 없습니다.', '삭제', true)) return;
        await DB.del(cfg.store, rec.id);
        toast('삭제 완료', 'warn'); go(entKey);
      }}),
    ])
  ]);

  const save = () => autosave(cfg.store, rec);
  const pane = el('div', { class:'pane single detail-page' }, [ head ]);
  root.appendChild(pane);

  /* ---- 캠(A~D) 탭이 있는 엔티티 (씬) ---- */
  if (Array.isArray(cfg.cams)){
    if (!rec.cams || typeof rec.cams !== 'object') rec.cams = {};
    for (const c of cfg.cams) if (!rec.cams[c]) rec.cams[c] = {};

    // 탭 표시와 물량 집계가 어긋나면 안 되므로 판정은 usedCams 하나만 쓴다
    const used = () => usedCams(entKey, rec);
    const hasData = (c) => used().includes(c);
    let active = used()[0] || cfg.cams[0];
    const tabBar = el('div', { class:'cam-tabs' });
    const formHost = el('div', { class:'cam-body' });

    async function drawForm(){
      clear(formHost);
      formHost.appendChild(await renderForm(rec, cfg.groups, entKey, save, {
        project, go, camRec: rec.cams[active],
        // 대표 이미지의 ⌁ 버튼 → 모니터 오버레이를 읽어 이 캠의 캠 롤·클립을 채운다
        onOcr: async (field, camRec, ref) => {
          const changed = await readMonitorInto(camRec, ref);
          if (changed){ save(); drawTabs(); await drawForm(); }
        },
      }));
    }
    function drawTabs(){
      clear(tabBar);
      for (const c of cfg.cams){
        tabBar.appendChild(el('button', {
          class:'cam-tab' + (c === active ? ' on' : '') + (hasData(c) ? ' filled' : ''),
          onclick: async () => { if (c === active) return; active = c; drawTabs(); await drawForm(); },
        }, [
          el('b', { text:c }),
          el('span', { class:'cam-sub', text: camSummary(rec.cams[c]) }),
        ]));
      }
      tabBar.appendChild(el('span', { class:'grow' }));
      tabBar.appendChild(el('span', { class:'dim tiny',
        text:'태블릿 카메라로 찍고 → 대표 이미지에서 사진 선택 → 자르기' }));
    }

    drawTabs();
    await drawForm();
    pane.append(tabBar, formHost);
  } else {
    pane.appendChild(await renderForm(rec, cfg.groups, entKey, save, { project, go }));
  }

  pane.scrollTop = 0;
}

/** 탭에 곁들일 한 줄 요약 — 'A027 C002' */
function camSummary(d){
  if (!d) return '';
  return [d.camRoll, d.clip].filter(Boolean).join(' ');
}

/**
 * 대표 이미지에 들어간 모니터 사진에서 캠 롤·클립을 읽어 그 캠에 채운다.
 * 촬영은 태블릿 기본 카메라로 하고(갤러리에 남는다), 앱은 그 사진을 불러와 자른 뒤 판독만 한다.
 * 판독값은 확인창을 거친다 — 클립 번호가 조용히 틀리는 게 제일 위험하다.
 *
 * @returns {Promise<boolean>} 값이 바뀌었는지
 */
async function readMonitorInto(camRec, ref){
  if (!ref || !ref.mid) return false;
  const p = progress(); p.set('준비 중', 3);
  const OCR = await import('./ocr.js');
  let snapped = {}, text = '', confidence = null;
  try {
    const media = await DB.getMedia(ref.mid);
    if (!media || !media.blob) throw new Error('사진을 찾을 수 없습니다');
    const r = await OCR.readMonitor(media.blob, (m, pc) => p.set(m, pc));
    text = r.text; confidence = r.confidence;
    const all = OCR.parseMonitor(text, {});
    if (all.camRoll) snapped.camRoll = all.camRoll;
    if (all.clip)    snapped.clip    = all.clip;
  } catch (e){
    p.done();
    toast('판독 실패: ' + errText(e), 'err', 4500);
    return false;
  }
  p.done();

  const picked = await ocrReview(snapped, OCR.OCR_LABELS, text, confidence);
  if (!picked) return false;

  let n = 0;
  if (picked.camRoll){ camRec.camRoll = picked.camRoll; n++; }
  if (picked.clip){    camRec.clip    = picked.clip;    n++; }
  toast(n ? `${[camRec.camRoll, camRec.clip].filter(Boolean).join(' ')} 입력됨` : '적용된 항목 없음',
        n ? 'ok' : 'warn');
  return n > 0;
}

/* ===================== PROJECT ===================== */

export async function projectView(root, reload){
  clear(root);
  const p = await DB.getProject();
  const pane = el('div', { class:'pane single' });

  const head = el('div', { class:'row between sec-head' }, [
    el('h2', { text:'Project' }),
    el('div', { class:'row gap' }, [
      el('button', { class:'btn', text:'+ 새 프로젝트', onclick: async () => {
        const np = await DB.createProject({ name:'새 프로젝트' });
        toast('프로젝트 생성 — 이름을 입력하세요');
        reload && reload();
      }}),
      el('button', { class:'btn danger', text:'이 프로젝트 삭제', onclick: async () => {
        const all = await DB.listProjects();
        if (all.length <= 1){ toast('마지막 프로젝트는 삭제할 수 없습니다', 'warn'); return; }
        const c = await DB.list('scenes');
        if (!await confirmBox('프로젝트 삭제',
          `"${p.name}" 과 그 안의 씬 ${c.length}건이 모두 삭제됩니다. 되돌릴 수 없습니다.`, '삭제', true)) return;
        await DB.deleteProject(p.id);
        toast('삭제 완료', 'warn'); reload && reload();
      }}),
    ])
  ]);

  let t = null;
  const form = await renderForm(p, PROJECT_SCHEMA.groups, 'project', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      await DB.setProject(p);
      const sel = $('#projSel');
      if (sel){ const o = Array.from(sel.options).find(o => o.value === p.id); if (o) o.textContent = p.name || '(이름 없음)'; }
      toast('저장됨', 'ok', 1000);
    }, 500);
  });

  pane.append(head, form);
  root.appendChild(pane);
}

/* ===================== OVERVIEW ===================== */

export async function overviewView(root, go){
  clear(root);
  const p = await DB.getProject();
  const scenes = await DB.list('scenes');

  // 기록 단위가 씬 + 캠 탭이므로 "캠 기록"(값이 들어간 캠) 개수를 센다
  const camRecords = [];
  for (const s of scenes) for (const c of usedCams('scenes', s))
    camRecords.push({ scene:s, cam:c, data:(s.cams||{})[c] || {} });

  const by = (list, fn) => {
    const m = {};
    for (const x of list){ const k = fn(x); if (k) m[k] = (m[k]||0)+1; }
    return m;
  };
  // 씬의 로케이션은 Location 레코드 id — 이름으로 바꿔야 집계가 사람이 읽을 수 있다
  const locName = Object.fromEntries((await DB.list('locations')).map(l => [l.id, displayName('locations', l)]));

  // VFX 물량 = 작업 타입이 지정된 캠 기록. 캠(앵글)마다 별개의 샷이므로 이게 세는 단위다.
  const vfxRecords = camRecords.filter(x => x.data.vfxType);

  const byEp     = by(scenes, s => s.episode);
  const byLoc    = by(scenes, s => locName[s.locationId] || s.legacyLocationName);
  const byTod    = by(scenes, s => s.tod);
  const byIntExt = by(scenes, s => s.intExt);
  const byCam    = by(camRecords, x => x.cam + '캠');
  const byType   = by(vfxRecords, x => x.data.vfxType);
  // 벤더는 씬 단위 값이지만 물량은 캠 단위로 센다 (벤더에 넘길 샷 수)
  const byVendor = by(vfxRecords, x => x.scene.vendor || '미배정');

  const isDrama = p.type === '드라마';

  const posterURL = p.poster && p.poster.mid ? await DB.mediaURL(p.poster.mid) : null;

  function bars(obj, cls, max){
    const entries = Object.entries(obj).sort((a,b)=>b[1]-a[1]);
    if (!entries.length) return el('div', { class:'empty tiny', text:'데이터 없음' });
    const top = Math.max(1, ...entries.map(e => e[1]));
    return el('div', { class:'bars '+cls },
      entries.slice(0, max || 99).map(([k,v]) => el('div', { class:'bar-row' }, [
        el('span', { class:'bar-k', text:k, title:k }),
        el('span', { class:'bar-t' }, [ el('i', { style:`width:${v/top*100}%` }) ]),
        el('b', { text:String(v) })
      ])));
  }

  root.appendChild(el('div', { class:'pane single dash' }, [
    el('div', { class:'proj-head' }, [
      posterURL ? el('img', { class:'poster', src:posterURL, onclick:()=>lightbox(posterURL,p.name) })
                : el('div', { class:'poster ph', text:'◧' }),
      el('div', { class:'grow' }, [
        el('h1', { text: p.name || '(프로젝트명 미설정)' }),
        el('div', { class:'dim', text:[p.type, p.season, p.productionCompany, p.distributor].filter(Boolean).join(' · ') }),
        el('div', { class:'dim tiny', text:`크랭크인 ${p.crankIn||'—'} · 크랭크업 ${p.crankUp||'—'} · 납품 ${p.deliveryDate||'—'}` }),
        el('div', { class:'dim tiny', text:`딜리버리 ${[p.deliveryResolution,p.deliveryFps&&p.deliveryFps+'fps',p.deliveryCodec,p.deliveryColorSpace].filter(Boolean).join(' / ')||'—'}` }),
        el('div', { class:'dim tiny', text:
           `씬 ${scenes.length} · 캠 기록 ${camRecords.length} · VFX 물량 ${vfxRecords.length}` })
      ])
    ]),

    el('div', { class:'stats big' }, [
      el('div', { class:'stat click', onclick:()=>go('scenes') }, [ el('b',{text:String(scenes.length)}), el('span',{text:'Scene'}) ]),
      el('div', { class:'stat click', onclick:()=>go('scenes') }, [ el('b',{text:String(camRecords.length)}), el('span',{text:'캠 기록'}) ]),
      el('div', { class:'stat click', onclick:()=>go('scenes') }, [ el('b',{text:String(vfxRecords.length)}), el('span',{text:'VFX 물량'}) ]),
      el('div', { class:'stat click', onclick:()=>go('locations') }, [ el('b',{text:String((await DB.list('locations')).length)}), el('span',{text:'Location'}) ]),
      el('div', { class:'stat click', onclick:()=>go('assets') }, [ el('b',{text:String((await DB.list('assets')).length)}), el('span',{text:'Asset'}) ]),
      el('div', { class:'stat click', onclick:()=>go('hdri') }, [ el('b',{text:String((await DB.list('hdri')).length)}), el('span',{text:'HDRI'}) ]),
    ]),

    el('div', { class:'dash-grid' }, [
      el('div', { class:'card wide' }, [ el('h4',{text:'작업 타입별 VFX 물량'}), bars(byType,'v') ]),
      isDrama ? el('div', { class:'card' }, [ el('h4',{text:'에피소드별 씬 수'}), bars(byEp,'e') ]) : null,
      el('div', { class:'card' }, [ el('h4',{text:'카메라별 기록 수'}), bars(byCam,'s') ]),
      el('div', { class:'card' }, [ el('h4',{text:'벤더별 VFX 물량'}), bars(byVendor,'s') ]),
      el('div', { class:'card' }, [ el('h4',{text:'로케이션별 씬 수'}), bars(byLoc,'e', 10) ]),
      el('div', { class:'card' }, [ el('h4',{text:'시제별 씬 수'}), bars(byTod,'e') ]),
      el('div', { class:'card' }, [ el('h4',{text:'INT / EXT'}), bars(byIntExt,'v') ]),
    ]),

    el('div', { class:'row gap wrap' }, [
      el('button', { class:'btn primary big', text:'📷 현장 기록 시작', onclick:()=>go('scenes') }),
      el('button', { class:'btn', text:'Breakdown 출력', onclick: async () => exportBreakdown(await DB.list('scenes')) }),
    ])
  ]));
}

/* ===================== SETTING (레퍼런스) ===================== */

export async function settingsView(root){
  clear(root);
  const refs = await DB.getRefs();
  const wrap = el('div', { class:'pane single' }, [
    el('h2', { text:'Setting' }),
    el('p', { class:'dim tiny', text:'드롭다운 목록은 모든 프로젝트가 함께 씁니다. 현장에서 새 값을 입력하면 자동으로 여기에 추가됩니다.' }),

    el('h3', { class:'sect', text:'앱 버전' }),
    el('div', { class:'row gap wrap' }, [
      el('code', { class:'dim', text: BUILD }),
      el('button', { class:'btn tiny', text:'업데이트 확인', onclick: async () => {
        if (!('serviceWorker' in navigator)){ toast('이 브라우저는 자동 갱신을 지원하지 않습니다', 'warn'); return; }
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg){ location.reload(); return; }
        toast('확인 중…', 'ok', 1200);
        await reg.update();
        setTimeout(() => location.reload(), 800);
      }}),
    ]),

    el('h3', { class:'sect', text:'드롭다운 기본값' }),
    el('p', { class:'dim tiny', text:
      '한 번이라도 목록을 수정하면 그 기기에 저장된 목록이 우선합니다. 앱이 업데이트되어 기본 목록이 바뀌어도 저장된 쪽은 그대로예요. 아래 버튼으로 최신 기본값을 가져올 수 있습니다.' }),
    el('div', { class:'row gap wrap' }, [
      el('button', { class:'btn', text:'없는 기본 항목만 채우기', onclick: async () => {
        const cur = await DB.getRefs();
        let added = 0;
        for (const [k, list] of Object.entries(DEFAULT_REFS)){
          if (!cur[k]){ cur[k] = list.slice(); added += list.length; continue; }
          for (const item of list) if (!cur[k].includes(item)){ cur[k].push(item); added++; }
        }
        await DB.setRefs(cur); setRefsCache(await DB.getRefs());
        toast(added ? `${added}개 항목 추가됨` : '추가할 항목 없음', added ? 'ok' : 'warn');
        settingsView(root);
      }}),
      el('button', { class:'btn danger', text:'기본값으로 완전 초기화', onclick: async () => {
        if (!await confirmBox('드롭다운 초기화',
          '직접 추가하거나 지운 항목이 모두 사라지고 기본 목록으로 돌아갑니다. 이미 기록한 씬·컷 데이터는 영향받지 않습니다.', '초기화', true)) return;
        await DB.setRefs(JSON.parse(JSON.stringify(DEFAULT_REFS)));
        setRefsCache(await DB.getRefs());
        toast('기본값으로 초기화됨');
        settingsView(root);
      }}),
    ]),

    el('h3', { class:'sect', text:'모니터 OCR' }),
    el('p', { class:'dim tiny', text:
      '씬 상세의 대표 이미지에 모니터 사진을 넣고 ⌁ 버튼을 누르면 캠 롤·클립을 읽어 그 캠에 채웁니다. 엔진(약 7MB)은 첫 사용 때 내려받고 그 뒤로는 오프라인에서도 동작합니다. 현장 나가기 전에 미리 받아두세요.' }),
    el('div', { class:'row gap wrap' }, [
      el('button', { class:'btn', text:'OCR 엔진 미리 받기', onclick: async (e) => {
        const p = progress(); p.set('내려받는 중', 3);
        try {
          const OCR = await import('./ocr.js');
          await OCR.loadEngine((m, pc) => p.set(m, pc));
          toast('OCR 엔진 준비 완료 — 이제 오프라인에서도 판독됩니다', 'ok', 4000);
        } catch (err){ toast('내려받기 실패: ' + errText(err), 'err', 5000); }
        finally { p.done(); }
      }}),
    ]),
  ]);

  const save = async () => { await DB.setRefs(refs); setRefsCache(await DB.getRefs()); };

  for (const grp of REF_GROUPS){
    const cards = el('div', { class:'ref-grid' });
    for (const [key, label] of Object.entries(grp.keys)){
      if (!refs[key]) refs[key] = [];
      const chips = el('div', { class:'chips' });
      const draw = () => {
        clear(chips);
        refs[key].forEach((v, i) => chips.appendChild(el('span', { class:'chip' }, [
          el('span', { text:v }),
          el('button', { text:'×', onclick: async () => { refs[key].splice(i,1); await save(); draw(); } })
        ])));
      };
      draw();
      const add = el('input', { class:'inp mini', placeholder:'+ 추가 후 Enter' });
      add.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        const v = add.value.trim(); if (!v) return;
        if (!refs[key].includes(v)) refs[key].push(v);
        add.value = ''; await save(); draw();
      });
      cards.appendChild(el('div', { class:'ref-card' }, [
        el('div', { class:'row between' }, [ el('h4', { text:label }), el('code', { class:'dim tiny', text:key }) ]),
        chips, add
      ]));
    }
    wrap.append(el('h3', { class:'sect', text:grp.title }), cards);
  }
  root.appendChild(wrap);
}

/* ===================== BACKUP ===================== */

export async function backupView(root, reload){
  clear(root);
  const info = await DB.storageInfo();
  const proj = await DB.getProject();
  const pane = el('div', { class:'pane single' });

  const statRows = [
    ['scenes','Scene'], ['cuts','Cut'], ['locations','Location'],
    ['assets','Asset'], ['cameras','Camera'], ['hdri','HDRI'],
  ].map(([k,l]) => el('div', { class:'stat' }, [
    el('b', { text:String(info.records[k] ?? 0) }), el('span', { text:l })
  ]));
  statRows.push(el('div', { class:'stat' }, [ el('b',{text:String(info.media)}), el('span',{text:'이미지'}) ]));

  const usage = info.quota
    ? `${fmtBytes(info.usage)} / ${fmtBytes(info.quota)} (${(info.usage/info.quota*100).toFixed(1)}%)`
    : fmtBytes(info.usage);

  const fileInput = el('input', { type:'file', accept:'.json,application/json', hidden:'' });
  let pendingMode = 'replace';
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0]; fileInput.value = '';
    if (!f) return;
    const p = progress(); p.set('파일 읽는 중', 3);
    try {
      const json = JSON.parse(await f.text());
      const s = await DB.importBackup(json, pendingMode, (m, pc) => p.set(m, pc));
      setRefsCache(await DB.getRefs());
      toast(`가져오기 완료 · 프로젝트 ${s.projects} / 씬 ${s.scenes} / 컷 ${s.cuts} / 로케 ${s.locations} / 에셋 ${s.assets} / 이미지 ${s.media}`, 'ok', 6000);
      reload && reload();
    } catch (e){ toast('가져오기 실패: ' + errText(e), 'err', 6000); }
    finally { p.done(); }
  });

  async function doExport(withMedia, scope){
    const p = progress(); p.set('백업 생성 중', 20);
    try {
      const data = await DB.exportBackup(withMedia, scope);
      p.set('직렬화 중', 70);
      const blob = new Blob([JSON.stringify(data)], { type:'application/json' });
      const tag = scope ? DB.slugOf(proj.name) : 'ALL';
      const name = `${tag}_온셋_${withMedia?'전체':'경량'}백업_${nowDate()}.json`;
      const a = el('a', { href: URL.createObjectURL(blob), download:name });
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      toast(`${name} (${fmtBytes(blob.size)})`);
    } catch(e){ toast('내보내기 실패: '+errText(e), 'err'); }
    finally { p.done(); }
  }

  pane.append(
    el('h2', { text:'Backup' }),
    el('p', { class:'dim', text:`현재 프로젝트: ${proj.name || '(이름 없음)'} · 전체 프로젝트 ${info.projects}개` }),
    el('div', { class:'stats' }, statRows),
    el('p', { class:'dim tiny', text:`저장소 사용량 ${usage}` }),

    el('h3', { class:'sect', text:'내보내기' }),
    el('div', { class:'row gap wrap' }, [
      el('button', { class:'btn primary', text:'현재 프로젝트 (이미지 포함)', onclick: () => doExport(true, proj.id) }),
      el('button', { class:'btn', text:'현재 프로젝트 (경량)', onclick: () => doExport(false, proj.id) }),
      el('button', { class:'btn ghost', text:'전체 프로젝트', onclick: () => doExport(true, null) }),
    ]),

    el('h3', { class:'sect', text:'가져오기' }),
    el('div', { class:'row gap wrap' }, [
      el('button', { class:'btn', text:'덮어쓰기 가져오기', onclick: async () => {
        if (!await confirmBox('덮어쓰기 가져오기', '이 기기의 모든 프로젝트와 기록을 지우고 파일 내용으로 교체합니다.', '진행', true)) return;
        pendingMode = 'replace'; fileInput.click();
      }}),
      el('button', { class:'btn ghost', text:'병합 가져오기', onclick: () => { pendingMode = 'merge'; fileInput.click(); } }),
    ]),
    fileInput,

    el('h3', { class:'sect', text:'유지관리' }),
    el('div', { class:'row gap wrap' }, [
      el('button', { class:'btn ghost', text:'미사용 이미지 정리', onclick: async () => {
        const n = await DB.gcMedia(); toast(`${n}개 정리됨`); reload && reload();
      }}),
      el('button', { class:'btn ghost', text:'영구 저장 요청', onclick: async () => {
        const ok = await DB.requestPersist();
        toast(ok ? '영구 저장 허용됨' : '브라우저가 거부했습니다', ok ? 'ok' : 'warn', 4000);
      }}),
    ]),
  );
  root.appendChild(pane);
}
