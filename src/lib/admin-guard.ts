// 관리자 권한 확인
//
// Supabase 모드: 로그인(getClaims로 JWT 서명 검증) + admins 테이블에 등록된 사용자만 허용. DB도 RLS로 한 번 더 막는다.
// 로컬 모드   : 로그인이 없으므로 개발 서버에서만 허용 (운영 빌드는 ONDAP_ALLOW_LOCAL_ADMIN=1일 때만)

import { dataSource } from './supabase/env.ts';

export type AdminStatus =
  | { allowed: true; mode: 'local' }
  | { allowed: true; mode: 'supabase'; email: string | null }
  | { allowed: false; reason: 'production' | 'login' | 'forbidden'; email?: string | null };

export function isLocalAdminAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ONDAP_ALLOW_LOCAL_ADMIN === '1';
}

export async function getAdminStatus(): Promise<AdminStatus> {
  if (dataSource() === 'local') {
    return isLocalAdminAllowed() ? { allowed: true, mode: 'local' } : { allowed: false, reason: 'production' };
  }
  const { createClient } = await import('./supabase/server.ts');
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return { allowed: false, reason: 'login' };
  const email = (claims.email as string | undefined) ?? null;
  const { data: row } = await db.from('admins').select('user_id').eq('user_id', claims.sub).maybeSingle();
  if (!row) return { allowed: false, reason: 'forbidden', email };
  return { allowed: true, mode: 'supabase', email };
}

export async function requireAdmin(): Promise<void> {
  const status = await getAdminStatus();
  if (!status.allowed) {
    const msg = {
      production: '관리자 기능은 로그인 없이 운영 환경에서 사용할 수 없습니다.',
      login: '로그인이 필요합니다.',
      forbidden: '관리자 권한이 없습니다.',
    }[status.reason];
    throw new Error(msg);
  }
}
