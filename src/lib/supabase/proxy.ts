// 관리자 경로 요청마다 로그인 세션을 갱신한다 (Supabase 공식 예제 기반)
// 관리자 권한은 여기서 정하지 않고 admin 레이아웃과 서버 액션, RLS가 판단한다.
// 로그인이 안 된 관리자 화면 요청만 원래 주소를 next에 담아 로그인 화면으로 보낸다
// (휴대폰으로 인쇄 시트 QR을 처음 찍었을 때 로그인 뒤 그 스캔 화면으로 돌아오게)

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseEnv } from './env.ts';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = supabaseEnv();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  // createServerClient와 getClaims 사이에 다른 코드를 넣지 않는다 (세션이 끊길 수 있음)
  const { data } = await supabase.auth.getClaims();

  const { pathname, search } = request.nextUrl;
  // 화면 이동(주소창·링크)만. 인쇄 파일 내려받기 같은 fetch 요청은 그대로 두어 403을 받게 한다
  const navigation = request.method === 'GET' && (request.headers.get('accept') ?? '').includes('text/html');
  if (!data?.claims?.sub && navigation && (pathname === '/admin' || pathname.startsWith('/admin/'))) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.search = `?next=${encodeURIComponent(pathname + search)}`;
    const redirect = NextResponse.redirect(login);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  return response;
}
