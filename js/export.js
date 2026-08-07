/* =====================================================================
 * Ribi Onset — export.js
 * CSV / VFX 브레이크다운 시트 / PDF(브라우저 인쇄)
 * 태블릿에서 팝업이 막히므로 새 창을 열지 않고 현재 문서에 인쇄 전용 DOM 을 만든다.
 * Chrome 인쇄 대화상자 → "PDF로 저장" 으로 PDF 생성.
 * ===================================================================== */

import * as DB from './db.js';
import { ENTITIES, labelOf } from './schema.js';
import { el, toast, progress, nowDate } from './ui.js';

/* ---------------- CSV ---------------- */

function csvCell(v){
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
}

function download(blob, name){
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

export async function exportCSV(entKey, rows){
  const cfg = ENTITIES[entKey];
  const p = await DB.getProject();

  // 씬 CSV 는 컷 단위로 펼쳐 내보낸다 (벤더 전달용 실무 포맷)
  if (entKey === 'scenes') return exportSceneCutCSV(rows, p);

  const cols = cfg.csvCols;
  const lines = [cols.map(c => csvCell(labelOf(entKey, c))).join(',')];
  for (const r of rows) lines.push(cols.map(c => csvCell(r[c])).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type:'text/csv;charset=utf-8' });
  download(blob, `${DB.slugOf(p.name)}_${cfg.label}_${nowDate()}.csv`);
  toast(`CSV ${rows.length}행 내보냄`);
}

async function exportSceneCutCSV(scenes, p){
  const allCuts = await DB.list('cuts');
  const bySceneId = {};
  for (const c of allCuts) (bySceneId[c.sceneId] = bySceneId[c.sceneId] || []).push(c);

  const head = ['씬 ID','에피소드','씬','유닛','촬영일','촬영시각','INT/EXT','시간대','로케이션','세부 장소',
                '컷 번호','VFX 샷 ID','작업 타입','작업 요소','상태','벤더',
                '테이크 수','OK 테이크','캠 롤 / 클립','샷 노트','플레이트 요청','씬 노트'];
  const lines = [head.map(csvCell).join(',')];

  const sorted = scenes.slice().sort((a,b) =>
    (a.episode||'').localeCompare(b.episode||'') ||
    (a.scene||'').localeCompare(b.scene||'', 'ko', { numeric:true }));

  for (const s of sorted){
    const cuts = (bySceneId[s.id] || []).sort((a,b) =>
      String(a.cutNo||'').localeCompare(String(b.cutNo||''), 'ko', { numeric:true }));
    const base = [s.id, s.episode, s.scene, s.unit, s.shootDate, s.shootTime,
                  s.intExt, s.tod, s.location, s.subLocation];
    if (!cuts.length){
      lines.push([...base, '', '', '', '', s.status, '', 0, 0, '', '', '', s.shotNote].map(csvCell).join(','));
      continue;
    }
    for (const c of cuts){
      const tk = c.takes || [];
      const clips = tk.map(t => [t.camRoll, t.clip].filter(Boolean).join(' ')).filter(Boolean).join(' / ');
      lines.push([...base,
        c.cutNo, c.vfxShotId, c.vfxType, c.workElement, c.status, c.vendor,
        tk.length, tk.filter(t => t.state === 'OK').length, clips,
        c.shotNote, c.plateNote, s.shotNote].map(csvCell).join(','));
    }
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type:'text/csv;charset=utf-8' });
  download(blob, `${DB.slugOf(p.name)}_SceneCut_${nowDate()}.csv`);
  toast(`CSV ${lines.length-1}행 내보냄 (컷 단위)`);
}

/* ---------------- 인쇄 공통 ---------------- */

function openPrint(node){
  const old = document.getElementById('printroot');
  if (old) old.remove();
  node.id = 'printroot';
  document.body.appendChild(node);
  document.body.classList.add('printing');

  node.prepend(el('div', { class:'printbar' }, [
    el('button', { class:'btn primary', text:'🖨 인쇄 / PDF 저장', onclick: () => window.print() }),
    el('button', { class:'btn ghost', text:'닫기', onclick: () => {
      document.body.classList.remove('printing'); node.remove();
    }}),
  ]));
  node.scrollIntoView();
}

async function thumbURL(rec, key){
  const v = rec && rec[key];
  return (v && v.mid) ? DB.mediaURL(v.mid) : null;
}

/* ---------------- 표 형태 인쇄 ---------------- */

export async function exportPrint(entKey, rows){
  const cfg = ENTITIES[entKey];
  const p = await DB.getProject();
  const cols = cfg.listCols;
  const pr = progress(); pr.set('인쇄 시트 생성 중', 30);

  const trs = [];
  for (const r of rows){
    const url = await thumbURL(r, cfg.thumbField);
    trs.push(el('tr', {}, [
      el('td', { class:'pcell-img' }, [ url ? el('img', { src:url }) : el('span',{class:'dim',text:'—'}) ]),
      el('td', { class:'pcell-id' }, [ el('code', { text:r.id }) ]),
      ...cols.map(c => el('td', { text: r[c] || '' })),
    ]));
  }
  pr.done();

  openPrint(el('div', { class:'printdoc' }, [
    el('header', { class:'phead' }, [
      el('h1', { text:`${p.name || 'PROJECT'} — ${cfg.label} List` }),
      el('div', { class:'dim', text:`${rows.length}건 · 출력 ${nowDate()}` }),
    ]),
    el('table', { class:'ptable' }, [
      el('thead', {}, [ el('tr', {}, [
        el('th', { text:'이미지' }), el('th', { text:'ID' }),
        ...cols.map(c => el('th', { text: labelOf(entKey, c) })),
      ])]),
      el('tbody', {}, trs)
    ])
  ]));
}

/* ---------------- VFX 브레이크다운 (씬 → 컷 → 테이크) ---------------- */

export async function exportBreakdown(scenes){
  const p = await DB.getProject();
  const pr = progress(); pr.set('브레이크다운 생성 중', 10);

  const allCuts = await DB.list('cuts');
  const bySceneId = {};
  for (const c of allCuts) (bySceneId[c.sceneId] = bySceneId[c.sceneId] || []).push(c);

  const sorted = scenes.slice().sort((a,b) =>
    (a.episode||'').localeCompare(b.episode||'') ||
    (a.scene||'').localeCompare(b.scene||'', 'ko', { numeric:true }));

  const blocks = [];
  let i = 0, cutTotal = 0;
  for (const s of sorted){
    i++;
    pr.set(`이미지 처리 ${i}/${sorted.length}`, 10 + i/sorted.length*80);
    const main = await thumbURL(s, 'thumbnail');
    const shots = [];
    for (const ph of (s.photos || [])) if (ph && ph.mid) shots.push(await DB.mediaURL(ph.mid));

    const cuts = (bySceneId[s.id] || []).sort((a,b) =>
      String(a.cutNo||'').localeCompare(String(b.cutNo||''), 'ko', { numeric:true }));
    cutTotal += cuts.length;

    const cutRows = [];
    for (const c of cuts){
      const curl = await thumbURL(c, 'thumbnail');
      const tk = c.takes || [];
      cutRows.push(el('tr', {}, [
        el('td', { class:'pcell-img' }, [ curl ? el('img', { src:curl }) : el('span',{class:'dim',text:'—'}) ]),
        el('td', {}, [ el('b', { text:'C' + (c.cutNo || '?') }),
                       c.vfxShotId ? el('div',{class:'dim',text:c.vfxShotId}) : null ]),
        el('td', {}, [ el('span', { class:'bd-badge', text:c.vfxType || '—' }) ]),
        el('td', { text:c.workElement || '' }),
        el('td', { text:c.status || '' }),
        el('td', { text:c.vendor || '' }),
        el('td', { text: tk.length ? `${tk.length} (OK ${tk.filter(t=>t.state==='OK').length})` : '—' }),
        el('td', { text: tk.map(t => [t.camRoll,t.clip].filter(Boolean).join(' ')).filter(Boolean).join(', ') }),
        el('td', { text:[c.shotNote, c.plateNote].filter(Boolean).join(' / ') }),
      ]));
    }

    blocks.push(el('article', { class:'bd-card' }, [
      el('div', { class:'bd-imgs' }, [
        main ? el('img', { class:'bd-main', src:main }) : el('div', { class:'bd-main ph', text:'NO IMAGE' }),
        el('div', { class:'bd-subs' }, shots.slice(0,4).map(u => el('img', { src:u })))
      ]),
      el('div', { class:'bd-body' }, [
        el('div', { class:'bd-title' }, [
          el('b', { text:[s.episode, s.scene].filter(Boolean).join(' / ') || '(미지정)' }),
          el('span', { class:'bd-badge', text:s.status || '' }),
          el('span', { class:'dim', text:`컷 ${cuts.length}` }),
        ]),
        el('code', { class:'bd-id', text:s.id }),
        el('dl', { class:'bd-kv' }, [
          ['촬영', [s.shootDate, s.shootTime].filter(Boolean).join(' ')],
          ['유닛', s.unit],
          ['공간', [s.intExt, s.tod, s.location, s.subLocation].filter(Boolean).join(' · ')],
        ].flatMap(([k,v]) => v ? [el('dt',{text:k}), el('dd',{text:v})] : [])),
        s.script   ? el('p', { class:'bd-note' }, [ el('b',{text:'대본 '}), document.createTextNode(s.script) ]) : null,
        s.shotNote ? el('p', { class:'bd-note' }, [ el('b',{text:'씬 노트 '}), document.createTextNode(s.shotNote) ]) : null,
        cutRows.length ? el('table', { class:'ptable bd-cuts' }, [
          el('thead', {}, [ el('tr', {}, ['','컷','타입','요소','상태','벤더','테이크','클립','노트']
            .map(h => el('th', { text:h }))) ]),
          el('tbody', {}, cutRows)
        ]) : el('p', { class:'bd-note dim', text:'등록된 컷 없음' }),
      ])
    ]));
  }
  pr.done();

  openPrint(el('div', { class:'printdoc' }, [
    el('header', { class:'phead' }, [
      el('h1', { text:`${p.name || 'PROJECT'} — VFX BREAKDOWN` }),
      el('div', { class:'dim', text:
        `${sorted.length} scenes / ${cutTotal} cuts · ${[p.deliveryResolution, p.deliveryFps && p.deliveryFps+'fps', p.deliveryColorSpace].filter(Boolean).join(' / ')} · 출력 ${nowDate()}` }),
    ]),
    el('div', { class:'bd-list' }, blocks)
  ]));
}
