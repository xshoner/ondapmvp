// 카페24 주문 상세(또는 주문 목록)를 통째로 복사해 붙여넣은 글에서 주문번호와 디자인 코드를 짝지어 찾는다 (순수 함수).
// 코드는 바로 앞에 나온 주문번호에 붙인다. 주문번호가 하나뿐이면 모든 코드에 그 번호를 쓴다.

import { normalizeDesignCode } from './rules.ts';

const ORDER_NO = /\b(20\d{6}-\d{7})\b/; // 카페24 주문번호: 20261021-0000123
const TOKEN = new RegExp(`${ORDER_NO.source}|\\b(OD-[A-Z0-9]{4}-[A-Z0-9]{4})\\b`, 'gi');

export interface OrderLink { code: string; orderNo: string | null }

export function extractOrderLinks(text: string): OrderLink[] {
  const found: { orderNo?: string; code?: string }[] = [];
  for (const m of text.matchAll(TOKEN)) {
    if (m[1]) found.push({ orderNo: m[1] });
    else {
      const code = normalizeDesignCode(m[2]);
      if (code) found.push({ code });
    }
  }
  const orderNos = [...new Set(found.flatMap((x) => (x.orderNo ? [x.orderNo] : [])))];
  const links: OrderLink[] = [];
  let current: string | null = orderNos.length === 1 ? orderNos[0] : null;
  for (const x of found) {
    if (x.orderNo) current = x.orderNo;
    else if (x.code && !links.some((l) => l.code === x.code)) links.push({ code: x.code, orderNo: current });
  }
  return links;
}
