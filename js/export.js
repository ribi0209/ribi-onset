/* =====================================================================
 * Ribi Onset — export.js
 * CSV / VFX 브레이크다운 시트 / PDF(브라우저 인쇄)
 * 태블릿에서 팝업이 막히므로 새 창을 열지 않고 현재 문서에 인쇄 전용 DOM 을 만든다.
 * Chrome 인쇄 대화상자 → "PDF로 저장" 으로 PDF 생성.
 * ===================================================================== */

import * as DB from './db.js';
import { ENTITIES, labelOf, displayName, thumbOf, usedCams } from './schema.js';
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
  // recordRef 는 id 대신 이름으로 내보낸다
  const refMaps = {};
  for (const g of cfg.groups) for (const f of g.fields){
    if (f.t === 'recordRef' && cols.includes(f.k)){
      refMaps[f.k] = Object.fromEntries((await DB.list(f.to)).map(r => [r.id, displayName(f.to, r)]));
    }
  }
  const lines = [cols.map(c => csvCell(labelOf(entKey, c))).join(',')];
  for (const r of rows)
    lines.push(cols.map(c => csvCell(refMaps[c] ? (refMaps[c][r[c]] || '') : r[c])).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type:'text/csv;charset=utf-8' });
  download(blob, `${DB.slugOf(p.name)}_${cfg.label}_${nowDate()}.csv`);
  toast(`CSV ${rows.length}행 내보냄`);
}

async function exportSceneCutCSV(scenes, p){
  // 씬 CSV 는 캠(A~D) 단위로 펼쳐 내보낸다 — 한 줄 = 한 카메라의 기록
  const locName = Object.fromEntries((await DB.list('locations')).map(l => [l.id, displayName('locations', l)]));

  const head = ['씬 ID','에피소드','씬','촬영일','촬영시각','INT/EXT','시제','로케이션','벤더',
                '캠','촬영 유닛','작업 타입','캠 롤','클립','사진 수','씬 노트','메모'];
  const lines = [head.map(csvCell).join(',')];

  const sorted = scenes.slice().sort((a,b) =>
    (a.episode||'').localeCompare(b.episode||'') ||
    (a.scene||'').localeCompare(b.scene||'', 'ko', { numeric:true }));

  let n = 0;
  for (const s of sorted){
    const base = [s.id, s.episode, s.scene, s.shootDate, s.shootTime,
                  s.intExt, s.tod, locName[s.locationId] || s.legacyLocationName || '', s.vendor];
    const cams = usedCams('scenes', s);
    if (!cams.length){
      lines.push([...base, '', '', '', '', '', 0, s.shotNote, s.extraNote].map(csvCell).join(','));
      n++;
      continue;
    }
    for (const c of cams){
      const d = (s.cams || {})[c] || {};
      const nPhoto = (d.thumbnail && d.thumbnail.mid ? 1 : 0)
                   + (Array.isArray(d.photos) ? d.photos.filter(x => x && x.mid).length : 0);
      lines.push([...base, c, d.unit, d.vfxType, d.camRoll, d.clip, nPhoto,
                  s.shotNote, s.extraNote].map(csvCell).join(','));
      n++;
    }
  }
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type:'text/csv;charset=utf-8' });
  download(blob, `${DB.slugOf(p.name)}_SceneCam_${nowDate()}.csv`);
  toast(`CSV ${n}행 내보냄 (캠 단위)`);
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

async function mediaOf(v){ return (v && v.mid) ? DB.mediaURL(v.mid) : null; }
async function thumbURL(entKey, rec){ return mediaOf(thumbOf(entKey, rec)); }

/* ---------------- 표 형태 인쇄 ---------------- */

export async function exportPrint(entKey, rows){
  const cfg = ENTITIES[entKey];
  const p = await DB.getProject();
  const cols = cfg.listCols;
  const pr = progress(); pr.set('인쇄 시트 생성 중', 30);

  const trs = [];
  for (const r of rows){
    const url = await thumbURL(entKey, r);
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

/* ---------------- 씬 브레이크다운 (씬 → 캠) ---------------- */

export async function exportBreakdown(scenes){
  const p = await DB.getProject();
  const pr = progress(); pr.set('브레이크다운 생성 중', 10);

  const locName = Object.fromEntries((await DB.list('locations')).map(l => [l.id, displayName('locations', l)]));
  const assets  = Object.fromEntries((await DB.list('assets')).map(a => [a.id, displayName('assets', a)]));

  const sorted = scenes.slice().sort((a,b) =>
    (a.episode||'').localeCompare(b.episode||'') ||
    (a.scene||'').localeCompare(b.scene||'', 'ko', { numeric:true }));

  const blocks = [];
  let i = 0, camTotal = 0, vfxTotal = 0;
  for (const s of sorted){
    i++;
    pr.set(`이미지 처리 ${i}/${sorted.length}`, 10 + i/sorted.length*80);

    const cams = usedCams('scenes', s);
    camTotal += cams.length;
    vfxTotal += cams.filter(c => ((s.cams||{})[c]||{}).vfxType).length;
    const main = await thumbURL('scenes', s);

    // 캠별 행 + 그 캠의 현장 사진
    const camRows = [];
    const shots = [];
    for (const c of cams){
      const d = (s.cams || {})[c] || {};
      const curl = await mediaOf(d.thumbnail);
      for (const ph of (d.photos || [])) if (ph && ph.mid) shots.push(await DB.mediaURL(ph.mid));
      const nPhoto = (d.thumbnail && d.thumbnail.mid ? 1 : 0)
                   + (Array.isArray(d.photos) ? d.photos.filter(x => x && x.mid).length : 0);
      camRows.push(el('tr', {}, [
        el('td', { class:'pcell-img' }, [ curl ? el('img', { src:curl }) : el('span',{class:'dim',text:'—'}) ]),
        el('td', {}, [ el('span', { class:'bd-badge', text:c + '캠' }) ]),
        el('td', { text:d.unit || '' }),
        el('td', {}, [ el('span', { class:'bd-badge', text:d.vfxType || '—' }) ]),
        el('td', { text:d.camRoll || '' }),
        el('td', { text:d.clip || '' }),
        el('td', { text: nPhoto ? nPhoto + '장' : '—' }),
      ]));
    }

    const links = (s.linkedAssetIds || []).map(id => assets[id]).filter(Boolean).join(', ');

    blocks.push(el('article', { class:'bd-card' }, [
      el('div', { class:'bd-imgs' }, [
        main ? el('img', { class:'bd-main', src:main }) : el('div', { class:'bd-main ph', text:'NO IMAGE' }),
        el('div', { class:'bd-subs' }, shots.slice(0,4).map(u => el('img', { src:u })))
      ]),
      el('div', { class:'bd-body' }, [
        el('div', { class:'bd-title' }, [
          el('b', { text:[s.episode, s.scene].filter(Boolean).join(' / ') || '(미지정)' }),
          el('span', { class:'dim', text:`캠 ${cams.length}` }),
        ]),
        el('code', { class:'bd-id', text:s.id }),
        el('dl', { class:'bd-kv' }, [
          ['촬영', [s.shootDate, s.shootTime].filter(Boolean).join(' ')],
          ['공간', [s.intExt, s.tod, locName[s.locationId] || s.legacyLocationName].filter(Boolean).join(' · ')],
          ['벤더', s.vendor],
          ['에셋', links],
        ].flatMap(([k,v]) => v ? [el('dt',{text:k}), el('dd',{text:v})] : [])),
        s.shotNote  ? el('p', { class:'bd-note' }, [ el('b',{text:'씬 노트 '}), document.createTextNode(s.shotNote) ]) : null,
        s.extraNote ? el('p', { class:'bd-note' }, [ el('b',{text:'메모 '}),   document.createTextNode(s.extraNote) ]) : null,
        camRows.length ? el('table', { class:'ptable bd-cuts' }, [
          el('thead', {}, [ el('tr', {}, ['','캠','유닛','작업 타입','캠 롤','클립','사진']
            .map(h => el('th', { text:h }))) ]),
          el('tbody', {}, camRows)
        ]) : el('p', { class:'bd-note dim', text:'기록된 캠 없음' }),
      ])
    ]));
  }
  pr.done();

  openPrint(el('div', { class:'printdoc' }, [
    el('header', { class:'phead' }, [
      el('h1', { text:`${p.name || 'PROJECT'} — SCENE BREAKDOWN` }),
      el('div', { class:'dim', text:
        `${sorted.length} scenes / ${camTotal} cam records / ${vfxTotal} VFX · ${[p.deliveryResolution, p.deliveryFps && p.deliveryFps+'fps', p.deliveryColorSpace].filter(Boolean).join(' / ')} · 출력 ${nowDate()}` }),
    ]),
    el('div', { class:'bd-list' }, blocks)
  ]));
}
