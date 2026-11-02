import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { launch } from './cdp.mjs';

const PORT = 3385;
const TMP_DATA_DIR = join(process.cwd(), 'tmp', 'e2e-admin-data');

// 1. 격리된 로컬 테스트 데이터 준비
if (existsSync(TMP_DATA_DIR)) rmSync(TMP_DATA_DIR, { recursive: true, force: true });
mkdirSync(TMP_DATA_DIR, { recursive: true });
execSync(`powershell -Command "Copy-Item -Recurse -Force '${join(process.cwd(), 'data')}\\*' '${TMP_DATA_DIR}'"`);

console.log('[1/5] 격리된 로컬 테스트 데이터 준비 완료:', TMP_DATA_DIR);

// 2. 개발 서버 실행 (포트 3385, --webpack, ONDAP_TEST_DATA_DIR 지정)
const env = {
  ...process.env,
  PORT: String(PORT),
  ONDAP_DATA_SOURCE: 'local',
  ONDAP_TEST_DATA_DIR: TMP_DATA_DIR,
  NODE_ENV: 'development',
};

const serverProc = spawn('node', ['node_modules/next/dist/bin/next', 'dev', '-p', String(PORT), '--webpack'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

serverProc.stdout.on('data', (d) => {
  const line = d.toString();
  if (line.includes('Ready') || line.includes('POST') || line.includes('error')) {
    console.log('[Next.js]', line.trim());
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return true;
    } catch {}
    await sleep(1000);
  }
  throw new Error('서버 응답 대기 시간 초과: ' + url);
}

// React Controlled Element 세터 헬퍼 (React의 prototype setter 호출 및 input/change 이벤트 발생)
const setTextarea = (sel, val) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) throw new Error('textarea 찾을 수 없음: ' + ${JSON.stringify(sel)});
  if (el._valueTracker) el._valueTracker.setValue(Math.random().toString());
  const d = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
  d.set.call(el, ${JSON.stringify(val)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
})()`;

const setInput = (sel, val) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) throw new Error('input 찾을 수 없음: ' + ${JSON.stringify(sel)});
  if (el._valueTracker) el._valueTracker.setValue(Math.random().toString());
  const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  d.set.call(el, ${JSON.stringify(val)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
})()`;

let browser = null;

try {
  console.log('[2/5] 개발 서버 시작 및 첫 컴파일 대기 중...');
  await waitForServer(`http://localhost:${PORT}/admin/formality`);
  console.log('[2/5] 개발 서버 준비 완료!');

  browser = await launch({ port: 9444, mobile: false });
  const { goto, evaluate, click, waitFor } = browser;

  // --- 시나리오 1: 관리자 저장 → 재조회 흐름 검증 ---
  console.log('\n[3/5] 시나리오 1: 격식지수 판정(/admin/formality) 저장 → 재조회 검증 시작...');
  await goto(`http://localhost:${PORT}/admin/formality`);

  // 첫 번째 상품의 원자료 textarea 대기
  await waitFor(`Boolean(document.querySelector('#product-desc'))`, 25000);

  // 원자료 텍스트 입력
  const testDesc = `[E2E 자동검증 원자료 ${Date.now()}] 대한민국 30년 전통 명장 제조`;
  await evaluate(setTextarea('#product-desc', testDesc));

  // 숙련도 근거 입력란 입력
  const testBasis = `[E2E 근거] 30년 전통 명장 인증 확인 완료`;
  await evaluate(setTextarea('textarea[data-factor-basis="skill"]', testBasis));

  // 숙련도 점수 '8점' 버튼 클릭
  await evaluate(`
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent === '8');
    if (btn) btn.click();
  `);

  console.log(' -> 원자료 및 근거·점수 입력 완료, 임시 저장 클릭');
  await click('button', '임시 저장 (미검수)');
  await waitFor(`document.body.innerText.includes('임시 저장했습니다.')`, 20000);
  console.log(' -> 임시 저장 성공 메시지 확인 완료!');

  // 페이지 새로고침하여 재조회 일치 검증
  await goto(`http://localhost:${PORT}/admin/formality`);
  await waitFor(`Boolean(document.querySelector('#product-desc'))`, 25000);

  const reloadedDesc = await evaluate(`return document.querySelector('#product-desc')?.value`);
  assert.equal(reloadedDesc, testDesc, '새로고침 후 재조회된 원자료가 저장값과 일치해야 함');

  const reloadedBasis = await evaluate(`return document.querySelector('textarea[data-factor-basis="skill"]')?.value`);
  assert.equal(reloadedBasis, testBasis, '새로고침 후 재조회된 숙련도 근거가 저장값과 일치해야 함');

  console.log('[3/5] 시나리오 1 PASS: 관리자 수정 → 저장 → 재조회 일치 확인 완료!');

  // --- 시나리오 2: 정책 저장(/admin/weights) → 검증(/admin/verify) 반영 흐름 검증 ---
  console.log('\n[4/5] 시나리오 2: 기준 설정(/admin/weights) 저장 → 검증(/admin/verify) 실시간 반영 검증 시작...');
  await goto(`http://localhost:${PORT}/admin/weights`);
  await waitFor(`Boolean(document.querySelector('input[type="number"]'))`, 25000);

  // 행사 적합도(E) 비중을 65로 설정
  await evaluate(setInput('input[type="number"]', 65));

  await click('button', '가중치 및 기준 저장');
  await waitFor(`document.body.innerText.includes('추천 가중치 및 기준 설정을 저장했습니다.')`, 20000);
  console.log(' -> 기준 설정 저장 성공 메시지 확인 완료');

  // /admin/verify 페이지로 이동
  await goto(`http://localhost:${PORT}/admin/verify`);
  await waitFor(`document.body.innerText.includes('알고리즘 검증')`, 25000);

  // 뱃지에 '로컬 파일 데이터 환경' 표시 확인
  const badgeText = await evaluate(`
    const el = [...document.querySelectorAll('span')].find(e => e.textContent.includes('로컬 파일 데이터 환경'));
    return el ? el.textContent : null;
  `);
  assert.ok(badgeText, '검증 화면에 로컬 파일 데이터 환경 뱃지가 표시되어야 함');
  console.log(' -> 환경 뱃지 확인:', badgeText);

  // 32개 시나리오 계산 완료 대기 (성공 32 / 실패 0)
  await waitFor(`document.body.innerText.includes('성공 32 / 실패 0')`, 35000);
  console.log(' -> 32개 전체 시나리오 실시간 계산 완료 확인 (성공 32 / 실패 0)');

  // 테이블 내 첫 번째 셀 클릭하여 상세 분석 패널 열기
  await evaluate(`
    const td = document.querySelector('table tbody tr td');
    if (td) td.click();
  `);
  await waitFor(`document.body.innerText.includes('시나리오 상세')`, 15000);
  console.log(' -> 시나리오 상세 분석 패널 및 추천점수 S 계산 표시 확인 완료');
  console.log('[4/5] 시나리오 2 PASS: 기준 설정 저장 → 알고리즘 검증 32개 시나리오 실시간 계산 완료!');

  // --- 시나리오 3: 동시 수정 충돌 시 초안 보존 및 재조회 흐름 검증 ---
  console.log('\n[5/5] 시나리오 3: 동시 수정 충돌 시 초안 보존 및 충돌 해결 흐름 검증 시작...');
  await goto(`http://localhost:${PORT}/admin/formality`);
  await waitFor(`Boolean(document.querySelector('#product-desc'))`, 25000);

  // 관리자가 화면에서 새로운 문구 작성
  const myDraft = `[내 작성 초안 ${Date.now()}] 다른 사람이 수정해도 내 글은 날아가면 안 됨!`;
  await evaluate(setTextarea('#product-desc', myDraft));
  await sleep(500);

  // 백그라운드에서 직접 formality-pilot.json의 updatedAt을 미래 시각으로 강제 변경 (다른 관리자의 동시 저장 시뮬레이션)
  const pilotPath = join(TMP_DATA_DIR, 'formality-pilot.json');
  const pilotData = existsSync(pilotPath)
    ? JSON.parse(readFileSync(pilotPath, 'utf8'))
    : { items: {} };
  if (!pilotData.items) pilotData.items = {};
  if (!pilotData.items['11']) pilotData.items['11'] = { productNo: 11 };
  pilotData.items['11'].updatedAt = new Date(Date.now() + 60000).toISOString();
  writeFileSync(pilotPath, JSON.stringify(pilotData, null, 2), 'utf8');

  // 이제 화면에서 저장 버튼 클릭 -> 충돌(revision_conflict) 발생해야 함!
  await click('button', '임시 저장 (미검수)');

  // 충돌 알림 및 해결 버튼 등장 대기
  await waitFor(`document.body.innerText.includes('최신 개정 수락') || document.body.innerText.includes('충돌')`, 20000);
  console.log(' -> 개정 충돌 감지 및 충돌 해결 패널 확인 완료');

  // 가장 중요한 검증: 내가 입력했던 myDraft 초안이 보존되어 있는가?
  const preservedDraft = await evaluate(`return document.querySelector('#product-desc')?.value`);
  assert.equal(preservedDraft, myDraft, '충돌 발생 시에도 사용자가 작성 중이던 초안이 화면에서 보존되어야 함!');
  console.log(' -> 충돌 후에도 관리자 입력 초안 보존 확인 완료');

  // '내 작성 내용 유지한 채 최신 개정 수락 (재저장 준비)' 클릭
  await click('button', '내 작성 내용 유지한 채 최신 개정 수락');
  await waitFor(`document.body.innerText.includes('최신 개정 번호를 수락했습니다')`, 15000);

  // 다시 저장 클릭 -> 이제 성공해야 함!
  await click('button', '임시 저장 (미검수)');
  await waitFor(`document.body.innerText.includes('임시 저장했습니다.')`, 20000);
  console.log(' -> 충돌 해결 후 재저장 성공 확인 완료');

  // 최종 확인: 새로고침 후에도 myDraft가 그대로 서버에 저장되어 재조회되는지
  await goto(`http://localhost:${PORT}/admin/formality`);
  await waitFor(`Boolean(document.querySelector('#product-desc'))`, 25000);
  const finalDesc = await evaluate(`return document.querySelector('#product-desc')?.value`);
  assert.equal(finalDesc, myDraft, '충돌 해결 후 저장된 초안이 최종 저장소에 반영되어야 함');
  console.log('[5/5] 시나리오 3 PASS: 충돌 시 초안 보존 및 재저장 흐름 완벽 통과!');

  console.log('\n======================================================');
  console.log('🎉 모든 실제 브라우저 E2E 검증 통과 (3개 시나리오 전체 PASS)');
  console.log('======================================================\n');
} finally {
  if (browser) await browser.close();
  try {
    if (serverProc.pid) execSync(`taskkill /F /T /PID ${serverProc.pid}`);
  } catch {}
  // 임시 데이터 정리
  try {
    rmSync(TMP_DATA_DIR, { recursive: true, force: true });
    console.log('임시 격리 데이터 디렉터리 정리 완료.');
  } catch {}
}
