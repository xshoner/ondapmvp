import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validStatsPeriod, kstDate, summarize, unmetDemand, type RecLog, type DesignLog } from '../src/stats/summary.ts';
import { lateSince, LATE_DAYS, isLate } from '../src/packaging/design-filter.ts';

test('대시보드 기간 유효성 검증: 최대 400일 및 날짜 형식 준수', () => {
  assert.equal(validStatsPeriod('2026-10-01', '2026-10-30'), true);
  // 400일 초과 시 차단
  assert.equal(validStatsPeriod('2025-01-01', '2026-11-09'), false);
  // 시작일이 종료일보다 뒤면 차단
  assert.equal(validStatsPeriod('2026-11-10', '2026-11-09'), false);
  // 잘못된 날짜 형식 차단
  assert.equal(validStatsPeriod('2026-13-45', '2026-11-09'), false);
  assert.equal(validStatsPeriod('invalid', '2026-11-09'), false);
});

test('대시보드 오늘 할 일: 접수 3일, 확인 2일 초과 시 지연(late) 감지', () => {
  const now = Date.parse('2026-11-09T15:00:00Z');
  const since = lateSince(now);

  // 4일 전 접수 -> 지연
  const fourDaysAgo = new Date(now - 4 * 86400000).toISOString();
  assert.equal(
    isLate({ status: 'received', createdAt: fourDaysAgo, statusChangedAt: fourDaysAgo }, now),
    true
  );

  // 1일 전 접수 -> 지연 아님
  const oneDayAgo = new Date(now - 1 * 86400000).toISOString();
  assert.equal(
    isLate({ status: 'received', createdAt: oneDayAgo, statusChangedAt: oneDayAgo }, now),
    false
  );

  // 3일 전 주문확인 후 인쇄 대기 -> 지연 (기준: 2일)
  const threeDaysAgo = new Date(now - 3 * 86400000).toISOString();
  assert.equal(
    isLate({ status: 'order_confirmed', createdAt: fourDaysAgo, statusChangedAt: threeDaysAgo }, now),
    true
  );

  // 1일 전 주문확인 -> 지연 아님
  assert.equal(
    isLate({ status: 'order_confirmed', createdAt: fourDaysAgo, statusChangedAt: oneDayAgo }, now),
    false
  );

  // 취소 및 완료 건은 지연 검사 대상 아님
  assert.equal(
    isLate({ status: 'printed', createdAt: fourDaysAgo, statusChangedAt: fourDaysAgo }, now),
    false
  );
  assert.equal(
    isLate({ status: 'canceled', createdAt: fourDaysAgo, statusChangedAt: fourDaysAgo }, now),
    false
  );
});

test('대시보드 핵심 지표: 결제 완료가 아닌 주문 연결 및 인쇄 완료 집계 정의 보존', () => {
  const recs: RecLog[] = [
    { createdAt: '2026-11-01T00:00:00Z', event: 'wedding', relation: 'friend', resultProductNos: [1, 2, 3] },
    { createdAt: '2026-11-02T00:00:00Z', event: 'birth', relation: 'family', resultProductNos: [2, 3, 4] },
  ];

  const designs: DesignLog[] = [
    // 1. 주문번호가 입력된 접수
    { createdAt: '2026-11-01T01:00:00Z', status: 'received', orderNo: '20261101-0001', hasSticker: true },
    // 2. 주문 확인 상태인 접수
    { createdAt: '2026-11-01T02:00:00Z', status: 'order_confirmed', orderNo: null, hasSticker: true },
    // 3. 인쇄 완료된 접수
    { createdAt: '2026-11-02T01:00:00Z', status: 'printed', orderNo: '20261102-0002', hasSticker: false },
    // 4. 주문 미연결 접수 (대기 상태)
    { createdAt: '2026-11-02T02:00:00Z', status: 'received', orderNo: null, hasSticker: false },
    // 5. 취소된 접수 (집계 제외)
    { createdAt: '2026-11-02T03:00:00Z', status: 'canceled', orderNo: null, hasSticker: true },
  ];

  const s = summarize(recs, designs, { from: '2026-11-01', to: '2026-11-03' });

  // 추천 결과 조회 수
  assert.equal(s.totals.recommendations, 2);
  // 포장 디자인 정상 접수 (취소 1건 제외)
  assert.equal(s.totals.designs, 4);
  // 스티커 포함 접수
  assert.equal(s.totals.withSticker, 2);
  // 주문 연결 접수 (주문번호 있거나 order_confirmed/printed: 1, 2, 3번)
  assert.equal(s.totals.ordered, 3);
  // 인쇄 완료 접수 (3번)
  assert.equal(s.totals.printed, 1);

  // 0인 날짜도 일별 데이터에 정확히 0으로 포함되어야 함 (2026-11-03)
  const nov3 = s.days.find((d) => d.date === '2026-11-03');
  assert.ok(nov3);
  assert.equal(nov3.recommendations, 0);
  assert.equal(nov3.designs, 0);
});

test('대시보드 부족 수요 (찾았지만 없던 것): 가격 변동 한계 및 조건별 집계 검증', () => {
  const recs: RecLog[] = [
    // 1. 추천 개수 부족 (2개만 반환)
    { createdAt: '2026-11-01T00:00:00Z', event: 'wedding', relation: 'friend', resultProductNos: [1, 2], budgetMax: 50000 },
    // 2. 예산 초과 (현재 가격이 예산 30000 초과)
    { createdAt: '2026-11-01T01:00:00Z', event: 'wedding', relation: 'friend', resultProductNos: [1, 2, 3], budgetMax: 30000 },
    // 3. 정상 추천 (예산 내 3개)
    { createdAt: '2026-11-01T02:00:00Z', event: 'wedding', relation: 'friend', resultProductNos: [1, 2, 4], budgetMax: 50000 },
  ];

  const prices = new Map<number, number>([
    [1, 25000],
    [2, 28000],
    [3, 35000], // 30000 예산 초과 유발
    [4, 40000],
  ]);

  const unmet = unmetDemand(recs, prices, 3);
  assert.equal(unmet.length, 2);

  // 3만 원 이하 조건: 예산 초과 (relaxed) 1건
  const row30k = unmet.find((r) => r.band === '3만 원 이하');
  assert.ok(row30k);
  assert.equal(row30k.total, 1);
  assert.equal(row30k.short, 0);
  assert.equal(row30k.relaxed, 1);

  // 5만 원 이하 조건: 결과 부족 (short) 1건
  const row50k = unmet.find((r) => r.band === '5만 원 이하');
  assert.ok(row50k);
  assert.equal(row50k.total, 2);
  assert.equal(row50k.short, 1);
  assert.equal(row50k.relaxed, 0);
});
