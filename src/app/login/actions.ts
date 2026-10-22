'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { clientIp, createRateLimiter } from '@/lib/rate-limit.ts';
import { dataSource } from '@/lib/supabase/env.ts';
import { createClient } from '@/lib/supabase/server.ts';
import { safeNext } from '@/lib/safe-next.ts';

// 비밀번호 대입을 늦춘다: 접속 주소당 10분에 10번 (Supabase 자체 제한은 서버 주소 하나로 보여 모든 사람이 함께 막힌다)
const allowSignIn = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });

export async function signInAction(_prev: { error: string | null }, form: FormData): Promise<{ error: string | null }> {
  if (dataSource() !== 'supabase') return { error: '로컬 모드에서는 로그인이 필요 없습니다.' };
  if (!allowSignIn(clientIp(await headers()))) return { error: '로그인을 너무 여러 번 시도했습니다. 10분 뒤 다시 시도해 주세요.' };
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  if (!email || !password) return { error: '이메일과 비밀번호를 입력하세요.' };

  const db = await createClient();
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) return { error: '이메일 또는 비밀번호가 맞지 않습니다.' };
  redirect(safeNext(form.get('next')));
}

export async function signOutAction(): Promise<void> {
  if (dataSource() === 'supabase') {
    const db = await createClient();
    await db.auth.signOut();
  }
  redirect('/login');
}
