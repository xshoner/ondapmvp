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
import { verifyAndAcceptOrder } from '../src/cafe24/intake-worker.ts';

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
