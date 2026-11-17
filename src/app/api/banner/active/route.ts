import { getActiveBanner } from '../../../../data/banner-repository.ts';

export const dynamic = 'force-dynamic';

function isSafeUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('/')) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    const banner = await getActiveBanner();
    if (!banner) {
      return Response.json({ ok: false, message: '활성 배너 없음' }, {
        status: 404,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        },
      });
    }

    // XSS 방어를 위한 URL 안전 검증 및 안전한 응답 구성
    const safeLinkUrl = isSafeUrl(banner.linkUrl) ? banner.linkUrl : 'https://dapcue.vercel.app/';
    const safeImageUrl = isSafeUrl(banner.imageUrl) ? banner.imageUrl : '';

    const payload = {
      id: banner.id,
      title: banner.title,
      imageUrl: safeImageUrl,
      linkUrl: safeLinkUrl,
      altText: banner.altText || banner.title,
      isActive: banner.isActive,
      seasonType: banner.seasonType,
      badgeText: banner.badgeText,
      headline: banner.headline,
      subText: banner.subText,
      buttonText: banner.buttonText,
    };

    return Response.json(payload, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return Response.json(
      { ok: false, message: e instanceof Error ? e.message : '배너 조회 실패' },
      {
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
