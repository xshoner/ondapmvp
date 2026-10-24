// 서버 예약 작업/운영 도구 전용. 일반 요청은 기존 RLS 클라이언트를 사용한다.
import { createClient } from '@supabase/supabase-js';
import { supabaseEnv } from './env.ts';

export function createServiceClient(timeoutMs = 10000) {
  const { url } = supabaseEnv();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('서버 예약 작업용 키가 설정되지 않았습니다.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init) => fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutMs) }) } });
}
