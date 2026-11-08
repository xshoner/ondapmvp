import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentEvent, verifyPaymentWebhook } from '../src/cafe24/payment-webhook.ts';

test('웹훅은 인증과 쇼핑몰·이벤트·주문번호를 확인한다', () => {
  const key = 'a'.repeat(32);
  assert.equal(verifyPaymentWebhook(key, key), true);
  assert.equal(verifyPaymentWebhook('b'.repeat(32), key), false);
  assert.equal(verifyPaymentWebhook('short', 'short'), false);
  assert.equal(verifyPaymentWebhook(null, key), false);
  assert.equal(verifyPaymentWebhook(key, undefined), false);

  const event = { event_no: 90025, resource: { mall_id: 'axopenlab', event_shop_no: '1', order_id: '20261108-0000010' } };
  assert.deepEqual(paymentEvent(event, 'axopenlab'), { shopNo: 1, orderNo: '20261108-0000010', eventNo: 90025 });
  assert.equal(paymentEvent(event, 'other'), null);
  assert.equal(paymentEvent({ ...event, event_no: 90023 }, 'axopenlab'), null);
  assert.equal(paymentEvent({ ...event, resource: { ...event.resource, order_id: 'bad' } }, 'axopenlab'), null);

  // 90026 취소 이벤트도 지원
  const cancelEvent = { event_no: 90026, resource: { mall_id: 'axopenlab', event_shop_no: '1', order_id: '20261108-0000010' } };
  assert.deepEqual(paymentEvent(cancelEvent, 'axopenlab'), { shopNo: 1, orderNo: '20261108-0000010', eventNo: 90026 });
});
