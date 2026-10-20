'use server';

import { redirect } from 'next/navigation';
import { dataSource } from '@/lib/supabase/env.ts';
import { createClient } from '@/lib/supabase/server.ts';

// 로그인 후 돌아갈 곳은 내부 경로만 허용한다 (외부 주소로 보내는 오픈 리다이렉트 방지)
function safeNext(next: FormDataEntryValue | null): string {
  const v = typeof next === 'string' ? next : '';
  return v.startsWith('/') && !v.startsWith('//') ? v : '/admin';
}

export async function signInAction(_prev: { error: string | null }, form: FormData): Promise<{ error: string | null }> {
  if (dataSource() !== 'supabase') return { error: '로컬 모드에서는 로그인이 필요 없습니다.' };
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
