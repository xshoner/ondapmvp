// 고객: 첫 화면·결과 화면 (잘못된 주소 값, 장례 차분 모드, 합계·배송비, 조건 칩, 빼고 다시, 비교표, 찜·지난 조건, 전체 예산, 공유 그림)
import { launch } from './cdp.mjs';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3000';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK ' : 'NG '} ${name}${detail ? ' — ' + detail : ''}`); };

const b = await launch({ port: 9335, mobile: true });
try {
  // 잘못된 주소 값도 안전하게
  await b.goto(`${BASE}/result?event=wedding&relation=business&budget=abc&qty=-5&exclude=foo,,0,7`);
  const bad = await b.evaluate(`return { chips: [...document.querySelectorAll('.cond summary')].map((s) => s.textContent), pick: Boolean(document.querySelector('.pick')), note: document.querySelector('.result-note').textContent }`);
  check('잘못된 예산·수량·뺀 상품 값 정리', bad.chips.join('|') === '결혼|거래처/공식|예산 상관없음|1개' && bad.pick, JSON.stringify(bad));

  // 장례: 차분한 화면
  await b.goto(`${BASE}/result?event=funeral&relation=senior&qty=50&budget=50000`);
  const calm = await b.evaluate(`return { cls: document.querySelector('main').className, h1: document.querySelector('h1').textContent, seal: getComputedStyle(document.querySelector('.seal')).backgroundColor, anim: getComputedStyle(document.querySelector('.seal')).animationName }`);
  check('장례 차분 모드', calm.cls.includes('mood-calm') && calm.h1.startsWith('조문해 주신') && calm.seal === 'rgb(74, 82, 77)' && calm.anim === 'none', JSON.stringify(calm));

  // 배송비 합계
  const price = await b.evaluate(`return [...document.querySelectorAll('.price-table span')].map((s) => s.textContent)`);
  check('합계에 배송비·예상 결제 금액', price.includes('배송비') && price.includes('예상 결제 금액'), price.join(' '));

  // 조건 칩 → 다른 행사로
  const wedHref = await b.evaluate(`return [...document.querySelectorAll('.cond-pop a')].find((a) => a.textContent === '결혼').getAttribute('href')`);
  check('조건 칩 링크', wedHref === '/result?event=wedding&relation=senior&qty=50&budget=50000', wedHref);

  // 조건 창: 바깥 누르면 닫힘
  await b.evaluate(`document.querySelectorAll('.cond summary')[2].click()`);
  await b.sleep(100);
  const opened = await b.evaluate(`return document.querySelectorAll('details.cond[open]').length`);
  await b.evaluate(`document.querySelector('h1').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
  await b.sleep(100);
  check('조건 창 바깥 누르면 닫힘', opened === 1 && (await b.evaluate(`return document.querySelectorAll('details.cond[open]').length`)) === 0);

  // 빼고 다시 → 되돌리기
  const first = await b.evaluate(`return document.querySelector('.pick-name').textContent`);
  const exHref = await b.evaluate(`return document.querySelector('.exclude-link').getAttribute('href')`);
  await b.goto(BASE + exHref);
  const second = await b.evaluate(`return { name: document.querySelector('.pick-name')?.textContent, undo: [...document.querySelectorAll('.result-note a')].map((a) => a.textContent) }`);
  check('이 상품 빼고 다시', second.name !== first && second.undo.includes('모두 되돌리기'), `${first} → ${second.name}`);

  // 비교표
  const cmp = await b.evaluate(`return { cols: document.querySelectorAll('.compare-table thead th').length, rows: [...document.querySelectorAll('.compare-table tbody th')].map((t) => t.textContent) }`);
  check('세 상품 비교표', cmp.cols >= 2 && cmp.rows.includes('지역 상생'), JSON.stringify(cmp));

  // 찜 → 첫 화면에 표시, 지난 조건 이어 하기
  await b.evaluate(`document.querySelector('.save-pick').click()`);
  await b.sleep(200);
  await b.goto(`${BASE}/`);
  await b.waitFor(`document.querySelector('.saved-picks') && document.querySelector('.resume-card')`);
  const home = await b.evaluate(`return { picks: document.querySelector('.saved-picks summary').textContent, resume: document.querySelector('.resume-card a').getAttribute('href') }`);
  check('첫 화면: 찜·지난 조건', home.picks.includes('1개') && home.resume.startsWith('/result?event=funeral'), JSON.stringify(home));

  // 전체 예산 → 1개당
  await b.evaluate(`[...document.querySelectorAll('.occasion')][1].click(); [...document.querySelectorAll('.choice-list button')][0].click(); [...document.querySelectorAll('.seg button')][1].click();`);
  await b.sleep(200);
  await b.evaluate(`const el = document.querySelector('.money-input input'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, '1,500,000원'); el.dispatchEvent(new Event('input', { bubbles: true }));`);
  await b.sleep(200);
  const total = await b.evaluate(`return { v: document.querySelector('.money-input input').value, hint: document.querySelector('.total-budget p').textContent, summary: document.querySelector('.summary-line').textContent }`);
  check('전체 예산 ÷ 수량', total.v === '1500000' && total.hint.includes('1개당 150,000원'), JSON.stringify(total));

  // 공유 그림
  for (const q of ['event=funeral&relation=senior&qty=50&budget=50000', 'event=wedding&relation=business&qty=10&exclude=49']) {
    const r = await fetch(`${BASE}/og/result?${q}`);
    check(`공유 그림 ${q.split('&')[0]}`, r.ok && r.headers.get('content-type') === 'image/png', `${r.status} ${r.headers.get('content-type')}`);
  }
} catch (e) {
  check('중단', false, e.message);
} finally {
  console.log('--- 콘솔 오류:', b.logs.length ? '\n' + b.logs.join('\n') : '없음');
  await b.close();
}
console.log(`\n${results.filter(Boolean).length}/${results.length} 통과`);
process.exitCode = results.every(Boolean) ? 0 : 1;
