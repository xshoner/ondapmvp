import { createServiceClient } from '../lib/supabase/service.ts';
import { dataSource } from '../lib/supabase/env.ts';
import { lookupDesign } from '../data/packaging-repository.ts';
import { recordOperation } from '../data/operations-repository.ts';
import { extractAllDesignCodes } from './readonly-orders.ts';
import {
  extractDesignCode,
  extractItemDesignCode,
  fetchAdminOrder,
  hasPackagingOption,
  isItemCanceledOrRefunded,
  isOrderCanceled,
  isOrderPaid,
  type Cafe24AdminOrder,
} from './admin-orders.ts';

export type IntakeDecision =
  | { status: 'confirmed'; code: string; message: string }
  | { status: 'already_confirmed'; code: string; message: string }
  | { status: 'unpaid'; message: string }
  | { status: 'canceled'; code?: string; message: string }
  | { status: 'not_applicable'; message: string }
  | { status: 'no_design_code'; message: string }
  | { status: 'design_not_found'; code: string; message: string }
  | { status: 'product_mismatch'; code: string; message: string }
  | { status: 'quantity_mismatch'; code: string; message: string }
  | { status: 'option_mismatch'; code: string; message: string }
  | { status: 'conflict'; code: string; message: string };

export function eventStatusFromDecision(decision: IntakeDecision): {
  status: 'completed' | 'waiting_payment' | 'failed';
  confirmed: boolean;
  lastError: string | null;
} {
  const confirmed = decision.status === 'confirmed' || decision.status === 'already_confirmed';
  if (confirmed || decision.status === 'canceled' || decision.status === 'not_applicable') {
    return { status: 'completed', confirmed, lastError: null };
  }
  if (decision.status === 'unpaid') {
    return { status: 'waiting_payment', confirmed: false, lastError: decision.message };
  }
  return { status: 'failed', confirmed: false, lastError: decision.message };
}

// 전체 주문 취소/환불 처리 (주문에 연결된 모든 디자인 일괄 처리)
export async function handleCanceledOrder(
  order: Cafe24AdminOrder,
  startedAt: number,
): Promise<IntakeDecision> {
  const note = `카페24 주문(${order.order_id}) 취소/환불 확인`;
  if (dataSource() === 'local') {
    const { listDesigns, updateDesign } = await import('../data/packaging-repository.ts');
    const all = await listDesigns({ includePending: true });
    const linked = all.filter(
      (d) =>
        d.orderNo === order.order_id ||
        (d.status === 'pending' && d.memo.includes(order.order_id)),
    );
    const produced = linked.filter((d) => d.status === 'printed' || d.status === 'completed');
    for (const item of produced) {
      const statusLabel = item.status === 'completed' ? '포장 완료' : '인쇄 완료';
      const warn = `[주의: 주문 ${order.order_id} 취소/환불 알림 — ${statusLabel} 건 확인 필요]`;
      const nextMemo = !item.memo.includes(`${order.order_id} 취소/환불 알림`) && item.memo.length + warn.length + 1 <= 500
        ? [item.memo.trim(), warn].filter(Boolean).join('\n') : item.memo;
      await updateDesign(item.code, { cafe24Canceled: true, memo: nextMemo });
    }

    // 이미 인쇄/완료된 건이 있더라도 같은 주문의 미인쇄 건들은 취소 처리한다
    let reverted = 0;
    const unproduced = linked.filter((d) => d.status !== 'printed' && d.status !== 'completed');
    for (const d of unproduced) {
      if (d.status === 'order_confirmed' || d.status === 'received') {
        const nextMemo = d.memo.includes(note) ? d.memo : (d.memo.trim() ? `${d.memo.trim()}\n${note}` : note).slice(0, 500);
        await updateDesign(d.code, { status: 'canceled', orderNo: d.orderNo, memo: nextMemo, cafe24Canceled: true });
        reverted++;
      } else if (d.status === 'pending' && d.memo.includes(order.order_id) && d.memo.includes('(무통장 입금 대기)')) {
        await updateDesign(d.code, {
          status: 'pending',
          orderNo: d.orderNo,
          memo: d.memo.replace('(무통장 입금 대기)', '(주문 취소)').slice(0, 500),
          cafe24Canceled: true,
        });
        reverted++;
      }
    }

    if (produced.length) {
      await recordOperation('design_save', 'error', startedAt, 'canceled_after_print');
      const firstStatus = produced[0].status === 'completed' ? '포장 완료' : '인쇄 완료';
      return { status: 'conflict', code: produced[0].code, message: `주문(${order.order_id}) 취소/환불 후 ${firstStatus}된 접수를 확인해 주세요.` };
    }

    if (reverted > 0) {
      await recordOperation('design_save', 'ok', startedAt, 'order_canceled_reverted');
      return { status: 'canceled', message: '주문 취소/환불이 확인되어 디자인 접수를 취소했습니다.' };
    }
    await recordOperation('health_check', 'ok', startedAt, 'order_canceled_detected');
    return { status: 'canceled', message: '주문이 취소되었습니다.' };
  }

  const db = createServiceClient();
  const { data: cancelResult, error } = await db.rpc('cancel_paid_designs', {
    p_order_no: order.order_id,
    p_code: null, // 전체 취소이므로 null로 전달하여 주문 내 전체 디자인 처리
    p_note: note,
  });
  if (error) {
    await recordOperation('design_save', 'error', startedAt, 'cancel_paid_designs_rpc_error');
    throw new Error(`주문 취소 반영 실패: ${error.message}`);
  }
  if (cancelResult === 'printed_conflict') {
    await recordOperation('design_save', 'error', startedAt, 'canceled_after_print');
    return {
      status: 'conflict',
      code: order.order_id,
      message: `주문(${order.order_id})이 취소/환불되었으나 이미 인쇄/완료된 디자인이 있습니다. 확인이 필요합니다.`,
    };
  }
  if (cancelResult === 'canceled') {
    await recordOperation('design_save', 'ok', startedAt, 'order_canceled_reverted');
    return { status: 'canceled', message: '주문 취소/환불이 확인되어 디자인 접수를 취소했습니다.' };
  }
  await recordOperation('health_check', 'ok', startedAt, 'order_canceled_detected');
  return { status: 'canceled', message: '주문이 취소되었습니다.' };
}

// 부분 품목 취소/환불 처리 (특정 디자인만 취소·경고하고 다른 유효 품목은 온전히 유지)
export async function handleCanceledItem(
  order: Cafe24AdminOrder,
  startedAt: number,
  targetCode: string,
): Promise<IntakeDecision> {
  const note = `카페24 주문(${order.order_id}) 품목 취소/환불 확인`;
  if (dataSource() === 'local') {
    const { listDesigns, updateDesign } = await import('../data/packaging-repository.ts');
    const [d] = await listDesigns({ code: targetCode, limit: 1, includePending: true });
    if (!d) {
      return { status: 'not_applicable', message: `취소 대상 디자인(${targetCode})을 찾을 수 없습니다.` };
    }

    // 주문번호가 일치하는 건만 변경하고, 주문번호 없는 pending은 메모에 해당 주문번호가 확인될 때만 대기 안내를 변경한다.
    // 다른 주문이나 주문 미연결 접수는 보호한다.
    const isMatchingOrder = d.orderNo === order.order_id;
    const isMatchingPending = !d.orderNo && d.status === 'pending' && d.memo.includes(order.order_id);
    if (!isMatchingOrder && !isMatchingPending) {
      return { status: 'not_applicable', message: `디자인(${targetCode})은 해당 주문(${order.order_id})과 연결되어 있지 않습니다.` };
    }

    // 다른 유효 품목은 일절 건드리지 않고, 오직 targetCode 해당 건만 처리
    if (d.status === 'printed' || d.status === 'completed') {
      const statusLabel = d.status === 'completed' ? '포장 완료' : '인쇄 완료';
      const warn = `[주의: 주문 ${order.order_id} 품목 취소/환불 알림 — ${statusLabel} 건 확인 필요]`;
      const nextMemo = !d.memo.includes(`${order.order_id} 품목 취소/환불 알림`) && d.memo.length + warn.length + 1 <= 500
        ? [d.memo.trim(), warn].filter(Boolean).join('\n') : d.memo;
      await updateDesign(d.code, { cafe24Canceled: true, memo: nextMemo });
      await recordOperation('design_save', 'error', startedAt, 'canceled_after_print');
      return {
        status: 'conflict',
        code: d.code,
        message: `주문(${order.order_id})의 품목(${targetCode})이 취소/환불되었으나 이미 ${statusLabel}되었습니다. 확인이 필요합니다.`,
      };
    }

    if (d.status === 'order_confirmed' || d.status === 'received') {
      const nextMemo = d.memo.includes(note) ? d.memo : (d.memo.trim() ? `${d.memo.trim()}\n${note}` : note).slice(0, 500);
      await updateDesign(d.code, { status: 'canceled', orderNo: d.orderNo, memo: nextMemo, cafe24Canceled: true });
      await recordOperation('design_save', 'ok', startedAt, 'item_canceled_reverted');
      return { status: 'canceled', code: d.code, message: `주문(${order.order_id}) 품목 취소/환불이 확인되어 디자인 접수(${targetCode})를 취소했습니다.` };
    }

    if (d.status === 'pending' && d.memo.includes(order.order_id)) {
      await updateDesign(d.code, {
        status: 'pending',
        orderNo: d.orderNo,
        memo: d.memo.replace('(무통장 입금 대기)', '(품목 취소)').slice(0, 500),
        cafe24Canceled: true,
      });
      return { status: 'canceled', code: d.code, message: `품목(${targetCode})이 취소되었습니다.` };
    }

    return { status: 'canceled', code: d.code, message: `품목(${targetCode}) 취소 상태가 확인되었습니다.` };
  }

  const db = createServiceClient();
  const { data: cancelResult, error } = await db.rpc('cancel_paid_designs', {
    p_order_no: order.order_id,
    p_code: targetCode, // 특정 디자인 코드 지정
    p_note: note,
  });
  if (error) {
    await recordOperation('design_save', 'error', startedAt, 'cancel_paid_designs_rpc_error');
    throw new Error(`품목 취소 반영 실패: ${error.message}`);
  }
  if (cancelResult === 'printed_conflict') {
    await recordOperation('design_save', 'error', startedAt, 'canceled_after_print');
    return {
      status: 'conflict',
      code: targetCode,
      message: `주문(${order.order_id})의 품목(${targetCode})이 취소/환불되었으나 이미 인쇄/완료되었습니다. 확인이 필요합니다.`,
    };
  }
  if (cancelResult === 'canceled') {
    await recordOperation('design_save', 'ok', startedAt, 'item_canceled_reverted');
    return { status: 'canceled', code: targetCode, message: `품목 취소/환불이 확인되어 디자인 접수(${targetCode})를 취소했습니다.` };
  }
  await recordOperation('health_check', 'ok', startedAt, 'item_canceled_detected');
  return { status: 'canceled', code: targetCode, message: `품목(${targetCode})이 취소되었습니다.` };
}

// 부분 취소 발생 시 대상 품목/디자인이 불명확한 경우:
// 전체 디자인을 성급하게 취소하지 않고, 확인 필요(cafe24Canceled: true) 상태로 마킹하여 관리자가 수동 확인할 수 있게 함
export async function markAmbiguousPartialCancel(
  order: Cafe24AdminOrder,
  targetCodes: string[],
): Promise<void> {
  const warn = `[주의: 주문 ${order.order_id} 부분 취소 발생 — 대상 디자인 불명확, 관리자 확인 필요]`;
  const { computeOrderCancelFingerprint } = await import('./admin-orders.ts');
  const currentFingerprint = computeOrderCancelFingerprint(order);
  let newlyMarked = false;

  if (dataSource() === 'local') {
    const { listDesigns, updateDesign } = await import('../data/packaging-repository.ts');
    for (const code of targetCodes) {
      const [d] = await listDesigns({ code, limit: 1, includePending: true });
      if (!d || d.orderNo !== order.order_id) continue;
      // 동일 취소 사건에 대해 관리자가 이미 정상 진행으로 확인 완료한 경우 재경고 방지
      if (d.reviewedCancelState === currentFingerprint && !d.cafe24Canceled) {
        continue;
      }
      newlyMarked = true;
      // 상태는 canceled로 바꾸지 않고 기존 상태 유지! cafe24Canceled: true 플래그만 설정
      const nextMemo = !d.memo.includes(`${order.order_id} 부분 취소 발생`) && d.memo.length + warn.length + 1 <= 500
        ? [d.memo.trim(), warn].filter(Boolean).join('\n') : d.memo;
      await updateDesign(d.code, { cafe24Canceled: true, memo: nextMemo });
    }
  } else {
    const db = createServiceClient();
    for (const code of targetCodes) {
      const { data: row, error: readError } = await db
        .from('designs')
        .select('memo, reviewed_cancel_state, cafe24_canceled')
        .eq('code', code)
        .eq('order_no', order.order_id)
        .maybeSingle();
      if (readError) throw new Error('부분 취소 상태를 확인하지 못했습니다.');
      if (!row) continue;
      if (row.reviewed_cancel_state === currentFingerprint && !row.cafe24_canceled) {
        continue;
      }
      newlyMarked = true;
      const curMemo = (row?.memo as string) || '';
      const nextMemo = !curMemo.includes(`${order.order_id} 부분 취소 발생`) && curMemo.length + warn.length + 1 <= 500
        ? [curMemo.trim(), warn].filter(Boolean).join('\n') : curMemo;
      const { error: updateError } = await db.from('designs').update({
        cafe24_canceled: true,
        memo: nextMemo,
        updated_at: new Date().toISOString(),
      }).eq('code', code).eq('order_no', order.order_id);
      if (updateError) throw new Error('부분 취소 확인 상태를 저장하지 못했습니다.');
    }
  }
  if (newlyMarked) {
    await recordOperation('design_save', 'error', Date.now(), 'partial_cancel_ambiguous');
  }
}

async function handleCanceledOrderOrItem(
  order: Cafe24AdminOrder,
  startedAt: number,
  candidateCode?: string | null,
  isPartial = false,
): Promise<IntakeDecision> {
  if (isPartial && candidateCode) {
    return handleCanceledItem(order, startedAt, candidateCode);
  }
  return handleCanceledOrder(order, startedAt);
}

export async function verifyAndAcceptOrder(
  order: Cafe24AdminOrder,
  targetCode?: string | null,
): Promise<IntakeDecision> {
  const startedAt = Date.now();
  const code = targetCode || extractDesignCode(order);

  // 1. 취소/환불 주문 확인 (전체 주문 취소)
  if (isOrderCanceled(order)) {
    return handleCanceledOrder(order, startedAt);
  }

  // 2. 결제 완료 여부 확인 (입금전/추가입금대기는 제외)
  if (!isOrderPaid(order)) {
    const statusDesc = order.paid ? `paid=${order.paid}` : `${order.payment_status || '미결제'}/${order.order_status || '상태없음'}`;
    return { status: 'unpaid', message: `결제 미완료 (상태: ${statusDesc})` };
  }

  // 3. 주문에서 디자인 코드 추출 (포장 유료 옵션이 없는 일반 주문은 정상 완료로 간주)
  if (!code) {
    const needsDesignCode =
      !Array.isArray(order.items) ||
      order.items.some((item) => !isItemCanceledOrRefunded(item) && hasPackagingOption(item));
    if (!needsDesignCode) {
      return { status: 'not_applicable', message: '포장 옵션이 없는 일반 주문입니다.' };
    }
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

  // 5. 상품번호 일치 품목 탐색 (부분 취소/환불 구분 - 해당 디자인 품목만 부분 취소 처리)
  const productItems = Array.isArray(order.items) ? order.items.filter((item) => item.product_no === design.productNo) : [];
  const activeItems = productItems.filter((item) => !isItemCanceledOrRefunded(item));
  const canceledProductItems = productItems.filter(isItemCanceledOrRefunded);

  if (productItems.length > 0 && activeItems.length === 0) {
    // 해당 상품번호의 모든 품목이 취소된 경우: 이 디자인의 품목 취소 확실
    return handleCanceledItem(order, startedAt, code);
  } else if (canceledProductItems.length > 0) {
    // 해당 상품번호 중 일부만 취소된 경우:
    const matchedCancelItem = canceledProductItems.find((item) => extractItemDesignCode(item) === code);
    if (matchedCancelItem) {
      return handleCanceledItem(order, startedAt, code);
    }
    const { computeOrderCancelFingerprint } = await import('./admin-orders.ts');
    const currentFingerprint = computeOrderCancelFingerprint(order);
    if (design.reviewedCancelState === currentFingerprint && !design.cafe24Canceled) {
      // 이미 관리자가 이 취소 사건을 확인하고 정상 진행으로 확인한 상태 -> 취소 경고 생략하고 진행
    } else {
      // 취소 품목에 명시된 코드가 없거나 일치하지 않아 어느 디자인이 취소 대상인지 불명확한 경우:
      // 전체를 취소하지 말고 확인 필요(conflict / cafe24Canceled: true)로 처리!
      await markAmbiguousPartialCancel(order, [code]);
      return {
        status: 'conflict',
        code,
        message: `주문(${order.order_id}) 부분 취소가 확인되었으나 대상 디자인이 불명확합니다. 관리자 확인이 필요합니다.`,
      };
    }
  }
  const matchingItem =
    activeItems.find((item) => hasPackagingOption(item) && item.quantity === design.quantity) ??
    activeItems.find((item) => hasPackagingOption(item)) ??
    activeItems[0];
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

  // 8. DB 전환 트랜잭션 실행 (원자적 잠금 및 주문 수량 초과 방지)
  const totalOrderedQty = activeItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
  const { atomicLinkDesignToOrder } = await import('../data/packaging-repository.ts');
  const linkRes = await atomicLinkDesignToOrder({
    code,
    orderNo: order.order_id,
    productNo: design.productNo,
    quantity: design.quantity,
    maxQuantity: totalOrderedQty,
    isAutoIntake: true,
  });

  if (linkRes === 'confirmed') {
    await recordOperation('design_save', 'ok', startedAt, 'design_intake_confirmed');
    return { status: 'confirmed', code, message: '주문 결제 확인 완료 및 접수 전환' };
  }

  if (linkRes === 'already_confirmed') {
    return { status: 'already_confirmed', code, message: '이미 접수 확인된 주문입니다.' };
  }

  if (linkRes === 'exceeded') {
    await recordOperation('design_save', 'error', startedAt, 'quantity_exceeded');
    return { status: 'conflict', code, message: `주문 수량(${totalOrderedQty}개)을 초과하여 연결할 수 없습니다.` };
  }

  if (linkRes === 'conflict' || linkRes === 'canceled') {
    await recordOperation('design_save', 'error', startedAt, 'design_conflict');
    return { status: 'conflict', code, message: '다른 주문에 이미 사용되었거나 취소된 디자인입니다.' };
  }

  await recordOperation('design_save', 'error', startedAt, 'design_mismatch');
  return { status: 'product_mismatch', code, message: '상품 또는 수량 불일치' };
}

export async function processSingleOrder(orderNo: string, shopNo = 1, timeoutMs = 8000): Promise<IntakeDecision> {
  const order = await fetchAdminOrder(orderNo, { shopNo, timeoutMs });
  return verifyAndAcceptOrder(order);
}

export async function processPaymentEventQueue(limit = 10, deadlineMs = Date.now() + 20000): Promise<{ processed: number; confirmed: number; errors: number }> {
  if (dataSource() === 'local') return { processed: 0, confirmed: 0, errors: 0 };

  const db = createServiceClient();
  const { data: claimed, error } = await db.rpc('claim_payment_events', { p_limit: limit });
  if (error || !Array.isArray(claimed) || claimed.length === 0) {
    return { processed: 0, confirmed: 0, errors: error ? 1 : 0 };
  }

  let processed = 0;
  let confirmed = 0;
  let errors = 0;

  for (let i = 0; i < claimed.length; i++) {
    const event = claimed[i];
    if (i > 0 && Date.now() >= deadlineMs) {
      for (const rest of claimed.slice(i)) {
        await db.from('cafe24_payment_events').update({
          status: 'pending',
          attempts: Math.max(0, Number(rest.attempts ?? 1) - 1),
          locked_at: null,
          updated_at: new Date().toISOString(),
        }).match({ shop_no: rest.shop_no, order_no: rest.order_no, event_revision: rest.event_revision, status: 'processing' });
      }
      break;
    }

    processed++;
    try {
      const remaining = Math.max(2000, Math.min(8000, deadlineMs - Date.now()));
      const decision = await processSingleOrder(event.order_no, event.shop_no, remaining);
      const outcome = eventStatusFromDecision(decision);
      const { error: updateError } = await db.from('cafe24_payment_events').update({
        status: outcome.status,
        last_error: outcome.lastError,
        locked_at: null,
        updated_at: new Date().toISOString(),
      }).match({ shop_no: event.shop_no, order_no: event.order_no, event_revision: event.event_revision, status: 'processing' });
      if (updateError) throw updateError;
      if (outcome.confirmed) confirmed++;
    } catch (e) {
      errors++;
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await db.from('cafe24_payment_events').update({
        status: 'pending',
        last_error: msg,
        locked_at: null,
        updated_at: new Date().toISOString(),
      }).match({ shop_no: event.shop_no, order_no: event.order_no, event_revision: event.event_revision, status: 'processing' });
    }
  }

  return { processed, confirmed, errors };
}

export async function syncRecentCafe24Orders(days = 3): Promise<{ total: number; confirmed: number; pendingOrders: number; failedOrders: number; hasMore: boolean }> {
  const mallId = (process.env.CAFE24_MALL_ID || '').trim();
  if (!mallId) throw new Error('CAFE24_MALL_ID 환경변수가 필요합니다.');

  const { readStoredToken, getValidAccessToken, refreshAccessToken } = await import('./oauth.ts');
  const tokenRecord = await readStoredToken(mallId);
  if (!tokenRecord) {
    throw new Error('카페24 관리자 OAuth 연동이 필요합니다. 관리자 메뉴(운영 상태)에서 계정을 연동해 주세요.');
  }

  let token = await getValidAccessToken();

  // 한국 표준시(KST: UTC+9) 기준으로 조회 기간 산출
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const today = kstNow.toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() + 9 * 3600 * 1000 - days * 86400000);
  const from = fromDate.toISOString().slice(0, 10);
  const apiVersion = (process.env.CAFE24_API_VERSION || '2026-09-01').trim();

  let allOrders: Cafe24AdminOrder[] = [];
  let offset = 0;
  let hasMore = false;
  const limit = 100;
  const maxPages = 10;

  for (let page = 0; page < maxPages; page++) {
    const url = `https://${mallId}.cafe24api.com/api/v2/admin/orders?start_date=${from}&end_date=${today}&embed=items,additional_order_info_list&limit=${limit}&offset=${offset}`;
    let res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Cafe24-Api-Version': apiVersion,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });

    // 401(토큰 만료/무효) 시 1회 자동 리프레시 후 재시도
    if (res.status === 401) {
      try {
        const refreshed = await refreshAccessToken();
        token = refreshed.access_token;
        res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Cafe24-Api-Version': apiVersion,
          },
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        throw new Error('카페24 관리자 OAuth 인증이 만료되었습니다. 관리자 메뉴(운영 상태)에서 "카페24 관리자 계정 연동하기"를 눌러 다시 인증해 주세요.');
      }
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`카페24 주문 목록 조회 실패 (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = (await res.json()) as { orders?: Cafe24AdminOrder[] };
    const batch = data.orders || [];
    allOrders.push(...batch);

    if (batch.length < limit) break;
    if (page === maxPages - 1) hasMore = true;
    offset += limit;
  }

  let confirmed = 0;
  let pendingOrders = 0;
  let failedOrders = 0;

  for (const order of allOrders) {
    if (isOrderCanceled(order)) {
      try {
        const outcome = await handleCanceledOrder(order, Date.now());
        if (outcome.status === 'conflict') failedOrders++;
      } catch (err) {
        failedOrders++;
        console.warn(`[Cafe24 Sync] 취소 주문 ${order.order_id} 반영 실패:`, err instanceof Error ? err.message : err);
      }
      continue;
    }

    let fullOrder = order;
    let code = extractDesignCode(fullOrder);

    // 부분 취소/환불 품목이 포함된 주문에서 해당 품목에 연결된 디자인만 정확히 부분 취소 처리
    if (Array.isArray(order.items) && order.items.some(isItemCanceledOrRefunded)) {
      try {
        const { computeOrderCancelFingerprint } = await import('./admin-orders.ts');
        const currentFingerprint = computeOrderCancelFingerprint(order);

        let linkedRows: { code: string; productNo: number; reviewedCancelState?: string | null; cafe24Canceled?: boolean }[] = [];
        if (dataSource() === 'local') {
          const { listDesigns } = await import('../data/packaging-repository.ts');
          linkedRows = (await listDesigns({ includePending: true }))
            .filter((d) => d.orderNo === order.order_id)
            .map((d) => ({
              code: d.code,
              productNo: d.productNo,
              reviewedCancelState: d.reviewedCancelState,
              cafe24Canceled: d.cafe24Canceled,
            }));
        } else {
          const db = createServiceClient();
          const { data: rows, error: linkedError } = await db
            .from('designs')
            .select('code, product_no, reviewed_cancel_state, cafe24_canceled')
            .eq('order_no', order.order_id);
          if (linkedError) throw new Error('연결된 접수를 확인하지 못했습니다.');
          linkedRows = (rows ?? []).map((r) => ({
            code: r.code as string,
            productNo: r.product_no as number,
            reviewedCancelState: r.reviewed_cancel_state as string | null,
            cafe24Canceled: Boolean(r.cafe24_canceled),
          }));
        }

        for (const linked of linkedRows) {
          const isAlreadyReviewed = linked.reviewedCancelState === currentFingerprint && !linked.cafe24Canceled;
          const productItems = order.items.filter((item) => item.product_no === linked.productNo);
          const productCanceledItems = productItems.filter(isItemCanceledOrRefunded);
          const productActiveItems = productItems.filter((item) => !isItemCanceledOrRefunded(item));

          if (productItems.length > 0 && productCanceledItems.length > 0) {
            if (productActiveItems.length === 0) {
              // 해당 상품번호 전체가 취소된 경우:
              // 같은 상품번호의 디자인이 1개뿐이면 명확히 그 디자인만 부분 취소
              const sameProductDesigns = linkedRows.filter((r) => r.productNo === linked.productNo);
              if (sameProductDesigns.length === 1) {
                const outcome = await handleCanceledItem(order, Date.now(), linked.code);
                if (outcome.status === 'conflict') failedOrders++;
              } else {
                // 같은 상품번호로 여러 디자인이 등록되어 있다면 대상 불명확 -> 확인 필요
                const unreviewed = sameProductDesigns.filter((r) => !(r.reviewedCancelState === currentFingerprint && !r.cafe24Canceled));
                if (unreviewed.length > 0) {
                  await markAmbiguousPartialCancel(order, unreviewed.map((r) => r.code));
                  failedOrders++;
                }
              }
            } else {
              // 해당 상품번호 중 일부 품목만 취소된 경우:
              // 취소된 품목 옵션에 linked.code가 직접 명시되어 있는지 확인
              const directlyCanceled = productCanceledItems.some((item) => extractItemDesignCode(item) === linked.code);
              if (directlyCanceled) {
                const outcome = await handleCanceledItem(order, Date.now(), linked.code);
                if (outcome.status === 'conflict') failedOrders++;
              } else if (productCanceledItems.some((item) => !extractItemDesignCode(item))) {
                // 취소 품목에 코드가 없어 어느 디자인이 취소되었는지 불명확:
                // 이미 관리자가 이 취소 사건을 확인한 건은 재경고하지 않음
                if (!isAlreadyReviewed) {
                  await markAmbiguousPartialCancel(order, [linked.code]);
                  failedOrders++;
                }
              }
            }
          }
        }
      } catch (err) {
        failedOrders++;
        console.warn(`[Cafe24 Sync] 부분 취소 주문 ${order.order_id} 확인 실패:`, err instanceof Error ? err.message : err);
      }
    }

    // 카페24 주문 목록 API는 additional_order_info_list가 누락되거나 미포함될 수 있으므로,
    // 코드가 추출되지 않은 주문 중 포장 옵션이 있거나 후보 주문인 경우 단건 상세 API(fetchAdminOrder)로 보완 조회한다.
    if (!code) {
      const needsDetail =
        !Array.isArray(order.items) ||
        order.items.length === 0 ||
        order.items.some(hasPackagingOption) ||
        allOrders.length <= 20;

      if (needsDetail) {
        try {
          fullOrder = await fetchAdminOrder(order.order_id, { customToken: token, shopNo: order.shop_no });
          code = extractDesignCode(fullOrder);
        } catch (err) {
          failedOrders++;
          console.warn(`[Cafe24 Sync] 주문 ${order.order_id} 상세 보완 조회 실패:`, err instanceof Error ? err.message : err);
        }
      }
    }

    if (!code) {
      continue;
    }

    for (const code of extractAllDesignCodes(fullOrder)) {
    if (isOrderPaid(fullOrder)) {
      const decision = await verifyAndAcceptOrder(fullOrder, code);
      if (decision.status === 'confirmed' || decision.status === 'already_confirmed') {
        confirmed++;
      } else if (decision.status !== 'canceled' && decision.status !== 'not_applicable') {
        failedOrders++;
      }
    } else {
      // 미결제(무통장 입금 대기 등) 주문:
      // 디자인 코드, 상품번호, 수량, 포장 옵션이 안전하게 일치하는 경우에만 pending 상태를 유지하며 관리자 메모 및 주문번호를 작성한다.
      try {
        let d: { code: string; productNo: number; quantity: number; status: string; orderNo: string | null; memo: string } | null = null;

        if (dataSource() === 'local') {
          const { listDesigns } = await import('../data/packaging-repository.ts');
          const [localD] = await listDesigns({ code, limit: 1, includePending: true });
          if (localD) {
            d = {
              code: localD.code,
              productNo: localD.productNo,
              quantity: localD.quantity,
              status: localD.status,
              orderNo: localD.orderNo,
              memo: localD.memo,
            };
          }
        } else {
          const { createServiceClient } = await import('../lib/supabase/service.ts');
          const db = createServiceClient();
          const { data: rows, error: rErr } = await db
            .from('designs')
            .select('code, product_no, quantity, status, order_no, memo')
            .eq('code', code)
            .limit(1);
          if (rErr) throw new Error(`디자인 조회 실패: ${rErr.message}`);
          if (rows && rows[0]) {
            d = {
              code: rows[0].code,
              productNo: rows[0].product_no,
              quantity: rows[0].quantity,
              status: rows[0].status,
              orderNo: rows[0].order_no,
              memo: rows[0].memo || '',
            };
          }
        }

        // 1. 디자인이 존재하고 status가 pending인지 확인 (이미 확인/인쇄/취소된 건은 변경하지 않음)
        if (!d) { failedOrders++; continue; }
        if (d.status !== 'pending') continue;

        // 2. 다른 주문에 이미 연결된 디자인인지 확인
        if (d.orderNo && d.orderNo !== fullOrder.order_id) {
          failedOrders++;
          console.warn(`[Cafe24 Sync] 디자인 ${code}는 이미 다른 주문(${d.orderNo})에 연결되어 있어 주문 ${fullOrder.order_id} 연결을 건너뜁니다.`);
          continue;
        }

        // 3. 상품번호 일치 품목 탐색
        const matchingItem = Array.isArray(fullOrder.items)
          ? fullOrder.items.find((item) => item.product_no === d.productNo)
          : undefined;
        if (!matchingItem) {
          failedOrders++;
          console.warn(`[Cafe24 Sync] 주문 ${fullOrder.order_id} 상품번호와 디자인 ${code} 상품번호(${d.productNo}) 불일치`);
          continue;
        }

        // 4. 수량 일치 확인
        if (matchingItem.quantity !== d.quantity) {
          failedOrders++;
          console.warn(`[Cafe24 Sync] 주문 ${fullOrder.order_id} 수량(${matchingItem.quantity})과 디자인 ${code} 수량(${d.quantity}) 불일치`);
          continue;
        }

        // 5. 포장 디자인 옵션 신청 여부 확인
        if (!hasPackagingOption(matchingItem)) {
          failedOrders++;
          console.warn(`[Cafe24 Sync] 주문 ${fullOrder.order_id} 포장 디자인 유료 옵션 미선택`);
          continue;
        }

        pendingOrders++;

        // 6. 관리자 메모 안전 작성 (기존 관리자 메모 보존 및 동일 주문 중복 작성 방지)
        const note = `카페24 주문: ${fullOrder.order_id} (무통장 입금 대기)`;
        const existingMemo = d.memo ? d.memo.trim() : '';

        if (existingMemo.includes(fullOrder.order_id)) continue;

        const newMemo = existingMemo ? `${existingMemo}\n${note}` : note;

        if (dataSource() === 'local') {
          const { updateDesign } = await import('../data/packaging-repository.ts');
          await updateDesign(code, {
            status: 'pending',
            orderNo: null,
            memo: newMemo,
          });
        } else {
          const { createServiceClient } = await import('../lib/supabase/service.ts');
          const db = createServiceClient();
          const { error: uErr } = await db
            .from('designs')
            .update({
              memo: newMemo,
              updated_at: new Date().toISOString(),
            })
            .eq('code', code)
            .eq('status', 'pending');
          if (uErr) throw new Error(`디자인 메모 저장 실패: ${uErr.message}`);
        }
      } catch (err) {
        failedOrders++;
        console.warn(`[Cafe24 Sync] 미결제 주문 ${fullOrder.order_id} (디자인: ${code}) 메모 작성 실패:`, err instanceof Error ? err.message : err);
      }
    }
    }
  }

  return { total: allOrders.length, confirmed, pendingOrders, failedOrders, hasMore };
}
