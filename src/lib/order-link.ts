import { clampQty } from './result-query.ts';

// 서버에서도 쓸 수 있다. 옵션은 쇼핑몰에서 고르며 링크가 선택을 덮어쓰지 않는다.
export function productOrderUrl(productUrl: string, quantity: number, code?: string | null, mobile = false): string {
  try {
    const u = new URL(productUrl);
    if (u.protocol !== 'https:') return productUrl;
    if (mobile && !u.pathname.startsWith('/m/')) u.pathname = `/m${u.pathname}`;
    u.searchParams.set('ondap_qty', String(clampQty(quantity)));
    u.searchParams.set('ondap_order', '1');
    if (code && /^OD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code)) u.searchParams.set('ondap_code', code);
    else u.searchParams.delete('ondap_code');
    return u.toString();
  } catch { return productUrl; }
}
