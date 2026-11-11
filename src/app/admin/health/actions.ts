'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin-guard.ts';
import { dataSource } from '@/lib/supabase/env.ts';
import { createServiceClient } from '@/lib/supabase/service.ts';
import { eventStatusFromDecision, processSingleOrder } from '@/cafe24/intake-worker.ts';

type HealthActionResult = { ok: boolean; message: string };
const ORDER_NO = /^20\d{6}-\d{7}$/;

async function authorizeAdmin(): Promise<{ ok: false; message: string } | null> {
  try {
    await requireAdmin();
    return null;
  } catch (e) {
    return { ok: false, message: `${e instanceof Error ? e.message : String(e)} 다시 로그인해 주세요.` };
  }
}

export async function retryPaymentEventAction(shopNo: number, orderNo: string): Promise<HealthActionResult> {
  const denied = await authorizeAdmin();
  if (denied) return denied;
  if (!Number.isSafeInteger(shopNo) || shopNo < 1 || !ORDER_NO.test(orderNo)) {
    return { ok: false, message: '올바른 주문 정보가 아닙니다.' };
  }
  if (dataSource() !== 'supabase') {
    return { ok: false, message: 'Supabase 운영 모드에서만 결제 알림을 재확인할 수 있습니다.' };
  }

  try {
    const decision = await processSingleOrder(orderNo, shopNo, 8000);
    const outcome = eventStatusFromDecision(decision);
    const db = createServiceClient();
    const patch: Record<string, unknown> = {
      status: outcome.status,
      last_error: outcome.lastError,
      locked_at: null,
      updated_at: new Date().toISOString(),
    };
    if (outcome.status === 'waiting_payment') patch.attempts = 1;
    const { error } = await db
      .from('cafe24_payment_events')
      .update(patch)
      .match({ shop_no: shopNo, order_no: orderNo });
    if (error) throw error;
    revalidatePath('/admin/health');
    revalidatePath('/admin/packaging');
    return { ok: outcome.status === 'completed' || outcome.status === 'waiting_payment', message: `주문 ${orderNo} 재확인 결과: ${decision.message}` };
  } catch (e) {
    return { ok: false, message: `주문 ${orderNo} 재확인 실패: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function resolvePaymentEventAction(shopNo: number, orderNo: string): Promise<HealthActionResult> {
  const denied = await authorizeAdmin();
  if (denied) return denied;
  if (!Number.isSafeInteger(shopNo) || shopNo < 1 || !ORDER_NO.test(orderNo)) {
    return { ok: false, message: '올바른 주문 정보가 아닙니다.' };
  }
  if (dataSource() !== 'supabase') {
    return { ok: false, message: 'Supabase 운영 모드에서만 처리할 수 있습니다.' };
  }

  try {
    const db = createServiceClient();
    const { error } = await db
      .from('cafe24_payment_events')
      .update({
        status: 'completed',
        last_error: '관리자 수동 확인 완료',
        locked_at: null,
        updated_at: new Date().toISOString(),
      })
      .match({ shop_no: shopNo, order_no: orderNo });
    if (error) throw error;
    revalidatePath('/admin/health');
    revalidatePath('/admin/packaging');
    return { ok: true, message: `주문 ${orderNo} 오류를 확인 완료로 정리했습니다.` };
  } catch (e) {
    return { ok: false, message: `상태 정리 실패: ${e instanceof Error ? e.message : String(e)}` };
  }
}
