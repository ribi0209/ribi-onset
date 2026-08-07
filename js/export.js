/* =====================================================================
 * PMT Onset — export.js
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

export async function exportCSV(entKey, rows){
  const cfg = ENTITIES[entKey];
  const cols = cfg.csvCols;
  const head = cols.map(c => labelOf(entKey, c) || c);
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) lines.push(cols.map(c => csvCell(r[c])).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type:'text/csv;charset=utf-8' });
  download(blob, `PMT_${cfg.label}_${nowDate()}.csv`);
  toast(`CSV ${rows.length}행 내보냄`);
}

function download(blob, name){
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

/* ---------------- 인쇄 공통 ---------------- */

function openPrint(node){
  const old = document.getElementById('printroot');
  if (old) old.remove();
  node.id = 'printroot';
  document.body.appendChild(node);
  document.body.classList.add('printing');

  const bar = el('div', { class:'printbar' }, [
    el('button', { class:'btn primary', text:'🖨 인쇄 / PDF 저장', onclick: () => window.print() }),
    el('button', { class:'btn ghost', text:'닫기', onclick: close }),
  ]);
  node.prepend(bar);

  function close(){
    document.body.classList.remove('printing');
    node.remove();
    window.removeEventListener('afterprint', onAfter);
  }
  function onAfter(){ /* 인쇄 후에도 화면 유지 — 사용자가 닫기 */ }
  window.addEventListener('afterprint', onAfter);
  node.scrollIntoView();
}

async function thumbURL(rec, key){
  const v = rec[key];
  if (v && v.mid) return DB.mediaURL(v.mid);
  return null;
}

/* ---------------- 표 형태 인쇄 (모든 엔티티) ---------------- */

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
      el('td', { class:'pcell-id' }, [ el('code', { text: r.id }) ]),
      ...cols.map(c => el('td', { text: r[c] || '' })),
    ]));
  }
  pr.done();

  openPrint(el('div', { class:'printdoc' }, [
    el('header', { class:'phead' }, [
      el('h1', { text: `${p.name || 'PROJECT'} — ${cfg.label} 리스트` }),
      el('div', { class:'dim', text: `${rows.length}건 · 출력 ${nowDate()}` }),
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

/* ---------------- VFX 브레이크다운 시트 ---------------- */

export async function exportBreakdown(scenes){
  const p = await DB.getProject();
  const pr = progress(); pr.set('브레이크다운 생성 중', 20);

  // EP → 씬 순으로 정렬
  const sorted = scenes.slice().sort((a,b) =>
    (a.episode||'').localeCompare(b.episode||'') ||
    (a.scene||'').localeCompare(b.scene||'', 'ko', { numeric:true }));

  const cards = [];
  let i = 0;
  for (const c of sorted){
    i++;
    if (i % 10 === 0) pr.set(`이미지 처리 ${i}/${sorted.length}`, 20 + i/sorted.length*70);
    const main = await thumbURL(c, 'thumbnail');
    const shots = [];
    for (const ph of (c.photos || [])) if (ph && ph.mid) shots.push(await DB.mediaURL(ph.mid));

    cards.push(el('article', { class:'bd-card' }, [
      el('div', { class:'bd-imgs' }, [
        main ? el('img', { class:'bd-main', src:main }) : el('div', { class:'bd-main ph', text:'NO IMAGE' }),
        el('div', { class:'bd-subs' }, shots.map(u => el('img', { src:u })))
      ]),
      el('div', { class:'bd-body' }, [
        el('div', { class:'bd-title' }, [
          el('b', { text: [c.episode, c.scene].filter(Boolean).join(' / ') || '(미지정)' }),
          el('span', { class:'bd-badge', text: c.status || '' }),
          el('span', { class:'bd-badge alt', text: c.vendor || '' }),
        ]),
        el('code', { class:'bd-id', text: c.id }),
        kv([
          ['촬영', [c.shootDate, c.shootTime].filter(Boolean).join(' ')],
          ['유닛', c.unit],
          ['공간', [c.intExt, c.tod, c.location, c.subLocation].filter(Boolean).join(' · ')],
          ['VFX A / B', [c.vfxA, c.vfxB].filter(Boolean).join(' / ')],
          ['작업 요소', c.workElement],
          ['파일명', c.filename],
        ]),
        c.script ? el('p', { class:'bd-note' }, [ el('b',{text:'대본 '}), document.createTextNode(c.script) ]) : null,
        c.shotNote ? el('p', { class:'bd-note' }, [ el('b',{text:'샷 노트 '}), document.createTextNode(c.shotNote) ]) : null,
        c.extraNote ? el('p', { class:'bd-note' }, [ el('b',{text:'메모 '}), document.createTextNode(c.extraNote) ]) : null,
      ])
    ]));
  }
  pr.done();

  openPrint(el('div', { class:'printdoc' }, [
    el('header', { class:'phead' }, [
      el('h1', { text: `${p.name || 'PROJECT'} — VFX BREAKDOWN` }),
      el('div', { class:'dim', text:
        `${sorted.length} scenes · ${[p.deliveryResolution, p.deliveryFps && p.deliveryFps+'fps', p.deliveryColorSpace].filter(Boolean).join(' / ')} · 출력 ${nowDate()}` }),
    ]),
    el('div', { class:'bd-list' }, cards)
  ]));
}

function kv(pairs){
  return el('dl', { class:'bd-kv' }, pairs.flatMap(([k,v]) => v ? [
    el('dt', { text:k }), el('dd', { text:v })
  ] : []));
}
