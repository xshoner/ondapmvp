// 카페24 상품 옵션을 고객이 고른 뒤에도 전달한 수량을 유지하는지 확인한다.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { launch } from './cdp.mjs';

const helper = readFileSync(new URL('../../public/cafe24/ondap-helper.js', import.meta.url), 'utf8');
const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><body>
    <table><tr><th>맛</th><td><select id="product_option_id1"><option value="*">선택</option><option value="a">사과</option><option value="b">배</option></select></td></tr></table><div id="rows"></div>
    <script>
      window.jQuery = function(el) { return { trigger: function(name) { el.dispatchEvent(new Event(name,{bubbles:true})); return this; } }; };
      document.querySelector('select').addEventListener('change', function () { document.querySelector('#rows').innerHTML='<input class="quantity_opt" value="1">'; });
    </script></body></html>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await launch({ port: 9439 });
try {
  await browser.goto(`http://127.0.0.1:${server.address().port}/product/detail.html?product_no=999&ondap_qty=13&ondap_order=1&ondap_code=OD-A2B3-4C5D`);
  await browser.evaluate(helper);
  await browser.sleep(7000);
  assert.equal(await browser.evaluate(`return document.querySelector('select').value;`), '*', '맛 등 상품 옵션을 임의로 고르지 않는다');
  await browser.evaluate(`const s=document.querySelector('select'); s.value='b'; s.dispatchEvent(new Event('change',{bubbles:true}));`);
  await browser.sleep(800);
  assert.deepEqual(await browser.evaluate(`return { value: document.querySelector('select').value, qty: document.querySelector('.quantity_opt').value };`), { value: 'b', qty: '13' });
  await browser.evaluate(`const q=document.querySelector('.quantity_opt'); q.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'2'})); q.value='2'; document.querySelector('select').dispatchEvent(new Event('change',{bubbles:true}));`);
  await browser.sleep(800);
  assert.equal(await browser.evaluate(`return document.querySelector('.quantity_opt').value;`), '1', '고객이 수량을 변경한 뒤에는 자동으로 덮어쓰지 않는다');
  await browser.goto(`http://127.0.0.1:${server.address().port}/product/detail.html?product_no=999&ondap_qty=13&ondap_order=1&ondap_code=OD-A2B3-4C5D`);
  await browser.evaluate(helper);
  await browser.evaluate(`document.querySelector('#rows').innerHTML='<input class="quantity_opt" value="2"><input class="quantity_opt" value="3">'; document.querySelector('select').dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('#rows').innerHTML='<input class="quantity_opt" value="2"><input class="quantity_opt" value="3">';`);
  await browser.sleep(800);
  assert.deepEqual(await browser.evaluate(`return [...document.querySelectorAll('.quantity_opt')].map(x=>x.value);`), ['2', '3'], '여러 상품 옵션 행의 수량을 일괄 변경하지 않는다');
  console.log('옵션 선택 후 수량 반영 검증 통과');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
