import assert from 'node:assert/strict';
import { launch } from './cdp.mjs';

const base = process.env.E2E_BASE ?? 'http://127.0.0.1:3379';
const b = await launch({ port: 9394, mobile: true });
try {
  const url = `${base}/packaging?product=49&qty=3&event=wedding&relation=business`;
  await b.goto(url);
  await b.click('button', '다음: 인쇄물 꾸미기');
  await b.click('button', '인쇄물 없음');
  await b.click('button', '다음: 최종 확인');
  await b.send('Network.enable');
  await b.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await b.click('button', '디자인 완료하고 코드 받기');
  await b.waitFor(`document.querySelector('[role="alert"]')?.textContent.includes('임시 보관')`, 20000);
  assert.equal(await b.evaluate(`return !!localStorage.getItem('ondap_editor_autosave') && !document.querySelector('.design-code')`), true);
  await b.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await b.goto(url);
  await b.waitFor(`document.querySelector('.editor-resume')`, 30000);
  await b.click('.editor-resume button', '이어서 꾸미기');
  await b.click('button', '다음: 인쇄물 꾸미기');
  await b.click('button', '다음: 최종 확인');
  await b.click('button', '디자인 완료하고 코드 받기');
  await b.waitFor(`document.querySelector('.design-code')`, 30000);
  assert.equal(await b.evaluate(`return localStorage.getItem('ondap_editor_autosave')`), null);
  console.log('PASS: 접수 실패 시 임시 보관, 복원 후 재접수 및 보관 제거');
} finally {
  await b.close();
}
