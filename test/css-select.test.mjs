/* 드롭다운 표시 검증 (CSS 우선순위)
 *
 * 실제로 났던 문제
 *  1) select.inp 에 padding-right:26px 를 줬는데 .inp.mini / .inp.cell 의 padding 축약형이
 *     클래스 수가 많아 우선순위에서 이겨 버렸다 → 글자가 화살표 밑으로 파고들었다.
 *  2) 에셋(link) 필드의 추가 드롭다운만 'inp mini' 라서 옆 칸보다 작고 폭이 자동이었다.
 * 눈으로는 잘 안 보이는 종류라 우선순위를 직접 계산해서 고정한다.
 */
import fs from 'node:fs';
// 주석을 지우고 파싱한다. 안 그러면 주석이 바로 뒤 규칙의 선택자에 붙어 규칙이 통째로 누락된다.
const css = fs.readFileSync('../css/app.css','utf8').replace(/\/\*[\s\S]*?\*\//g, '');
let fail=0; const ok=(c,m)=>{ console.log((c?'  PASS ':'  FAIL ')+m); if(!c) fail++; };

/** 규칙들을 순서대로 뽑는다 */
function rules(){
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))){
    const sels = m[1].split(',').map(s=>s.trim()).filter(Boolean);
    for (const sel of sels) out.push({ sel, body:m[2], idx: out.length });
  }
  return out;
}
/** (id, class, element) 명시도 */
function spec(sel){
  const id  = (sel.match(/#[\w-]+/g)||[]).length;
  const cls = (sel.match(/\.[\w-]+|\[[^\]]+\]|:[a-z-]+/g)||[]).length;
  const ele = (sel.match(/(^|[\s>+~])[a-z]+/g)||[]).length;
  return [id, cls, ele];
}
const cmp = (a,b) => a[0]-b[0] || a[1]-b[1] || a[2]-b[2];

/** 해당 클래스 조합의 엘리먼트에 최종 적용되는 padding-right 를 구한다 */
function paddingRight(tag, classes){
  // "선택적 태그 + 클래스들" 형태만 본다.
  // 느슨하게 두면 #nav 같은 id 규칙까지 걸려서 엉뚱한 값이 이긴다 (실제로 그랬다).
  const SIMPLE = /^([a-z]+)?(\.[\w-]+)+$/;
  const has = (sel) => {
    const t = sel.trim();
    if (!SIMPLE.test(t)) return false;
    const tag2 = (t.match(/^[a-z]+/) || [])[0];
    if (tag2 && tag2 !== tag) return false;
    return (t.match(/\.[\w-]+/g) || []).every(c => classes.includes(c.slice(1)));
  };
  let best = null;
  for (const r of rules()){
    if (!has(r.sel)) continue;
    const pr = r.body.match(/padding-right\s*:\s*([^;]+)/);
    const pd = r.body.match(/(?:^|;)\s*padding\s*:\s*([^;]+)/);
    let val = null;
    if (pr) val = pr[1].trim();
    else if (pd){
      const parts = pd[1].trim().split(/\s+/);
      val = parts.length === 1 ? parts[0] : parts.length === 2 ? parts[1] : parts[3] || parts[1];
    }
    if (val == null) continue;
    const s = spec(r.sel);
    if (!best || cmp(s, best.s) >= 0) best = { val, s, idx:r.idx };
  }
  return best && best.val;
}

const px = (v) => parseFloat(String(v)) || 0;

console.log('== 드롭다운 글자가 화살표를 침범하지 않는가 ==');
{
  // 화살표는 오른쪽 4~14px 구간에 그려진다. 여백이 그보다 좁으면 겹친다.
  const cases = [
    ['일반 셀렉트',        ['inp'],          20],
    ['필터바/작은 셀렉트', ['inp','mini'],   18],
    ['표 안 셀렉트',       ['inp','cell'],   16],
  ];
  for (const [name, classes, min] of cases){
    const v = paddingRight('select', classes);
    ok(v !== null && px(v) >= min, `${name} padding-right = ${v} (≥ ${min}px 필요)`);
  }
  // 입력칸(input)은 화살표가 없으므로 제약 없음 — 셀렉트에만 걸려야 한다
  ok(px(paddingRight('select', ['inp','mini'])) > px(paddingRight('input', ['inp','mini']) || 8),
     '셀렉트만 여백이 넓다 (입력칸은 그대로)');
}

console.log('== 에셋(연결) 드롭다운이 옆 칸과 같은 형식인가 ==');
{
  const ui = fs.readFileSync('../js/ui.js','utf8');
  const m = ui.match(/const sel = el\('select', \{ class:'([^']+)' \}\);\s*\n\s*sel\.appendChild\(el\('option', \{ value:'', text:`\+ \$\{cfg\.labelKo\}/);
  ok(!!m, '연결 위젯의 추가 드롭다운을 찾음');
  ok(m && !m[1].includes('mini'), `class = "${m && m[1]}" — mini 아님 (옆 칸과 같은 높이·폭)`);
  ok(/\.link-wrap\{[^}]*flex-direction:column/.test(css), '연결 위젯은 칩 줄 + 드롭다운을 세로로 쌓는다');
  ok(/\.link-wrap\.backlink\{[^}]*flex-direction:row/.test(css), '읽기 전용 역방향 목록은 가로 배치 유지');
}

console.log('== 노트 칸은 한 줄로 끊는다 ==');
{
  const m = css.match(/td\.note\{([^}]*)\}/);
  ok(!!m, '노트 칸 규칙 존재');
  const body = (m ? m[1] : '').replace(/\s+/g,'');
  ok(body.includes('white-space:nowrap'), '한 줄로 유지');
  ok(body.includes('text-overflow:ellipsis'), '넘치면 … 로 끊음');
  ok(!body.includes('line-clamp'), '두 줄 클램프는 제거됨');
}

console.log('== 자르기 화면이 아래 버튼을 덮지 않는가 ==');
{
  // 실제로 났던 문제: 선택 영역 바깥을 덮는 9999px 그림자가 화면 밖까지 번져
  // "이 영역 사용" 버튼까지 검게 덮였다 → 비활성처럼 보였다.
  const stage = (css.match(/\.crop-stage\{([^}]*)\}/) || [,''])[1].replace(/\s+/g,'');
  ok(/overflow:hidden/.test(stage), '무대 밖으로 그림자가 새지 않게 잘라 낸다');
  const box = (css.match(/\.crop-box\{([^}]*)\}/) || [,''])[1].replace(/\s+/g,'');
  ok(/box-shadow:0 ?0 ?0 ?9999px/.test(box.replace(/;/g,';')) || box.includes('box-shadow'),
     '선택 영역 바깥은 여전히 어둡게 표시');

  // 모서리 핸들이 무대 밖으로 튀어나가면 위 overflow:hidden 에 잘린다
  const h = (css.match(/\.crop-h\{([^}]*)\}/) || [,''])[1].replace(/\s+/g,'');
  ok(!/margin:-/.test(h), '핸들은 음수 여백으로 밖으로 빼지 않는다 (잘림 방지)');
  for (const c of ['nw','ne','sw','se'])
    ok(new RegExp('\\.crop-h\\.'+c+'\\{').test(css.replace(/\s+/g,'')), `${c} 핸들 위치 지정`);
  ok(!/\.crop-h\.(ne|sw|se)\{[^}]*left:100%/.test(css), '핸들이 상자 밖(100%)에 놓이지 않는다');
}

console.log('== 사진 버튼이 무슨 기능인지 알아볼 수 있는가 ==');
{
  const ui = fs.readFileSync('../js/ui.js','utf8');
  ok(/class:'photo-ocr'[^}]*text:'[^']*OCR'/.test(ui), 'OCR 버튼에 글자 표시 (⌁ 만으로는 모른다)');
  ok(/class:'photo-crop'[^}]*text:'[^']*자르기'/.test(ui), '자르기 버튼에 글자 표시');
  // 옛 규칙(우상단 28px 정사각)이 남아 있으면 새 규칙과 자리·크기가 충돌한다
  ok(!/\.photo-ocr\{[^}]*right:36px/.test(css.replace(/\s+/g,'')), '옛 .photo-ocr 규칙 제거됨');
}

console.log(fail?`\n### 실패 ${fail}건`:'\n### 전체 통과');
process.exit(fail?1:0);
