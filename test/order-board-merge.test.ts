import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeDesignsAndOrders,
  summarizeCafe24Order,
} from '../src/packaging/order-board-merge.ts';
import type { Design } from '../src/packaging/types.ts';
import type { Cafe24AdminOrder } from '../src/cafe24/admin-orders.ts';

function createMockDesign(code: string, overrides: Partial<Design> = {}): Design {
  return {
    code,
    productNo: 101,
    productName: '호두강정 10구 세트',
    quantity: 30,
    event: 'wedding',
    styleId: 'classic-ribbon',
    styleName: '클래식 리본 포장',
    sticker: null,
    card: null,
    draft: null,
    cardDraft: null,
    status: 'order_confirmed',
    hasPrintFile: false,
    hasCardPrintFile: false,
    memo: '',
    sourceCode: null,
    createdAt: '2026-11-17T10:00:00.000Z',
    statusChangedAt: '2026-11-17T10:00:00.000Z',
    eventDate: '2026-11-25',
    desiredDeliveryDate: '2026-11-23',
    printCode: `PRT-${code}`,
    orderNo: null,
    ...overrides,
  };
}

describe('주문·포장 작업판 결합 (mergeDesignsAndOrders)', () => {
  it('1. 디자인 미연결: 포장 옵션이 선택되었으나 디자인 접수가 없는 카페24 주문', () => {
    const designs: Design[] = [];
    const orders: Cafe24AdminOrder[] = [
      {
        order_id: '20261117-0000001',
        shop_no: 1,
        order_date: '2026-11-17 14:00:00',
        paid: 'T',
        canceled: 'F',
        order_status: 'N10', // 상품준비중
        items: [
          {
            product_no: 101,
            product_name: '답례떡 3구',
            quantity: 50,
            options: [{ name: '선물 포장', value: '보자기 포장 신청' }],
          },
        ],
      },
    ];

    const merged = mergeDesignsAndOrders(designs, orders);
    assert.equal(merged.length, 1);
    const item = merged[0];
    assert.equal(item.kind, 'unlinked_order');
    if (item.kind === 'unlinked_order') {
      assert.equal(item.order.orderId, '20261117-0000001');
      assert.equal(item.order.paid, true);
      assert.equal(item.order.paymentStatusLabel, '결제완료');
      assert.equal(item.order.orderStatusLabel, '상품준비중');
      assert.equal(item.order.hasPackaging, true);
      assert.match(item.missingReason, /포장 옵션/);
    }
  });

  it('2. 포장 미요청: 포장 옵션이 전혀 없는 일반 상품 주문', () => {
    const designs: Design[] = [];
    const orders: Cafe24AdminOrder[] = [
      {
        order_id: '20261117-0000002',
        shop_no: 1,
        order_date: '2026-11-17 15:00:00',
        paid: 'T',
        canceled: 'F',
        order_status: 'N20', // 배송준비중
        items: [
          {
            product_no: 201,
            product_name: '일반 찹쌀떡 단품',
            quantity: 10,
            options: [{ name: '맛 선택', value: '호두' }],
          },
        ],
      },
    ];

    const merged = mergeDesignsAndOrders(designs, orders);
    assert.equal(merged.length, 1);
    const item = merged[0];
    assert.equal(item.kind, 'no_packaging_order');
    if (item.kind === 'no_packaging_order') {
      assert.equal(item.order.orderId, '20261117-0000002');
      assert.equal(item.order.hasPackaging, false);
      assert.match(item.reason, /일반 상품 주문/);
    }
  });

  it('3. 확인 불가: 품목 목록이 비어 있거나 불완전한 주문', () => {
    const designs: Design[] = [];
    const orders: Cafe24AdminOrder[] = [
      {
        order_id: '20261117-0000003',
        shop_no: 1,
        order_date: '2026-11-17 16:00:00',
        paid: 'T',
        canceled: 'F',
        items: [],
      },
    ];

    const merged = mergeDesignsAndOrders(designs, orders);
    assert.equal(merged.length, 1);
    const item = merged[0];
    assert.equal(item.kind, 'unknown_order');
    if (item.kind === 'unknown_order') {
      assert.equal(item.order.orderId, '20261117-0000003');
      assert.match(item.reason, /품목 정보가 비어 있거나/);
    }
  });

  it('4. 부분 취소 주문: 포장 품목이 취소된 경우 포장 미요청/취소로 정상 판별', () => {
    const designs: Design[] = [];
    const orders: Cafe24AdminOrder[] = [
      {
        order_id: '20261117-0000004',
        shop_no: 1,
        order_date: '2026-11-17 17:00:00',
        paid: 'T',
        canceled: 'F',
        order_status: 'N10',
        items: [
          {
            product_no: 101,
            product_name: '포장 떡 세트 (취소됨)',
            quantity: 20,
            status_code: 'C40', // 품목 취소
            options: [{ name: '포장', value: '전통 보자기 포장' }],
          },
          {
            product_no: 202,
            product_name: '일반 다과 (유효)',
            quantity: 5,
            options: [{ name: '맛', value: '단호박' }],
          },
        ],
      },
    ];

    const merged = mergeDesignsAndOrders(designs, orders);
    assert.equal(merged.length, 1);
    const item = merged[0];
    // 포장 품목은 취소되었고, 남은 유효 품목은 일반 다과뿐이므로 포장 미요청
    assert.equal(item.kind, 'no_packaging_order');
    if (item.kind === 'no_packaging_order') {
      assert.equal(item.order.hasPackaging, false);
      assert.equal(item.order.totalValidQuantity, 5);
      assert.equal(item.order.packagingQuantity, 0);
    }
  });

  it('5. 중복 노출 방지: 이미 디자인과 주문번호/코드로 매칭된 주문은 미연결/포장미요청으로 중복 노출되지 않음', () => {
    const design = createMockDesign('OD-TEST-0001', { orderNo: '20261117-0000005' });
    const orders: Cafe24AdminOrder[] = [
      {
        order_id: '20261117-0000005',
        shop_no: 1,
        order_date: '2026-11-17 18:00:00',
        paid: 'T',
        canceled: 'F',
        order_status: 'N10',
        items: [
          {
            product_no: 101,
            product_name: '호두강정 10구 세트',
            quantity: 30,
            options: [{ name: '포장', value: '리본 포장' }],
          },
        ],
      },
    ];

    const merged = mergeDesignsAndOrders([design], orders);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].kind, 'linked_design');
    if (merged[0].kind === 'linked_design') {
      assert.equal(merged[0].design.code, 'OD-TEST-0001');
      assert.ok(merged[0].matchedOrder);
      assert.equal(merged[0].matchedOrder?.orderId, '20261117-0000005');
    }
  });

  it('6. 다품목·다디자인 주문: 옵션에 기재된 디자인 코드로 올바르게 매칭', () => {
    const design = createMockDesign('OD-ABCD-EF23');
    const orders: Cafe24AdminOrder[] = [
      {
        order_id: '20261117-0000006',
        shop_no: 1,
        order_date: '2026-11-17 19:00:00',
        paid: 'T',
        canceled: 'F',
        order_status: 'N10',
        items: [
          {
            product_no: 101,
            product_name: '호두강정',
            quantity: 30,
            options: [{ name: '디자인 접수 코드', value: 'OD-ABCD-EF23' }],
          },
        ],
      },
    ];

    const merged = mergeDesignsAndOrders([design], orders);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].kind, 'linked_design');
    if (merged[0].kind === 'linked_design') {
      assert.equal(merged[0].matchedOrder?.orderId, '20261117-0000006');
    }
  });

  it('7. 결제·취소·환불 실제 상태 충실 반영 (미결제 및 전건 취소)', () => {
    // 7-1. 미결제 주문
    const unpaidOrder: Cafe24AdminOrder = {
      order_id: '20261117-0000007',
      shop_no: 1,
      order_date: '2026-11-17 20:00:00',
      paid: 'F',
      canceled: 'F',
      payment_status: 'F',
      order_status: 'N00',
      items: [
        {
          product_no: 101,
          product_name: '포장 상품',
          quantity: 10,
          options: [{ name: '포장', value: '보자기' }],
        },
      ],
    };

    const s1 = summarizeCafe24Order(unpaidOrder);
    assert.equal(s1.paid, false);
    assert.equal(s1.paymentStatusLabel, '미결제 (입금대기)');
    assert.equal(s1.orderStatusLabel, '입금전');

    // 7-2. 전건 취소 주문
    const canceledOrder: Cafe24AdminOrder = {
      order_id: '20261117-0000008',
      shop_no: 1,
      order_date: '2026-11-17 21:00:00',
      paid: 'F',
      canceled: 'T',
      order_status: 'C40',
      items: [
        {
          product_no: 101,
          product_name: '취소 상품',
          quantity: 10,
          options: [{ name: '포장', value: '보자기' }],
        },
      ],
    };

    const s2 = summarizeCafe24Order(canceledOrder);
    assert.equal(s2.canceled, true);
    assert.equal(s2.paymentStatusLabel, '취소/환불');
    assert.equal(s2.orderStatusLabel, '주문취소');
  });

  it('8. 복합 주문: 포장 상품과 일반 상품이 함께 있을 때 디자인 미연결 및 포장 수량 집계', () => {
    const orders: Cafe24AdminOrder[] = [
      {
        order_id: '20261117-0000009',
        shop_no: 1,
        order_date: '2026-11-17 22:00:00',
        paid: 'T',
        canceled: 'F',
        order_status: 'N10',
        items: [
          {
            product_no: 101,
            product_name: '포장 답례품',
            quantity: 40,
            options: [{ name: '선물 포장', value: '보자기 포장 신청' }],
          },
          {
            product_no: 201,
            product_name: '일반 다과 단품',
            quantity: 10,
            options: [{ name: '맛', value: '콩고물' }],
          },
        ],
      },
    ];

    const merged = mergeDesignsAndOrders([], orders);
    assert.equal(merged.length, 1);
    const item = merged[0];
    assert.equal(item.kind, 'unlinked_order');
    if (item.kind === 'unlinked_order') {
      assert.equal(item.order.totalValidQuantity, 50);
      assert.equal(item.order.packagingQuantity, 40);
      assert.equal(item.order.items.length, 2);
    }
  });

  it('9. 존재하지 않는 디자인 코드가 주문에 기재된 경우 디자인 미연결 분류 및 코드 유지', () => {
    const orders: Cafe24AdminOrder[] = [
      {
        order_id: '20261117-0000010',
        shop_no: 1,
        order_date: '2026-11-17 23:00:00',
        paid: 'T',
        canceled: 'F',
        order_status: 'N10',
        additional_order_info_list: [
          { name: '디자인코드', value: 'OD-WXYZ-9876' },
        ],
        items: [
          {
            product_no: 101,
            product_name: '답례떡 세트',
            quantity: 20,
          },
        ],
      },
    ];

    const merged = mergeDesignsAndOrders([], orders);
    assert.equal(merged.length, 1);
    const item = merged[0];
    assert.equal(item.kind, 'unlinked_order');
    if (item.kind === 'unlinked_order') {
      assert.deepEqual(item.suggestedCodes, ['OD-WXYZ-9876']);
      assert.match(item.missingReason, /OD-WXYZ-9876/);
    }
  });

  it('10. 복수 디자인 코드 주문에서 일부만 접수된 경우: 접수건은 linked_design, 미접수 코드는 unlinked_order로 보존', () => {
    // OD-ABCD-EF23만 등록됨
    const design = createMockDesign('OD-ABCD-EF23');
    const orders: Cafe24AdminOrder[] = [
      {
        order_id: '20261118-0000088',
        shop_no: 1,
        order_date: '2026-11-18 09:00:00',
        paid: 'T',
        canceled: 'F',
        order_status: 'N10',
        items: [
          {
            product_no: 101,
            product_name: '호두강정 10구 (디자인 1)',
            quantity: 30,
            options: [{ name: '선물 포장 코드', value: 'OD-ABCD-EF23' }],
          },
          {
            product_no: 102,
            product_name: '도라지정과 세트 (디자인 2 미접수)',
            quantity: 20,
            options: [{ name: '선물 포장 코드', value: 'OD-WXYZ-9876' }],
          },
        ],
      },
    ];

    const merged = mergeDesignsAndOrders([design], orders);
    assert.equal(merged.length, 2, '접수된 디자인 1건과 미접수 주문 1건이 모두 존재해야 함');

    const linked = merged.find((i) => i.kind === 'linked_design');
    assert.ok(linked, 'linked_design 항목이 있어야 함');
    assert.equal(linked?.code, 'OD-ABCD-EF23');

    const unlinked = merged.find((i) => i.kind === 'unlinked_order');
    assert.ok(unlinked, '미접수 코드를 위한 unlinked_order 항목이 있어야 함');
    if (unlinked && unlinked.kind === 'unlinked_order') {
      assert.deepEqual(unlinked.suggestedCodes, ['OD-WXYZ-9876']);
      assert.match(unlinked.missingReason, /OD-WXYZ-9876/);
    }
  });
});
