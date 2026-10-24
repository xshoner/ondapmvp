import { getCatalog, getFeedback } from '../data/repository.ts';
import { listDesigns } from '../data/packaging-repository.ts';
import { createClient } from '../lib/supabase/server.ts';
import { dataSource } from '../lib/supabase/env.ts';
import { summarize, unmetDemand, type Summary, type UnmetRow } from './summary.ts';
import { summarizeFeedback, type FeedbackSummary } from '../lib/feedback.ts';
import { kstRange } from '../packaging/design-filter.ts';

export interface StatsResult { summary: Summary; feedback: FeedbackSummary | null; unmet: UnmetRow[] }
export function validStatsPeriod(from: string, to: string): boolean {
  const date = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  return date(from) && date(to) && from <= to && Date.parse(to) - Date.parse(from) <= 399 * 86400000;
}

// 화면/CSV가 같은 입구를 사용한다. 구 DB의 잘린 원시 기록으로 합계를 대신 만들지 않는다.
export async function getStats(from: string, to: string): Promise<StatsResult> {
  if (!validStatsPeriod(from, to)) throw new Error('조회 기간은 올바른 날짜로 최대 400일까지 선택해 주세요.');
  const catalog = await getCatalog();
  if (dataSource() === 'local') {
    const [designs, feedback] = await Promise.all([listDesigns({ from, to, limit: Number.MAX_SAFE_INTEGER }), getFeedback(kstRange({ from, to }))]);
    return { summary: summarize([], designs.map((d) => ({ ...d, hasSticker: Boolean(d.sticker) })), { from, to }), feedback: feedback ? summarizeFeedback(feedback) : null, unmet: unmetDemand([], new Map(), catalog.config.resultCount) };
  }
  const db = await createClient();
  const { data, error } = await db.rpc('admin_stats', { p_from: from, p_to: to, p_result_count: catalog.config.resultCount });
  if (error || !data?.summary?.totals || !Array.isArray(data.summary.days)) throw new Error('전체 실적을 읽지 못했습니다. 운영 상태와 20261027 DB 변경 적용을 확인해 주세요.');
  return data as StatsResult;
}
