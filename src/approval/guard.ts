import { dataSource } from '../lib/supabase/env.ts';

// 신규 화면과 API는 기본적으로 development + local 데이터 소스에서만 동작하며,
// 배포 환경에서는 명시적인 ENABLE_APPROVAL_DOCS=true 설정이 있을 때만 안전하게 활성화됩니다.
export function isApprovalEnabled(): boolean {
  if (process.env.ENABLE_APPROVAL_DOCS === 'true') {
    return true;
  }
  return process.env.NODE_ENV === 'development' && dataSource() === 'local';
}

// 다른 포트·하위 도메인의 요청은 같은 출처로 취급하지 않는다.
export function isValidApprovalOrigin(req: Request): boolean {
  const url = new URL(req.url);
  const host = req.headers.get('host') || url.host;
  const allowed = new Set([`${url.protocol}//${host}`]);
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    try { allowed.add(new URL(process.env.NEXT_PUBLIC_SITE_URL).origin); } catch { return false; }
  }
  for (const header of ['origin', 'referer']) {
    const value = req.headers.get(header);
    if (!value) continue;
    try { if (!allowed.has(new URL(value).origin)) return false; } catch { return false; }
  }
  return true;
}
