import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReason, objectParticle, tierFor } from '../src/engine/explain.ts';
import { scoreForSituation } from '../src/engine/formality.ts';
import { attrs, testConfig } from './fixtures.ts';

test('을/를은 마지막 글자 받침으로 고른다', () => {
  assert.equal(objectParticle('녹차'), '를');
  assert.equal(objectParticle('굴비 세트'), '를');
  assert.equal(objectParticle('천일염'), '을');
  assert.equal(objectParticle('ABC'), '을(를)');
});

test('격식 단계는 격식 적합도 점수로 정한다', () => {
  assert.equal(tierFor(testConfig, 9), '격을 갖춘 선택');
  assert.equal(tierFor(testConfig, 6), '실속 있는 정성');
  assert.equal(tierFor(testConfig, 2), '가벼운 안부의 예의');
});

test('선물의 의미와 소멸위기지역은 가산점과 문구에 함께 반영된다', () => {
  const a = attrs(1, { region: '영광', meanings: { funeral: '정성과 감사를 담은 답례' } });
  const s = scoreForSituation(testConfig, a, 'funeral', 'senior');
  assert.ok(s.bonuses.some((b) => b.points === 6 && b.reason.includes('정성과 감사')));
  assert.ok(s.bonuses.some((b) => b.points === 3 && b.reason.includes('영광')));

  const reason = buildReason(testConfig, { event: 'funeral', relation: 'senior' }, '굴비', a, s.indicators);
  assert.match(reason, /^장례 상급자\/어르신 답례로는 굴비를 추천드립니다\./);
  assert.match(reason, /‘정성과 감사를 담은 답례’를 담았습니다\./);
  assert.match(reason, /영광의 생산자를 응원/);
});

test('의미가 없는 행사·지역이면 가산하지 않는다', () => {
  const a = attrs(1, { region: '제주', meanings: { wedding: '달콤한 출발' } });
  const s = scoreForSituation(testConfig, a, 'funeral', 'senior');
  assert.ok(!s.bonuses.some((b) => b.reason.startsWith('선물의 의미') || b.reason.includes('소멸위기')));
});
