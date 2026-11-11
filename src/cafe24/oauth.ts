import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServiceClient } from '../lib/supabase/service.ts';
import { dataSource } from '../lib/supabase/env.ts';

export interface Cafe24TokenRecord {
  mall_id: string;
  shop_no: number;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  refresh_token_expires_at: string;
  scope: string;
  updated_at: string;
}

export interface OAuthStatus {
  connected: boolean;
  mallId?: string;
  shopNo?: number;
  expiresAt?: string;
  isExpired?: boolean;
  refreshTokenExpiresAt?: string;
  isRefreshTokenExpired?: boolean;
  scope?: string;
}

function cleanEnv(v?: string | null): string {
  if (!v) return '';
  return v.trim().replace(/^["']|["']$/g, '').trim();
}

function getSigningSecret(): string {
  const secret = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY) || cleanEnv(process.env.CRON_SECRET) || 'ondap-cafe24-oauth-secret-fallback';
  return secret;
}

export function createOAuthState(): string {
  const ts = Date.now().toString(36);
  const nonce = Math.random().toString(36).slice(2, 10);
  const data = `${ts}.${nonce}`;
  const sig = createHmac('sha256', getSigningSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyOAuthState(state: string | null | undefined): boolean {
  if (!state || typeof state !== 'string') return false;
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [tsStr, nonce, sig] = parts;
  const expectedSig = createHmac('sha256', getSigningSecret()).update(`${tsStr}.${nonce}`).digest('base64url');
  if (sig.length !== expectedSig.length) return false;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return false;
  const ts = parseInt(tsStr, 36);
  if (!Number.isFinite(ts) || Date.now() - ts > 10 * 60 * 1000 || ts > Date.now() + 60 * 1000) {
    return false; // 10분 유효기간 초과
  }
  return true;
}

function resolveRedirectUri(): string {
  const explicit = cleanEnv(process.env.CAFE24_REDIRECT_URI);
  if (explicit) return explicit;
  const site = cleanEnv(process.env.NEXT_PUBLIC_SITE_URL)
    || (cleanEnv(process.env.VERCEL_PROJECT_PRODUCTION_URL) ? `https://${cleanEnv(process.env.VERCEL_PROJECT_PRODUCTION_URL)}` : '');
  const base = (site || 'https://dapcue.vercel.app').replace(/\/+$/, '');
  return `${base}/api/cafe24/callback`;
}

export function getCafe24OAuthAuthorizeUrl(state: string): string {
  const mallId = cleanEnv(process.env.CAFE24_MALL_ID);
  const clientId = cleanEnv(process.env.CAFE24_CLIENT_ID);
  const redirectUri = resolveRedirectUri();
  if (!mallId || !clientId) throw new Error('CAFE24_MALL_ID와 CAFE24_CLIENT_ID가 설정되어야 합니다.');
  const scope = 'mall.read_product,mall.read_order';
  return `https://${mallId}.cafe24api.com/api/v2/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}`;
}

export function parseCafe24Date(dateStr?: string | null): number {
  if (!dateStr || typeof dateStr !== 'string') return NaN;
  const trimmed = dateStr.trim();
  const withT = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  // 카페24 API 응답에 타임존(+09:00, Z 등)이 누락된 경우 한국 표준시(KST: UTC+9)로 처리
  const hasTimezone = /(Z|[+-]\d{2}(:?\d{2})?)$/i.test(withT);
  const normalized = hasTimezone ? withT : `${withT}+09:00`;
  return Date.parse(normalized);
}

export function toIsoWithKstFallback(dateStr?: string | null): string {
  const ms = parseCafe24Date(dateStr);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : (dateStr || '');
}

// 로컬 테스트용 인메모리 토큰 캐시
let localTokenCache: Cafe24TokenRecord | null = null;

export function setLocalTokenCacheForTesting(token: Cafe24TokenRecord | null) {
  localTokenCache = token;
}

export async function readStoredToken(mallId?: string): Promise<Cafe24TokenRecord | null> {
  const targetMall = mallId || cleanEnv(process.env.CAFE24_MALL_ID);
  if (!targetMall) return null;
  if (dataSource() === 'local' && localTokenCache) {
    return localTokenCache.mall_id === targetMall ? localTokenCache : null;
  }
  try {
    const db = createServiceClient();
    const { data, error } = await db.from('cafe24_tokens').select('*').eq('mall_id', targetMall).maybeSingle();
    if (error || !data) return null;
    return data as Cafe24TokenRecord;
  } catch {
    return null;
  }
}

export async function saveStoredToken(record: Omit<Cafe24TokenRecord, 'updated_at'>): Promise<void> {
  const full: Cafe24TokenRecord = { ...record, updated_at: new Date().toISOString() };
  if (dataSource() === 'local') {
    localTokenCache = full;
    return;
  }
  const db = createServiceClient();
  const { error } = await db.from('cafe24_tokens').upsert(full);
  if (error) throw new Error(`카페24 토큰 저장 실패: ${error.message}`);
}

export async function exchangeAuthorizationCode(code: string): Promise<Cafe24TokenRecord> {
  const mallId = cleanEnv(process.env.CAFE24_MALL_ID);
  const clientId = cleanEnv(process.env.CAFE24_CLIENT_ID);
  const clientSecret = cleanEnv(process.env.CAFE24_CLIENT_SECRET);
  const redirectUri = resolveRedirectUri();
  if (!mallId || !clientId || !clientSecret) {
    throw new Error('카페24 OAuth 연동에 필요한 환경변수(CAFE24_MALL_ID, CAFE24_CLIENT_ID, CAFE24_CLIENT_SECRET)가 누락되었습니다.');
  }

  const url = `https://${mallId}.cafe24api.com/api/v2/oauth/token`;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(`카페24 토큰 발급 실패 (${res.status}): ${errorBody.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_at: string;
    refresh_token: string;
    refresh_token_expires_at: string;
    scope?: string | string[];
    mall_id?: string;
    shop_no?: string | number;
  };

  const tokenRecord: Omit<Cafe24TokenRecord, 'updated_at'> = {
    mall_id: data.mall_id || mallId,
    shop_no: Number(data.shop_no) || 1,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: toIsoWithKstFallback(data.expires_at),
    refresh_token_expires_at: toIsoWithKstFallback(data.refresh_token_expires_at),
    scope: Array.isArray(data.scope) ? data.scope.join(',') : (data.scope || ''),
  };

  await saveStoredToken(tokenRecord);
  return { ...tokenRecord, updated_at: new Date().toISOString() };
}

let refreshPromise: Promise<Cafe24TokenRecord> | null = null;

export async function refreshAccessToken(): Promise<Cafe24TokenRecord> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const mallId = cleanEnv(process.env.CAFE24_MALL_ID);
      const clientId = cleanEnv(process.env.CAFE24_CLIENT_ID);
      const clientSecret = cleanEnv(process.env.CAFE24_CLIENT_SECRET);
      if (!mallId || !clientId || !clientSecret) {
        throw new Error('카페24 토큰 갱신에 필요한 환경변수가 누락되었습니다.');
      }

      const current = await readStoredToken(mallId);
      if (!current) throw new Error('저장된 카페24 토큰이 없습니다. 관리자 연동을 먼저 진행해 주세요.');

      const refreshExpires = parseCafe24Date(current.refresh_token_expires_at);
      if (Number.isFinite(refreshExpires) && refreshExpires <= Date.now()) {
        throw new Error('카페24 리프레시 토큰이 만료되었습니다. 관리자 메뉴(운영 상태)에서 계정을 다시 연동해 주세요.');
      }

      const url = `https://${mallId}.cafe24api.com/api/v2/oauth/token`;
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: current.refresh_token,
      });

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        throw new Error(`카페24 토큰 갱신 실패 (${res.status}): ${errorBody.slice(0, 200)}`);
      }

      const data = (await res.json()) as {
        access_token: string;
        expires_at: string;
        refresh_token: string;
        refresh_token_expires_at: string;
        scope?: string | string[];
        mall_id?: string;
        shop_no?: string | number;
      };

      const updatedRecord: Omit<Cafe24TokenRecord, 'updated_at'> = {
        mall_id: data.mall_id || mallId,
        shop_no: Number(data.shop_no) || current.shop_no || 1,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: toIsoWithKstFallback(data.expires_at),
        refresh_token_expires_at: toIsoWithKstFallback(data.refresh_token_expires_at),
        scope: Array.isArray(data.scope) ? data.scope.join(',') : (data.scope || current.scope || ''),
      };

      await saveStoredToken(updatedRecord);
      return { ...updatedRecord, updated_at: new Date().toISOString() };
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function getValidAccessToken(forceRefresh = false): Promise<string> {
  const current = await readStoredToken();
  if (!current) {
    throw new Error('카페24 관리자 OAuth 연동이 필요합니다. 관리자 메뉴(운영 상태)에서 계정을 연동해 주세요.');
  }

  const expiresAtMs = parseCafe24Date(current.expires_at);
  // 만료 10분 전이거나 강제 갱신 요청 시 선제적으로 토큰 갱신
  if (forceRefresh || !Number.isFinite(expiresAtMs) || expiresAtMs - Date.now() < 10 * 60 * 1000) {
    const refreshed = await refreshAccessToken();
    return refreshed.access_token;
  }
  return current.access_token;
}

export async function getOAuthStatus(): Promise<OAuthStatus> {
  const mallId = cleanEnv(process.env.CAFE24_MALL_ID);
  const current = await readStoredToken(mallId);
  if (!current) return { connected: false, mallId };
  const expiresMs = parseCafe24Date(current.expires_at);
  const refreshExpiresMs = parseCafe24Date(current.refresh_token_expires_at);
  const now = Date.now();
  return {
    connected: true,
    mallId: current.mall_id,
    shopNo: current.shop_no,
    expiresAt: current.expires_at,
    isExpired: Number.isFinite(expiresMs) && expiresMs <= now,
    refreshTokenExpiresAt: current.refresh_token_expires_at,
    isRefreshTokenExpired: Number.isFinite(refreshExpiresMs) && refreshExpiresMs <= now,
    scope: current.scope,
  };
}
