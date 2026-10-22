// 추천에 대한 고객 목소리: 결과 화면 끝 '도움 됐어요 / 아쉬워요' + 아쉬운 이유 (고르기만, 자유 입력 없음 → 개인정보를 받지 않는다).
// 고객 화면·서버 액션·실적 화면이 함께 쓴다 (순수 값·함수)

export const FEEDBACK_REASONS = {
  price: '가격이 맞지 않아요',
  formality: '자리의 격식과 안 맞아요',
  kind: '원하는 종류가 없어요',
  quantity: '수량·배송이 걱정돼요',
  other: '그 밖의 이유',
} as const;
export type FeedbackReason = keyof typeof FEEDBACK_REASONS;

export const isFeedbackReason = (v: unknown): v is FeedbackReason => typeof v === 'string' && Object.hasOwn(FEEDBACK_REASONS, v);

export interface FeedbackLog { createdAt: string; event: string; relation: string; helpful: boolean; reasons: string[] }

export interface FeedbackSummary {
  total: number;
  helpful: number;
  reasons: { id: FeedbackReason; count: number }[];
  byEvent: { id: string; total: number; helpful: number }[];
}

export function summarizeFeedback(list: FeedbackLog[]): FeedbackSummary {
  const reasons = new Map<FeedbackReason, number>();
  const events = new Map<string, { total: number; helpful: number }>();
  for (const f of list) {
    const e = events.get(f.event) ?? { total: 0, helpful: 0 };
    e.total += 1;
    if (f.helpful) e.helpful += 1;
    events.set(f.event, e);
    if (!f.helpful) for (const r of f.reasons) if (isFeedbackReason(r)) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  return {
    total: list.length,
    helpful: list.filter((f) => f.helpful).length,
    reasons: [...reasons].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count),
    byEvent: [...events].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.total - a.total),
  };
}
