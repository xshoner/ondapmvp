import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessPilotEvent, evidenceFromIntake, groundedFactors } from '../src/engine/formality-intake.ts';
import { initialPolicy, productRarity } from '../src/engine/eligibility.ts';
import { catalog, product } from './fixtures.ts';
import { fetchProductDescription } from '../src/cafe24/client.ts';

test('AI 근거는 원문에 있는 항목만 사용하고 계산은 확정된 수준에 따라 한다', () => {
  const source = '생산 경력 20년. 연 500개만 생산합니다.';
  const factors = groundedFactors({ skill: { level: 'high', basis: '생산 경력 20년' }, distribution: { level: 'medium', basis: '연 500개만 생산합니다.' }, locality: { level: 'high', basis: '독점 산지' }, history: { level: 'bad', basis: '생산 경력 20년' } }, source);
  assert.deepEqual(Object.keys(factors), ['skill', 'distribution']);
  const evidence = evidenceFromIntake(1, factors, true);
  assert.equal(productRarity(evidence, initialPolicy(catalog([product(1, 100)], []))).value, 0.65);
  assert.equal(productRarity(evidenceFromIntake(1, { skill: factors.skill }, true), initialPolicy(catalog([product(1, 100)], []))).value, null);
});

test('확인된 같은 상품도 행사 기준에 따라 통과 여부가 달라진다', () => {
  const p = product(1, 100);
  const policy = initialPolicy(catalog([p], []));
  const evidence = evidenceFromIntake(1, { skill: { level: 'medium', basis: '경력 확인' }, distribution: { level: 'high', basis: '생산량 확인' } }, true);
  const official = { event: 'ceremony', relation: 'business', sender: 'public', purpose: 'return' } as const;
  const personal = { event: 'birthday', relation: 'family', sender: 'personal', purpose: 'return' } as const;
  assert.equal(assessPilotEvent(p, evidence, policy, official).allowed, false);
  assert.equal(assessPilotEvent(p, evidence, policy, personal).allowed, true);
  assert.equal(assessPilotEvent({ ...p, soldOut: true }, evidence, policy, personal).allowed, false);
  assert.equal(assessPilotEvent(p, evidence, policy, personal, '행사 제외').allowed, false);
  assert.throws(() => assessPilotEvent(p, { ...evidence, reviewed: false }, policy, personal), /확인/);
});

test('선택한 상품 상세에서 텍스트만 가져오고 다른 번호의 응답은 거부한다', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ product: { product_no: 51, simple_description: '한정 생산', description: '<!-- 비공개 메타 --><style>숨김</style><p>강진 &amp; 바다</p>' } }));
    const text = await fetchProductDescription({ mallId: 'test', clientId: 'test' }, 51);
    assert.match(text, /한정 생산/); assert.match(text, /강진 & 바다/); assert.doesNotMatch(text, /비공개 메타|숨김/);
    await assert.rejects(fetchProductDescription({ mallId: 'test', clientId: 'test' }, 52), /상품 상세/);
  } finally { globalThis.fetch = original; }
});

test('상품 설명이 비어있거나 이미지 전용인 경우 빈 텍스트를 반환한다', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ product: { product_no: 53, description: '<img src="https://example.com/detail.jpg" />' } }));
    const text = await fetchProductDescription({ mallId: 'test', clientId: 'test' }, 53);
    assert.equal(text, '');
  } finally { globalThis.fetch = original; }
});

test('발신 주체나 목적이 미입력이어도 격식 지수는 계산하되 incomplete를 표시한다', () => {
  const p = product(1, 100);
  const policy = initialPolicy(catalog([p], []));
  const evidence = evidenceFromIntake(1, { skill: { level: 'high', basis: '전승' }, history: { level: 'high', basis: '100년' } }, true);
  const incompleteInput = { event: 'birthday', relation: 'family', sender: 'unknown', purpose: 'unknown' } as const;
  const result = assessPilotEvent(p, evidence, policy, incompleteInput);
  assert.equal(result.incomplete, true);
  assert.equal(typeof result.eventScore, 'number');
});
