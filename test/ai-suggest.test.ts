import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySuggestion, buildPrompt, normalizeSuggestion, suggestionSchema } from '../src/ai/suggest.ts';
import { attrs, testConfig } from './fixtures.ts';

const input = { productName: '영광 법성포 굴비', price: 120000, region: '', category: '수산', story: "진상품 '굴비'", tags: [] };

test('프롬프트에 지표·행사·관계와 상품 정보가 들어간다', () => {
  const { system, user } = buildPrompt(testConfig, input);
  assert.match(system, /rarity \(희소성/);
  assert.match(system, /funeral=장례/);
  assert.match(system, /senior=상급자\/어르신/);
  assert.match(system, /지어내지 않습니다/);
  assert.match(user, /영광 법성포 굴비/);
  assert.match(user, /120,000원/);
});

test('스키마는 설정의 지표·행사 목록으로 만들어진다', () => {
  const schema = suggestionSchema(testConfig) as { properties: Record<string, any> };
  assert.deepEqual(Object.keys(schema.properties.scores.properties), ['rarity', 'formality']);
  assert.ok(schema.properties.events.items.enum.includes('funeral'));
  assert.equal(schema.properties.scores.properties.rarity.properties.score.maximum, 10);
});

test('정상 응답을 정리한다: 점수 반올림·범위 제한, 모르는 값 버림', () => {
  const s = normalizeSuggestion(
    {
      scores: { rarity: { score: 8.6, reason: '법성포 한정' }, formality: { score: 14, reason: '고급' }, unknown: { score: 3, reason: 'x' } },
      events: ['longevity', 'promotion', 'party', 'longevity'],
      relations: ['senior', 'boss'],
      excludedEvents: [{ event: 'funeral', reason: '생물' }, { event: 'nope', reason: 'x' }],
      meanings: [{ event: 'promotion', meaning: '굴하지 않는 기개' }, { event: 'funeral', meaning: '제외된 행사' }],
      tags: ['#법성포', '진상품', '법성포'],
      region: '영광',
      summary: '격식 있는 자리용',
    },
    testConfig,
    'test-model',
  );
  assert.deepEqual(s.scores, { rarity: 9, formality: 10 });
  assert.equal(s.reasons.rarity, '법성포 한정');
  assert.deepEqual(s.events, ['longevity', 'promotion']);
  assert.deepEqual(s.relations, ['senior']);
  assert.deepEqual(s.excludedEvents, [{ event: 'funeral', reason: '생물' }]);
  assert.deepEqual(s.meanings, { promotion: '굴하지 않는 기개' });
  assert.deepEqual(s.tags, ['법성포', '진상품']);
  assert.equal(s.region, '영광');
  assert.equal(s.model, 'test-model');
});

test('제외한 행사는 어울리는 행사에서 빠진다', () => {
  const s = normalizeSuggestion(
    { scores: { rarity: { score: 5, reason: '' } }, events: ['funeral', 'wedding'], excludedEvents: [{ event: 'funeral', reason: '생물' }] },
    testConfig,
    'm',
  );
  assert.deepEqual(s.events, ['wedding']);
});

test('점수가 하나도 없는 응답은 오류', () => {
  assert.throws(() => normalizeSuggestion({ events: [] }, testConfig, 'm'), /지표 점수가 없습니다/);
  assert.throws(() => normalizeSuggestion(null, testConfig, 'm'), /지표 점수가 없습니다/);
});

test('모두 적용: 점수·행사·관계를 덮고, 이미 입력한 산지는 유지', () => {
  const current = attrs(23, { region: '영광', scores: { rarity: 5, formality: 5 }, tags: ['기존'] });
  const s = normalizeSuggestion(
    { scores: { rarity: { score: 9, reason: '' } }, events: ['promotion'], relations: ['business'], region: '전남', tags: [] },
    testConfig,
    'm',
  );
  const next = applySuggestion(current, s);
  assert.deepEqual(next.scores, { rarity: 9, formality: 5 });
  assert.deepEqual(next.events, ['promotion']);
  assert.deepEqual(next.relations, ['business']);
  assert.equal(next.region, '영광');
  assert.deepEqual(next.tags, ['기존']);
});

test('모두 적용: 써 둔 선물의 의미는 남기고, AI가 뺀 행사의 의미만 지운다', () => {
  const current = attrs(23, { meanings: { opening: '번창', funeral: '위로' } });
  const s = normalizeSuggestion(
    { scores: { rarity: { score: 5, reason: '' } }, meanings: [{ event: 'birth', meaning: '건강' }], excludedEvents: [{ event: 'funeral', reason: '격식이 맞지 않음' }] },
    testConfig,
    'm',
  );
  assert.deepEqual(applySuggestion(current, s).meanings, { opening: '번창', birth: '건강' });
});

test('산지가 비어 있으면 AI 제안 산지를 쓴다', () => {
  const s = normalizeSuggestion({ scores: { rarity: { score: 5, reason: '' } }, region: '하동' }, testConfig, 'm');
  assert.equal(applySuggestion(attrs(1, { region: '국내' }), s).region, '하동');
});
