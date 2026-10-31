import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessPilotEvent, evidenceFromIntake, findTopEventScenarios, groundedFactors, isOccasionPurposeCompatible, LEVELS } from '../src/engine/formality-intake.ts';
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

test('행사와 목적의 정합성을 검사하여 어긋난 조합을 배제한다', () => {
  // 장례: 축하·홍보 불가, 위로·답례 허용
  assert.equal(isOccasionPurposeCompatible('funeral', 'celebration'), false);
  assert.equal(isOccasionPurposeCompatible('funeral', 'promotion'), false);
  assert.equal(isOccasionPurposeCompatible('funeral', 'condolence'), true);
  assert.equal(isOccasionPurposeCompatible('funeral', 'return'), true);

  // 축하/경조사: 위로 목적 불가
  assert.equal(isOccasionPurposeCompatible('wedding', 'condolence'), false);
  assert.equal(isOccasionPurposeCompatible('birth', 'condolence'), false);
  assert.equal(isOccasionPurposeCompatible('birthday', 'condolence'), false);
  assert.equal(isOccasionPurposeCompatible('wedding', 'celebration'), true);

  // 미입력(unknown) 불가
  assert.equal(isOccasionPurposeCompatible('ceremony', 'unknown'), false);
});

test('검수 완료 상품에 대해 행사 종류가 다양한 기준 충족 예시 Top 3를 선정한다', () => {
  const p = product(1, 100);
  const policy = initialPolicy(catalog([p], []));
  const evidence = evidenceFromIntake(1, {
    skill: { level: 'high', basis: '무형문화재 전승 30년' },
    distribution: { level: 'high', basis: '연간 300세트 한정 제작' },
  }, true);

  const scenarios = findTopEventScenarios(p, evidence, policy, [], 3);
  assert.equal(scenarios.length, 3);

  // 서로 다른 행사 종류(다양성) 확인
  const events = new Set(scenarios.map((s) => s.event));
  assert.equal(events.size, 3);

  for (const s of scenarios) {
    if (['funeral', 'wedding', 'longevity', 'birth', 'birthday'].includes(s.event)) assert.equal(s.sender, 'personal');
    assert.ok(s.headline.includes('기준 충족 예시'));
    assert.ok(s.reason.includes('통과한 검토용 행사 조합'));
    assert.ok(s.rarity >= s.band.min && s.rarity <= s.band.max);
    // 어긋난 조합(장례에 축하 등)이 없어야 함
    assert.ok(isOccasionPurposeCompatible(s.event, s.purpose));
  }

  // 미검수 상품은 예시 목록이 비어있음
  assert.equal(findTopEventScenarios(p, { ...evidence, reviewed: false }, policy).length, 0);

  // 품절 상품도 예시 목록이 비어있음
  assert.equal(findTopEventScenarios({ ...p, soldOut: true }, evidence, policy).length, 0);

  // 특정 행사를 제외하면 그 행사는 추천에 포함되지 않음
  const top1Event = scenarios[0].event;
  const filteredScenarios = findTopEventScenarios(p, evidence, policy, [{ event: top1Event, reason: '테스트 제외' }], 3);
  assert.ok(!filteredScenarios.some((s) => s.event === top1Event));

  // 모든 행사를 제외하면 후보 부족(0개)으로 빈 배열 반환 (오류 없음)
  const allEventsExcluded = Object.keys(policy.eventBase).map((e) => ({ event: e, reason: '전체 제외' }));
  const emptyScenarios = findTopEventScenarios(p, evidence, policy, allEventsExcluded, 3);
  assert.deepEqual(emptyScenarios, []);
});

test('속성 수정 후 재판정 시 희소값이 정확하게 다시 계산되고 반복 판정 흐름이 유지된다', () => {
  const policy = initialPolicy(catalog([product(1, 100)], []));

  // 1차 판정: skill high (8점) + distribution medium (5점) -> 희소값 (0.8 + 0.5) / 2 = 0.65
  const initialFactors = {
    skill: { level: 'high' as const, basis: '30년 경력' },
    distribution: { level: 'medium' as const, basis: '월 500개 한정' },
  };
  const ev1 = evidenceFromIntake(1, initialFactors, true);
  const rarity1 = productRarity(ev1, policy).value;
  assert.equal(rarity1, 0.65);

  // 2차 수정: skill을 medium (5점)으로 낮추고, locality high (8점)를 새로 추가
  // -> (0.5 + 0.5 + 0.8) / 3 = 0.60
  const updatedFactors = {
    skill: { level: 'medium' as const, basis: '10년 경력' },
    distribution: { level: 'medium' as const, basis: '월 500개 한정' },
    locality: { level: 'high' as const, basis: '지리산 청정 산지 독점' },
  };
  const ev2 = evidenceFromIntake(1, updatedFactors, true);
  const rarity2 = productRarity(ev2, policy).value;
  assert.equal(rarity2, 0.6);

  // 3차 수정: 다시 속성을 변경 (history 8점 추가, locality 제외)
  // -> (0.5 + 0.5 + 0.8) / 3 = 0.60
  const updatedFactors3 = {
    skill: { level: 'medium' as const, basis: '10년 경력' },
    distribution: { level: 'medium' as const, basis: '월 500개 한정' },
    history: { level: 'high' as const, basis: '100년 가업' },
  };
  const ev3 = evidenceFromIntake(1, updatedFactors3, true);
  const rarity3 = productRarity(ev3, policy).value;
  assert.equal(rarity3, 0.6);

  // 근거가 비어있는 속성은 희소값 계산에서 배제됨
  const incompleteFactors = {
    skill: { level: 'high' as const, basis: ' ' }, // 공백 근거
    distribution: { level: 'high' as const, basis: '소량 생산' },
  };
  const ev4 = evidenceFromIntake(1, incompleteFactors, true);
  // 유효 근거가 1개뿐이므로 희소값 산출 불가(null)
  assert.equal(productRarity(ev4, policy).value, null);
});

test('수준 선택지에서 점수 문구가 제거되어도 4단계 수준과 내부 점수는 그대로 유지된다', () => {
  const levelKeys = Object.keys(LEVELS);
  assert.deepEqual(levelKeys, ['low', 'medium', 'high']);
  assert.equal(LEVELS.low.score, 2);
  assert.equal(LEVELS.medium.score, 5);
  assert.equal(LEVELS.high.score, 8);
  assert.equal(LEVELS.low.label, '일반적인 수준');
  assert.equal(LEVELS.medium.label, '일부 특징이 있음');
  assert.equal(LEVELS.high.label, '뚜렷한 특징이 있음');
  // 라벨에 (2점), (5점), (8점) 문구가 포함되어 있지 않음
  for (const entry of Object.values(LEVELS) as { label: string }[]) {
    assert.doesNotMatch(entry.label, /\d+점/);
  }
});
