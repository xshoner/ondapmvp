import { createServiceClient } from '../lib/supabase/service.ts';
import { dataSource } from '../lib/supabase/env.ts';
import { lookupDesign } from '../data/packaging-repository.ts';
import { recordOperation } from '../data/operations-repository.ts';
import {
  extractDesignCode,
  fetchAdminOrder,
  hasPackagingOption,
  isOrderCanceled,
  isOrderPaid,
  type Cafe24AdminOrder,
} from './admin-orders.ts';

export type IntakeDecision =
  | { status: 'confirmed'; code: string; message: string }
  | { status: 'already_confirmed'; code: string; message: string }
  | { status: 'unpaid'; message: string }
  | { status: 'canceled'; message: string }
  | { status: 'no_design_code'; message: string }
  | { status: 'design_not_found'; code: string; message: string }
  | { status: 'product_mismatch'; code: string; message: string }
  | { status: 'quantity_mismatch'; code: string; message: string }
  | { status: 'option_mismatch'; code: string; message: string }
  | { status: 'conflict'; code: string; message: string };

export async function verifyAndAcceptOrder(order: Cafe24AdminOrder): Promise<IntakeDecision> {
  const startedAt = Date.now();

  // 1. 취소 주문 확인
  if (isOrderCanceled(order)) {
    await recordOperation('health_check', 'ok', startedAt, 'order_canceled_detected');
    return { status: 'canceled', message: '주문이 취소되었습니다.' };
  }

  // 2. 결제 완료 여부 확인 (입금전/추가입금대기는 제외)
  if (!isOrderPaid(order)) {
    const statusDesc = order.paid ? `paid=${order.paid}` : `${order.payment_status || '미결제'}/${order.order_status || '상태없음'}`;
    return { status: 'unpaid', message: `결제 미완료 (상태: ${statusDesc})` };
  }

  // 3. 주문에서 디자인 코드 추출
  const code = extractDesignCode(order);
  if (!code) {
    await recordOperation('design_save', 'error', startedAt, 'no_design_code_in_order');
    return { status: 'no_design_code', message: '주문서에 디자인 코드가 없습니다.' };
  }

  // 4. 저장된 디자인 정보 조회 (주문번호와 상태 확인을 위해 includePending 사용)
  const { listDesigns } = await import('../data/packaging-repository.ts');
  const [design] = await listDesigns({ code, limit: 1, includePending: true });
  if (!design) {
    await recordOperation('design_save', 'error', startedAt, 'design_not_found');
    return { status: 'design_not_found', code, message: `디자인 ${code}를 찾을 수 없습니다.` };
  }

  // 5. 상품번호 일치 품목 탐색
  const matchingItem = order.items.find((item) => item.product_no === design.productNo);
  if (!matchingItem) {
    await recordOperation('design_save', 'error', startedAt, 'product_mismatch');
    return { status: 'product_mismatch', code, message: `주문 상품번호와 디자인 상품번호(${design.productNo}) 불일치` };
  }

  // 6. 수량 일치 확인
  if (matchingItem.quantity !== design.quantity) {
    await recordOperation('design_save', 'error', startedAt, 'quantity_mismatch');
    return { status: 'quantity_mismatch', code, message: `주문 수량(${matchingItem.quantity})과 디자인 수량(${design.quantity}) 불일치` };
  }

  // 7. 포장 디자인 옵션 신청 여부 확인
  if (!hasPackagingOption(matchingItem)) {
    await recordOperation('design_save', 'error', startedAt, 'packaging_option_missing');
    return { status: 'option_mismatch', code, message: '포장 디자인 유료 옵션이 선택되지 않았습니다.' };
  }

  // 8. DB 전환 트랜잭션 실행 (accept_paid_design)
  if (dataSource() === 'local') {
    // 로컬 파일/시험 모드일 때
    const { updateDesign } = await import('../data/packaging-repository.ts');
    if (design.status === 'order_confirmed' || design.status === 'printed') {
      if (design.orderNo === order.order_id) {
        return { status: 'already_confirmed', code, message: '이미 접수 확인된 주문입니다.' };
      }
      return { status: 'conflict', code, message: '다른 주문에 이미 사용된 디자인 코드입니다.' };
    }
    await updateDesign(code, { status: 'order_confirmed', orderNo: order.order_id, memo: design.memo });
    await recordOperation('design_save', 'ok', startedAt, 'design_intake_confirmed');
    return { status: 'confirmed', code, message: '주문 결제 확인 완료 및 접수 전환' };
  }

  const db = createServiceClient();
  const { data, error } = await db.rpc('accept_paid_design', {
    p_code: code,
    p_order_no: order.order_id,
    p_product_no: design.productNo,
    p_quantity: design.quantity,
  });

  if (error) {
    await recordOperation('design_save', 'error', startedAt, 'accept_paid_design_rpc_error');
    throw new Error(`디자인 접수 전환 실패: ${error.message}`);
  }

  if (data === 'confirmed') {
    await recordOperation('design_save', 'ok', startedAt, 'design_intake_confirmed');
    return { status: 'confirmed', code, message: '주문 결제 확인 완료 및 접수 전환' };
  }

  if (data === 'already_confirmed') {
    return { status: 'already_confirmed', code, message: '이미 접수 확인된 주문입니다.' };
  }

  if (data === 'conflict') {
    await recordOperation('design_save', 'error', startedAt, 'design_conflict');
    return { status: 'conflict', code, message: '다른 주문에 이미 사용되었거나 취소된 디자인입니다.' };
  }

  await recordOperation('design_save', 'error', startedAt, 'design_mismatch');
  return { status: 'product_mismatch', code, message: '상품 또는 수량 불일치' };
}

export async function processSingleOrder(orderNo: string, shopNo = 1): Promise<IntakeDecision> {
  const order = await fetchAdminOrder(orderNo);
  return verifyAndAcceptOrder(order);
}

export async function processPaymentEventQueue(limit = 10): Promise<{ processed: number; confirmed: number; errors: number }> {
  if (dataSource() === 'local') return { processed: 0, confirmed: 0, errors: 0 };

  const db = createServiceClient();
  const { data: claimed, error } = await db.rpc('claim_payment_events', { p_limit: limit });
  if (error || !Array.isArray(claimed) || claimed.length === 0) {
    return { processed: 0, confirmed: 0, errors: error ? 1 : 0 };
  }

  let confirmed = 0;
  let errors = 0;

  for (const event of claimed) {
    try {
      const decision = await processSingleOrder(event.order_no, event.shop_no);
      if (decision.status === 'confirmed' || decision.status === 'already_confirmed') {
        confirmed++;
        await db.from('cafe24_payment_events').update({
          status: 'completed',
          last_error: null,
          updated_at: new Date().toISOString(),
        }).match({ shop_no: event.shop_no, order_no: event.order_no });
      } else if (decision.status === 'unpaid') {
        await db.from('cafe24_payment_events').update({
          status: 'waiting_payment',
          last_error: decision.message,
          updated_at: new Date().toISOString(),
        }).match({ shop_no: event.shop_no, order_no: event.order_no });
      } else if (decision.status === 'canceled') {
        await db.from('cafe24_payment_events').update({
          status: 'completed',
          last_error: '주문 취소됨',
          updated_at: new Date().toISOString(),
        }).match({ shop_no: event.shop_no, order_no: event.order_no });
      } else {
        // 불일치 또는 영구 오류
        await db.from('cafe24_payment_events').update({
          status: 'failed',
          last_error: decision.message,
          updated_at: new Date().toISOString(),
        }).match({ shop_no: event.shop_no, order_no: event.order_no });
      }
    } catch (e) {
      errors++;
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await db.from('cafe24_payment_events').update({
        status: 'pending',
        last_error: msg,
        updated_at: new Date().toISOString(),
      }).match({ shop_no: event.shop_no, order_no: event.order_no });
    }
  }

  return { processed: claimed.length, confirmed, errors };
}
