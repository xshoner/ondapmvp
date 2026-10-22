'use server';

// 결과 화면 '도움 됐어요 / 아쉬워요' 받기. 로그인 없이 누구나 부르므로 값마다 다시 검사하고 접속 주소당 횟수를 제한한다
import { headers } from 'next/headers';
import { getCatalog, saveFeedback } from '@/data/repository.ts';
import { isEvent, isRelation } from '@/engine/labels.ts';
import { isFeedbackReason } from '@/lib/feedback.ts';
import { clientIp, createRateLimiter } from '@/lib/rate-limit.ts';
import { clampQty, parseBudget } from '@/lib/result-query.ts';

const allow = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });

export async function sendFeedbackAction(input: {
  event: string; relation: string; budget: number | null; qty: number; productNos: number[]; helpful: boolean; reasons: string[];
}): Promise<{ ok: boolean }> {
  if (!allow(clientIp(await headers()))) return { ok: false };
  try {
    const { config, products } = await getCatalog();
    if (!isEvent(config, input?.event) || !isRelation(config, input?.relation) || typeof input.helpful !== 'boolean') return { ok: false };
    const known = new Set(products.map((p) => p.productNo));
    const productNos = (Array.isArray(input.productNos) ? input.productNos : []).map(Number).filter((n) => known.has(n)).slice(0, 10);
    const reasons = input.helpful ? [] : [...new Set((Array.isArray(input.reasons) ? input.reasons : []).filter(isFeedbackReason))].slice(0, 5);
    await saveFeedback({
      event: input.event, relation: input.relation, budgetMax: parseBudget(input.budget), quantity: clampQty(input.qty),
      resultProductNos: productNos, helpful: input.helpful, reasons, modelVersion: config.modelVersion,
    });
    return { ok: true };
  } catch (e) {
    console.warn('[고객 의견] 저장 실패:', e instanceof Error ? e.message : e);
    return { ok: false };
  }
}
