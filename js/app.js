/* =====================================================================
 * PMT Onset — app.js  (부트 + 라우터)
 * ===================================================================== */

import * as DB from './db.js';
import { ENTITIES, ENTITY_ORDER } from './schema.js';
import { el, $, clear, toast, setRefsCache } from './ui.js';
import { entityView, projectView, refsView, backupView, dashView } from './views.js';

const ROUTES = [
  { k:'dash',      label:'대시보드', icon:'▤' },
  ...ENTITY_ORDER.map(k => ({ k, label: ENTITIES[k].label, icon: ENTITIES[k].icon })),
  { k:'project',   label:'프로젝트', icon:'◫' },
  { k:'refs',      label:'레퍼런스', icon:'≡' },
  { k:'backup',    label:'백업',     icon:'⤓' },
];

function currentRoute(){
  const h = (location.hash || '#/dash').replace(/^#\//,'');
  return ROUTES.some(r => r.k === h) ? h : 'dash';
}
function go(k){ location.hash = '#/' + k; }

async function render(){
  const k = currentRoute();
  for (const b of document.querySelectorAll('.nav-btn')) b.classList.toggle('on', b.dataset.k === k);
  const main = $('#main');
  main.dataset.route = k;

  if (k === 'dash')          return dashView(main, go);
  if (k === 'project')       return projectView(main);
  if (k === 'refs')          return refsView(main);
  if (k === 'backup')        return backupView(main, () => render());
  return entityView(main, k);
}

async function boot(){
  await DB.open();
  setRefsCache(await DB.getRefs());

  const p = await DB.getProject();
  $('#projName').textContent = p.name || 'PMT Onset';

  const nav = $('#nav');
  clear(nav);
  for (const r of ROUTES){
    nav.appendChild(el('button', {
      class:'nav-btn', dataset:{ k:r.k }, onclick: () => go(r.k)
    }, [ el('i', { text:r.icon }), el('span', { text:r.label }) ]));
  }

  window.addEventListener('hashchange', render);
  await render();

  // 오프라인 캐시
  if ('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  // 현장 데이터 보호
  DB.requestPersist().then(ok => { if (!ok) console.warn('persistent storage not granted'); });

  window.addEventListener('online',  () => toast('온라인', 'ok', 1200));
  window.addEventListener('offline', () => toast('오프라인 — 로컬 저장은 정상 동작합니다', 'warn', 2500));

  // 디버그/자동 테스트용 훅
  window.PMT = { DB, render, go };
  document.body.dataset.ready = '1';
}

boot().catch(e => {
  document.body.innerHTML = '<pre style="padding:24px;color:#f66">부팅 실패\n' + e.stack + '</pre>';
});
