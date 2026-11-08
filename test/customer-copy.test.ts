import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCustomerReason } from '../src/app/recommendation-ui/types.ts';

test('고객 추천 문구를 유형별로 표시한다', () => {
  assert.equal(formatCustomerReason('적격 상품 중 행사 적합도가 가장 높습니다.', 'standard'), '답례큐 알고리즘이 고른 가장 1순위 추천 Pick은 이 상품!');
  assert.equal(formatCustomerReason('적격 상품 중 행사 적합도와 예산 사용 비율을 종합한 점수가 가장 높습니다.', 'standard'), '답례큐 알고리즘이 고른 가장 1순위 추천 Pick은 이 상품!');
  assert.equal(formatCustomerReason('표준안을 제외한 적격 상품 중 단가가 가장 낮습니다.', 'practical'), '표준안 외 가성비 측면에서 가장 우수해요!');
  assert.equal(formatCustomerReason('그 외 설명', 'formal'), '그 외 설명');
});
