// 운영: 오늘 할 일·늦어지는 건·단축키·한꺼번에 바꾸기·주문 붙여넣기·시험 인쇄·QR 완료 처리, 상품 지표 키보드·엑셀·점수 예시, 다시 주문·요약 API
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from './cdp.mjs';

const root = process.argv[2];
const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3000';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK ' : 'NG '} ${name}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`); };
const designs = () => JSON.parse(readFileSync(join(root, 'data/designs.json'), 'utf8'));
const click = (sel, text) => `{ const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => ${text ? `e.textContent.includes(${JSON.stringify(text)})` : 'true'}); if (!el) throw new Error('없음: ${sel} ${text ?? ''}'); el.click(); }`;
const key = (b, k, opts = {}) => b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: opts.code, text: opts.text, modifiers: opts.mod ?? 0, windowsVirtualKeyCode: opts.vk }).then(() => b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: opts.code, modifiers: opts.mod ?? 0, windowsVirtualKeyCode: opts.vk }));
const type = (b, ch) => b.send('Input.dispatchKeyEvent', { type: 'char', text: ch });

// ---------------- AP: 주문·인쇄 ----------------
{
  const b = await launch({ port: 9340 });
  try {
    await b.goto(`${BASE}/admin/packaging?tab=designs`);
    await b.waitFor(`document.querySelector('.today-bar') && document.querySelector('.designs-table')`, 40000);
    const bar = await b.evaluate(`return document.querySelector('.today-bar').innerText.replace(/\\s+/g, ' ')`);
    check('AP-01 오늘 할 일 띠', /주문 확인 대기 \d+/.test(bar) && /인쇄 대기 \d+/.test(bar) && /늦어지는 건 2/.test(bar), bar);

    const late = await b.evaluate(`return [...document.querySelectorAll('tr.late')].map((r) => r.dataset.row + ':' + r.querySelector('.late-badge').textContent)`);
    check('AP-06 늦어지는 건 빨간 표시', late.length === 2 && late.some((l) => l.startsWith('OD-3QNT-CPFA:접수 5일째')) && late.some((l) => l.startsWith('OD-R2KH-56GT:주문 확인 3일째')), late.join(' | '));
    await b.goto(`${BASE}/admin/packaging?tab=designs&late=1`);
    await b.waitFor(`document.querySelector('.designs-table')`);
    const lateOnly = await b.evaluate(`return [...document.querySelectorAll('tr[data-row]')].map((r) => r.dataset.row)`);
    check('AP-06 늦어지는 건만 거르기', lateOnly.length === 2, lateOnly.join(','));

    await b.goto(`${BASE}/admin/packaging?tab=designs`);
    await b.waitFor(`document.querySelector('.designs-table')`);
    // AP-08 단축키
    await b.evaluate(`document.activeElement?.blur(); document.body.focus()`);
    await key(b, 'j'); await key(b, 'j'); await key(b, 'x'); await key(b, '?');
    await b.sleep(300);
    const sc = await b.evaluate(`return { cursor: document.querySelector('tr.cursor')?.dataset.row, rows: [...document.querySelectorAll('tr[data-row]')].map((r) => r.dataset.row), selected: [...document.querySelectorAll('tr[data-row] input[type=checkbox]')].filter((c) => c.checked).length, help: Boolean(document.querySelector('.shortcut-help')) }`);
    check('AP-08 단축키 j·x·?', sc.cursor === sc.rows[1] && sc.selected === 1 && sc.help, JSON.stringify(sc));
    await key(b, 'Escape');

    // AP-02 상태 한꺼번에 바꾸기 (두 건을 '인쇄 완료'로 → 다시 '접수'로)
    const targets = ['OD-7ZBM-MVL5', 'OD-2THX-RTKZ'];
    await b.evaluate(`for (const c of ${JSON.stringify(targets)}) document.querySelector('tr[data-row="' + c + '"] input[type=checkbox]').click()`);
    await b.waitFor(`document.querySelector('.batch-bar')`);
    await b.evaluate(`const s = document.querySelector('.batch-bar select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'printed'); s.dispatchEvent(new Event('change', { bubbles: true }))`);
    await b.evaluate(click('.batch-bar button', '상태 한꺼번에'));
    await b.waitFor(`[...document.querySelectorAll('[role=status]')].some((e) => e.textContent.includes('2건을'))`);
    const after = designs().filter((d) => targets.includes(d.code)).map((d) => d.status);
    check('AP-02 상태 한꺼번에 바꾸기', after.every((s) => s === 'printed'), after.join(','));
    const t0 = Date.now();
    await b.waitFor(`${JSON.stringify(targets)}.every((c) => document.querySelector('tr[data-row="' + c + '"] select')?.value === 'printed')`, 15000).catch(() => {});
    console.log('   (화면 반영까지', Date.now() - t0, 'ms)');
    const rowsShown = await b.evaluate(`return ${JSON.stringify(targets)}.map((c) => document.querySelector('tr[data-row="' + c + '"] select')?.value)`);
    check('AP-02 화면의 상태 칸도 새 값', rowsShown.every((v) => v === 'printed'), rowsShown.join(','));

    // AP-07 주문 상세 붙여넣기
    await b.evaluate(click('button', '주문 상세 붙여넣기'));
    await b.waitFor(`document.querySelector('textarea[aria-label="붙여넣을 주문 상세"]')`);
    await b.evaluate(`const t = document.querySelector('textarea[aria-label="붙여넣을 주문 상세"]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, '주문번호 20261022-0000777\\n상품: 지리산 벌꿀 30개\\n온답 포장 디자인 코드 : od-l588-sm5t'); t.dispatchEvent(new Event('input', { bubbles: true }))`);
    await b.waitFor(`[...document.querySelectorAll('button')].some((x) => x.textContent.includes('주문번호 1건 잇기'))`);
    await b.evaluate(click('button', '주문번호 1건 잇기'));
    await b.waitFor(`[...document.querySelectorAll('td')].some((x) => x.textContent.includes('주문번호 연결 · 주문 확인'))`);
    const linked = designs().find((d) => d.code === 'OD-L588-SM5T');
    check('AP-07 붙여넣어 주문번호 잇기', linked.orderNo === '20261022-0000777' && linked.status === 'order_confirmed', `${linked.orderNo} ${linked.status}`);

    // AP-05 시험 인쇄 1장
    const testHref = await b.evaluate(`return [...document.querySelectorAll('a')].find((a) => a.textContent === '시험 1장')?.getAttribute('href')`);
    const pdf = await fetch(BASE + testHref);
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    check('AP-05 시험 인쇄 1장 PDF', pdf.ok && pdf.headers.get('content-type') === 'application/pdf' && /count=1&test=1/.test(testHref), `${testHref} ${bytes.length}B`);
  } catch (e) {
    check('AP 흐름 중단', false, e.message);
  } finally {
    console.log('--- AP 콘솔 오류:', b.logs.length ? '\n' + b.logs.join('\n') : '없음');
    await b.close();
  }
}

// ---------------- AP-04: QR로 완료 처리 ----------------
{
  const b = await launch({ port: 9341, mobile: true });
  try {
    await b.goto(`${BASE}/s/OD-3QNT-CPFA`);
    await b.waitFor(`location.pathname === '/admin/scan' && [...document.querySelectorAll('button')].some((x) => x.textContent === '인쇄 완료로 바꾸기')`, 40000);
    check('AP-04 QR 주소 → 스캔 화면', await b.evaluate(`return location.search === '?code=OD-3QNT-CPFA'`));
    await b.evaluate(click('button', '인쇄 완료로 바꾸기'));
    await b.waitFor(`document.querySelector('.scan-log')`);
    check('AP-04 인쇄 완료로 바뀜', designs().find((d) => d.code === 'OD-3QNT-CPFA').status === 'printed');
    await b.evaluate(click('.scan-log button', '되돌리기'));
    await b.waitFor(`document.querySelector('.scan-log li').textContent.includes('되돌림')`);
    check('AP-04 되돌리기', designs().find((d) => d.code === 'OD-3QNT-CPFA').status === 'received');
    await b.evaluate(click('button', '카메라 켜기'));
    await b.sleep(1500);
    const cam = await b.evaluate(`return { unsupported: document.body.innerText.includes('화면 안에서 QR을 읽지 못합니다'), video: Boolean(document.querySelector('.scan-video')), alert: document.querySelector('[role=alert]')?.textContent ?? '' }`);
    check('AP-04 카메라: 지원 안 되는 브라우저 안내 또는 영상', cam.unsupported || cam.video || /카메라를 켜지 못했/.test(cam.alert), JSON.stringify(cam));
    // 직접 입력
    await b.evaluate(`const i = document.querySelector('input[aria-label="디자인 코드 직접 입력"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'od-7zbm-mvl5'); i.dispatchEvent(new Event('input', { bubbles: true }))`);
    await b.evaluate(click('button', '완료 처리'));
    await b.waitFor(`document.querySelector('.scan-log').textContent.includes('OD-7ZBM-MVL5')`);
    const already = await b.evaluate(`return document.querySelector('.scan-log').textContent`);
    check('AP-04 이미 완료인 건은 그대로', already.includes('이미 인쇄 완료였음'), already);
  } catch (e) {
    check('AP-04 흐름 중단', false, e.message);
  } finally {
    console.log('--- 스캔 콘솔 오류:', b.logs.length ? '\n' + b.logs.join('\n') : '없음');
    await b.close();
  }
}

// ---------------- AM: 상품·지표 ----------------
{
  const b = await launch({ port: 9342 });
  const attrsFile = join(root, 'data/product-attributes.json');
  try {
    await b.goto(`${BASE}/admin?product=27`);
    await b.waitFor(`document.getElementById('s-rarity')`, 40000);
    const before = JSON.parse(readFileSync(attrsFile, 'utf8')).products.find((a) => a.productNo === 27).scores.rarity;
    // AM-03 키보드: 첫 막대에 포커스 → 숫자키 → ↓ 이동
    await b.evaluate(`document.getElementById('s-rarity').focus()`);
    const target = before === 3 ? '4' : '3';
    await key(b, target, { text: target, code: `Digit${target}`, vk: 48 + Number(target) });
    await b.sleep(200);
    await key(b, 'ArrowDown', { code: 'ArrowDown', vk: 40 });
    await b.sleep(200);
    const kb = await b.evaluate(`return { rarity: document.querySelector('label[for="s-rarity"]').parentElement.querySelector('b').textContent, focused: document.activeElement?.id, dirty: document.body.innerText.includes('저장하지 않은 변경') }`);
    check('AM-03 숫자키로 점수 + ↓로 다음 지표', kb.rarity === target && kb.focused === 's-craftsmanship' && kb.dirty, JSON.stringify(kb));
    // AM-01 바꾸면 무엇이 달라지나
    await b.waitFor(`document.querySelector('.impact')`);
    const impact = await b.evaluate(`return document.querySelector('.impact').innerText`);
    check('AM-01 저장 전 영향 요약', /32가지 상황/.test(impact), impact);
    // 크게 바꿔서 1위가 바뀌는지
    await b.evaluate(`document.getElementById('s-rarity').focus()`);
    await key(b, '0', { text: '0', code: 'Digit0', vk: 48 });
    for (const id of ['craftsmanship', 'regional', 'trust']) { await b.evaluate(`document.getElementById('s-${id}').focus()`); await key(b, '0', { text: '0', code: 'Digit0', vk: 48 }); }
    await b.sleep(600);
    const big = await b.evaluate(`return document.querySelector('.impact').innerText`);
    check('AM-01 크게 올리면 1위가 바뀌는 상황 표시', /1위가 바뀌는 상황 \d+건|새로 추천되는 상황/.test(big), big);
    await b.evaluate(click('.impact button', '자세히'));
    const list = await b.evaluate(`return document.querySelectorAll('.impact-list li').length`);
    check('AM-01 자세히 목록', list > 0, `${list}건`);
    // AM-03 Ctrl+S 저장 → AM-05 이력
    await key(b, 's', { code: 'KeyS', vk: 83, mod: 2 });
    await b.waitFor(`document.body.innerText.includes('저장했습니다')`);
    const saved = JSON.parse(readFileSync(attrsFile, 'utf8')).products.find((a) => a.productNo === 27).scores;
    check('AM-03 Ctrl+S 저장', saved.rarity === 10 && saved.trust === 10, JSON.stringify(saved));
    await b.evaluate(click('.admin-tabs a', '변경 이력'));
    await b.waitFor(`document.querySelector('.history-list')`);
    const hist = await b.evaluate(`return document.querySelector('.history-list li').innerText`);
    check('AM-05 변경 이력 (바뀐 칸)', /희소성/.test(hist) && /→ 10/.test(hist), hist);
    // 처음 값으로 되돌리기: 맨 아래(가장 오래된) 기록의 이전 값이 아니라, 저장 직전 값 = 두 번째 기록 or 원래 값. 여기서는 '이때 값 불러오기'가 동작하는지만 본다
    await b.evaluate(click('.history-list button', '불러오기'));
    await b.waitFor(`document.getElementById('s-rarity')`);
    check('AM-05 이때 값 불러오기 → 입력 탭', await b.evaluate(`return document.body.innerText.includes('그때 값을 불러왔습니다')`));
    // AM-02 추천 진단
    await b.evaluate(click('.admin-tabs a', '추천 진단'));
    await b.waitFor(`document.querySelector('.diagnose-table')`);
    const diag = await b.evaluate(`return { rows: document.querySelectorAll('.diagnose-table tbody tr').length, cells: document.querySelectorAll('.diagnose-table .stand').length, kinds: [...new Set([...document.querySelectorAll('.diagnose-table .stand')].map((s) => s.className))] }`);
    check('AM-02 추천 진단 표 8×4', diag.rows === 8 && diag.cells === 32, JSON.stringify(diag));
    // AM-09 고객 카드 미리보기
    await b.evaluate(click('.admin-tabs a', '고객 카드 미리보기'));
    await b.waitFor(`document.querySelector('.card-preview')`);
    const card = await b.evaluate(`return { pick: Boolean(document.querySelector('.card-preview .pick')), heart: Boolean(document.querySelector('.card-preview .save-pick')), notice: document.querySelector('.card-preview .notice')?.textContent ?? '' }`);
    check('AM-09 고객 카드 미리보기 (찜 버튼 없음)', (card.pick && !card.heart) || card.notice.includes('보이지 않습니다'), JSON.stringify(card));
  } catch (e) {
    check('AM 흐름 중단', false, e.message);
  } finally {
    console.log('--- AM 콘솔 오류:', b.logs.length ? '\n' + b.logs.join('\n') : '없음');
    await b.close();
  }
}

// ---------------- AM-04 엑셀로 한꺼번에, AM-07 점수 기준 예시 ----------------
{
  const b = await launch({ port: 9343 });
  try {
    await b.goto(`${BASE}/admin/bulk`);
    await b.waitFor(`document.querySelector('.bulk-steps')`, 40000);
    // 내려받기와 같은 CSV를 만들어 한 칸만 고쳐 올린다
    const csvMod = await import(new URL(`file:///${root.replace(/\\/g, '/')}/src/data/attributes-csv.ts`).href);
    const catalog = {
      products: JSON.parse(readFileSync(join(root, 'data/cafe24-products.json'), 'utf8')).products,
      attributes: JSON.parse(readFileSync(join(root, 'data/product-attributes.json'), 'utf8')).products,
      config: JSON.parse(readFileSync(join(root, 'data/config/engine.json'), 'utf8')),
    };
    const csv = csvMod.attributesCsv(catalog).split('\r\n');
    const i = csv.findIndex((l) => l.startsWith('11,'));
    const cols = csvMod.parseCsv(csv[0])[0];
    const row = csvMod.parseCsv(csv[i])[0];
    const r = cols.indexOf('희소성');
    row[r] = String((Number(row[r]) + 1) % 11);
    csv[i] = row.map((v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',');
    const file = join(tmpdir(), 'ondap-e2e-bulk.csv');
    writeFileSync(file, csv.join('\r\n'));
    await b.setFile('.file-pick input[type=file]', file);
    await b.waitFor(`document.body.innerText.includes('1개 상품이 바뀝니다')`);
    const preview = await b.evaluate(`return document.querySelector('.change-list').innerText`);
    check('AM-04 올리기 미리보기: 바뀐 칸만', /희소성/.test(preview) && preview.split('\n').length === 1, preview);
    await b.evaluate(click('button', '1개 저장하기'));
    await b.waitFor(`document.body.innerText.includes('1개 상품을 저장했습니다')`);
    const savedRarity = JSON.parse(readFileSync(join(root, 'data/product-attributes.json'), 'utf8')).products.find((a) => a.productNo === 11).scores.rarity;
    check('AM-04 한꺼번에 저장', String(savedRarity) === row[r], `${savedRarity}`);
    // 엑셀 일반 CSV(EUC-KR)도 읽는지: 헤더만 바꿔 오류 메시지가 한글로 나오는지 본다
    const euc = Buffer.from([0xbb, 0xf3, 0xc7, 0xb0, 0xb9, 0xf8, 0xc8, 0xa3, 0x2c, 0xc8, 0xf1, 0xbc, 0xd2, 0xbc, 0xba, 0x0d, 0x0a, 0x31, 0x31, 0x2c, 0x39, 0x0d, 0x0a]); // 상품번호,희소성\r\n11,9
    writeFileSync(file, euc);
    await b.setFile('.file-pick input[type=file]', file);
    await b.waitFor(`/바뀝니다|바뀐 칸이 없습니다/.test(document.body.innerText)`);
    check('AM-04 EUC-KR(엑셀 일반 CSV)도 읽음', await b.evaluate(`return /상품이 바뀝니다|바뀐 칸이 없습니다/.test(document.body.innerText) && !document.body.innerText.includes('상품번호\\' 칸이 없습니다')`));

    // AM-07 점수 기준 예시 입력 → 상품 편집기 도움말
    await b.goto(`${BASE}/admin/weights`);
    await b.waitFor(`document.querySelector('input[aria-label="희소성 높은 점수 예시"]')`, 40000);
    await b.evaluate(`const i = document.querySelector('input[aria-label="희소성 높은 점수 예시"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '울릉도 명이처럼 산지 한정 소량'); i.dispatchEvent(new Event('input', { bubbles: true }))`);
    await b.evaluate(click('button', '설정 저장'));
    await b.waitFor(`document.body.innerText.includes('저장했습니다')`);
    await b.goto(`${BASE}/admin?product=11`);
    await b.waitFor(`document.getElementById('s-rarity')`, 40000);
    await b.evaluate(`document.getElementById('s-rarity').focus()`);
    await key(b, '9', { text: '9', code: 'Digit9', vk: 57 });
    await b.sleep(300);
    const hint = await b.evaluate(`return document.getElementById('s-rarity').closest('.field').querySelector('.score-hint')?.innerText ?? ''`);
    check('AM-07 점수 기준 예시가 막대 아래에', hint.includes('울릉도 명이처럼'), hint);
  } catch (e) {
    check('AM-04/07 흐름 중단', false, e.message);
  } finally {
    console.log('--- 엑셀·예시 콘솔 오류:', b.logs.length ? '\n' + b.logs.join('\n') : '없음');
    await b.close();
  }
}

// ---------------- CO: 주문한 뒤 ----------------
{
  const b = await launch({ port: 9344, mobile: true });
  const konva = 'window.Konva?.stages?.[0]';
  try {
    // 디자인 하나 저장 (이 기기에 그림·편집 내용이 남게)
    await b.goto(`${BASE}/packaging?product=49&qty=12&event=wedding&relation=business`);
    await b.waitFor(`${konva} && ${konva}.find('Image').length > 0`, 40000);
    await b.sleep(600);
    await b.evaluate(click('button', '디자인 저장하고'));
    await b.waitFor(`document.querySelector('.design-code')`, 30000);
    const code = await b.evaluate(`return document.querySelector('.design-code').textContent`);
    await b.sleep(800);

    // CO-01 진행 상황 (이 기기 목록 + 코드 조회)
    await b.goto(`${BASE}/packaging/mine?code=${code}`);
    await b.waitFor(`document.querySelector('.progress') && document.querySelector('.alt .pill')`, 30000);
    const prog = await b.evaluate(`return { steps: [...document.querySelectorAll('.progress li')].map((l) => l.className), pill: document.querySelector('.alt .pill').textContent, hint: document.querySelector('.progress').nextElementSibling.textContent }`);
    check('CO-01 진행 단계 표시', prog.steps[0] === 'now' && /접수/.test(prog.pill), JSON.stringify(prog));

    // CO-05 스티커 그림 받기 버튼 (이 기기에 그림이 있을 때)
    check('CO-05 스티커 그림 받기 버튼', await b.evaluate(`return [...document.querySelectorAll('button')].some((x) => x.textContent === '스티커 그림 받기')`));
    const png = await b.evaluate(`return await new Promise((res) => { const r = indexedDB.open('ondap', 1); r.onsuccess = () => { const q = r.result.transaction('photos').objectStore('photos').get('p:${code}'); q.onsuccess = () => res(q.result ? { type: q.result.type, size: q.result.size } : null); }; })`);
    check('CO-05 화면용 그림 480px PNG 보관', png?.type === 'image/png' && png.size > 5000, JSON.stringify(png));

    // CO-03 같은 디자인으로 다시 주문
    await b.evaluate(click('article.card button', '같은 디자인으로 다시 주문'));
    await b.waitFor(`document.querySelector('.reorder input')`);
    await b.evaluate(`const i = document.querySelector('.reorder input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '25'); i.dispatchEvent(new Event('input', { bubbles: true }))`);
    await b.evaluate(click('.reorder button', '새 코드 받기'));
    await b.waitFor(`document.querySelector('.fresh-code .design-code')`, 20000);
    const fresh = await b.evaluate(`return { code: document.querySelector('.fresh-code .design-code').textContent, order: document.querySelector('.fresh-code a')?.getAttribute('href') }`);
    const row = designs().find((d) => d.code === fresh.code);
    check('CO-03 새 코드로 다시 접수 (수량 25, 원본 인쇄 파일)', row && row.quantity === 25 && row.sourceCode === code && row.status === 'received' && /ondap_qty=25/.test(fresh.order), JSON.stringify({ fresh, row: row && { q: row.quantity, src: row.sourceCode } }));
    await b.waitFor(`document.querySelectorAll('.alt').length >= 2 && [...document.querySelectorAll('.alt')].filter((a) => a.textContent.includes('스티커 그림 받기')).length >= 2`, 15000).catch(() => {});
    const listed = await b.evaluate(`return { codes: [...document.querySelectorAll('.alt b.serif')].map((x) => x.textContent), pngBtn: [...document.querySelectorAll('.alt')].filter((a) => a.textContent.includes('스티커 그림 받기')).length }`);
    check('CO-03 새 코드가 이 기기 목록에 (그림도 이어받음)', listed.codes.includes(fresh.code) && listed.pngBtn >= 2, JSON.stringify(listed));

    // CO-04 주문서 확인용 요약 API
    const api = await fetch(`${BASE}/api/design/${fresh.code.toLowerCase()}`);
    const body = await api.json();
    check('CO-04 요약 API (CORS·수량·스티커)', api.headers.get('access-control-allow-origin') === '*' && body.quantity === 25 && body.sticker?.sizeCm === 6 && !('draft' in body) && !('orderNo' in body), JSON.stringify(body));
  } catch (e) {
    check('CO 흐름 중단', false, e.message);
  } finally {
    console.log('--- CO 콘솔 오류:', b.logs.length ? '\n' + b.logs.join('\n') : '없음');
    await b.close();
  }
}

console.log(`\n${results.filter(Boolean).length}/${results.length} 통과`);
process.exitCode = results.every(Boolean) ? 0 : 1;
