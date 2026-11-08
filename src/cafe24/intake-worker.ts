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

export async function syncRecentCafe24Orders(days = 3): Promise<{ total: number; confirmed: number; pendingOrders: number }> {
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
    offset += limit;
  }

  let confirmed = 0;
  let pendingOrders = 0;

  for (const order of allOrders) {
    if (isOrderCanceled(order)) continue;

    let fullOrder = order;
    let code = extractDesignCode(fullOrder);

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
          fullOrder = await fetchAdminOrder(order.order_id, token);
          code = extractDesignCode(fullOrder);
        } catch (err) {
          console.warn(`[Cafe24 Sync] 주문 ${order.order_id} 상세 보완 조회 실패:`, err instanceof Error ? err.message : err);
        }
      }
    }

    if (!code) continue;

    if (isOrderPaid(fullOrder)) {
      const decision = await verifyAndAcceptOrder(fullOrder);
      if (decision.status === 'confirmed' || decision.status === 'already_confirmed') {
        confirmed++;
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
        if (!d || d.status !== 'pending') continue;

        // 2. 다른 주문에 이미 연결된 디자인인지 확인
        if (d.orderNo && d.orderNo !== fullOrder.order_id) {
          console.warn(`[Cafe24 Sync] 디자인 ${code}는 이미 다른 주문(${d.orderNo})에 연결되어 있어 주문 ${fullOrder.order_id} 연결을 건너뜁니다.`);
          continue;
        }

        // 3. 상품번호 일치 품목 탐색
        const matchingItem = Array.isArray(fullOrder.items)
          ? fullOrder.items.find((item) => item.product_no === d.productNo)
          : undefined;
        if (!matchingItem) {
          console.warn(`[Cafe24 Sync] 주문 ${fullOrder.order_id} 상품번호와 디자인 ${code} 상품번호(${d.productNo}) 불일치`);
          continue;
        }

        // 4. 수량 일치 확인
        if (matchingItem.quantity !== d.quantity) {
          console.warn(`[Cafe24 Sync] 주문 ${fullOrder.order_id} 수량(${matchingItem.quantity})과 디자인 ${code} 수량(${d.quantity}) 불일치`);
          continue;
        }

        // 5. 포장 디자인 옵션 신청 여부 확인
        if (!hasPackagingOption(matchingItem)) {
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
        console.warn(`[Cafe24 Sync] 미결제 주문 ${fullOrder.order_id} (디자인: ${code}) 메모 작성 실패:`, err instanceof Error ? err.message : err);
      }
    }
  }

  return { total: allOrders.length, confirmed, pendingOrders };
}
