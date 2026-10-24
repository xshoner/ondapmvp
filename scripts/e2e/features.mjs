// 고객 의견·실적 A4 인쇄·수량 칸·관리자 입력 칸·스티커 레이어 제한·저장 목록 방어
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './cdp.mjs';

const root = process.argv[2];
const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3000';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK ' : 'NG '} ${name}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`); };
const click = (sel, text) => `{ const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => ${text ? `e.textContent.includes(${JSON.stringify(text)})` : 'true'}); if (!el) throw new Error('없음: ${sel} ${text ?? ''}'); el.click(); }`;
const key = (b, k, opts = {}) => b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: opts.code, modifiers: opts.mod ?? 0, windowsVirtualKeyCode: opts.vk })
  .then(() => b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: opts.code, modifiers: opts.mod ?? 0, windowsVirtualKeyCode: opts.vk }));
const typeText = (b, text) => b.send('Input.insertText', { text });
const selectAllAndDelete = async (b) => { await key(b, 'a', { code: 'KeyA', mod: 2, vk: 65 }); await key(b, 'Backspace', { code: 'Backspace', vk: 8 }); };
const feedbackFile = join(root, 'data/feedback.json');
const feedbackCount = () => (existsSync(feedbackFile) ? JSON.parse(readFileSync(feedbackFile, 'utf8')).length : 0);

// ---------------- 고객 (휴대폰) ----------------
{
  const b = await launch({ port: 9351, mobile: true });
  try {
    // 수량 칸: 지우고 다시 칠 수 있다
    await b.goto(`${BASE}/`);
    await b.waitFor(`document.querySelector('#qty')`);
    await b.evaluate(`localStorage.clear(); const q = document.querySelector('#qty'); q.focus();`);
    await selectAllAndDelete(b);
    await b.sleep(150);
    const emptied = await b.evaluate(`return document.querySelector('#qty').value`);
    await typeText(b, '30');
    await b.sleep(200);
    const typed = await b.evaluate(`return document.querySelector('#qty').value`);
    await b.evaluate(`document.querySelector('button[aria-label="수량 늘리기"]').click()`);
    await b.sleep(150);
    const plus = await b.evaluate(`return document.querySelector('#qty').value`);
    check('첫 화면 수량: 지우면 빈 칸, 30을 치면 30 (+ 누르면 40)', emptied === '' && typed === '30' && plus === '40', JSON.stringify({ emptied, typed, plus }));
    await b.evaluate(`const q = document.querySelector('#qty'); q.focus();`);
    await selectAllAndDelete(b);
    await b.evaluate(`document.querySelector('#qty').blur()`);
    await b.sleep(150);
    check('첫 화면 수량: 비운 채 벗어나면 마지막 값으로', (await b.evaluate(`return document.querySelector('#qty').value`)) === '40');

    // 추천 의견
    const before = feedbackCount();
    await b.goto(`${BASE}/result?event=opening&relation=business&qty=20&budget=50000`);
    await b.waitFor(`document.querySelector('.feedback')`);
    await b.click('.feedback button', '아쉬워요');
    await b.waitFor(`document.querySelector('.feedback .chip')`);
    await b.click('.feedback .chip', '가격이 맞지 않아요');
    await b.click('.feedback .chip', '원하는 종류가 없어요');
    await b.click('.feedback button', '보내기');
    await b.waitFor(`document.querySelector('.feedback')?.textContent.includes('의견 고맙습니다')`);
    const saved = JSON.parse(readFileSync(feedbackFile, 'utf8')).at(-1);
    check('의견 보내기 → 저장(행사·관계·예산·수량·이유)', feedbackCount() === before + 1 && saved.event === 'opening' && saved.relation === 'business' && saved.budgetMax === 50000 && saved.quantity === 20 && saved.helpful === false && saved.reasons.join(',') === 'price,kind' && saved.resultProductNos.length === 3, JSON.stringify(saved));
    await b.goto(`${BASE}/result?event=opening&relation=business&qty=20&budget=50000`);
    await b.sleep(800);
    check('같은 결과에는 다시 묻지 않음', !(await b.evaluate(`return Boolean(document.querySelector('.feedback'))`)));
    await b.goto(`${BASE}/result?event=opening&relation=senior&qty=20&budget=50000`);
    await b.waitFor(`document.querySelector('.feedback')`);
    await b.click('.feedback button', '도움 됐어요');
    await b.waitFor(`document.querySelector('.feedback')?.textContent.includes('의견 고맙습니다')`);
    check('도움 됐어요는 이유 없이 저장', JSON.parse(readFileSync(feedbackFile, 'utf8')).at(-1).helpful === true && feedbackCount() === before + 2);

    // 저장은 끝났지만 응답만 잃은 경우에도 같은 전송 ID로 한 번만 남는다.
    await b.goto(`${BASE}/result?event=funeral&relation=peer&qty=25&budget=50000`);
    await b.waitFor(`document.querySelector('.feedback button')`);
    const retryBefore = feedbackCount();
    await b.evaluate(`window.__originalFetch=window.fetch;window.__dropOnce=true;window.fetch=async function(input,init){const r=await window.__originalFetch(input,init);if(window.__dropOnce&&init?.method==='POST'){window.__dropOnce=false;throw new TypeError('E2E response lost')}return r;};return true`);
    await b.click('.feedback button','도움 됐어요');
    await b.waitFor(`document.querySelector('.feedback [type=button]')?.textContent.includes('다시 보내기')`);
    check('의견 응답 유실 시 완료로 기억하지 않음',feedbackCount()===retryBefore+1 && !(await b.evaluate(`return localStorage.getItem('ondap_feedback_sent')?.includes('funeral|peer|50000|25')`)));
    await b.goto(`${BASE}/result?event=funeral&relation=peer&qty=25&budget=50000`);
    await b.waitFor(`document.querySelector('.feedback button')?.textContent==='다시 보내기'`);
    check('새로고침 후에도 재시도 전송 ID 보존',true);
    await b.click('.feedback button','다시 보내기');
    await b.waitFor(`document.querySelector('.feedback')?.textContent.includes('의견 고맙습니다')`);
    check('의견 재시도 후에도 한 건만 저장',feedbackCount()===retryBefore+1);
    await b.evaluate(`if(window.__originalFetch)window.fetch=window.__originalFetch;return true`);

    // 비교표 '지역 상생'은 산지로 판단
    const depop = await b.evaluate(`return [...document.querySelectorAll('.compare tr')].find((r) => r.textContent.startsWith('지역 상생'))?.textContent ?? ''`);
    check('비교표 지역 상생 줄', depop.startsWith('지역 상생'), depop);

    // 내 디자인: 모양이 어긋난 저장 항목이 있어도 화면이 깨지지 않음
    await b.goto(`${BASE}/packaging/mine`);
    await b.evaluate(`localStorage.setItem('ondap_my_designs', JSON.stringify([{ code: 'OD-AAAA-AAAA' }, { code: 'OD-BBBB-BBBB', productName: 'x', productUrl: 'https://a', quantity: 3, savedAt: 'not-a-date', thumb: null }]))`);
    await b.goto(`${BASE}/packaging/mine`);
    await b.sleep(1200);
    const mine = await b.evaluate(`return { err: document.body.innerText.includes('잠시 문제가 생겼어요'), h1: document.querySelector('h1')?.textContent }`);
    check('내 디자인: 잘못된 저장 항목은 건너뜀', !mine.err, JSON.stringify(mine));
    await b.evaluate(`localStorage.removeItem('ondap_my_designs')`);
  } finally {
    const errs = b.logs.filter((l) => /error/i.test(l) && !/favicon|Failed to load resource.*404/.test(l));
    console.log('--- 고객 콘솔 오류:', errs.length ? errs.join('\n') : '없음');
    await b.close();
  }
}

// ---------------- 포장 편집기 (PC) ----------------
{
  const b = await launch({ port: 9352 });
  try {
    await b.goto(`${BASE}/packaging?product=27&qty=30&event=funeral`);
    await b.waitFor(`document.querySelector('.qty-input') && document.querySelector('canvas')`, 40000);
    await b.evaluate(`document.querySelector('.qty-input').focus()`);
    await selectAllAndDelete(b);
    await typeText(b, '45');
    await b.sleep(200);
    check('편집기 수량: 지우고 45', (await b.evaluate(`return document.querySelector('.qty-input').value`)) === '45');

    // 레이어 12개 제한
    await b.evaluate(`localStorage.removeItem('ondap_editor_autosave')`);
    for (let i = 0; i < 14; i++) {
      await b.evaluate(`document.activeElement?.blur(); ${click('button', '+ 문구 추가')}`);
      await b.sleep(120);
    }
    const lim = await b.evaluate(`return { err: document.body.innerText.includes('12개까지 넣을 수 있어요') }`);
    check('스티커 레이어 12개 제한 안내', lim.err, JSON.stringify(lim));
  } finally {
    const errs = b.logs.filter((l) => /error/i.test(l) && !/favicon|Failed to load resource.*404/.test(l));
    console.log('--- 편집기 콘솔 오류:', errs.length ? errs.join('\n') : '없음');
    await b.close();
  }
}

// ---------------- 관리자 (PC) ----------------
{
  const b = await launch({ port: 9353 });
  try {
    await b.goto(`${BASE}/admin/stats`);
    await b.waitFor(`[...document.querySelectorAll('.panel-title')].some((h) => h.textContent === '고객 목소리')`, 40000);
    const st = await b.evaluate(`return {
      titles: [...document.querySelectorAll('.panel-title')].map((h) => h.textContent),
      voice: [...document.querySelectorAll('.panel')].find((p) => p.textContent.startsWith('고객 목소리'))?.innerText.replace(/\\s+/g, ' '),
      print: [...document.querySelectorAll('button')].some((x) => x.textContent === 'A4로 인쇄'),
    }`);
    check('실적: 고객 목소리·찾았지만 없던 것·인쇄 단추', st.titles.includes('찾았지만 없던 것') && /\d+% 도움 됐어요/.test(st.voice) && st.voice.includes('가격이 맞지 않아요') && st.print, JSON.stringify(st));
    await b.send('Emulation.setEmulatedMedia', { media: 'print' });
    await b.sleep(200);
    const pr = await b.evaluate(`return {
      nav: getComputedStyle(document.querySelector('.admin-nav')).display,
      bar: getComputedStyle(document.querySelector('.today-bar')).display,
      filter: getComputedStyle(document.querySelector('.filter-bar')).display,
      head: getComputedStyle(document.querySelector('.print-only')).display,
      headText: document.querySelector('.print-only').textContent,
    }`);
    check('A4 인쇄: 메뉴·필터 숨김, 기간·출력 시각 표시', pr.nav === 'none' && pr.bar === 'none' && pr.filter === 'none' && pr.head === 'block' && /온답 실적 · \d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2} · .+ 출력/.test(pr.headText), JSON.stringify(pr));
    await b.send('Emulation.setEmulatedMedia', { media: '' });

    // 상품 편집기: 해시태그 칸에 쉼표·띄어쓰기를 쳐도 그대로
    await b.goto(`${BASE}/admin`);
    await b.waitFor(`document.querySelector('#tags')`, 40000);
    await b.evaluate(`document.querySelector('#tags').focus()`);
    await selectAllAndDelete(b);
    await typeText(b, '선물, 명절 ');
    await b.sleep(150);
    await typeText(b, '한정');
    await b.sleep(150);
    const tags = await b.evaluate(`return document.querySelector('#tags').value`);
    check('해시태그 칸: 친 글자 그대로', tags === '선물, 명절 한정', tags);

    // 가중치: 소멸위기지역 끝에 쉼표, 배수 칸 비우기
    await b.goto(`${BASE}/admin/weights`);
    await b.waitFor(`[...document.querySelectorAll('td')].some((t) => t.textContent.includes('쉼표로 구분'))`, 40000);
    const area = `[...document.querySelectorAll('tr')].find((r) => r.textContent.includes('쉼표로 구분')).querySelector('input')`;
    await b.evaluate(`const el = ${area}; el.focus(); el.setSelectionRange(el.value.length, el.value.length);`);
    await typeText(b, ', ');
    await b.sleep(100);
    await typeText(b, '가상군');
    await b.sleep(150);
    const areaVal = await b.evaluate(`return ${area}.value`);
    check('소멸위기지역 칸: 끝에 새 지역 입력', areaVal.endsWith(', 가상군'), areaVal.slice(-30));
    const mult = `[...document.querySelectorAll('section.panel')].find((s) => s.textContent.includes('관계별 보정')).querySelector('tbody input')`;
    await b.evaluate(`${mult}.focus()`);
    await selectAllAndDelete(b);
    await b.sleep(100);
    const multEmpty = await b.evaluate(`return ${mult}.value`);
    await b.evaluate(`${mult}.blur()`);
    await b.sleep(150);
    const multAfter = await b.evaluate(`return ${mult}.value`);
    check('배수 칸: 비우면 1', multEmpty === '' && multAfter === '1', JSON.stringify({ multEmpty, multAfter }));

    // 검증 화면: 고객과 같은 예산 단추
    await b.goto(`${BASE}/admin/verify`);
    await b.waitFor(`document.querySelector('a.chip')`, 40000);
    const chips = await b.evaluate(`return [...document.querySelectorAll('a.chip')].filter((a) => a.href.includes('budget=')).map((a) => a.textContent + (a.getAttribute('aria-pressed') === 'true' ? '*' : ''))`);
    check('검증 예산 = 고객 예산 단추, 기본 5만 원', chips.length === 4 && chips.some((c) => c.includes('50,000') && c.endsWith('*')), chips.join(' | '));
  } finally {
    const errs = b.logs.filter((l) => /error/i.test(l) && !/favicon|Failed to load resource.*404/.test(l));
    console.log('--- 관리자 콘솔 오류:', errs.length ? errs.join('\n') : '없음');
    await b.close();
  }
}

console.log(`\n${results.filter(Boolean).length}/${results.length} 통과`);
process.exitCode = results.every(Boolean) ? 0 : 1;
