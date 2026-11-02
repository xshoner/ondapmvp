import crypto from 'node:crypto';
import { getAdminStatus } from '../lib/admin-guard.ts';
import { dataSource } from '../lib/supabase/env.ts';
import type { ApprovalDraft } from './types.ts';

export function generateCreatorToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashCreatorToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

export function buildCreatorCookie(draftId: string, token: string): string {
  return `ondap_approval_${draftId}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
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
      try { return decodeURIComponent(match[1].trim()); } catch { return null; }
    }
  }


  return null;
}

export async function canAccessDraft(req: Request, draft: ApprovalDraft): Promise<boolean> {
  return canAccessDraftWithToken(extractCreatorToken(req, draft.id), draft);
}

export async function canAccessDraftWithToken(
  token: string | null | undefined,
  draft: ApprovalDraft,
): Promise<boolean> {
  if (!draft.creatorTokenHash && process.env.NODE_ENV === 'development' && dataSource() === 'local') {
    return true;
  }

  if (draft.creatorTokenHash && token && verifyToken(token, draft.creatorTokenHash)) return true;
  try {
    const admin = await getAdminStatus();
    if (admin.allowed && admin.mode === 'supabase') {
      return true;
    }
  } catch {}

  return false;
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
