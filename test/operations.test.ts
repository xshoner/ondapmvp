import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeImpact, standing } from '../src/engine/impact.ts';
import { attributeDiff } from '../src/data/attribute-diff.ts';
import { attributesCsv, parseAttributesCsv, parseCsv } from '../src/data/attributes-csv.ts';
import { extractOrderLinks } from '../src/packaging/order-paste.ts';
import { isLate } from '../src/packaging/design-filter.ts';
import { diffProducts, syncSummary } from '../src/cafe24/sync-diff.ts';
import { soldOutFavorites } from '../src/stats/summary.ts';
import { attrs, catalog, product, testConfig } from './fixtures.ts';

// ---------- 바꾸면 무엇이 달라지나 / 왜 추천 안 되나 ----------

test('지표를 올리면 1위가 바뀌는 상황만 골라 준다', () => {
  const c = catalog(
    [product(1, 10000), product(2, 10000), product(3, 10000), product(4, 10000)],
    [attrs(1, { scores: { rarity: 9, formality: 7 } }), attrs(2, { scores: { rarity: 6, formality: 7 } }), attrs(3), attrs(4, { scores: { rarity: 1, formality: 7 } })],
  );
  assert.deepEqual(changeImpact(c, attrs(1, { scores: { rarity: 9, formality: 7 } })), [], '그대로면 변화 없음');
  const rows = changeImpact(c, attrs(4, { scores: { rarity: 10, formality: 7 } }));
  assert.ok(rows.length > 0);
  for (const r of rows) assert.ok(r.firstChanged || r.entered || r.left);
  const funeral = rows.find((r) => r.event === 'funeral' && r.relation === 'senior');
  assert.equal(funeral?.after[0], 4);
  assert.equal(funeral?.entered, true);
});

test('상황별 순위와 빠진 이유: 표시·다양성·점수 차·제외', () => {
  const c = catalog(
    [product(1, 10000), product(2, 10000), product(3, 10000), product(4, 10000), product(5, 90000), product(6, 10000)],
    [
      attrs(1, { scores: { rarity: 10, formality: 7 } }),
      attrs(2, { scores: { rarity: 9, formality: 7 }, category: '카테고리1' }), // 1번과 같은 분류
      attrs(3, { scores: { rarity: 8, formality: 7 } }),
      attrs(4, { scores: { rarity: 7, formality: 7 } }),
      attrs(5, { scores: { rarity: 10, formality: 7 } }),
      attrs(6, { scores: { rarity: 2, formality: 7 } }),
    ],
  );
  const s = { event: 'funeral', relation: 'senior' } as const;
  assert.deepEqual(standing(c, 1, s, 50000), { kind: 'shown', rank: 1 });
  assert.deepEqual(standing(c, 2, s, 50000), { kind: 'diversity', rank: 2 });
  assert.deepEqual(standing(c, 5, s, 50000), { kind: 'excluded', reason: '예산 초과 (90,000원)' });
  const low = standing(c, 6, s, 50000);
  assert.equal(low.kind, 'below');
  assert.ok(low.kind === 'below' && low.rank === 5 && low.gap > 0);
});

// ---------- 지표 차이 ----------

test('지표 차이는 바뀐 칸만, 행사 순서가 달라도 같은 내용이면 없음', () => {
  const a = attrs(1, { events: ['wedding', 'funeral'] });
  assert.deepEqual(attributeDiff(a, { ...a, events: ['funeral', 'wedding'] }, testConfig), []);
  const changes = attributeDiff(a, { ...a, scores: { rarity: 9, formality: 7 }, reviewed: false, excludedEvents: [{ event: 'birth', reason: '생물' }] }, testConfig);
  assert.deepEqual(changes.map((c) => c.label), ['희소성', '제외 행사', '검토 완료']);
  assert.deepEqual(changes[0], { label: '희소성', from: '5', to: '9' });
  assert.equal(changes[1].to, '출산(생물)');
});

// ---------- 엑셀(CSV) ----------

test('CSV 읽기: 따옴표 안의 쉼표·줄바꿈·"" 와 BOM', () => {
  assert.deepEqual(parseCsv('﻿a,"b,1","줄\r\n바꿈","따옴""표"\r\n\r\n1,2,3,4\n'), [['a', 'b,1', '줄\r\n바꿈', '따옴"표'], ['1', '2', '3', '4']]);
});

test('내려받은 CSV를 그대로 올리면 바뀐 것 없음 (지표 없는 상품 줄은 건너뜀)', () => {
  const c = catalog(
    [product(1, 10000, { name: '=위험한, "이름"' }), product(2, 20000), product(3, 30000)],
    [
      attrs(1, { tags: ['죽방렴', '자연건조'], story: '첫 줄\n둘째 줄, 쉼표', excludedEvents: [{ event: 'birth', reason: '생물; 보관 어려움' }] }),
      attrs(2, { events: ['longevity', 'promotion'], reviewed: true }),
    ],
  );
  const csv = attributesCsv(c);
  const back = parseAttributesCsv(csv, c);
  assert.deepEqual(back.errors, []);
  assert.equal(back.rows.length, 2);
  for (const row of back.rows) {
    const before = c.attributes.find((a) => a.productNo === row.productNo)!;
    assert.deepEqual(attributeDiff(before, row, testConfig), [], `상품 ${row.productNo}`);
  }
});

test('CSV 올리기: 점수·행사 이름·상품번호를 검사하고, 없는 칸은 지금 값 유지', () => {
  const c = catalog([product(1, 10000), product(2, 10000)], [attrs(1, { meanings: { funeral: '위로의 뜻' } })]);
  const ok = parseAttributesCsv('상품번호,희소성,어울리는 행사,검토 완료,메모\n1,8,"장례, 회갑/칠순",예,무시\n2,3,,N,\n', c);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.ignoredColumns, ['메모']);
  assert.equal(ok.rows[0].scores.rarity, 8);
  assert.equal(ok.rows[0].scores.formality, 7, '없는 칸은 그대로');
  assert.deepEqual(ok.rows[0].events, ['funeral', 'longevity']);
  assert.equal(ok.rows[0].meanings.funeral, '위로의 뜻');
  assert.equal(ok.rows[0].reviewed, true);
  assert.equal(ok.rows[1].scores.rarity, 3, '지표가 없던 상품은 새로 만든다');

  const bad = parseAttributesCsv('상품번호,희소성,어울리는 행사,제외 행사\n1,11,돌잔치,장례\n9,5,,\n1,5,,\nabc,1,,\n', c);
  assert.equal(bad.errors.length, 6, bad.errors.join('\n'));
  assert.match(bad.errors.join('\n'), /희소성 '11'/);
  assert.match(bad.errors.join('\n'), /'돌잔치'/);
  assert.match(bad.errors.join('\n'), /사유가 없습니다/);
  assert.match(bad.errors.join('\n'), /9는 쇼핑몰 상품 목록에 없습니다/);
  assert.match(bad.errors.join('\n'), /두 번 나옵니다/);
  assert.match(bad.errors.join('\n'), /숫자가 아닙니다/);
  assert.match(parseAttributesCsv('이름,희소성\n', c).errors[0], /상품번호/);
  assert.match(parseAttributesCsv('상품번호,어울리는 행사,제외 행사\n1,장례,장례: 생물\n', c).errors[0], /함께 있습니다/);
});

// ---------- 주문번호 붙여넣기 ----------

test('주문 상세 붙여넣기: 코드마다 바로 앞 주문번호를 잇는다', () => {
  const text = `주문번호 20261022-0000123\n상품 멸치 30개\n온답 포장 디자인 코드 : od-7qdf-3p6m\n\n주문번호 20261022-0000124 곶감\n코드 OD-AAAA-BBBB, OD-AAAA-BBBB`;
  assert.deepEqual(extractOrderLinks(text), [
    { code: 'OD-7QDF-3P6M', orderNo: '20261022-0000123' },
    { code: 'OD-AAAA-BBBB', orderNo: '20261022-0000124' },
  ]);
  assert.deepEqual(extractOrderLinks('OD-CCCC-DDDD 주문 20261022-0000999'), [{ code: 'OD-CCCC-DDDD', orderNo: '20261022-0000999' }], '번호가 하나면 모두 그 번호');
  assert.deepEqual(extractOrderLinks('OD-0000-1111 없음'), []);
});

// ---------- 늦어지는 건 ----------

test('늦어지는 건: 접수 3일, 주문 확인 2일', () => {
  const now = Date.parse('2026-10-22T09:00:00Z');
  const ago = (days: number) => new Date(now - days * 86400000 - 1000).toISOString();
  assert.equal(isLate({ status: 'received', createdAt: ago(3), statusChangedAt: ago(3) }, now), true);
  assert.equal(isLate({ status: 'received', createdAt: ago(2), statusChangedAt: ago(2) }, now), false);
  assert.equal(isLate({ status: 'order_confirmed', createdAt: ago(9), statusChangedAt: ago(2) }, now), true);
  assert.equal(isLate({ status: 'order_confirmed', createdAt: ago(9), statusChangedAt: ago(1) }, now), false);
  assert.equal(isLate({ status: 'printed', createdAt: ago(30), statusChangedAt: ago(30) }, now), false);
});

// ---------- 카페24 가져오기 요약 ----------

test('카페24 가져오기 요약: 새 상품·가격·품절·재개·사라짐', () => {
  const before = [product(1, 10000), product(2, 20000), product(3, 30000, { soldOut: true }), product(4, 40000)];
  const after = [product(1, 12000), product(2, 20000, { display: false }), product(3, 30000), product(5, 50000)];
  const d = diffProducts(before, after);
  assert.deepEqual(d.added.map((p) => p.productNo), [5]);
  assert.deepEqual(d.removed.map((p) => p.productNo), [4]);
  assert.deepEqual(d.priceChanged.map((x) => [x.product.productNo, x.from]), [[1, 10000]]);
  assert.deepEqual(d.stopped.map((p) => p.productNo), [2]);
  assert.deepEqual(d.resumed.map((p) => p.productNo), [3]);
  assert.equal(syncSummary(d), '새 상품 1, 가격 변경 1, 품절·판매중지 1, 판매 재개 1, 사라짐 1');
  assert.equal(syncSummary(diffProducts(before, before)), '바뀐 상품 없음');
});

// ---------- 자주 추천되던 상품 품절 ----------

test('자주 1위였던 상품이 팔 수 없게 되면 알린다', () => {
  const rec = (first: number) => ({ createdAt: '2026-10-20T00:00:00Z', event: 'funeral', relation: 'senior', resultProductNos: [first, 9] });
  const recs = [rec(1), rec(1), rec(1), rec(2), rec(2), rec(2), rec(2), rec(3)];
  const products = [product(1, 1, { soldOut: true }), product(2, 1, { display: false }), product(3, 1, { soldOut: true }), product(9, 1, { soldOut: true })];
  assert.deepEqual(soldOutFavorites(recs, products).map((a) => [a.productNo, a.first, a.state]), [[2, 4, '미진열'], [1, 3, '품절']]);
});
