import crypto from 'node:crypto';
import { getAdminStatus } from '../lib/admin-guard.ts';
import type { ApprovalDraft } from './types.ts';

export function generateCreatorToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashCreatorToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

export function buildCreatorCookie(draftId: string, token: string): string {
  return `ondap_approval_${draftId}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

export function extractCreatorToken(req: Request, draftId: string): string | null {
  // 1. 커스텀 헤더 X-Approval-Token
  const headerToken = req.headers.get('x-approval-token');
  if (headerToken && headerToken.trim()) return headerToken.trim();

  // 2. HttpOnly 쿠키 ondap_approval_<draftId>
  const cookieHeader = req.headers.get('cookie');
  if (cookieHeader) {
    const cookieName = `ondap_approval_${draftId}`;
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
    if (match && match[1]) {
      return decodeURIComponent(match[1].trim());
    }
  }

  // 3. 쿼리 스트링 ?token=
  try {
    const url = new URL(req.url);
    const queryToken = url.searchParams.get('token');
    if (queryToken && queryToken.trim()) return queryToken.trim();
  } catch {}

  return null;
}

export async function canAccessDraft(req: Request, draft: ApprovalDraft): Promise<boolean> {
  // 레거시 초안 호환성: 토큰 해시가 없는 과거 초안은 접근 허용
  if (!draft.creatorTokenHash) {
    return true;
  }

  // Supabase 모드에서 실제 로그인 및 인증된 관리자는 조회 허용
  try {
    const admin = await getAdminStatus();
    if (admin.allowed && admin.mode === 'supabase') {
      return true;
    }
  } catch {}

  const token = extractCreatorToken(req, draft.id);
  if (!token) {
    return false;
  }

  return verifyToken(token, draft.creatorTokenHash);
}

export async function canAccessDraftWithToken(
  token: string | null | undefined,
  draft: ApprovalDraft,
): Promise<boolean> {
  if (!draft.creatorTokenHash) {
    return true;
  }

  try {
    const admin = await getAdminStatus();
    if (admin.allowed && admin.mode === 'supabase') {
      return true;
    }
  } catch {}

  if (!token || !token.trim()) {
    return false;
  }

  return verifyToken(token, draft.creatorTokenHash);
}

function verifyToken(token: string, expectedHash: string): boolean {
  try {
    const calculatedHash = hashCreatorToken(token);
    const a = Buffer.from(calculatedHash, 'hex');
    const b = Buffer.from(expectedHash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
