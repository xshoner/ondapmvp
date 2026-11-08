import { NextRequest, NextResponse } from 'next/server';
import { exchangeAuthorizationCode, verifyOAuthState } from '@/cafe24/oauth.ts';
import { recordOperation } from '@/data/operations-repository.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const searchParams = request.nextUrl.searchParams;
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  const origin = request.nextUrl.origin;

  if (error) {
    await recordOperation('health_check', 'error', startedAt, 'oauth_denied');
    const msg = encodeURIComponent(errorDescription || error);
    return NextResponse.redirect(`${origin}/admin/health?oauth=error&msg=${msg}`);
  }

  if (!code || !state || !verifyOAuthState(state)) {
    await recordOperation('health_check', 'error', startedAt, 'oauth_invalid_state');
    return new NextResponse('유효하지 않거나 만료된 인증 요청(state)입니다. 다시 시도해 주세요.', { status: 400 });
  }

  try {
    await exchangeAuthorizationCode(code);
    await recordOperation('health_check', 'ok', startedAt, 'oauth_connected');
    return NextResponse.redirect(`${origin}/admin/health?oauth=connected`);
  } catch (e) {
    await recordOperation('health_check', 'error', startedAt, 'oauth_exchange_failed');
    const msg = encodeURIComponent(e instanceof Error ? e.message : '토큰 발급 실패');
    return NextResponse.redirect(`${origin}/admin/health?oauth=error&msg=${msg}`);
  }
}
