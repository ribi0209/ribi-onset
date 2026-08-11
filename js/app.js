/* =====================================================================
 * Ribi Onset — app.js  (부트 + 라우터 + 프로젝트 셀렉터)
 * ===================================================================== */

import * as DB from './db.js';
import { NAV, ENTITY_ROUTES, ENTITIES, BUILD } from './schema.js';
import { el, $, clear, toast, setRefsCache } from './ui.js';
import { entityListView, entityDetailView, projectView, overviewView, settingsView, backupView } from './views.js';

/** '#/locations/LOC-1234' → { k:'locations', id:'LOC-1234' }
 *
 * 씬 ID 는 프로젝트명 앞 3글자를 접두사로 쓰므로 한글이 들어갈 수 있다(프로젝-2026…).
 * 브라우저는 location.hash 를 퍼센트 인코딩해서 돌려주기 때문에(%ED%94%84…)
 * 디코드하지 않으면 DB 에서 못 찾아 "기록을 찾을 수 없습니다" 가 된다. */
export function parseRoute(hash){
  const raw = (hash || '#/overview').replace(/^#\//,'');
  const [k, ...rest] = raw.split('/');
  let id = rest.join('/') || null;
  if (id){ try { id = decodeURIComponent(id); } catch { /* 인코딩이 아니면 그대로 */ } }
  return NAV.some(r => r.k === k) ? { k, id } : { k:'overview', id:null };
}
function currentRoute(){ return parseRoute(location.hash); }
function go(path){ location.hash = '#/' + path; }

async function render(){
  const { k, id } = currentRoute();
  for (const b of document.querySelectorAll('.nav-btn')) b.classList.toggle('on', b.dataset.k === k);
  const main = $('#main');
  main.dataset.route = k;
  main.scrollTop = 0;

  if (k === 'project')  return projectView(main, () => boot(true));
  if (k === 'overview') return overviewView(main, go);
  if (k === 'settings') return settingsView(main);
  if (k === 'backup')   return backupView(main, () => boot(true));
  if (ENTITY_ROUTES.includes(k)){
    // inline 엔티티(카메라)는 상세 페이지가 없다 — id 가 붙어도 목록으로
    if (ENTITIES[k] && ENTITIES[k].inline) return entityListView(main, k, go);
    return id ? entityDetailView(main, k, id, go) : entityListView(main, k, go);
  }
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

    if ('serviceWorker' in navigator){
      // 새 버전이 활성화되면 한 번만 자동 새로고침한다.
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        location.reload();
      });
      navigator.serviceWorker.register('./sw.js')
        .then(reg => {
          reg.update();                                  // 접속할 때마다 갱신 확인
          setInterval(() => reg.update(), 10 * 60 * 1000);
        })
        .catch(() => {});
    }
    console.info('Ribi Onset build', BUILD);
    DB.requestPersist().then(ok => { if (!ok) console.warn('persistent storage not granted'); });
    window.addEventListener('offline', () => toast('오프라인 — 로컬 저장은 정상 동작합니다', 'warn', 2500));
    window.RIBI = { DB, render, go };
  }

  await render();
  document.body.dataset.ready = '1';
}

// 테스트에서는 라우터만 꺼내 쓰므로 부팅하지 않는다
if (!globalThis.RIBI_TEST){
  boot().catch(e => {
    document.body.innerHTML = '<pre style="padding:24px;color:#f66;white-space:pre-wrap">부팅 실패\n' + e.stack + '</pre>';
  });
}
