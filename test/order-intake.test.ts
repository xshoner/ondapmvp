import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractDesignCode,
  hasPackagingOption,
  isOrderCanceled,
  isOrderPaid,
  type Cafe24AdminOrder,
} from '../src/cafe24/admin-orders.ts';
import { syncRecentCafe24Orders, verifyAndAcceptOrder } from '../src/cafe24/intake-worker.ts';
import { setLocalTokenCacheForTesting } from '../src/cafe24/oauth.ts';

test('주문 결제 상태 및 취소 상태를 정확히 판별한다', () => {
  // 1. 미결제 (무통장 입금전 F, 상태 N00)
  const unpaidOrder: Cafe24AdminOrder = {
    order_id: '20261108-0000010',
    shop_no: 1,
    order_date: '2026-11-08T06:25:00+09:00',
    payment_status: 'F',
    order_status: 'N00',
    items: [],
  };
  assert.equal(isOrderPaid(unpaidOrder), false);
  assert.equal(isOrderCanceled(unpaidOrder), false);

  // 2. 추가입금대기 (M)
  const partialOrder: Cafe24AdminOrder = {
    ...unpaidOrder,
    payment_status: 'M',
    order_status: 'N02',
  };
  assert.equal(isOrderPaid(partialOrder), false);

  // 3. 결제 완료 (카드 P, 준비중 N10)
  const paidCardOrder: Cafe24AdminOrder = {
    ...unpaidOrder,
    payment_status: 'P',
    order_status: 'N10',
  };
  assert.equal(isOrderPaid(paidCardOrder), true);
  assert.equal(isOrderCanceled(paidCardOrder), false);

  // 4. 입금 완료 (무통장 자동입금 A, 준비중 N10)
  const paidBankOrder: Cafe24AdminOrder = {
    ...unpaidOrder,
    payment_status: 'A',
    order_status: 'N10',
  };
  assert.equal(isOrderPaid(paidBankOrder), true);

  // 5. 취소 주문 (C40)
  const canceledOrder: Cafe24AdminOrder = {
    ...unpaidOrder,
    payment_status: 'F',
    order_status: 'C40',
  };
  assert.equal(isOrderPaid(canceledOrder), false);
  assert.equal(isOrderCanceled(canceledOrder), true);
});

test('주문에서 디자인 코드와 포장 옵션을 정확히 추출한다', () => {
  // 주문 추가 정보에 코드가 있는 경우
  const orderWithCommonField: Cafe24AdminOrder = {
    order_id: '20261108-0000010',
    shop_no: 1,
    order_date: '2026-11-08T06:25:00+09:00',
    payment_status: 'P',
    order_status: 'N10',
    additional_order_info_list: [
      { id: 1, name: '온답 포장 디자인 코드 (공통)', value: 'OD-8UJV-VY8G' },
    ],
    items: [
      {
        product_no: 48,
        product_name: '하동 전통 차밭에서 딴 수제 우전 녹차',
        quantity: 5,
        options: [{ name: '포장 디자인 서비스', value: '신청' }],
      },
    ],
  };

  assert.equal(extractDesignCode(orderWithCommonField), 'OD-8UJV-VY8G');
  assert.equal(hasPackagingOption(orderWithCommonField.items[0]), true);

  // 포장 옵션을 선택하지 않은 경우
  const noPackagingItem = {
    product_no: 48,
    product_name: '하동 전통 차밭에서 딴 수제 우전 녹차',
    quantity: 5,
    options: [{ name: '포장 디자인 서비스', value: '신청하지 않음' }],
  };
  assert.equal(hasPackagingOption(noPackagingItem), false);
});

test('verifyAndAcceptOrder: 실제 시험 주문 20261108-0000010는 미결제이므로 접수되지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dapryeq-order-test-'));
  process.env.ONDAP_TEST_DATA_DIR = dir;
  process.env.ONDAP_DATA_SOURCE = 'local';

  try {
    const { createDesign, lookupDesign } = await import('../src/data/packaging-repository.ts');
    // 시험 주문에 해당하는 디자인 등록
    await createDesign({
      code: 'OD-8UJV-VY8G',
      productNo: 48,
      productName: '하동 전통 차밭에서 딴 수제 우전 녹차',
      quantity: 5,
      event: null,
      styleId: 'test-style',
      styleName: '송학 장생',
      sticker: null,
      draft: null,
    }, null);

    // 카페24 시험 주문 20261108-0000010 데이터 (실제 상태: 입금전 F, N00)
    const testOrder: Cafe24AdminOrder = {
      order_id: '20261108-0000010',
      shop_no: 1,
      order_date: '2026-11-08T06:25:00+09:00',
      payment_status: 'F', // 미결제
      order_status: 'N00',  // 입금전
      additional_order_info_list: [
        { id: 1, name: '온답 포장 디자인 코드 (공통)', value: 'OD-8UJV-VY8G' },
      ],
      items: [
        {
          product_no: 48,
          product_name: '하동 전통 차밭에서 딴 수제 우전 녹차',
          quantity: 5,
          options: [{ name: '포장 디자인 서비스', value: '신청' }],
        },
      ],
    };

    const decision = await verifyAndAcceptOrder(testOrder);
    assert.equal(decision.status, 'unpaid');

    // DB의 디자인 상태는 여전히 pending(결제 대기)이어야 함
    const stored = await lookupDesign('OD-8UJV-VY8G');
    assert.equal(stored?.status, 'pending');

    const { listDesigns } = await import('../src/data/packaging-repository.ts');
    const [dBefore] = await listDesigns({ code: 'OD-8UJV-VY8G', limit: 1, includePending: true });
    assert.equal(dBefore?.orderNo, null);

    // 만약 사용자가 실제로 결제를 완료한 상태(payment_status = 'P', order_status = 'N10')로 들어온다면
    const paidOrder: Cafe24AdminOrder = {
      ...testOrder,
      payment_status: 'P',
      order_status: 'N10',
    };

    const paidDecision = await verifyAndAcceptOrder(paidOrder);
    assert.equal(paidDecision.status, 'confirmed');

    // 결제 확인 후 정상적으로 order_confirmed로 전환됨
    const confirmedDesign = await lookupDesign('OD-8UJV-VY8G');
    assert.equal(confirmedDesign?.status, 'order_confirmed');
    const [dAfter] = await listDesigns({ code: 'OD-8UJV-VY8G', limit: 1, includePending: true });
    assert.equal(dAfter?.orderNo, '20261108-0000010');

    // 동일한 결제 확인 알림이 다시 와도 멱등하게 already_confirmed 반환
    const duplicateDecision = await verifyAndAcceptOrder(paidOrder);
    assert.equal(duplicateDecision.status, 'already_confirmed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verifyAndAcceptOrder: 수량/상품 불일치 및 포장 옵션 미선택 시 접수를 거절한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dapryeq-order-test2-'));
  process.env.ONDAP_TEST_DATA_DIR = dir;
  process.env.ONDAP_DATA_SOURCE = 'local';

  try {
    const { createDesign } = await import('../src/data/packaging-repository.ts');
    await createDesign({
      code: 'OD-AAAA-BBBB',
      productNo: 48,
      productName: '녹차',
      quantity: 5,
      event: null,
      styleId: 'test',
      styleName: '스타일',
      sticker: null,
      draft: null,
    }, null);

    const basePaidOrder: Cafe24AdminOrder = {
      order_id: '20261108-0000099',
      shop_no: 1,
      order_date: '2026-11-08T06:25:00+09:00',
      payment_status: 'P',
      order_status: 'N10',
      additional_order_info_list: [
        { id: 1, name: '온답 포장 디자인 코드 (공통)', value: 'OD-AAAA-BBBB' },
      ],
      items: [
        {
          product_no: 48,
          product_name: '녹차',
          quantity: 3, // 불일치 수량 (디자인은 5개)
          options: [{ name: '포장 디자인 서비스', value: '신청' }],
        },
      ],
    };

    // 1. 수량 불일치
    const qtyMismatch = await verifyAndAcceptOrder(basePaidOrder);
    assert.equal(qtyMismatch.status, 'quantity_mismatch');

    // 2. 포장 옵션 미선택
    const noOptionOrder: Cafe24AdminOrder = {
      ...basePaidOrder,
      items: [
        {
          product_no: 48,
          product_name: '녹차',
          quantity: 5,
          options: [{ name: '포장 디자인 서비스', value: '선택 안 함' }],
        },
      ],
    };
    const optionMismatch = await verifyAndAcceptOrder(noOptionOrder);
    assert.equal(optionMismatch.status, 'option_mismatch');

    // 3. 상품 번호 불일치
    const productMismatchOrder: Cafe24AdminOrder = {
      ...basePaidOrder,
      items: [
        {
          product_no: 99, // 다른 상품
          product_name: '다른 상품',
          quantity: 5,
          options: [{ name: '포장 디자인 서비스', value: '신청' }],
        },
      ],
    };
    const prodMismatch = await verifyAndAcceptOrder(productMismatchOrder);
    assert.equal(prodMismatch.status, 'product_mismatch');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('syncRecentCafe24Orders: 주문 추가정보의 디자인 코드를 추출해 미결제 메모를 안전하게 작성하고 기존 메모를 보존한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dapryeq-sync-test-'));
  process.env.ONDAP_TEST_DATA_DIR = dir;
  process.env.ONDAP_DATA_SOURCE = 'local';
  process.env.CAFE24_MALL_ID = 'testmall';

  setLocalTokenCacheForTesting({
    mall_id: 'testmall',
    shop_no: 1,
    access_token: 'valid_test_token',
    refresh_token: 'valid_refresh_token',
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    refresh_token_expires_at: new Date(Date.now() + 86400000).toISOString(),
    scope: 'mall.read_product,mall.read_order',
    updated_at: new Date().toISOString(),
  });

  const originalFetch = globalThis.fetch;

  try {
    const { createDesign, lookupDesign, listDesigns, updateDesign } = await import('../src/data/packaging-repository.ts');

    // 1. 주문 20261108-0000038에 해당하는 디자인 OD-EJF4-JSV2 등록
    await createDesign({
      code: 'OD-EJF4-JSV2',
      productNo: 20,
      productName: '완도 청정 바다 활전복 선물용',
      quantity: 10,
      event: null,
      styleId: 'test-style',
      styleName: '매화 노리개',
      sticker: null,
      draft: null,
    }, null);

    // 카페24 미결제(무통장 입금 대기) 주문 20261108-0000038
    // 디자인 코드가 additional_order_info_list에 저장되어 있음
    const order38: Cafe24AdminOrder = {
      order_id: '20261108-0000038',
      shop_no: 1,
      order_date: '2026-11-08 19:56:18',
      paid: 'F',
      payment_status: 'F',
      order_status: 'N00',
      additional_order_info_list: [
        { id: 1, name: '답례큐 포장 디자인 코드', value: 'OD-EJF4-JSV2' },
      ],
      items: [
        {
          product_no: 20,
          product_name: '완도 청정 바다 활전복 선물용',
          quantity: 10,
          options: [{ name: '포장 디자인 옵션', value: '포장신청' }],
        },
      ],
    };

    let requestedUrls: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      requestedUrls.push(urlStr);

      if (urlStr.includes('/api/v2/admin/orders')) {
        // embed에 items와 additional_order_info_list가 모두 포함되어 있는지 확인
        assert.ok(urlStr.includes('embed=items%2Cadditional_order_info_list') || urlStr.includes('embed=items,additional_order_info_list'), 'API 요청 시 additional_order_info_list가 embed 되어야 함');
        return new Response(JSON.stringify({ orders: [order38] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    // 동기화 실행
    const result1 = await syncRecentCafe24Orders(3);
    assert.equal(result1.total, 1);
    assert.equal(result1.confirmed, 0);
    assert.equal(result1.pendingOrders, 1);

    // 디자인 확인: status는 pending 유지, orderNo는 null, 메모는 자동 표시됨
    const [dAfter1] = await listDesigns({ code: 'OD-EJF4-JSV2', limit: 1, includePending: true });
    assert.equal(dAfter1?.status, 'pending');
    assert.equal(dAfter1?.orderNo, null);
    assert.equal(dAfter1?.memo, '카페24 주문: 20261108-0000038 (무통장 입금 대기)');

    // 2. 반복 동기화 실행 시 메모 중복 방지 검증
    const result2 = await syncRecentCafe24Orders(3);
    assert.equal(result2.pendingOrders, 1, '결제 대기 주문 수는 1건으로 유지');
    const [dAfter2] = await listDesigns({ code: 'OD-EJF4-JSV2', limit: 1, includePending: true });
    assert.equal(dAfter2?.memo, '카페24 주문: 20261108-0000038 (무통장 입금 대기)', '반복 동기화해도 메모가 중복되지 않아야 함');

    // 3. 기존 관리자 메모가 있는 상태에서 동기화 시 기존 메모 보존 검증
    await updateDesign('OD-EJF4-JSV2', {
      status: 'pending',
      orderNo: null,
      memo: '고객 특별 요청: 노리개 포장',
    });

    const result3 = await syncRecentCafe24Orders(3);
    assert.equal(result3.pendingOrders, 1);
    const [dAfter3] = await listDesigns({ code: 'OD-EJF4-JSV2', limit: 1, includePending: true });
    assert.equal(dAfter3?.memo, '고객 특별 요청: 노리개 포장\n카페24 주문: 20261108-0000038 (무통장 입금 대기)');

    // 4. 불일치/취소 주문 방어 검증
    // 4-1. 상품번호 불일치 (order has product_no 999)
    const mismatchProductOrder: Cafe24AdminOrder = {
      ...order38,
      order_id: '20261108-0000040',
      items: [{ product_no: 999, product_name: '다른 상품', quantity: 10, options: [{ name: '포장 디자인', value: '포장신청' }] }],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify({ orders: [mismatchProductOrder] }))) as typeof fetch;
    await syncRecentCafe24Orders(3);
    const [dMismatch1] = await listDesigns({ code: 'OD-EJF4-JSV2', limit: 1, includePending: true });
    assert.ok(!dMismatch1?.memo.includes('20261108-0000040'), '상품번호 불일치 시 메모가 추가되지 않아야 함');

    // 4-2. 수량 불일치 (order has quantity 5, design has 10)
    const mismatchQtyOrder: Cafe24AdminOrder = {
      ...order38,
      order_id: '20261108-0000041',
      items: [{ product_no: 20, product_name: '활전복', quantity: 5, options: [{ name: '포장 디자인', value: '포장신청' }] }],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify({ orders: [mismatchQtyOrder] }))) as typeof fetch;
    await syncRecentCafe24Orders(3);
    const [dMismatch2] = await listDesigns({ code: 'OD-EJF4-JSV2', limit: 1, includePending: true });
    assert.ok(!dMismatch2?.memo.includes('20261108-0000041'), '수량 불일치 시 메모가 추가되지 않아야 함');

    // 4-3. 포장 옵션 미신청 ("신청안함")
    const noOptionOrder: Cafe24AdminOrder = {
      ...order38,
      order_id: '20261108-0000042',
      items: [{ product_no: 20, product_name: '활전복', quantity: 10, options: [{ name: '포장 디자인', value: '신청하지 않음' }] }],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify({ orders: [noOptionOrder] }))) as typeof fetch;
    await syncRecentCafe24Orders(3);
    const [dMismatch3] = await listDesigns({ code: 'OD-EJF4-JSV2', limit: 1, includePending: true });
    assert.ok(!dMismatch3?.memo.includes('20261108-0000042'), '포장 옵션 미신청 시 메모가 추가되지 않아야 함');

    // 4-4. 취소 주문 (canceled: 'T')
    const canceledOrder: Cafe24AdminOrder = {
      ...order38,
      order_id: '20261108-0000043',
      canceled: 'T',
    };
    globalThis.fetch = (async () => new Response(JSON.stringify({ orders: [canceledOrder] }))) as typeof fetch;
    await syncRecentCafe24Orders(3);
    const [dMismatch4] = await listDesigns({ code: 'OD-EJF4-JSV2', limit: 1, includePending: true });
    assert.ok(!dMismatch4?.memo.includes('20261108-0000043'), '취소된 주문은 메모가 추가되지 않아야 함');

    // 4-5. 다른 주문에 이미 연결된 디자인
    await updateDesign('OD-EJF4-JSV2', {
      status: 'pending',
      orderNo: '20261108-0000001',
      memo: '기존 연결',
    });
    const conflictOrder: Cafe24AdminOrder = {
      ...order38,
      order_id: '20261108-0000044',
    };
    globalThis.fetch = (async () => new Response(JSON.stringify({ orders: [conflictOrder] }))) as typeof fetch;
    await syncRecentCafe24Orders(3);
    const [dConflict] = await listDesigns({ code: 'OD-EJF4-JSV2', limit: 1, includePending: true });
    assert.ok(!dConflict?.memo.includes('20261108-0000044'), '다른 주문번호가 이미 지정된 디자인은 덮어쓰지 않아야 함');

    // 5. 결제 완료된 주문에 대한 기존 정상 처리 유지 검증
    // 미결제 주문 38이 이후 고객 입금 완료되어 payment_status='P', order_status='N10'으로 변경된 경우
    const paidOrder38: Cafe24AdminOrder = {
      ...order38,
      paid: 'T',
      payment_status: 'P',
      order_status: 'N10',
    };
    globalThis.fetch = (async () => new Response(JSON.stringify({ orders: [paidOrder38] }))) as typeof fetch;
    const paidResult = await syncRecentCafe24Orders(3);
    assert.equal(paidResult.confirmed, 1, '결제 완료 주문은 confirmed로 처리');
    const [dPaid] = await listDesigns({ code: 'OD-EJF4-JSV2', limit: 1, includePending: true });
    assert.equal(dPaid?.status, 'order_confirmed', '결제 완료 시 order_confirmed 상태로 정상 전환');
    assert.equal(dPaid?.orderNo, '20261108-0000038', '주문번호가 정식 연결되어야 함');

    // 6. API 오류 시 예외 발생 검증
    globalThis.fetch = (async () => new Response('Internal Error', { status: 500 })) as typeof fetch;
    await assert.rejects(
      async () => syncRecentCafe24Orders(3),
      /카페24 주문 목록 조회 실패 \(500\)/,
      'API 오류 시 0건 성공으로 위장하지 않고 오류를 던져야 함',
    );
  } finally {
    globalThis.fetch = originalFetch;
    setLocalTokenCacheForTesting(null);
    await rm(dir, { recursive: true, force: true });
  }
});
