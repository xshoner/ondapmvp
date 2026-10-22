// 결과보고용 실적 집계 (순수 함수: 저장소에서 읽은 기록을 받아 숫자로 만든다)

export interface RecLog { createdAt: string; event: string; relation: string; resultProductNos: number[]; budgetMax?: number | null }
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
const isOrdered = (d: DesignLog) => Boolean(d.orderNo) || d.status === 'order_confirmed' || d.status === 'printed';

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

// 최근 자주 1위로 추천되던 상품이 지금 팔 수 없는 상태(품절·미진열·판매중지)면 관리자에게 알린다
export interface FavoriteAlert { productNo: number; name: string; first: number; state: string }

export function soldOutFavorites(
  recs: RecLog[],
  products: { productNo: number; name: string; display: boolean; selling: boolean; soldOut: boolean }[],
  minFirst = 3,
): FavoriteAlert[] {
  const first = new Map<number, number>();
  for (const r of recs) if (r.resultProductNos[0]) first.set(r.resultProductNos[0], (first.get(r.resultProductNos[0]) ?? 0) + 1);
  return products
    .filter((p) => (first.get(p.productNo) ?? 0) >= minFirst && (p.soldOut || !p.display || !p.selling))
    .map((p) => ({ productNo: p.productNo, name: p.name, first: first.get(p.productNo) ?? 0, state: p.soldOut ? '품절' : !p.display ? '미진열' : '판매중지' }))
    .sort((a, b) => b.first - a.first || a.productNo - b.productNo);
}

// 찾았지만 없던 것: 추천이 모자랐거나(결과 3개 미만) 예산을 넓혀야 했던 조건 → 다음에 들여올 상품의 힌트.
// 예산을 넓혔는지는 기록된 결과 상품의 지금 가격이 예산을 넘는지로 가늠한다
const BANDS: [number, string][] = [[30000, '3만 원 이하'], [50000, '5만 원 이하'], [100000, '10만 원 이하'], [200000, '20만 원 이하']];
export const budgetBand = (b: number | null | undefined) => (b == null ? '예산 상관없음' : (BANDS.find(([max]) => b <= max)?.[1] ?? '20만 원 넘게'));

export interface UnmetRow { event: string; relation: string; band: string; total: number; short: number; relaxed: number }

export function unmetDemand(recs: RecLog[], prices: Map<number, number>, resultCount: number, limit = 10): UnmetRow[] {
  const rows = new Map<string, UnmetRow>();
  for (const r of recs) {
    const band = budgetBand(r.budgetMax);
    const key = `${r.event}|${r.relation}|${band}`;
    const row = rows.get(key) ?? { event: r.event, relation: r.relation, band, total: 0, short: 0, relaxed: 0 };
    row.total += 1;
    if (r.resultProductNos.length < resultCount) row.short += 1;
    else if (r.budgetMax != null && r.resultProductNos.some((no) => (prices.get(no) ?? 0) > (r.budgetMax ?? Infinity))) row.relaxed += 1;
    rows.set(key, row);
  }
  return [...rows.values()]
    .filter((r) => r.short + r.relaxed > 0)
    .sort((a, b) => b.short + b.relaxed - (a.short + a.relaxed) || b.total - a.total)
    .slice(0, limit);
}
