// 관리자 경로 요청마다 로그인 세션을 갱신한다 (Supabase 공식 예제 기반)
// 접근 허용 여부는 여기서 정하지 않고 admin 레이아웃과 서버 액션, RLS가 판단한다.

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
  await supabase.auth.getClaims();

  return response;
}
