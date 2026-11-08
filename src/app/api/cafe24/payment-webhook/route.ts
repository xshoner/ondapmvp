import { createServiceClient } from '@/lib/supabase/service.ts';
import { dataSource } from '@/lib/supabase/env.ts';
import { paymentEvent, verifyPaymentWebhook } from '@/cafe24/payment-webhook.ts';
import { processSingleOrder } from '@/cafe24/intake-worker.ts';
import { recordOperation } from '@/data/operations-repository.ts';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const startedAt = Date.now();
  if (!verifyPaymentWebhook(request.headers.get('x-api-key'), process.env.CAFE24_WEBHOOK_KEY)) {
    await recordOperation('health_check', 'error', startedAt, 'webhook_unauthorized');
    return new Response(null, { status: 403 });
  }

  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });

  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 128 * 1024) {
      await reader.cancel();
      return new Response(null, { status: 413 });
    }
    chunks.push(value);
  }

  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return new Response(null, { status: 400 });
  }

  const event = paymentEvent(body, process.env.CAFE24_MALL_ID);
  if (!event) return new Response(null, { status: 400 });

  // 1. 이벤트 큐 등록
  if (dataSource() !== 'local') {
    try {
      const db = createServiceClient();
      const { error } = await db.from('cafe24_payment_events').upsert({
        shop_no: event.shopNo,
        order_no: event.orderNo,
        event_no: event.eventNo,
        status: 'pending',
        received_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    } catch (e) {
      await recordOperation('health_check', 'error', startedAt, 'webhook_db_error');
      return new Response(null, { status: 503 });
    }
  }

  // 2. 즉시 검증 및 접수 전환 시도 (실패해도 큐에 남아있으므로 웹훅 응답은 정상 반환)
  try {
    const decision = await processSingleOrder(event.orderNo, event.shopNo);
    if (dataSource() !== 'local') {
      const db = createServiceClient();
      if (decision.status === 'confirmed' || decision.status === 'already_confirmed') {
        await db.from('cafe24_payment_events').update({
          status: 'completed',
          last_error: null,
          updated_at: new Date().toISOString(),
        }).match({ shop_no: event.shopNo, order_no: event.orderNo });
      } else if (decision.status === 'unpaid') {
        await db.from('cafe24_payment_events').update({
          status: 'waiting_payment',
          last_error: decision.message,
          updated_at: new Date().toISOString(),
        }).match({ shop_no: event.shopNo, order_no: event.orderNo });
      } else if (decision.status === 'canceled') {
        await db.from('cafe24_payment_events').update({
          status: 'completed',
          last_error: '주문 취소됨',
          updated_at: new Date().toISOString(),
        }).match({ shop_no: event.shopNo, order_no: event.orderNo });
      } else {
        await db.from('cafe24_payment_events').update({
          status: 'failed',
          last_error: decision.message,
          updated_at: new Date().toISOString(),
        }).match({ shop_no: event.shopNo, order_no: event.orderNo });
      }
    }
  } catch (e) {
    // 백그라운드 재처리를 위해 큐에 남아있도록 둠
    if (dataSource() !== 'local') {
      const db = createServiceClient();
      await db.from('cafe24_payment_events').update({
        last_error: e instanceof Error ? e.message.slice(0, 500) : '처리 실패',
        updated_at: new Date().toISOString(),
      }).match({ shop_no: event.shopNo, order_no: event.orderNo });
    }
  }

  return new Response(null, { status: 204 });
}
