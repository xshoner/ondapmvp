import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { verifiedFeatures } from '../src/approval/cafe24-features.ts';

test('상품 특징은 해당 상품의 카페24 원문에서 확인되는 문구만 저장한다', () => {
  const source = new Map([[1, '국산 쌀로 만들어 고소합니다.'], [2, '제주에서 재배한 녹차']]);
  const actual = verifiedFeatures(source, [
    { productNo: 1, feature: '국산 쌀로 만들어 고소합니다' },
    { productNo: 2, feature: '국산 쌀로 만들어 고소합니다' },
    { productNo: 3, feature: '제주에서 재배한 녹차' },
    { productNo: 2, feature: '제주' },
  ]);
  assert.deepEqual([...actual], [[1, '국산 쌀로 만들어 고소합니다']]);
});
