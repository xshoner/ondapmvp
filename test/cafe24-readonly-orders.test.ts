import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchRecentCafe24OrdersReadOnly,
  getCafe24OrderStatusLabel,
  getCafe24PaymentStatusLabel,
} from '../src/cafe24/readonly-orders.ts';
import type { Cafe24AdminOrder } from '../src/cafe24/admin-orders.ts';

describe('카페24 읽기 전용 주문 조회 (fetchRecentCafe24OrdersReadOnly & helpers)', () => {
  it('주문 상태 및 결제 상태 라벨 변환', () => {
    assert.equal(getCafe24OrderStatusLabel('N00'), '입금전');
    assert.equal(getCafe24OrderStatusLabel('N10'), '상품준비중');
    assert.equal(getCafe24OrderStatusLabel('N20'), '배송준비중');
    assert.equal(getCafe24OrderStatusLabel('N30'), '배송중');
    assert.equal(getCafe24OrderStatusLabel('N40'), '배송완료');
    assert.equal(getCafe24OrderStatusLabel('C40'), '주문취소');
    assert.equal(getCafe24OrderStatusLabel('R20'), '반품/환불');
    assert.equal(getCafe24OrderStatusLabel('E10'), '교환');

    const paidOrder: Cafe24AdminOrder = {
      order_id: '20261117-1000001',
      shop_no: 1,
      order_date: '2026-11-17 10:00:00',
      paid: 'T',
      canceled: 'F',
      items: [],
    };
    assert.equal(getCafe24PaymentStatusLabel(paidOrder), '결제완료');

    const unpaidOrder: Cafe24AdminOrder = {
      order_id: '20261117-1000002',
      shop_no: 1,
      order_date: '2026-11-17 10:00:00',
      paid: 'F',
      canceled: 'F',
      items: [],
    };
    assert.equal(getCafe24PaymentStatusLabel(unpaidOrder), '미결제 (입금대기)');

    const canceledOrder: Cafe24AdminOrder = {
      order_id: '20261117-1000003',
      shop_no: 1,
      order_date: '2026-11-17 10:00:00',
      paid: 'T',
      canceled: 'T',
      items: [],
    };
    assert.equal(getCafe24PaymentStatusLabel(canceledOrder), '취소/환불');
  });

  it('환경변수 CAFE24_MALL_ID 미설정 시 CONFIG_MISSING 반환', async () => {
    const origMallId = process.env.CAFE24_MALL_ID;
    try {
      delete process.env.CAFE24_MALL_ID;
      const res = await fetchRecentCafe24OrdersReadOnly();
      assert.equal(res.ok, false);
      assert.equal(res.errorCode, 'CONFIG_MISSING');
      assert.match(res.error || '', /CAFE24_MALL_ID/);
    } finally {
      if (origMallId !== undefined) process.env.CAFE24_MALL_ID = origMallId;
    }
  });

  it('카페24 API 응답을 목(mock)하여 정상 페이지네이션 및 주문 반환 검증', async () => {
    const origFetch = globalThis.fetch;
    const origMallId = process.env.CAFE24_MALL_ID;

    try {
      process.env.CAFE24_MALL_ID = 'testmall';

      let callCount = 0;
      globalThis.fetch = (async (url: string | URL | Request) => {
        callCount++;
        const urlStr = String(url);
        assert.ok(urlStr.includes('testmall.cafe24api.com/api/v2/admin/orders'));

        // 첫 페이지는 100건(더 있음), 둘째 페이지는 50건(종료)
        const count = callCount === 1 ? 100 : 50;
        const orders = Array.from({ length: count }, (_, i) => ({
          order_id: `20261117-${String(callCount * 100 + i).padStart(7, '0')}`,
          shop_no: 1,
          order_date: '2026-11-17 10:00:00',
          paid: 'T',
          canceled: 'F',
          items: [
            {
              product_no: 101,
              product_name: `상품 ${i}`,
              quantity: 1,
            },
          ],
        }));

        return new Response(JSON.stringify({ orders }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      const res = await fetchRecentCafe24OrdersReadOnly({
        customToken: 'mock-valid-token',
        days: 3,
        maxPages: 5,
      });

      assert.equal(res.ok, true);
      assert.equal(res.orders.length, 150);
      assert.equal(res.total, 150);
      assert.equal(callCount, 2);
    } finally {
      globalThis.fetch = origFetch;
      if (origMallId !== undefined) process.env.CAFE24_MALL_ID = origMallId;
    }
  });

  it('403 Forbidden 권한 부족 시 PERMISSION_DENIED 오류 반환', async () => {
    const origFetch = globalThis.fetch;
    const origMallId = process.env.CAFE24_MALL_ID;

    try {
      process.env.CAFE24_MALL_ID = 'testmall';
      globalThis.fetch = (async () => {
        return new Response('Forbidden', { status: 403 });
      }) as typeof fetch;

      const res = await fetchRecentCafe24OrdersReadOnly({
        customToken: 'mock-token',
      });

      assert.equal(res.ok, false);
      assert.equal(res.errorCode, 'PERMISSION_DENIED');
      assert.match(res.error || '', /권한/);
    } finally {
      globalThis.fetch = origFetch;
      if (origMallId !== undefined) process.env.CAFE24_MALL_ID = origMallId;
    }
  });
});
