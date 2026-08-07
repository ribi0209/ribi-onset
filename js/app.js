/* =====================================================================
 * Ribi Onset — app.js  (부트 + 라우터 + 프로젝트 셀렉터)
 * ===================================================================== */

import * as DB from './db.js';
import { NAV, ENTITY_ROUTES } from './schema.js';
import { el, $, clear, toast, setRefsCache } from './ui.js';
import { entityView, projectView, overviewView, settingsView, backupView } from './views.js';

function currentRoute(){
  const h = (location.hash || '#/overview').replace(/^#\//,'');
  return NAV.some(r => r.k === h) ? h : 'overview';
}
function go(k){ location.hash = '#/' + k; }

async function render(){
  const k = currentRoute();
  for (const b of document.querySelectorAll('.nav-btn')) b.classList.toggle('on', b.dataset.k === k);
  const main = $('#main');
  main.dataset.route = k;

  if (k === 'project')  return projectView(main, () => boot(true));
  if (k === 'overview') return overviewView(main, go);
  if (k === 'settings') return settingsView(main);
  if (k === 'backup')   return backupView(main, () => boot(true));
  if (ENTITY_ROUTES.includes(k)) return entityView(main, k);
  return overviewView(main, go);
}

/* ---------------- 프로젝트 셀렉터 ---------------- */

async function buildProjectSelector(){
  const host = $('#projPick');
  clear(host);
  const all = await DB.listProjects();
  const cur = await DB.currentProjectId();

  const sel = el('select', { id:'projSel', class:'inp mini proj-sel', title:'프로젝트 전환' });
  for (const p of all){
    sel.appendChild(el('option', { value:p.id, text:p.name || '(이름 없음)' }));
  }
  sel.value = cur;
  sel.addEventListener('change', async () => {
    await DB.setCurrentProject(sel.value);
    toast(`프로젝트 전환: ${sel.options[sel.selectedIndex].textContent}`, 'ok', 1400);
    await render();
  });

  host.append(
    sel,
    el('button', {
      class:'btn tiny', title:'새 프로젝트', text:'+',
      onclick: async () => {
        const p = await DB.createProject({ name:'새 프로젝트' });
        await buildProjectSelector();
        go('project');
        await render();
        toast('새 프로젝트 생성 — 이름을 입력하세요');
      }
    })
  );
}

/* ---------------- 부트 ---------------- */

async function boot(again = false){
  await DB.open();
  await DB.currentProjectId();          // 없으면 기본 프로젝트 생성
  setRefsCache(await DB.getRefs());
  await buildProjectSelector();

  if (!again){
    const nav = $('#nav');
    clear(nav);
    for (const r of NAV){
      nav.appendChild(el('button', {
        class:'nav-btn', dataset:{ k:r.k }, onclick: () => go(r.k)
      }, [ el('i', { text:r.icon }), el('span', { text:r.label }) ]));
    }
    window.addEventListener('hashchange', render);

    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
    DB.requestPersist().then(ok => { if (!ok) console.warn('persistent storage not granted'); });
    window.addEventListener('offline', () => toast('오프라인 — 로컬 저장은 정상 동작합니다', 'warn', 2500));
    window.RIBI = { DB, render, go };
  }

  await render();
  document.body.dataset.ready = '1';
}

boot().catch(e => {
  document.body.innerHTML = '<pre style="padding:24px;color:#f66;white-space:pre-wrap">부팅 실패\n' + e.stack + '</pre>';
});
