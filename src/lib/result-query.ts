// 추천 결과 주소(/result?…) 읽기·만들기. 첫 화면 폼, 결과 화면, 조건 칩이 함께 쓴다.
// 서버·브라우저 공용 순수 함수: 주소는 누구나 고쳐 보낼 수 있으므로 값마다 범위를 다시 잡는다.

// 화면에 쓰는 금액 표시: 12,000원
export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

export const MAX_QTY = 100000;
const MAX_BUDGET = 100_000_000;
export const MAX_EXCLUDE = 10;

export interface ResultQuery {
  event: string;
  relation: string;
  budget: number | null; // 1개당 최대 예산(원). null = 상관없음
  qty: number;
  exclude: number[]; // 고객이 뺀 상품번호
}

export function clampQty(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(MAX_QTY, Math.max(1, n)) : 1;
}

export function parseBudget(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_BUDGET, n) : null;
}

export function parseExclude(v: unknown): number[] {
  const out: number[] = [];
  for (const s of String(v ?? '').split(',')) {
    const n = Number(s);
    if (s.trim() !== '' && Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    if (out.length === MAX_EXCLUDE) break;
  }
  return out;
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseResultQuery(sp: Params): ResultQuery {
  return {
    event: String(one(sp.event) ?? ''),
    relation: String(one(sp.relation) ?? ''),
    budget: parseBudget(one(sp.budget)),
    qty: clampQty(one(sp.qty) ?? 1),
    exclude: parseExclude(one(sp.exclude)),
  };
}

export function resultHref(q: ResultQuery, patch: Partial<ResultQuery> = {}): string {
  const v = { ...q, ...patch };
  const p = new URLSearchParams({ event: v.event, relation: v.relation, qty: String(v.qty) });
  if (v.budget !== null) p.set('budget', String(v.budget));
  if (v.exclude.length) p.set('exclude', v.exclude.join(','));
  return `/result?${p}`;
}

// 전체 예산 → 1개당 예산. 원 단위로 내려 전체 예산을 넘지 않게 한다
export function perItemBudget(total: unknown, qty: unknown): number | null {
  const t = Math.round(Number(total));
  if (!Number.isFinite(t) || t <= 0) return null;
  return parseBudget(Math.floor(t / clampQty(qty)));
}

// '5만 원 이하', '333,333원 이하', '예산 상관없음'
export function budgetText(budget: number | null): string {
  if (budget === null) return '예산 상관없음';
  return budget % 10000 === 0 ? `${(budget / 10000).toLocaleString('ko-KR')}만 원 이하` : `${budget.toLocaleString('ko-KR')}원 이하`;
}

// 1개당 예산 고르기 (첫 화면 칩, 결과 화면 조건 칩). null = 상관없음
export const BUDGET_STEPS: (number | null)[] = [30000, 50000, 100000, 200000, null];
// 관리자 진단·검증 화면이 처음 보여 줄 예산 (고객이 가장 많이 고르는 단추)
export const DEFAULT_ADMIN_BUDGET = 50000;

export function budgetChipText(budget: number | null): string {
  return budget === null ? '예산 상관없음' : `1개 ${budgetText(budget)}`;
}

// 쇼핑몰 배송비 (카페24 상품 상세 "2,500원, 50,000원 이상 구매 시 무료" 기준). 한 곳으로 받을 때 합계가 무료 기준 이상이면 0
const DEFAULT_SHIPPING = { fee: 2500, freeOver: 50000 };

export function shippingFee(subtotal: number, rule: { fee: number; freeOver: number } = DEFAULT_SHIPPING): number {
  return subtotal >= rule.freeOver ? 0 : rule.fee;
}
