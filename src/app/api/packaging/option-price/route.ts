import { getPackagingOptionPrice } from '../../../../cafe24/client.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const productParam = searchParams.get('product');
  const refreshParam = searchParams.get('refresh');

  const productNo = Number(productParam);
  if (!Number.isSafeInteger(productNo) || productNo <= 0) {
    return Response.json(
      { ok: false, error: '올바른 상품번호를 입력해 주세요.' },
      { status: 400 },
    );
  }

  const refresh = refreshParam === '1' || refreshParam === 'true';
  const result = await getPackagingOptionPrice(productNo, { refresh });

  return Response.json({
    ok: true,
    data: result,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
