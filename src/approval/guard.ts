import { dataSource } from '../lib/supabase/env.ts';

// 신규 화면과 API는 기본적으로 development + local 데이터 소스에서만 동작하며,
// 배포 환경에서는 명시적인 ENABLE_APPROVAL_DOCS=true 설정이 있을 때만 안전하게 활성화됩니다.
export function isApprovalEnabled(): boolean {
  if (process.env.ENABLE_APPROVAL_DOCS === 'true') {
    return true;
  }
  return process.env.NODE_ENV === 'development' && dataSource() === 'local';
}

function isAllowedHostname(hostname: string, currentHost: string): boolean {
  if (hostname === '127.0.0.1' || hostname === 'localhost') {
    return true;
  }
  const hostWithoutPort = currentHost.split(':')[0];
  if (hostWithoutPort && (hostname === hostWithoutPort || hostname.endsWith(`.${hostWithoutPort}`))) {
    return true;
  }
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    try {
      const siteUrl = new URL(process.env.NEXT_PUBLIC_SITE_URL);
      if (hostname === siteUrl.hostname) return true;
    } catch {}
  }
  return false;
}

// 외부 사이트의 문서 접근·변경 차단 (CSRF / Origin 검증)
export function isValidApprovalOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const host = req.headers.get('host') || '';

  if (origin) {
    try {
      const u = new URL(origin);
      if (!isAllowedHostname(u.hostname, host)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  if (referer) {
    try {
      const u = new URL(referer);
      if (!isAllowedHostname(u.hostname, host)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  const hostWithoutPort = host.split(':')[0];
  if (hostWithoutPort && !isAllowedHostname(hostWithoutPort, host)) {
    return false;
  }

  return true;
}
