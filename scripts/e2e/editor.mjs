// 포장 편집기: 사진 올리기·자동 보관·이어서 꾸미기·저장·다시 꾸미기·PC QR·실물 크기 미리보기
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from './cdp.mjs';

const project = process.argv[2];
const require = createRequire(join(project, 'package.json'));
const sharp = require('sharp');
const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3000';
const photo = join(tmpdir(), 'ondap-e2e-photo.jpg');
await sharp({ create: { width: 1400, height: 1000, channels: 3, background: { r: 120, g: 160, b: 140 } } }).jpeg().toFile(photo);

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'OK ' : 'NG '} ${name}${detail ? ' — ' + detail : ''}`); };

const setInput = (sel, value) => `{ const el = document.querySelector(${JSON.stringify(sel)}); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); }`;
const konva = `window.Konva?.stages?.[0]`;

// ---------- A. 휴대폰: 사진 올리기 → 자동 보관 → 이어서 꾸미기 → 저장 → 다시 꾸미기 ----------
{
  const b = await launch({ port: 9333, mobile: true });
  try {
    await b.goto(`${BASE}/packaging?product=49&qty=30&event=wedding&relation=business`);
    await b.waitFor(`${konva} && ${konva}.find('Text').length > 0`, 30000);
    await b.click('.style-grid button','모란');
    const initial = await b.evaluate(`return ${konva}.find('Text').map((t)=>t.text()).join(' ')`);
    check('편집기 열림 + 결혼 감사 답례 기본 문구 (기념일 이미지 없음)', initial.includes('감사') && !initial.includes('기념일'));

    await b.click('[role=tab]', '이미지');
    await b.setFile('input[type=file]', photo);
    await b.waitFor(`${konva}.find('Image').some((n) => n.image()?.src?.startsWith('blob:'))`);
    check('사진 올리기', true);

    await b.click('[role=tab]', '문구');
    await b.sleep(300);
    await b.click('.text-choice', '결혼합니다');
    await b.waitFor(`document.querySelector('.name-fields input')`);
    await b.evaluate(setInput('.name-fields input', '홍길동·김영희'));
    await b.click('.date-row button', '오늘');
    await b.sleep(1800);
    const auto = await b.evaluate(`const v = JSON.parse(localStorage.getItem('ondap_editor_autosave') || 'null'); return v && { pn: v.productNo, layers: v.snap.layers.map((l) => l.type + ':' + (l.src ?? l.text) + ':' + (l.photoId ?? '')) }`);
    check('자동 보관 기록', Boolean(auto && auto.pn === 49 && auto.layers.some((l) => l.startsWith('image:upload:l'))), JSON.stringify(auto));
    const idb = await b.evaluate(`return await new Promise((res) => { const r = indexedDB.open('ondap', 1); r.onsuccess = () => { const q = r.result.transaction('photos').objectStore('photos').count(); q.onsuccess = () => res(q.result); }; r.onerror = () => res(-1); })`);
    check('사진 원본 IndexedDB 보관', idb === 1, `사진 ${idb}장`);

    await b.goto(`${BASE}/packaging?product=49&qty=30&event=wedding&relation=business`);
    await b.waitFor(`document.querySelector('.editor-resume')`);
    check('다시 열면 "꾸미다 만 디자인" 안내', true);
    await b.click('.editor-resume button', '이어서 꾸미기');
    await b.waitFor(`${konva} && ${konva}.find('Image').some((n) => n.image()?.src?.startsWith('blob:')) && ${konva}.find('Text').length > 0`);
    const restored = await b.evaluate(`return { banner: document.querySelector('.notice[role=status]')?.textContent, text: ${konva}.find('Text').map((t) => t.text()), names: [...document.querySelectorAll('.name-fields input')].map((i) => i.value) }`);
    check('이어서 꾸미기: 사진·문구·이름 복원', restored.text.some((t) => t.includes('홍길동·김영희')), JSON.stringify(restored));

    // 저장: 사진 권한 + 철자 확인
    await b.click('button', '디자인 저장하고');
    await b.sleep(400);
    const err1 = await b.evaluate(`return document.querySelector('[role=alert]')?.textContent ?? ''`);
    await b.click('[role=tab]', '이미지');
    await b.sleep(200);
    await b.evaluate(`const c = [...document.querySelectorAll('label')].find((l) => l.textContent.includes('사용 권한이 있는 사진입니다'))?.querySelector('input'); if (c && !c.checked) c.click();`);
    await b.evaluate(`const c = document.querySelector('.name-check input'); if (c && !c.checked) c.click();`);
    await b.click('button', '디자인 저장하고');
    await b.waitFor(`document.querySelector('[aria-label="디자인 코드"]')`, 20000);
    await b.waitFor(`localStorage.getItem('ondap_my_designs')`, 10000);
    const saved = await b.evaluate(`return { code: document.querySelector('.design-code')?.textContent, qr: Boolean(document.querySelector('.qr-box')), autosave: localStorage.getItem('ondap_editor_autosave'), mine: JSON.parse(localStorage.getItem('ondap_my_designs'))[0] }`);
    check('저장 전 확인 문구', err1.includes('권한') || err1.includes('철자'), err1);
    check('저장 → 코드 발급, 자동 보관 비움', Boolean(saved.code) && saved.autosave === null, saved.code);
    check('휴대폰에서는 QR 안 보임', saved.qr === false);
    check('내 디자인에 다시 꾸미기 정보', saved.mine.productNo === 49 && saved.mine.snapshot.layers.some((l) => l.photoId), '');

    await b.goto(`${BASE}/packaging/mine`);
    await b.waitFor(`[...document.querySelectorAll('a')].some((a) => a.textContent === '다시 꾸미기')`);
    const href = await b.evaluate(`return [...document.querySelectorAll('a')].find((a) => a.textContent === '다시 꾸미기').getAttribute('href')`);
    check('내 디자인: 다시 꾸미기 버튼', href.includes(`restore=${saved.code}`), href);

    await b.goto(BASE + href);
    await b.waitFor(`${konva} && ${konva}.find('Image').some((n) => n.image()?.src?.startsWith('blob:')) && ${konva}.find('Text').length > 0`);
    const again = await b.evaluate(`return { back: document.querySelector('.topbar .back')?.textContent, banner: document.querySelector('.notice[role=status]')?.textContent, text: ${konva}.find('Text').map((t) => t.text()), resume: Boolean(document.querySelector('.editor-resume')) }`);
    await b.sleep(1500);
    check('다시 꾸미기만 하고 안 고치면 자동 보관 안 함', (await b.evaluate(`return localStorage.getItem('ondap_editor_autosave')`)) === null);
    check('다시 꾸미기: 디자인 복원 + 돌아가기 링크', again.back === '‹ 내 디자인' && again.text.some((t) => t.includes('홍길동·김영희')) && !again.resume, JSON.stringify(again));

    // 이름 기억 (다른 상품 새 편집에서)
    await b.goto(`${BASE}/packaging?product=27&qty=10&event=wedding&relation=business`);
    await b.waitFor(`${konva} && ${konva}.find('Text').length > 0`, 30000);
    await b.click('[role=tab]', '문구');
    await b.sleep(300);
    await b.click('.text-choice', '결혼합니다');
    await b.waitFor(`document.querySelector('.name-fields input')`);
    const remembered = await b.evaluate(`return { v: document.querySelector('.name-fields input').value, note: document.querySelector('.name-fields .link-btn')?.textContent }`);
    check('이름 자동 채우기 (이 기기 기억)', remembered.v === '홍길동·김영희' && remembered.note === '지우기', JSON.stringify(remembered));
  } catch (e) {
    check('휴대폰 흐름 중단', false, e.message);
  } finally {
    console.log('--- 휴대폰 콘솔 오류:', b.logs.length ? '\n' + b.logs.join('\n') : '없음');
    await b.close();
  }
}

// ---------- B. PC: 저장하면 휴대폰 이어서 주문 QR ----------
{
  const b = await launch({ port: 9334, mobile: false });
  try {
    await b.goto(`${BASE}/packaging?product=49&qty=30&event=funeral&relation=senior`);
    await b.waitFor(`${konva} && (${konva}.find('Image').length > 0 || ${konva}.find('Text').length > 0)`, 30000);
    await b.click('.style-grid button','송학');
    await b.sleep(800);
    await b.evaluate(`const c = document.querySelector('.name-check input'); if (c && !c.checked) c.click();`);
    await b.click('button', '디자인 저장하고');
    await b.waitFor(`document.querySelector('.qr-box img')?.src.startsWith('data:image/gif')`, 20000);
    check('PC 저장 → QR 표시', true);
  } catch (e) {
    check('PC 흐름 중단', false, e.message);
  } finally {
    console.log('--- PC 콘솔 오류:', b.logs.length ? '\n' + b.logs.join('\n') : '없음');
    await b.close();
  }
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 통과`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
