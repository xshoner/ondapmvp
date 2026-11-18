import type { Design } from './types.ts';
import {
  hasPackagingOption,
  isItemCanceledOrRefunded,
  isOrderCanceled,
  isOrderPaid,
  type Cafe24AdminOrder,
  type Cafe24AdminOrderItem,
} from '../cafe24/admin-orders.ts';
import {
  extractAllDesignCodes,
  extractItemDesignCode,
  getCafe24OrderStatusLabel,
  getCafe24PaymentStatusLabel,
} from '../cafe24/readonly-orders.ts';

export type MergedItemKind =
  | 'linked_design'      // 디자인 접수 완료 건 (기존 디자인 카드)
  | 'unlinked_order'     // 디자인 미연결 (포장 옵션/코드가 있으나 접수된 디자인이 없음)
  | 'no_packaging_order' // 포장 미요청 (모든 유효 품목에 포장 옵션 없음, 일반 상품)
  | 'unknown_order';     // 확인 불가 (품목 데이터 누락, 형식 불일치 등)

export interface Cafe24OrderItemSummary {
  itemNo?: number;
  productNo: number;
  productName: string;
  quantity: number;
  hasPackaging: boolean;
  isCanceled: boolean;
  statusLabel: string;
  optionsText: string;
  extractedCode: string | null;
}

export interface Cafe24OrderSummary {
  orderId: string;
  orderDate: string;
  shopNo: number;
  paid: boolean;
  canceled: boolean;
  paymentStatus: string;
  paymentStatusLabel: string;
  orderStatus: string;
  orderStatusLabel: string;
  hasPackaging: boolean;
  extractedCodes: string[];
  items: Cafe24OrderItemSummary[];
  totalValidQuantity: number;
  packagingQuantity: number;
}

export type MergedBoardItem =
  | {
      kind: 'linked_design';
      id: string; // design.code
      code: string;
      design: Design;
      matchedOrder?: Cafe24OrderSummary;
      sortTime: number;
    }
  | {
      kind: 'unlinked_order';
      id: string; // `unlinked-${order.orderId}`
      order: Cafe24OrderSummary;
      missingReason: string;
      suggestedCodes: string[];
      sortTime: number;
    }
  | {
      kind: 'no_packaging_order';
      id: string; // `noop-${order.orderId}`
      order: Cafe24OrderSummary;
      reason: string;
      sortTime: number;
    }
  | {
      kind: 'unknown_order';
      id: string; // `unknown-${order.orderId}`
      order: Cafe24OrderSummary;
      reason: string;
      sortTime: number;
    };

/**
 * 카페24 원본 주문 데이터를 읽기 전용 요약 객체로 변환
 */
export function summarizeCafe24Order(order: Cafe24AdminOrder): Cafe24OrderSummary {
  const items = Array.isArray(order.items) ? order.items : [];
  const extractedCodes = extractAllDesignCodes(order);
  const paid = isOrderPaid(order);
  const canceled = isOrderCanceled(order);
  const paymentStatus = order.payment_status || (paid ? 'P' : 'F');
  const paymentStatusLabel = getCafe24PaymentStatusLabel(order);
  const orderStatus = order.order_status || '';
  const orderStatusLabel = getCafe24OrderStatusLabel(order.order_status);

  const itemSummaries: Cafe24OrderItemSummary[] = items.map((item) => {
    const isCanceled = isItemCanceledOrRefunded(item);
    const hasPkg = hasPackagingOption(item);
    const extractedCode = extractItemDesignCode(item);

    const opts: string[] = [];
    if (Array.isArray(item.options)) {
      for (const o of item.options as Record<string, unknown>[]) {
        const n = String(o.option_name || o.name || '').trim();
        let v = '';
        if (typeof o.option_value === 'object' && o.option_value !== null) {
          v = String((o.option_value as { option_text?: unknown }).option_text || '').trim();
        } else if (typeof o.option_value === 'string') {
          v = o.option_value.trim();
        } else if (typeof o.value === 'string') {
          v = o.value.trim();
        }
        if (n || v) opts.push(n ? `${n}: ${v}` : v);
      }
    }
    if (typeof item.option_value === 'string' && item.option_value.trim() && opts.length === 0) {
      opts.push(item.option_value.trim());
    }

    return {
      itemNo: item.item_no,
      productNo: item.product_no,
      productName: item.product_name || `상품 #${item.product_no}`,
      quantity: item.quantity || 1,
      hasPackaging: hasPkg,
      isCanceled,
      statusLabel: getCafe24OrderStatusLabel(item.status_code || item.status),
      optionsText: opts.join(' / '),
      extractedCode,
    };
  });

  const validItems = itemSummaries.filter((i) => !i.isCanceled);
  const totalValidQuantity = validItems.reduce((acc, i) => acc + i.quantity, 0);
  const packagingQuantity = validItems.filter((i) => i.hasPackaging).reduce((acc, i) => acc + i.quantity, 0);
  const hasPackaging = packagingQuantity > 0 || extractedCodes.length > 0;

  return {
    orderId: order.order_id,
    orderDate: order.order_date || '',
    shopNo: order.shop_no || 1,
    paid,
    canceled,
    paymentStatus,
    paymentStatusLabel,
    orderStatus,
    orderStatusLabel,
    hasPackaging,
    extractedCodes,
    items: itemSummaries,
    totalValidQuantity,
    packagingQuantity,
  };
}

/**
 * 디자인 목록과 카페24 주문 목록을 결합하여 동일 작업판에서 볼 수 있는 통일된 항목 목록을 생성.
 * - 가짜 designs 행 생성 없음 (DB 순수성 보장)
 * - 자동 상태 변경이나 운영 DB 쓰기 없음
 * - 디자인 미연결 / 포장 미요청 / 확인 불가 3대 구분을 명확히 분리
 */
export function mergeDesignsAndOrders(
  designs: Design[],
  orders: Cafe24AdminOrder[],
): MergedBoardItem[] {
  const merged: MergedBoardItem[] = [];

  // 1. 카페24 주문 인덱싱 (주문번호별, 디자인코드별)
  const ordersById = new Map<string, Cafe24AdminOrder>();
  const ordersByCode = new Map<string, Cafe24AdminOrder[]>();

  for (const o of orders) {
    if (!o || !o.order_id) continue;
    ordersById.set(o.order_id, o);

    const codes = extractAllDesignCodes(o);
    for (const code of codes) {
      const list = ordersByCode.get(code) || [];
      list.push(o);
      ordersByCode.set(code, list);
    }
  }

  const existingCodesSet = new Set(designs.map((d) => d.code));
  const linkedDesignCountByOrder = new Map<string, number>();
  const fullyMatchedOrderIds = new Set<string>();

  // 2. 기존 접수된 designs 행들 결합
  for (const d of designs) {
    let matchedOrder: Cafe24OrderSummary | undefined;

    // 2-1. 주문번호 직접 연결 확인
    if (d.orderNo && ordersById.has(d.orderNo)) {
      const rawOrder = ordersById.get(d.orderNo)!;
      matchedOrder = summarizeCafe24Order(rawOrder);
      linkedDesignCountByOrder.set(rawOrder.order_id, (linkedDesignCountByOrder.get(rawOrder.order_id) || 0) + 1);
    }
    // 2-2. 주문서 옵션에 적힌 코드로 매칭
    else if (ordersByCode.has(d.code)) {
      const candidates = ordersByCode.get(d.code)!;
      // 유효하고 취소되지 않은 주문 우선
      const cand = candidates.find((o) => !isOrderCanceled(o)) || candidates[0];
      if (cand) {
        matchedOrder = summarizeCafe24Order(cand);
        linkedDesignCountByOrder.set(cand.order_id, (linkedDesignCountByOrder.get(cand.order_id) || 0) + 1);
      }
    }

    const sortTime = Date.parse(d.createdAt) || 0;
    merged.push({
      kind: 'linked_design',
      id: d.code,
      code: d.code,
      design: d,
      matchedOrder,
      sortTime,
    });
  }

  // 3. 주문별 다중 디자인 매칭 여부 판정
  for (const o of orders) {
    if (!o || !o.order_id) continue;
    const codes = extractAllDesignCodes(o);
    if (codes.length > 0) {
      // 주문서에 디자인 코드가 있는 경우: 모든 코드가 접수되었을 때만 완전히 매칭된 것으로 판정
      const unlinkedCodes = codes.filter((c) => !existingCodesSet.has(c));
      if (unlinkedCodes.length === 0) {
        fullyMatchedOrderIds.add(o.order_id);
      }
    } else {
      // 주문서에 코드가 없는 경우: 연결된 디자인이 1개 이상이면 매칭 완료 판정
      if ((linkedDesignCountByOrder.get(o.order_id) || 0) > 0) {
        fullyMatchedOrderIds.add(o.order_id);
      }
    }
  }

  // 4. 아직 완전히 디자인과 매칭되지 않은 카페24 주문들 분류
  for (const o of orders) {
    if (!o || !o.order_id) continue;
    if (fullyMatchedOrderIds.has(o.order_id)) continue;

    const summary = summarizeCafe24Order(o);
    const sortTime = Date.parse(o.order_date) || 0;

    // 4-1. 품목 정보가 아예 없거나 식별 불가인 경우 -> 확인 불가
    if (summary.items.length === 0) {
      merged.push({
        kind: 'unknown_order',
        id: `unknown-${o.order_id}`,
        order: summary,
        reason: '주문 품목 정보가 비어 있거나 조회가 불완전합니다. 상세 확인이 필요합니다.',
        sortTime,
      });
      continue;
    }

    // 4-2. 전체 취소/환불 주문인 경우 -> 포장 불필요 처리 (취소 사유 명시)
    if (summary.canceled) {
      merged.push({
        kind: 'no_packaging_order',
        id: `noop-${o.order_id}`,
        order: summary,
        reason: '주문 전체가 취소/환불되었습니다 (제작·출고 불필요).',
        sortTime,
      });
      continue;
    }

    // 4-3. 유효 품목 중 포장 옵션이 있거나, 주문에 디자인 코드가 기재된 경우 -> 디자인 미연결
    if (summary.hasPackaging) {
      const codes = summary.extractedCodes;
      const unlinkedCodes = codes.filter((c) => !existingCodesSet.has(c));

      let reason: string;
      if (unlinkedCodes.length > 0) {
        reason = codes.length > unlinkedCodes.length
          ? `주문 내 일부 디자인 미접수 (미연결 코드: ${unlinkedCodes.join(', ')})`
          : `주문서에 디자인 코드(${unlinkedCodes.join(', ')})가 있으나 접수된 디자인이 없습니다.`;
      } else {
        reason = '포장 옵션이 선택된 주문이나 아직 고객 디자인이 접수되지 않았습니다.';
      }

      merged.push({
        kind: 'unlinked_order',
        id: `unlinked-${o.order_id}`,
        order: summary,
        missingReason: reason,
        suggestedCodes: unlinkedCodes.length > 0 ? unlinkedCodes : summary.extractedCodes,
        sortTime,
      });
      continue;
    }

    // 4-4. 포장 옵션이 전혀 없는 일반 상품 주문 -> 포장 미요청
    merged.push({
      kind: 'no_packaging_order',
      id: `noop-${o.order_id}`,
      order: summary,
      reason: '일반 상품 주문 (포장 옵션 미선택)',
      sortTime,
    });
  }

  return merged;
}
