'use server';

import { headers } from 'next/headers';
import { createClient as createAuthClient } from '@supabase/supabase-js';
import { getAdminStatus } from '@/lib/admin-guard.ts';
import { clientIp, createRateLimiter } from '@/lib/rate-limit.ts';
import { passwordError } from '@/lib/password-validation.ts';
import { createClient } from '@/lib/supabase/server.ts';
import { supabaseEnv } from '@/lib/supabase/env.ts';

const allowAttempt = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });

export async function changePassword(_previous: { message: string; ok: boolean }, form: FormData): Promise<{ message: string; ok: boolean }> {
  const status = await getAdminStatus();
  if (!status.allowed || status.mode !== 'supabase' || !status.email) return { ok: false, message: '관리자로 로그인한 뒤 다시 시도해 주세요.' };
  if (!allowAttempt(clientIp(await headers()))) return { ok: false, message: '시도 횟수가 너무 많습니다. 10분 뒤 다시 시도해 주세요.' };
  const current = String(form.get('current') ?? '');
  const password = String(form.get('password') ?? '');
  const confirmation = String(form.get('confirmation') ?? '');
  const invalid = passwordError(current, password, confirmation);
  if (invalid) return { ok: false, message: invalid };
  try {
    const db = await createClient();
    const { data: claims } = await db.auth.getClaims();
    if (!claims?.claims.sub) return { ok: false, message: '로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.' };
    const { url, key } = supabaseEnv();
    const verification = createAuthClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init) => fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(10000) }) } });
    const { data, error: signInError } = await verification.auth.signInWithPassword({ email: status.email, password: current });
    if (signInError || data.user?.id !== claims.claims.sub) return { ok: false, message: '현재 비밀번호가 맞지 않습니다.' };
    const { error } = await verification.auth.updateUser({ current_password: current, password });
    if (error) return { ok: false, message: '변경하지 못했습니다. 현재 비밀번호와 새 비밀번호의 보안 기준을 확인해 주세요.' };
    return { ok: true, message: '비밀번호를 변경했습니다. 다시 로그인할 때 새 비밀번호를 사용하세요.' };
  } catch {
    return { ok: false, message: '비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  }
}
