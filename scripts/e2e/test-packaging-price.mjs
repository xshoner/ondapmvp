import assert from 'node:assert/strict';
import { launch } from './cdp.mjs';
const b = await launch({port: 9346, mobile: true});
try {
  await b.goto(`${process.env.E2E_BASE ?? 'http://localhost:3367'}/packaging?product=49&qty=30&event=wedding&relation=business`);
  await b.waitFor("window.Konva?.stages?.[0]?.find('Text').length > 0", 30000);
  await b.click('button', '다음: 인쇄물 꾸미기');
  await b.click('button', '다음: 최종 확인');
  await b.waitFor("document.querySelector('.pkg-review-summary')");
  const summary = await b.evaluate("return document.querySelector('.pkg-review-summary').innerText");
  assert.match(summary, /100원\s*×\s*30개\s*=\s*3,000원/);
  assert.doesNotMatch(summary, /0원 \(기본 제공\)/);
  assert.match(summary, /쇼핑몰에서 포장 디자인 서비스 옵션을 선택/);
  console.log('PASS: 30 units show 3,000 won and explicit checkout option');
} finally { await b.close(); }
