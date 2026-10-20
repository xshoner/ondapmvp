// 관리자 기능 보호 (임시)
// 4단계에서 Supabase 로그인을 붙이기 전까지 관리자 화면과 저장 기능은 로컬 개발 서버에서만 동작한다.
// 운영 빌드(next start, Vercel)에서는 ONDAP_ALLOW_LOCAL_ADMIN=1을 명시하지 않는 한 막힌다.

export function isLocalAdminAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ONDAP_ALLOW_LOCAL_ADMIN === '1';
}

export function assertLocalAdmin(): void {
  if (!isLocalAdminAllowed()) {
    throw new Error('관리자 기능은 로그인이 붙기 전까지 로컬 개발 환경에서만 사용할 수 있습니다.');
  }
}
