'use server';

// 결과 화면 '도움 됐어요 / 아쉬워요' 받기. 로그인 없이 누구나 부르므로 값마다 다시 검사하고 접속 주소당 횟수를 제한한다
import { headers } from 'next/headers';
import { getCatalog, saveFeedback } from '@/data/repository.ts';
import { isEvent, isRelation } from '@/engine/labels.ts';
import { isFeedbackReason } from '@/lib/feedback.ts';
import { clientIp, createRateLimiter } from '@/lib/rate-limit.ts';
import { clampQty, parseBudget } from '@/lib/result-query.ts';
import { recordOperation } from '@/data/operations-repository.ts';

const allow = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });

export async function sendFeedbackAction(input: {
  event: string; relation: string; budget: number | null; qty: number; productNos: number[]; helpful: boolean; reasons: string[];
  requestId?: string;
}): Promise<{ ok: boolean }> {
  const startedAt = Date.now();
  if (!allow(clientIp(await headers()))) return { ok: false };
  try {
    const { config, products } = await getCatalog();
    if (!isEvent(config, input?.event) || !isRelation(config, input?.relation) || typeof input.helpful !== 'boolean') return { ok: false };
    const requestId = input.requestId ?? crypto.randomUUID(); // 이전 배포의 열린 탭도 정상 처리
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return { ok: false };
    const known = new Set(products.map((p) => p.productNo));
    const productNos = (Array.isArray(input.productNos) ? input.productNos : []).map(Number).filter((n) => known.has(n)).slice(0, 10);
    const reasons = input.helpful ? [] : [...new Set((Array.isArray(input.reasons) ? input.reasons : []).filter(isFeedbackReason))].slice(0, 5);
    await saveFeedback({
      event: input.event, relation: input.relation, budgetMax: parseBudget(input.budget), quantity: clampQty(input.qty),
      resultProductNos: productNos, helpful: input.helpful, reasons, modelVersion: config.modelVersion,
      requestId,
    });
    await recordOperation('feedback_save', 'ok', startedAt);
    return { ok: true };
  } catch (e) {
    await recordOperation('feedback_save', 'error', startedAt, 'db_write');
    return { ok: false };
  }
}
