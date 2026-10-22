// 카페24 주문서 도우미(public/cafe24/ondap-helper.js)가 부르는 디자인 요약: 포장·스티커·수량·진행 상태.
// 코드를 아는 사람만 볼 수 있는 고객 조회와 같은 범위다 (편집 내용·인쇄 파일·주문번호·메모는 주지 않는다).
// 쇼핑몰 도메인에서 부르므로 CORS를 열고, 접속 주소당 조회 횟수를 제한한다.
import { lookupDesign } from '@/data/packaging-repository.ts';
import { clientIp, createRateLimiter } from '@/lib/rate-limit.ts';
import { normalizeDesignCode } from '@/packaging/rules.ts';

const allow = createRateLimiter({ limit: 60, windowMs: 10 * 60 * 1000 });
const HEADERS = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!allow(clientIp(request.headers))) return json({ error: 'too_many' }, 429);
  const code = normalizeDesignCode((await params).code);
  if (!code) return json({ error: 'bad_code' }, 400);
  try {
    const d = await lookupDesign(code);
    if (!d) return json({ error: 'not_found' }, 404);
    return json({ code: d.code, productNo: d.productNo, productName: d.productName, quantity: d.quantity, styleName: d.styleName, sticker: d.sticker, status: d.status });
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
}
