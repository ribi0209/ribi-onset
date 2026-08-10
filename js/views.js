/* =====================================================================
 * Ribi Onset — views.js
 * 화면: Project / Overview / 엔티티 리스트+에디터 / Setting / Backup
 * ===================================================================== */

import * as DB from './db.js';
import {
  ENTITIES, PROJECT_SCHEMA, REF_GROUPS, TAKE_FIELDS, DEFAULT_REFS, NAV, BUILD, fieldMap, labelOf
} from './schema.js';
import {
  el, $, clear, toast, confirmBox, progress, renderForm, setRefsCache,
  refList, nowDate, nowTime, fmtBytes, lightbox, photoTile, miniField, ocrReview
} from './ui.js';
import { ingest, pickFiles } from './media.js';
import { exportCSV, exportBreakdown, exportPrint } from './export.js';

const PAGE = 60;
const STATE = {};
function st(ent){
  if (!STATE[ent]) STATE[ent] = { q:'', filters:{}, selected:null, limit:PAGE, sort:'new' };
  return STATE[ent];
}

/* ---------------- 자동 저장 ---------------- */

const timers = new Map();
function autosave(store, rec, after){
  const key = store + ':' + rec.id;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(async () => {
    await DB.put(store, rec);
    const dot = $('#saveDot'); if (dot){ dot.classList.add('on'); setTimeout(()=>dot.classList.remove('on'), 900); }
    timers.delete(key);
    after && after();
  }, 500));
}
async function flushAll(){
  for (const [, t] of timers) clearTimeout(t);
  timers.clear();
}

/* ===================== 엔티티 : 리스트 페이지 ===================== */

/** 리스트 → 클릭 → 상세 페이지 (좌우 분할 아님) */
export async function entityListView(root, entKey, go){
  const cfg = ENTITIES[entKey];
  const S = st(entKey);
  clear(root);

  const project = await DB.getProject();
  const rows = await DB.list(cfg.store);
  const cutIndex = {};
  if (entKey === 'scenes'){
    for (const c of await DB.list('cuts')) (cutIndex[c.sceneId] = cutIndex[c.sceneId] || []).push(c);
  }

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
      el('button', { class:'btn', text:'📷 촬영 + 추가', onclick: () => addNew(true) }),
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
      const vals = Array.from(new Set([...(refList(f.ref)||[]), ...rows.map(r => r[f.k]).filter(Boolean)]));
      for (const val of vals) sel.appendChild(el('option', { value:val, text:val }));
      sel.value = S.filters[f.k] || '';
      if (sel.value) sel.classList.add('on');
      sel.addEventListener('change', () => { S.filters[f.k] = sel.value; draw(); buildFilters(); });
      filterBar.appendChild(sel);
    }
    const sortSel = el('select', { class:'inp mini' }, [
      el('option', { value:'name', text:'식별자순' }),
      el('option', { value:'new',  text:'최신순' }),
      el('option', { value:'old',  text:'오래된순' }),
    ]);
    sortSel.value = S.sort;
    sortSel.addEventListener('change', () => { S.sort = sortSel.value; draw(); });
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
      for (const [k,val] of Object.entries(S.filters)) if (val && (r[k] || '') !== val) return false;
      if (!q) return true;
      return Object.entries(r).some(([k,val]) => typeof val === 'string' && val.toLowerCase().includes(q));
    });
    const key = (r) => cfg.titleFields.map(k => r[k] || '').join('|');
    if (S.sort === 'new')  out.sort((a,b) => (b.updatedAt||'').localeCompare(a.updatedAt||''));
    if (S.sort === 'old')  out.sort((a,b) => (a.createdAt||'').localeCompare(b.createdAt||''));
    if (S.sort === 'name') out.sort((a,b) => key(a).localeCompare(key(b), 'ko', { numeric:true }));
    return out;
  }

  /* ---- 표 ---- */
  const cols = (cfg.listCols || []).filter(k => {
    const f = fieldMap(entKey)[k];
    return !(f && typeof f.when === 'function' && !f.when(project));
  });
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
        ...cols.map(k => el('th', { text: labelOf(entKey, k) })),
        entKey === 'scenes' ? el('th', { text:'컷 / 테이크' }) : null,
        el('th', { class:'c-go' }),
      ])]),
      body
    ]);
    tableWrap.appendChild(table);

    let i = 0;
    for (const r of list){
      i++;
      const thumb = el('div', { class:'tcell-img' });
      const tv = r[cfg.thumbField];
      if (tv && tv.mid){
        const url = await DB.mediaURL(tv.mid);
        if (url) thumb.appendChild(el('img', { src:url }));
      } else thumb.appendChild(el('span', { class:'noimg', text:'NO IMG' }));

      const tds = cols.map((k, idx) => el('td', {
        class: idx === 0 ? 'strong' : (r[k] ? '' : 'dim'),
        text: r[k] || '—'
      }));
      if (entKey === 'scenes'){
        const cs = cutIndex[r.id] || [];
        const tk = cs.reduce((a,c) => a + (c.takes ? c.takes.length : 0), 0);
        tds.push(el('td', { class: cs.length ? '' : 'dim', text: cs.length ? `컷 ${cs.length} · 테이크 ${tk}` : '—' }));
      }

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

  async function addNew(withCapture){
    const rec = await makeRecord(entKey, cfg, project, rows, withCapture);
    go(`${entKey}/${rec.id}`);
  }

  buildFilters();
  root.appendChild(el('div', { class:'pane single list-page' }, [ head, filterBar, countEl, tableWrap ]));
  await draw();
}

/** 새 레코드 생성 (리스트/상세 공용) */
async function makeRecord(entKey, cfg, project, rows, withCapture){
  const base = { projectId: project.id };
  for (const g of cfg.groups) for (const f of g.fields){
    base[f.k] = (f.t === 'photos') ? new Array(f.n||2).fill(null)
              : (f.t === 'photo') ? null
              : (f.t === 'link') ? [] : '';
  }
  if (cfg.inherit && rows && rows.length){
    const last = rows.slice().sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''))[0];
    if (last) for (const k of cfg.inherit) if (last[k]) base[k] = last[k];
  }
  base.id = (entKey === 'scenes') ? DB.makeSceneId(project.name) : DB.makeId(cfg.idPrefix || 'REC');
  if (cfg.autoStamp){
    base[cfg.autoStamp.date] = nowDate();
    base[cfg.autoStamp.time] = nowTime();
  }
  if (withCapture){
    const files = await pickFiles({ capture:true });
    if (files.length){
      const p = progress(); p.set('이미지 압축 중', 40);
      try { base[cfg.thumbField] = await ingest(files[0], 'thumb'); }
      catch(e){ toast('이미지 처리 실패: '+e.message, 'err'); }
      finally { p.done(); }
    }
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
      el('h2', { text: `${cfg.labelKo} 입력` }),
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
        for (const g of cfg.groups) for (const f of g.fields){
          if (f.t === 'photo') copy[f.k] = null;
          if (f.t === 'photos') copy[f.k] = new Array(f.n||2).fill(null);
        }
        delete copy.createdAt; delete copy.updatedAt;
        if (cfg.autoStamp){ copy[cfg.autoStamp.date] = nowDate(); copy[cfg.autoStamp.time] = nowTime(); }
        await DB.put(cfg.store, copy);
        toast('복제 완료'); go(`${entKey}/${copy.id}`);
      }}),
      el('button', { class:'btn danger', text:'삭제', onclick: async () => {
        const nCuts = entKey === 'scenes' ? (await DB.listCuts(rec.id)).length : 0;
        const msg = nCuts ? `이 씬과 하위 컷 ${nCuts}개가 함께 삭제됩니다.` : '되돌릴 수 없습니다.';
        if (!await confirmBox(`${cfg.labelKo} 삭제`, msg, '삭제', true)) return;
        await DB.del(cfg.store, rec.id);
        toast('삭제 완료', 'warn'); go(entKey);
      }}),
    ])
  ]);

  const form = await renderForm(rec, cfg.groups, entKey,
    () => autosave(cfg.store, rec), { project });

  const pane = el('div', { class:'pane single detail-page' }, [ head, form ]);
  root.appendChild(pane);

  if (entKey === 'scenes') pane.appendChild(await cutsSection(rec, null));
  pane.scrollTop = 0;
}

/* ===================== 모니터 사진 OCR ===================== */

/**
 * 테이크의 모니터 사진을 읽어 카메라 정보를 채운다.
 * 판독값은 확인창을 거쳐야만 반영된다 (잘못된 클립 번호가 조용히 들어가는 게 가장 위험).
 */
async function runMonitorOCR(take, save, redraw){
  if (!take.monitor || !take.monitor.mid) return;
  const p = progress(); p.set('준비 중', 3);
  try {
    const OCR = await import('./ocr.js');
    const media = await DB.getMedia(take.monitor.mid);
    if (!media || !media.blob) throw new Error('사진을 찾을 수 없습니다');

    const { text, confidence, fields } = await OCR.readMonitor(media.blob, (m, pc) => p.set(m, pc));
    p.done();

    // 레퍼런스 목록 표기에 맞춰 스냅
    const snapped = OCR.parseMonitor(text, {
      fps: refList('fps'), shutters: refList('shutters'), tStops: refList('tStops'),
      isoEi: refList('isoEi'), whiteBalance: refList('whiteBalance'), ndFilters: refList('ndFilters'),
    });

    const picked = await ocrReview(snapped, OCR.OCR_LABELS, text, confidence);
    if (!picked) return;

    let n = 0;
    for (const k of OCR.TAKE_KEYS) if (picked[k]){ take[k] = picked[k]; n++; }
    if (picked.cc){
      take.note = [take.note, 'CC ' + picked.cc].filter(Boolean).join(' ');
      n++;
    }
    save();
    if (redraw) await redraw();
    toast(n ? `${n}개 항목 입력됨` : '적용된 항목 없음', n ? 'ok' : 'warn');
  } catch (e){
    p.done();
    toast('판독 실패: ' + e.message, 'err', 5000);
  }
}

/* ===================== 씬 하위 컷 / 테이크 ===================== */

async function cutsSection(scene, onChange){
  const cfg = ENTITIES.cuts;
  const wrap = el('section', { class:'cuts-sec' });
  let cuts = await DB.listCuts(scene.id);

  const body = el('div', { class:'cut-list' });

  async function addCut(){
    const last = cuts[cuts.length - 1];
    const rec = {
      id: DB.makeId('CUT'), projectId: scene.projectId, sceneId: scene.id,
      cutNo: String(cuts.length + 1),
      vfxType: last ? last.vfxType : '', workElement:'',
      vendor: last ? last.vendor : '',
      vfxShotId:'', shotNote:'', plateNote:'',
      thumbnail:null, photos:[null,null,null], takes:[],
    };
    await DB.put('cuts', rec);
    cuts = await DB.listCuts(scene.id);
    await draw(rec.id);
    onChange && onChange();
  }

  async function draw(openId){
    clear(body);
    if (!cuts.length){
      body.appendChild(el('div', { class:'empty tiny', text:'컷이 없습니다. 아래 + 컷 으로 추가하세요.' }));
    }
    for (const c of cuts) body.appendChild(await cutCard(c, c.id === openId));
  }

  async function cutCard(cut, open){
    const card = el('article', { class:'cut-card' + (open ? ' open' : '') });
    const nTakes = (cut.takes || []).length;
    const nOk = (cut.takes || []).filter(t => t.state === 'OK').length;

    const save = () => autosave('cuts', cut, () => { onChange && onChange(); });

    /* --- 헤더 (항상 보임) --- */
    const summary = el('div', { class:'cut-head', onclick:(e) => {
      if (e.target.closest('button,input,select')) return;
      card.classList.toggle('open');
    }}, [
      el('span', { class:'cut-no', text: 'C' + (cut.cutNo || '?') }),
      el('span', { class:'tag t-vfxType', text: cut.vfxType || '타입 미정' }),
      cut.workElement ? el('span', { class:'tag', text: cut.workElement }) : null,
      cut.vendor ? el('span', { class:'tag', text: cut.vendor }) : null,
      el('span', { class:'dim tiny', text: nTakes ? `테이크 ${nTakes} (OK ${nOk})` : '테이크 없음' }),
      el('span', { class:'grow' }),
      el('button', { class:'btn tiny danger', text:'삭제', onclick: async (e) => {
        e.stopPropagation();
        if (!await confirmBox('컷 삭제', `C${cut.cutNo} 과 테이크 ${nTakes}개가 삭제됩니다.`, '삭제', true)) return;
        await DB.del('cuts', cut.id);
        cuts = await DB.listCuts(scene.id);
        await draw(); onChange && onChange();
        toast('컷 삭제', 'warn');
      }}),
      el('span', { class:'chev', text:'▾' }),
    ]);

    /* --- 본문 --- */
    const grid = el('div', { class:'grid cut-grid' });
    for (const g of cfg.groups){
      for (const f of g.fields){
        if (f.t === 'photos') continue;                 // 참고 사진은 아래 별도
        const cell = el('div', { class:'field' + (f.full ? ' full' : '') });
        cell.appendChild(el('label', { text:f.label }));
        if (f.t === 'photo'){
          cell.appendChild(photoTile(() => cut[f.k], (v) => { cut[f.k] = v; }, 'thumb', save));
        } else if (f.t === 'textarea'){
          const ta = el('textarea', { class:'inp ta', rows:2 });
          ta.value = cut[f.k] || '';
          ta.addEventListener('input', () => { cut[f.k] = ta.value; save(); });
          cell.appendChild(ta);
        } else {
          cell.appendChild(miniField(f, cut, save));
        }
        grid.appendChild(cell);
      }
    }

    const takesBox = el('div', { class:'takes' });
    async function drawTakes(){
      clear(takesBox);
      if (!Array.isArray(cut.takes)) cut.takes = [];
      takesBox.appendChild(el('div', { class:'takes-head' }, [
        el('h5', { text:`TAKES (${cut.takes.length})` }),
        el('span', { class:'grow' }),
        el('button', { class:'btn tiny primary', text:'+ 테이크', onclick: async () => {
          const prev = cut.takes[cut.takes.length - 1] || {};
          cut.takes.push({
            takeNo: String(cut.takes.length + 1),
            camRoll: prev.camRoll || '', clip:'', tc:'', state:'',
            fps: prev.fps || '', shutter: prev.shutter || '', iris: prev.iris || '',
            ei: prev.ei || '', nd: prev.nd || '', wb: prev.wb || '', lens: prev.lens || '',
            note:'', monitor:null,
          });
          save(); await drawTakes();
        }}),
      ]));

      if (!cut.takes.length){
        takesBox.appendChild(el('div', { class:'empty tiny', text:'모니터를 찍어 테이크를 남기세요.' }));
        return;
      }

      const table = el('div', { class:'take-table' });
      table.appendChild(el('div', { class:'take-row hdr' }, [
        el('span', { class:'tk-mon', text:'모니터' }),
        ...TAKE_FIELDS.map(f => el('span', { class:'tk-'+f.k, text:f.label })),
        el('span', { class:'tk-del' }),
      ]));
      for (let i = 0; i < cut.takes.length; i++){
        const tk = cut.takes[i];
        const row = el('div', { class:'take-row' });
        row.appendChild(el('span', { class:'tk-mon' }, [
          photoTile(() => tk.monitor, (v) => { tk.monitor = v; }, 'plate', save, {
            label:'모니터',
            onShot: () => runMonitorOCR(tk, save, drawTakes),
          })
        ]));
        for (const f of TAKE_FIELDS){
          row.appendChild(el('span', { class:'tk-'+f.k }, [ miniField(f, tk, save) ]));
        }
        row.appendChild(el('span', { class:'tk-del' }, [
          el('button', { class:'btn tiny ghost', text:'×', title:'테이크 삭제', onclick: async () => {
            if (tk.monitor && tk.monitor.mid) await DB.delMedia(tk.monitor.mid);
            cut.takes.splice(i,1); save(); await drawTakes();
          }})
        ]));
        table.appendChild(row);
      }
      takesBox.appendChild(table);
    }
    await drawTakes();

    const photosBox = el('div', { class:'field full' }, [ el('label', { text:'참고 사진' }) ]);
    if (!Array.isArray(cut.photos)) cut.photos = [null,null,null];
    const pg = el('div', { class:'photo-grid' });
    for (let i = 0; i < 3; i++){
      pg.appendChild(photoTile(() => cut.photos[i], (v) => { cut.photos[i] = v; }, 'photo', save));
    }
    photosBox.appendChild(pg);

    card.append(summary, el('div', { class:'cut-body' }, [ grid, takesBox, photosBox ]));
    return card;
  }

  await draw();
  wrap.append(
    el('div', { class:'row between sec-head' }, [
      el('h4', { text:'CUTS' }),
      el('button', { class:'btn primary', text:'+ 컷', onclick: addCut }),
    ]),
    body
  );
  return wrap;
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
  const cuts   = await DB.list('cuts');
  const sceneById = Object.fromEntries(scenes.map(s => [s.id, s]));

  const takes = cuts.reduce((a,c) => a + (c.takes ? c.takes.length : 0), 0);
  const okTakes = cuts.reduce((a,c) => a + (c.takes||[]).filter(t => t.state === 'OK').length, 0);

  const by = (fn) => {
    const m = {};
    for (const c of cuts){ const k = fn(c); if (k) m[k] = (m[k]||0)+1; }
    return m;
  };
  const byType   = by(c => c.vfxType || '미분류');
  const byEp     = by(c => (sceneById[c.sceneId]||{}).episode);
  const byVendor = by(c => c.vendor || '미배정');
  const byLoc    = by(c => (sceneById[c.sceneId]||{}).location);
  const byElem   = by(c => c.workElement);
  const byTod    = by(c => (sceneById[c.sceneId]||{}).tod);

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
           `씬 ${scenes.length} · 컷 ${cuts.length} · 테이크 ${takes} (OK ${okTakes})` })
      ])
    ]),

    el('div', { class:'stats big' }, [
      el('div', { class:'stat click', onclick:()=>go('scenes') }, [ el('b',{text:String(scenes.length)}), el('span',{text:'Scene'}) ]),
      el('div', { class:'stat click', onclick:()=>go('scenes') }, [ el('b',{text:String(cuts.length)}), el('span',{text:'Cut (VFX 물량)'}) ]),
      el('div', { class:'stat' }, [ el('b',{text:String(takes)}), el('span',{text:`Take (OK ${okTakes})`}) ]),
      el('div', { class:'stat click', onclick:()=>go('locations') }, [ el('b',{text:String((await DB.list('locations')).length)}), el('span',{text:'Location'}) ]),
      el('div', { class:'stat click', onclick:()=>go('assets') }, [ el('b',{text:String((await DB.list('assets')).length)}), el('span',{text:'Asset'}) ]),
      el('div', { class:'stat click', onclick:()=>go('hdri') }, [ el('b',{text:String((await DB.list('hdri')).length)}), el('span',{text:'HDRI'}) ]),
    ]),

    el('div', { class:'dash-grid' }, [
      el('div', { class:'card wide' }, [ el('h4',{text:'작업 타입별 컷 수'}), bars(byType,'v') ]),
      isDrama ? el('div', { class:'card' }, [ el('h4',{text:'에피소드별 컷 수'}), bars(byEp,'e') ]) : null,
      el('div', { class:'card' }, [ el('h4',{text:'벤더별'}), bars(byVendor,'s') ]),
      el('div', { class:'card' }, [ el('h4',{text:'로케이션별'}), bars(byLoc,'e', 10) ]),
      el('div', { class:'card' }, [ el('h4',{text:'작업 요소 TOP 10'}), bars(byElem,'v', 10) ]),
      el('div', { class:'card' }, [ el('h4',{text:'시간대별 컷 수'}), bars(byTod,'e') ]),
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
      '테이크의 모니터 사진에서 캠 롤·클립·TC·FPS·셔터·EI·WB 를 읽어옵니다. 엔진(약 7MB)은 첫 사용 때 내려받고 그 뒤로는 오프라인에서도 동작합니다. 현장 나가기 전에 미리 받아두세요.' }),
    el('div', { class:'row gap wrap' }, [
      el('button', { class:'btn', text:'OCR 엔진 미리 받기', onclick: async (e) => {
        const p = progress(); p.set('내려받는 중', 3);
        try {
          const OCR = await import('./ocr.js');
          await OCR.loadEngine((m, pc) => p.set(m, pc));
          toast('OCR 엔진 준비 완료 — 이제 오프라인에서도 판독됩니다', 'ok', 4000);
        } catch (err){ toast('내려받기 실패: ' + err.message, 'err', 5000); }
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
    } catch (e){ toast('가져오기 실패: ' + e.message, 'err', 6000); }
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
    } catch(e){ toast('내보내기 실패: '+e.message, 'err'); }
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
