import { NextResponse } from 'next/server';
import { getAdminStatus } from '@/lib/admin-guard.ts';
import { createOAuthState, getCafe24OAuthAuthorizeUrl } from '@/cafe24/oauth.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const status = await getAdminStatus();
  if (!status.allowed) {
    return new NextResponse('관리자 권한이 필요합니다.', { status: 403 });
  }

  try {
    const state = createOAuthState();
    const authorizeUrl = getCafe24OAuthAuthorizeUrl(state);
    return NextResponse.redirect(authorizeUrl);
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : 'OAuth 설정 오류', { status: 500 });
  }
}
