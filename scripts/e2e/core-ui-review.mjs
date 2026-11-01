import assert from 'node:assert/strict';

// Execute inside cua_repl with its documented Tab handle. No external browser transport or private React state.
const button = (tab, name) => tab.playwright.getByRole('button', { name, exact: true });
const waitText = (tab, text) => tab.playwright.getByText(text, { exact: true }).waitFor({ state: 'visible' });
const value = (field) => field.evaluate((el) => el.value);
const deliver = async (tab, label) => {
  await tab.playwright.getByRole('status').filter({ hasText: label }).waitFor({ state: 'visible' });
  await button(tab, '대기 응답 전달').click();
};
async function reset(tab) {
  await tab.reload();
  await button(tab, '임시 저장 (미검수)').waitFor({ state: 'visible' });
}

export async function checkConflict(tab) {
  await reset(tab);
  await button(tab, '임시 저장 (미검수)').click();
  await deliver(tab, '저장 응답 대기');
  await waitText(tab, '임시 저장했습니다.');
  await button(tab, '다른 관리자 원격 변경').click();
  await tab.playwright.getByTestId('server-memory').filter({ hasText: '[다른 관리자]' }).waitFor({ state: 'attached' });
  await button(tab, '임시 저장 (미검수)').click();
  await button(tab, '내 작성 내용 유지한 채 최신 개정 수락 (재저장 준비)').click();
  await button(tab, '임시 저장 (미검수)').click();
  await deliver(tab, '저장 응답 대기');
  await waitText(tab, '임시 저장했습니다.');
  assert.equal(await button(tab, '내 작성 내용 유지한 채 최신 개정 수락 (재저장 준비)').count(), 0);
  return 'PASS: actual editor resolves a real revision mismatch and saves again';
}

export async function checkPolicyEditDuringSave(tab) {
  await reset(tab);
  await button(tab, '정책 시험').click();
  const field = tab.playwright.getByRole('spinbutton', { name: '행사 적합도(E) 비중', exact: true });
  await field.fill('60');
  await button(tab, '가중치 및 기준 저장').click();
  await tab.playwright.getByRole('status').filter({ hasText: '정책 응답 대기' }).waitFor({ state: 'visible' });
  await field.fill('55');
  assert.equal(await value(field), '55');
  await deliver(tab, '정책 응답 대기');
  await waitText(tab, '요청한 설정은 저장했습니다. 이후 수정한 설정은 아직 저장되지 않았습니다.');
  assert.equal(await value(field), '55');
  const before = JSON.parse(await tab.playwright.getByTestId('server-memory').textContent());
  assert.equal(before.weights.eventFit, 60);
  await button(tab, '가중치 및 기준 저장').click();
  await deliver(tab, '정책 응답 대기');
  await waitText(tab, '추천 가중치 및 기준 설정을 저장했습니다.');
  assert.equal(JSON.parse(await tab.playwright.getByTestId('server-memory').textContent()).weights.eventFit, 55);
  return 'PASS: policy keeps newer input, identifies it as unsaved, and saves it on the next request';
}

export async function checkAiEditDuringRequest(tab) {
  await reset(tab);
  const source = tab.playwright.getByRole('textbox', { name: '상품 원자료 (상세 설명 문구)', exact: true });
  const basis = tab.playwright.getByRole('textbox', { name: '생산자 숙련도 확인 근거', exact: true });
  await source.fill('30년 장인이 제작한 수제 선물입니다.');
  await button(tab, '✦ AI 제안 받기').click();
  await tab.playwright.getByRole('status').filter({ hasText: 'AI 응답 대기' }).waitFor({ state: 'visible' });
  await basis.fill('[AI 요청 후 직접 작성한 최신 근거]');
  await button(tab, '9').first().click();
  await deliver(tab, 'AI 응답 대기');
  await waitText(tab, 'AI 분석 중 작성 내용이 변경되어 제안을 적용하지 않았습니다. 현재 내용으로 다시 분석해 주세요.');
  assert.equal(await value(basis), '[AI 요청 후 직접 작성한 최신 근거]');
  assert.equal(await tab.playwright.getByText('현재 점수: 9점', { exact: true }).count(), 1);
  return 'PASS: late AI response leaves subsequent manual evidence and score unchanged';
}

export async function checkAssessmentEditDuringSave(tab) {
  await reset(tab);
  const field = tab.playwright.getByRole('textbox', { name: '상품 원자료 (상세 설명 문구)', exact: true });
  await field.fill('저장 요청 시점의 원자료');
  await button(tab, '검수 완료 및 저장').click();
  await tab.playwright.getByRole('status').filter({ hasText: '저장 응답 대기' }).waitFor({ state: 'visible' });
  await field.fill('저장 요청 후 추가한 원자료');
  await deliver(tab, '저장 응답 대기');
  await waitText(tab, '요청한 내용은 저장했습니다. 이후 수정한 내용은 아직 저장되지 않았습니다.');
  assert.equal(await value(field), '저장 요청 후 추가한 원자료');
  assert.equal(JSON.parse(await tab.playwright.getByTestId('server-memory').textContent()).assessment.description, '저장 요청 시점의 원자료');
  await button(tab, '임시 저장 (미검수)').click();
  await deliver(tab, '저장 응답 대기');
  await waitText(tab, '임시 저장했습니다.');
  assert.equal(JSON.parse(await tab.playwright.getByTestId('server-memory').textContent()).assessment.description, '저장 요청 후 추가한 원자료');
  return 'PASS: assessment preserves post-request edits without claiming they are already saved';
}
