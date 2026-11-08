import { timingSafeEqual } from 'node:crypto';

export function verifyPaymentWebhook(key: string | null, expected: string | undefined): boolean {
  if (!key || !expected || expected.length < 16) return false;
  const a = Buffer.from(key), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ValidatedPaymentEvent {
  orderNo: string;
  shopNo: number;
  eventNo: number;
}

export function paymentEvent(value: unknown, mallId: string | undefined): ValidatedPaymentEvent | null {
  if (!value || typeof value !== 'object' || !mallId) return null;
  const event = value as { event_no?: unknown; resource?: Record<string, unknown> };
  const resource = event.resource;
  const eventNo = Number(event.event_no);
  // 90025: 입금/결제 완료, 90026: 주문 취소
  if (![90025, 90026].includes(eventNo)) return null;
  if (!resource || resource.mall_id !== mallId) return null;
  if (typeof resource.order_id !== 'string' || !/^20\d{6}-\d{7}$/.test(resource.order_id)) return null;
  const shopNo = Number(resource.event_shop_no);
  if (!Number.isSafeInteger(shopNo) || shopNo < 1) return null;
  return { orderNo: resource.order_id, shopNo, eventNo };
}
