// 결과보고용 실적 집계 (순수 함수: 저장소에서 읽은 기록을 받아 숫자로 만든다)

export interface RecLog { createdAt: string; event: string; relation: string; resultProductNos: number[] }
export interface DesignLog { createdAt: string; status: string; orderNo: string | null; hasSticker: boolean }

export interface Summary {
  days: { date: string; recommendations: number; designs: number }[];
  totals: { recommendations: number; designs: number; ordered: number; printed: number; withSticker: number };
  byEvent: { id: string; count: number }[];
  byRelation: { id: string; count: number }[];
  topProducts: { productNo: number; first: number; top3: number }[];
}

// UTC 시각 → 한국 날짜(YYYY-MM-DD)
export function kstDate(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`) && out.length < 400; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const countBy = <T>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
};

// 주문으로 이어진 접수: 주문번호가 적혔거나 주문 확인·인쇄 완료 상태
export const isOrdered = (d: DesignLog) => Boolean(d.orderNo) || d.status === 'order_confirmed' || d.status === 'printed';

export function summarize(recs: RecLog[], designs: DesignLog[], range: { from: string; to: string }): Summary {
  const live = designs.filter((d) => d.status !== 'canceled');
  const recByDay = new Map<string, number>();
  const desByDay = new Map<string, number>();
  for (const r of recs) recByDay.set(kstDate(r.createdAt), (recByDay.get(kstDate(r.createdAt)) ?? 0) + 1);
  for (const d of live) desByDay.set(kstDate(d.createdAt), (desByDay.get(kstDate(d.createdAt)) ?? 0) + 1);

  const products = new Map<number, { first: number; top3: number }>();
  for (const r of recs) {
    r.resultProductNos.forEach((no, i) => {
      const p = products.get(no) ?? { first: 0, top3: 0 };
      if (i === 0) p.first += 1;
      p.top3 += 1;
      products.set(no, p);
    });
  }

  return {
    days: dateRange(range.from, range.to).map((date) => ({ date, recommendations: recByDay.get(date) ?? 0, designs: desByDay.get(date) ?? 0 })),
    totals: {
      recommendations: recs.length,
      designs: live.length,
      ordered: live.filter(isOrdered).length,
      printed: live.filter((d) => d.status === 'printed').length,
      withSticker: live.filter((d) => d.hasSticker).length,
    },
    byEvent: countBy(recs, (r) => r.event),
    byRelation: countBy(recs, (r) => r.relation),
    topProducts: [...products].map(([productNo, v]) => ({ productNo, ...v }))
      .sort((a, b) => b.first - a.first || b.top3 - a.top3).slice(0, 10),
  };
}

export function summaryCsv(s: Summary): string {
  const rows = [['날짜', '추천 사용', '포장 디자인 접수'], ...s.days.map((d) => [d.date, d.recommendations, d.designs])];
  return '﻿' + rows.map((r) => r.join(',')).join('\r\n') + '\r\n';
}
