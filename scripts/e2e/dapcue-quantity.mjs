import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { launch } from './cdp.mjs';

const helper = readFileSync(new URL('../../public/cafe24/ondap-helper.js', import.meta.url));
const page = `<!doctype html><html><body>
<select id="product_option_id1" name="option1"><option value="*">선택</option><option value="a">신청</option></select>
<div class="xans-product-action"><a onclick="product_submit(1)">구매</a></div>
<div id="rows"><input class="quantity_opt" style="display:none" value="999"></div>
<script src="/cafe24/ondap-helper.js" defer></script></body></html>`;
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url.startsWith('/cafe24/') ? 'application/javascript; charset=utf-8' : 'text/html; charset=utf-8');
  const rows = req.url.includes('rows=two') ? '<input class="quantity_opt" value="1"><input class="quantity_opt" value="2">' : req.url.includes('rows=one') ? '<input class="quantity_opt" value="1">' : '';
  res.end(req.url.startsWith('/cafe24/') ? helper : page.replace('value="999"></div>', `value="999">${rows}</div>`));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await launch({ port: 9392 });
  await browser.goto(`${base}/product/detail.html?product_no=11`);
  await browser.waitFor("document.getElementById('ondap-pack-btn')");
  for (const qty of [1, 10, 25]) {
    const href = await browser.evaluate(`
      document.getElementById('rows').innerHTML='<input class="quantity_opt" style="display:none" value="999"><input class="quantity_opt" name="quantity_opt[]" value="${qty}">';
      const link=document.getElementById('ondap-pack-btn');
      const stop=e=>e.preventDefault(); link.addEventListener('click',stop,{once:true}); link.click(); return link.href;
    `);
    assert.equal(new URL(href).searchParams.get('qty'), String(qty));
  }
  const ambiguous = await browser.evaluate(`
    document.getElementById('rows').innerHTML='<input class="quantity_opt" value="10"><input class="quantity_opt" value="25">';
    window.alert = message => { window.lastAlert = message; };
    const link=document.getElementById('ondap-pack-btn');
    const event=new MouseEvent('click',{bubbles:true,cancelable:true});
    return {allowed:link.dispatchEvent(event),message:window.lastAlert};
  `);
  assert.equal(ambiguous.allowed, false);
  assert.match(ambiguous.message, /하나만/);
  await browser.goto(`${base}/product/detail.html?product_no=11&ondap_order=1&ondap_qty=10&rows=one`);
  await browser.waitFor("document.querySelector('input.quantity_opt:not([style])').value === '10'");
  await browser.evaluate(`const el=document.querySelector('input.quantity_opt:not([style])'); el.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true})); el.value='12'; return true;`);
  await browser.sleep(1400);
  assert.equal(await browser.evaluate("return document.querySelector('input.quantity_opt:not([style])').value"), '12');
  await browser.goto(`${base}/product/detail.html?product_no=11&ondap_order=1&ondap_qty=10&rows=two`);
  await browser.sleep(400);
  assert.deepEqual(await browser.evaluate("return [...document.querySelectorAll('input.quantity_opt:not([style])')].map(e=>e.value)"), ['1', '2']);
  console.log('PASS: visible option quantity 1/10/25, hidden row ignored, multiple rows blocked');
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
