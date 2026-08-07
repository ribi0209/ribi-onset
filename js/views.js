/* =====================================================================
 * PMT Onset — views.js
 * 엔티티 리스트 + 에디터, 프로젝트, 레퍼런스, 백업, 대시보드
 * ===================================================================== */

import * as DB from './db.js';
import { ENTITIES, ENTITY_ORDER, PROJECT_SCHEMA, REF_GROUPS, fieldMap } from './schema.js';
import {
  el, $, clear, toast, confirmBox, progress, renderForm, setRefsCache,
  refList, nowDate, nowTime, fmtBytes, lightbox
} from './ui.js';
import { ingest, pickFiles } from './media.js';
import { exportCSV, exportBreakdown, exportPrint } from './export.js';

const PAGE = 60;

/* 뷰별 상태 유지 (탭 전환해도 필터/선택 유지) */
const STATE = {};
function st(ent){
  if (!STATE[ent]) STATE[ent] = { q:'', filters:{}, selected:null, limit:PAGE, sort:'new' };
  return STATE[ent];
}

let saveTimer = null;
function autosave(store, rec, after){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await DB.put(store, rec);
    const dot = $('#saveDot'); if (dot){ dot.classList.add('on'); setTimeout(()=>dot.classList.remove('on'), 900); }
    after && after();
  }, 500);
}
async function flushSave(){
  if (saveTimer){ clearTimeout(saveTimer); saveTimer = null; }
}

/* ===================== 엔티티 뷰 ===================== */

export async function entityView(root, entKey){
  const cfg = ENTITIES[entKey];
  const S = st(entKey);
  clear(root);

  const listPane = el('aside', { class:'pane list-pane' });
  const editPane = el('section', { class:'pane edit-pane' });
  root.appendChild(el('div', { class:'split' }, [listPane, editPane]));

  let rows = await DB.list(cfg.store);

  /* ---- 필터 / 검색 바 ---- */
  const search = el('input', { class:'inp search', placeholder:`${cfg.label} 검색 (전체 필드)`, value:S.q });
  search.addEventListener('input', () => { S.q = search.value; S.limit = PAGE; drawList(); });

  const filterBar = el('div', { class:'filterbar' });
  function buildFilters(){
    clear(filterBar);
    for (const f of (cfg.filters || [])){
      const sel = el('select', { class:'inp mini' });
      sel.appendChild(el('option', { value:'', text: f.label }));
      const vals = Array.from(new Set([...(refList(f.ref)||[]), ...rows.map(r => r[f.k]).filter(Boolean)]));
      for (const v of vals) sel.appendChild(el('option', { value:v, text:v }));
      sel.value = S.filters[f.k] || '';
      if (sel.value) sel.classList.add('on');
      sel.addEventListener('change', () => { S.filters[f.k] = sel.value; S.limit = PAGE; drawList(); buildFilters(); });
      filterBar.appendChild(sel);
    }
    const sortSel = el('select', { class:'inp mini' }, [
      el('option', { value:'new',  text:'최신순' }),
      el('option', { value:'old',  text:'오래된순' }),
      el('option', { value:'name', text:'식별자순' }),
    ]);
    sortSel.value = S.sort;
    sortSel.addEventListener('change', () => { S.sort = sortSel.value; drawList(); });
    filterBar.appendChild(sortSel);
    if (Object.values(S.filters).some(Boolean) || S.q){
      filterBar.appendChild(el('button', { class:'btn tiny ghost', text:'초기화', onclick: () => {
        S.filters = {}; S.q = ''; search.value = ''; S.limit = PAGE; drawList(); buildFilters();
      }}));
    }
  }

  /* ---- 액션 바 ---- */
  const actions = el('div', { class:'row gap wrap actionbar' }, [
    el('button', { class:'btn primary', text:`+ 새 ${cfg.label}`, onclick: () => newRecord(false) }),
    (entKey === 'scenes' || cfg.thumbField)
      ? el('button', { class:'btn', text:'📷 촬영 + 등록', onclick: () => newRecord(true) }) : null,
    el('button', { class:'btn ghost', text:'CSV', onclick: () => exportCSV(entKey, filtered()) }),
    entKey === 'scenes'
      ? el('button', { class:'btn ghost', text:'브레이크다운', onclick: () => exportBreakdown(filtered()) }) : null,
    el('button', { class:'btn ghost', text:'PDF 인쇄', onclick: () => exportPrint(entKey, filtered()) }),
  ]);

  const countEl = el('div', { class:'dim count' });
  const listEl  = el('div', { class:'reclist' });
  listEl.addEventListener('scroll', () => {
    if (listEl.scrollTop + listEl.clientHeight > listEl.scrollHeight - 200){
      const n = filtered().length;
      if (S.limit < n){ S.limit += PAGE; drawList(true); }
    }
  });

  listPane.append(actions, search, filterBar, countEl, listEl);
  buildFilters();

  /* ---- 필터링 ---- */
  function filtered(){
    const q = (S.q || '').trim().toLowerCase();
    let out = rows.filter(r => {
      for (const [k,v] of Object.entries(S.filters)) if (v && (r[k] || '') !== v) return false;
      if (!q) return true;
      return Object.entries(r).some(([k,val]) =>
        typeof val === 'string' && val.toLowerCase().includes(q));
    });
    const key = (r) => cfg.titleFields.map(k => r[k] || '').join('|');
    if (S.sort === 'new')  out.sort((a,b) => (b.updatedAt||'').localeCompare(a.updatedAt||''));
    if (S.sort === 'old')  out.sort((a,b) => (a.createdAt||'').localeCompare(b.createdAt||''));
    if (S.sort === 'name') out.sort((a,b) => key(a).localeCompare(key(b), 'ko', { numeric:true }));
    return out;
  }

  /* ---- 리스트 ---- */
  let rendered = 0;
  async function drawList(append = false){
    const f = filtered();
    countEl.textContent = `${f.length} / ${rows.length} 건`;
    if (!append){ clear(listEl); rendered = 0; }
    const slice = f.slice(rendered, S.limit);
    for (const r of slice) listEl.appendChild(await rowEl(r));
    rendered += slice.length;
    if (!f.length) listEl.appendChild(el('div', { class:'empty', text:'레코드가 없습니다.' }));
  }

  async function rowEl(r){
    const title = cfg.titleFields.map(k => r[k]).filter(Boolean).join(' · ') || '(제목 없음)';
    const sub   = cfg.subtitleFields.map(k => r[k]).filter(Boolean).join(' · ');
    const thumb = el('div', { class:'thumb' });
    const tv = r[cfg.thumbField];
    if (tv && tv.mid){
      const url = await DB.mediaURL(tv.mid);
      if (url) thumb.appendChild(el('img', { src:url }));
    } else thumb.textContent = cfg.icon;

    const tags = el('div', { class:'tags' });
    for (const k of (cfg.listCols || []).slice(0, 6)){
      if (!r[k]) continue;
      if (cfg.titleFields.includes(k)) continue;
      tags.appendChild(el('span', { class:'tag t-'+k, text: r[k] }));
    }

    const node = el('div', {
      class:'rec' + (S.selected === r.id ? ' on' : ''),
      dataset:{ id:r.id },
      onclick: () => select(r.id)
    }, [ thumb, el('div', { class:'rec-body' }, [
        el('div', { class:'rec-title', text:title }),
        sub ? el('div', { class:'rec-sub dim', text:sub }) : null,
        tags
      ]) ]);
    return node;
  }

  /* ---- 신규 ---- */
  async function newRecord(withCapture){
    const project = await DB.getProject();
    const base = {};
    for (const g of cfg.groups) for (const f of g.fields){
      base[f.k] = (f.t === 'photos') ? new Array(f.n||2).fill(null)
                : (f.t === 'photo') ? null
                : (f.t === 'link') ? [] : '';
    }
    // 직전 레코드 값 상속
    if (cfg.inherit){
      const last = rows.slice().sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''))[0];
      if (last) for (const k of cfg.inherit) if (last[k]) base[k] = last[k];
    }
    if (entKey === 'scenes'){
      base.project = project.name || '';
      base.status = base.status || (refList('statuses')[0] || '');
      base.id = DB.makeSceneId(project.name);
    } else {
      base.id = DB.makeId(cfg.idPrefix || 'REC');
    }
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
    rows = await DB.list(cfg.store);
    S.selected = base.id;
    buildFilters(); await drawList(); await select(base.id);
    toast(`${cfg.label} 생성: ${base.id}`);
  }

  /* ---- 에디터 ---- */
  async function select(id){
    await flushSave();
    S.selected = id;
    const rec = await DB.get(cfg.store, id);
    for (const n of listEl.children) n.classList.toggle('on', n.dataset && n.dataset.id === id);
    clear(editPane);
    if (!rec){ editPane.appendChild(el('div', { class:'empty', text:'좌측에서 레코드를 선택하세요.' })); return; }

    const head = el('div', { class:'edit-head' }, [
      el('div', {}, [
        el('div', { class:'idline' }, [
          el('code', { text: rec.id }),
          el('span', { id:'saveDot', class:'savedot', title:'자동 저장됨' })
        ]),
        el('div', { class:'dim tiny', text:`생성 ${(rec.createdAt||'').slice(0,19).replace('T',' ')} · 수정 ${(rec.updatedAt||'').slice(0,19).replace('T',' ')}` })
      ]),
      el('div', { class:'row gap' }, [
        el('button', { class:'btn ghost', text:'복제', onclick: async () => {
          const copy = JSON.parse(JSON.stringify(rec));
          copy.id = entKey === 'scenes' ? DB.makeSceneId((await DB.getProject()).name) : DB.makeId(cfg.idPrefix||'REC');
          // 이미지는 참조만 공유하지 않고 비운다 (삭제 시 원본 유실 방지)
          for (const g of cfg.groups) for (const f of g.fields){
            if (f.t === 'photo') copy[f.k] = null;
            if (f.t === 'photos') copy[f.k] = new Array(f.n||2).fill(null);
          }
          delete copy.createdAt; delete copy.updatedAt;
          if (cfg.autoStamp){ copy[cfg.autoStamp.date] = nowDate(); copy[cfg.autoStamp.time] = nowTime(); }
          await DB.put(cfg.store, copy);
          rows = await DB.list(cfg.store); await drawList(); await select(copy.id);
          toast('복제 완료');
        }}),
        el('button', { class:'btn danger', text:'삭제', onclick: async () => {
          if (!await confirmBox(`${cfg.label} 삭제`, `${rec.id} 을(를) 삭제합니다. 되돌릴 수 없습니다.`, '삭제', true)) return;
          await DB.del(cfg.store, rec.id);
          rows = await DB.list(cfg.store); S.selected = null;
          await drawList(); clear(editPane);
          editPane.appendChild(el('div', { class:'empty', text:'삭제되었습니다.' }));
          toast('삭제 완료', 'warn');
        }}),
      ])
    ]);

    const form = await renderForm(rec, cfg.groups, entKey, () => {
      autosave(cfg.store, rec, async () => {
        rows = await DB.list(cfg.store);
        const node = Array.from(listEl.children).find(n => n.dataset && n.dataset.id === rec.id);
        if (node){ const nn = await rowEl(rec); nn.classList.add('on'); node.replaceWith(nn); }
      });
    });

    editPane.append(head, form);
    editPane.scrollTop = 0;
  }

  await drawList();
  if (S.selected) await select(S.selected);
  else editPane.appendChild(el('div', { class:'empty', text:`좌측에서 ${cfg.label}을(를) 선택하거나 새로 만드세요.` }));
}

/* ===================== 프로젝트 ===================== */

export async function projectView(root){
  clear(root);
  const p = await DB.getProject();
  let t = null;
  const form = await renderForm(p, PROJECT_SCHEMA.groups, 'project', () => {
    clearTimeout(t);
    t = setTimeout(async () => { await DB.setProject(p); toast('프로젝트 저장됨', 'ok', 1200); }, 500);
  });
  root.appendChild(el('div', { class:'pane single' }, [
    el('h2', { text:'프로젝트' }),
    form
  ]));
}

/* ===================== 레퍼런스 ===================== */

export async function refsView(root){
  clear(root);
  const refs = await DB.getRefs();
  const wrap = el('div', { class:'pane single' }, [ el('h2', { text:'레퍼런스 (드롭다운 목록)' }) ]);

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
      const add = el('input', { class:'inp mini', placeholder:'+ 항목 추가 후 Enter' });
      add.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        const v = add.value.trim(); if (!v) return;
        if (!refs[key].includes(v)) refs[key].push(v);
        add.value = ''; await save(); draw();
      });
      cards.appendChild(el('div', { class:'ref-card' }, [
        el('div', { class:'row between' }, [
          el('h4', { text:label }),
          el('code', { class:'dim tiny', text:key })
        ]),
        chips, add
      ]));
    }
    wrap.append(el('h3', { class:'sect', text: grp.title }), cards);
  }
  root.appendChild(wrap);
}

/* ===================== 백업 ===================== */

export async function backupView(root, reload){
  clear(root);
  const info = await DB.storageInfo();
  const pane = el('div', { class:'pane single' });

  const statRows = ENTITY_ORDER.map(k => el('div', { class:'stat' }, [
    el('b', { text: String(info.records[ENTITIES[k].store] ?? 0) }),
    el('span', { text: ENTITIES[k].label })
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
      const text = await f.text();
      const json = JSON.parse(text);
      const stats = await DB.importBackup(json, pendingMode, (m, pc) => p.set(m, pc));
      setRefsCache(await DB.getRefs());
      toast(`가져오기 완료 · 씬 ${stats.scenes} / 로케 ${stats.locations} / 에셋 ${stats.assets} / 카메라 ${stats.cameras} / HDRI ${stats.hdri} / 이미지 ${stats.media}`, 'ok', 5000);
      reload && reload();
    } catch (e){
      toast('가져오기 실패: ' + e.message, 'err', 6000);
    } finally { p.done(); }
  });

  async function doExport(withMedia){
    const p = progress(); p.set('백업 생성 중', 20);
    try {
      const data = await DB.exportBackup(withMedia);
      p.set('직렬화 중', 70);
      const blob = new Blob([JSON.stringify(data)], { type:'application/json' });
      const name = `PMT_온셋_${withMedia?'전체':'경량'}백업_${nowDate()}.json`;
      const a = el('a', { href: URL.createObjectURL(blob), download: name });
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      toast(`${name} (${fmtBytes(blob.size)})`);
    } catch(e){ toast('내보내기 실패: '+e.message, 'err'); }
    finally { p.done(); }
  }

  pane.append(
    el('h2', { text:'백업 / 데이터' }),
    el('div', { class:'stats' }, statRows),
    el('p', { class:'dim', text:`저장소 사용량 ${usage}` }),

    el('h3', { class:'sect', text:'내보내기' }),
    el('div', { class:'row gap wrap' }, [
      el('button', { class:'btn primary', text:'전체 백업 (이미지 포함)', onclick: () => doExport(true) }),
      el('button', { class:'btn', text:'경량 백업 (이미지 제외)', onclick: () => doExport(false) }),
    ]),
    el('p', { class:'dim tiny', text:'전체 백업은 기존 PMT Onset 백업(v3)과 동일한 구조라 상호 호환됩니다.' }),

    el('h3', { class:'sect', text:'가져오기' }),
    el('div', { class:'row gap wrap' }, [
      el('button', { class:'btn', text:'덮어쓰기 가져오기', onclick: async () => {
        if (!await confirmBox('덮어쓰기 가져오기', '현재 기기의 모든 데이터를 지우고 파일 내용으로 교체합니다.', '진행', true)) return;
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
        toast(ok ? '영구 저장 허용됨 (브라우저가 데이터를 임의 삭제하지 않음)' : '브라우저가 거부했습니다', ok ? 'ok' : 'warn', 4000);
      }}),
      el('button', { class:'btn danger', text:'전체 초기화', onclick: async () => {
        if (!await confirmBox('전체 초기화', '이 기기의 모든 데이터가 삭제됩니다. 먼저 백업했는지 확인하세요.', '초기화', true)) return;
        for (const s of DB.RECORD_STORES) await DB.clearStore(s);
        await DB.clearStore('media'); await DB.setProject(DB.DEFAULT_PROJECT);
        toast('초기화 완료', 'warn'); reload && reload();
      }}),
    ]),
  );
  root.appendChild(pane);
}

/* ===================== 대시보드 ===================== */

export async function dashView(root, go){
  clear(root);
  const p = await DB.getProject();
  const counts = {};
  for (const k of ENTITY_ORDER) counts[k] = (await DB.list(ENTITIES[k].store)).length;
  const scenes = await DB.list('scenes');

  const byStatus = {};
  const byEp = {};
  const byVfx = {};
  for (const c of scenes){
    byStatus[c.status || '미지정'] = (byStatus[c.status||'미지정']||0)+1;
    if (c.episode) byEp[c.episode] = (byEp[c.episode]||0)+1;
    if (c.vfxA) byVfx[c.vfxA] = (byVfx[c.vfxA]||0)+1;
  }
  const today = nowDate();
  const todayScenes = scenes.filter(c => c.shootDate === today).length;

  const posterURL = p.poster && p.poster.mid ? await DB.mediaURL(p.poster.mid) : null;

  function bars(obj, cls){
    const max = Math.max(1, ...Object.values(obj));
    return el('div', { class:'bars '+cls },
      Object.entries(obj).sort((a,b)=>b[1]-a[1]).map(([k,v]) => el('div', { class:'bar-row' }, [
        el('span', { class:'bar-k', text:k }),
        el('span', { class:'bar-t' }, [ el('i', { style:`width:${v/max*100}%` }) ]),
        el('b', { text:String(v) })
      ])));
  }

  root.appendChild(el('div', { class:'pane single dash' }, [
    el('div', { class:'proj-head' }, [
      posterURL ? el('img', { class:'poster', src:posterURL, onclick:()=>lightbox(posterURL,p.name) }) : el('div',{class:'poster ph',text:'◧'}),
      el('div', {}, [
        el('h1', { text: p.name || '(프로젝트명 미설정)' }),
        el('div', { class:'dim', text: [p.type, p.productionCompany, p.distributor].filter(Boolean).join(' · ') }),
        el('div', { class:'dim tiny', text: `크랭크인 ${p.crankIn||'—'} · 크랭크업 ${p.crankUp||'—'}` }),
        el('div', { class:'dim tiny', text: `딜리버리 ${[p.deliveryResolution,p.deliveryFps+'fps',p.deliveryCodec].filter(Boolean).join(' / ')}` }),
      ])
    ]),
    el('div', { class:'stats big' }, [
      el('div', { class:'stat click', onclick:()=>go('scenes') }, [ el('b',{text:String(counts.scenes)}), el('span',{text:'씬'}) ]),
      el('div', { class:'stat click', onclick:()=>go('locations') }, [ el('b',{text:String(counts.locations)}), el('span',{text:'로케이션'}) ]),
      el('div', { class:'stat click', onclick:()=>go('hdri') }, [ el('b',{text:String(counts.hdri)}), el('span',{text:'HDRI·조명'}) ]),
      el('div', { class:'stat click', onclick:()=>go('assets') }, [ el('b',{text:String(counts.assets)}), el('span',{text:'에셋'}) ]),
      el('div', { class:'stat click', onclick:()=>go('cameras') }, [ el('b',{text:String(counts.cameras)}), el('span',{text:'카메라'}) ]),
      el('div', { class:'stat' }, [ el('b',{text:String(todayScenes)}), el('span',{text:'오늘 기록'}) ]),
    ]),
    el('div', { class:'dash-grid' }, [
      el('div', { class:'card' }, [ el('h4',{text:'상태별 씬'}), bars(byStatus,'s') ]),
      el('div', { class:'card' }, [ el('h4',{text:'에피소드별 씬'}), bars(byEp,'e') ]),
      el('div', { class:'card' }, [ el('h4',{text:'VFX A 분류'}), bars(byVfx,'v') ]),
    ]),
    el('div', { class:'row gap wrap' }, [
      el('button', { class:'btn primary big', text:'📷 현장 씬 기록 시작', onclick:()=>go('scenes') }),
    ])
  ]));
}
