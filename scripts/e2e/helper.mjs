// 카페24 도우미(public/cafe24/ondap-helper.js): 가짜 주문서에서 코드 자동 입력·포장 요약·수량 비교, 가짜 상품 페이지에서 '다른 상품' 판별
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from './cdp.mjs';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3000';
const CODE = 'OD-7ZBM-MVL5'; // fixtures.mjs의 접수 (상품 49, 30개, 송학 장생, 6cm 원형)
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK ' : 'NG '} ${name}${detail ? ' — ' + detail : ''}`); };
const dir = mkdtempSync(join(tmpdir(), 'ondap-e2e-cafe24-'));
const fileUrl = (path) => 'file:///' + path.replace(/\\/g, '/');
const script = `<script src="${BASE}/cafe24/ondap-helper.js" defer></script>`;
// 카페24 주문서에서 도우미가 읽는 부분만 흉내 낸다 (상품 49, 주문 수량 qty개, 추가 항목 칸)
const orderForm = (qty) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>주문서</title></head><body>
<div class="xans-order-normallist"><div class="prdBox"><div class="displaynone"><input id="chk_order_cancel_list0" name="chk_order_cancel_list_basic0" value="49:000A:F:4" type="checkbox"></div>
<div class="description"><strong class="prdName"><a href="/product/x/49/category/48/">지리산 벌꿀</a></strong>
<ul class="info"><li title="옵션"><div class="optionWrap"><div class="optionItem">${qty}개</div></div></li></ul></div></div></div>
<table><tr class="xans-record-"><th scope="row">온답 포장 디자인 코드</th><td><input id="oa_content[1|49]" name="oa_content[1|49]" type="text" value=""></td></tr></table>
${script}</body></html>`;
const remember = (b) => b.evaluate(`localStorage.setItem('ondap_packaging', JSON.stringify({ code: '${CODE}', qty: 30, productNo: '49', at: Date.now() })); return true`);

const b = await launch({ port: 9345 });
try {
  for (const [qty, expect] of [[3, '달라요'], [30, '이대로 주문하시면']]) {
    const page = join(dir, 'order', 'orderform.html');
    mkdirSync(join(dir, 'order'), { recursive: true });
    writeFileSync(page, orderForm(qty));
    await b.goto(fileUrl(page));
    await remember(b);
    await b.goto(fileUrl(page));
    await b.waitFor(`document.getElementById('ondap-banner')?.textContent.includes('송학 장생')`, 15000);
    const r = await b.evaluate(`return { field: document.querySelector('input[name="oa_content[1|49]"]').value, banner: document.getElementById('ondap-banner').innerText }`);
    check(`주문서: 주문 ${qty}개 / 디자인 30개`, r.field === CODE && r.banner.includes(expect) && r.banner.includes('송학 장생') && r.banner.includes('6cm 원형'), r.banner.replace(/\n/g, ' / '));
  }
  // 짧은 상품 주소(/product/이름/번호/…)에서도 상품 번호를 읽어 다른 상품에는 '접수 완료' 띠를 띄우지 않는다
  for (const [no, shown] of [[49, true], [50, false]]) {
    const sub = join(dir, 'product', 'honey', String(no), 'category', '48', 'display', '1');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'index.html'), `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>상품</title></head><body><input id="quantity" value="1">${script}</body></html>`);
    await b.goto(fileUrl(join(sub, 'index.html')));
    await remember(b);
    await b.goto(fileUrl(join(sub, 'index.html')));
    await b.sleep(1500);
    const banner = await b.evaluate(`return document.getElementById('ondap-banner')?.textContent ?? ''`);
    check(`상품 ${no} 페이지: 접수 완료 띠 ${shown ? '보임' : '안 보임'}`, banner.includes('접수 완료') === shown, banner.slice(0, 60));
  }
} catch (e) {
  check('중단', false, e.message);
} finally {
  console.log('--- 콘솔 오류:', b.logs.length ? '\n' + b.logs.join('\n') : '없음');
  await b.close();
}
console.log(`\n${results.filter(Boolean).length}/${results.length} 통과`);
process.exitCode = results.every(Boolean) ? 0 : 1;
