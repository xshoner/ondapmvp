import assert from 'node:assert/strict';
import { launch } from './cdp.mjs';

const b = await launch({ port: 9345, mobile: true });
try {
  await b.goto(`${process.env.E2E_BASE ?? 'http://localhost:3367'}/packaging?product=49&qty=30&event=wedding&relation=business`);
  await b.waitFor("window.Konva?.stages?.[0]?.find('Text').length > 0", 30000);
  await b.click('button', '다음: 인쇄물 꾸미기');
  await b.evaluate(`const node = window.Konva.stages[0].find('Text')[0]; node.fire('mousedown', {evt:{clientX:180,clientY:200}}); node.fire('click', {evt:{clientX:180,clientY:200}});`);
  await b.waitFor("document.querySelector('.pkg-inline-editor-textarea')");
  await b.evaluate(`const t = document.querySelector('.pkg-inline-editor-textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ''); t.dispatchEvent(new Event('input', {bubbles:true}));`);
  await b.click('.pkg-inline-done-btn');
  await b.waitFor("window.Konva.stages[0].find('Text').some(t => t.text() === '(문구 입력)')");
  await b.evaluate(`window.__originalFontLoad = document.fonts.load.bind(document.fonts); document.fonts.load = () => Promise.reject(new Error('test font failure'));`);
  await b.click('button', '조합 예시');
  await b.waitFor("document.querySelector('.pkg-mockup-error')", 15000);
  await b.click('button', '스티커 상세');
  await b.waitFor("window.Konva.stages[0].find('Text').some(t => t.text() === '(문구 입력)')");
  await b.evaluate(`document.fonts.load = window.__originalFontLoad;`);
  await b.click('button', '조합 예시');
  await b.waitFor("document.querySelector('.pkg-mockup-sticker-img')", 15000);
  assert.equal(await b.evaluate("return Boolean(document.querySelector('.pkg-mockup-error'))"), false);
  await b.click('button', '스티커 상세');
  await b.click('.pkg-img-thumb');
  await b.waitFor("window.Konva.stages[0].find('Image').length > 0", 15000);
  await b.evaluate(`const stage = window.Konva.stages[0]; window.__originalStageFind = stage.find.bind(stage); stage.find = (selector) => selector === 'Image' ? [] : window.__originalStageFind(selector);`);
  await b.click('button', '조합 예시');
  await b.waitFor("document.querySelector('.pkg-mockup-error')", 15000);
  await b.click('button', '스티커 상세');
  await b.waitFor("window.Konva.stages[0].find('Text').some(t => t.text() === '(문구 입력)')");
  await b.evaluate(`window.Konva.stages[0].find = window.__originalStageFind;`);
  await b.click('button', '조합 예시');
  await b.waitFor("document.querySelector('.pkg-mockup-sticker-img')", 15000);
  console.log('PASS: font/image export failures restore editing state; retries render preview');
} finally { await b.close(); }
