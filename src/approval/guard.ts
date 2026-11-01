import { dataSource } from '../lib/supabase/env.ts';

// 신규 화면과 API는 development + local 데이터 소스에서만 동작
export function isApprovalEnabled(): boolean {
  return process.env.NODE_ENV === 'development' && dataSource() === 'local';
}

// 외부 사이트의 로컬 문서 접근·변경 차단 (CSRF / Origin 검증)
export function isValidApprovalOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const host = req.headers.get('host') || '';

  // 브라우저 직접 탐색(GET)인 경우 origin이 없을 수 있음.
  // Origin 헤더가 존재하면 127.0.0.1 또는 localhost인지 확인.
  if (origin) {
    try {
      const u = new URL(origin);
      if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
        return false;
      }
    } catch {
      return false;
    }
  }

  // Referer 헤더가 존재하면 확인
  if (referer) {
    try {
      const u = new URL(referer);
      if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
        return false;
      }
    } catch {
      return false;
    }
  }

  // Host 헤더 확인 (127.0.0.1, localhost 허용)
  const hostWithoutPort = host.split(':')[0];
  if (hostWithoutPort && hostWithoutPort !== '127.0.0.1' && hostWithoutPort !== 'localhost') {
    return false;
  }

  return true;
}
