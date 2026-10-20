import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributesFromRow, attributesToRow, productFromRow, productToRow } from '../src/data/rows.ts';
import { attrs, product } from './fixtures.ts';

test('상품 행 변환은 왕복해도 같다', () => {
  const p = product(50, 26000, { image: 'https://x/a.jpg', soldOut: true });
  assert.deepEqual(productFromRow(productToRow(p)), p);
  assert.equal(productToRow(p).sold_out, true);
});

test('지표 행 변환은 왕복해도 같다', () => {
  const a = attrs(23, {
    region: '영광',
    meanings: { promotion: '굴하지 않는 기개' },
    excludedEvents: [{ event: 'birthday', reason: '테스트' }],
    tags: ['법성포'],
  });
  const row = attributesToRow(a);
  assert.deepEqual(row.excluded_events, [{ event: 'birthday', reason: '테스트' }]);
  assert.deepEqual(attributesFromRow(row), a);
});

test('DB에서 빈 값이 와도 기본값으로 채운다', () => {
  const a = attributesFromRow({
    product_no: 1, region: '국내', category: '', scores: {}, events: [], relations: [],
    excluded_events: [], meanings: {}, tags: [], story: '', reviewed: false,
  });
  assert.deepEqual(a.tags, []);
  assert.deepEqual(a.meanings, {});
});
