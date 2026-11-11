import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from '../lib/paths.ts';
const createClient = async () => (await import('../lib/supabase/server.ts')).createClient();
import { createServiceClient } from '../lib/supabase/service.ts';
import { dataSource } from '../lib/supabase/env.ts';
import { reportOperation, type Operation } from '../lib/operations.ts';
import { loadSyncInfo, loadCatalog } from './catalog.ts';

const file = join(dataDir, 'operation-events.json');
const localEvents = () => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>[] : [];

export async function recordOperation(operation: Operation, outcome: 'ok' | 'error', startedAt: number, code = 'ok'): Promise<void> {
  const event = reportOperation(operation, outcome, startedAt, code);
  try {
    if (dataSource() === 'local') {
      writeFileSync(file, JSON.stringify([...localEvents(), { created_at: new Date().toISOString(), operation: event.operation, outcome, code: event.code, duration_ms: event.durationMs }].slice(-500)));
      return;
    }
    // 익명 고객 작업도 운영 기록을 남기지만 서버 키는 이 모듈 밖으로 보내지 않는다.
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return; // 키가 없을 때에도 구조화 콘솔 기록은 남는다.
    const db = createServiceClient(2000);
    const { error } = await db.from('operation_events').insert({ operation: event.operation, outcome, code: event.code, duration_ms: event.durationMs });
    if (error) reportOperation('health_check', 'error', startedAt, 'operation_store_unavailable');
  } catch { reportOperation('health_check', 'error', startedAt, 'operation_store_unavailable'); }
}

export interface PaymentEventIssue {
  shopNo: number;
  orderNo: string;
  eventNo: number;
  status: string;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
}

export interface Health {
  schemaVersion: string;
  lastSync: string | null;
  productCount: number;
  errors24h: number;
  events: { created_at: string; operation: string; outcome: string; code: string; duration_ms: number }[];
  cafe24?: {
    connected: boolean;
    mallId?: string;
    expiresAt?: string;
    isExpired?: boolean;
    refreshTokenExpiresAt?: string;
    isRefreshTokenExpired?: boolean;
    pendingCount: number;
    failedCount: number;
    waitingPaymentCount: number;
    issues?: PaymentEventIssue[];
  };
}
export async function getOperationalHealth(service = false): Promise<Health> {
  const { getOAuthStatus } = await import('../cafe24/oauth.ts');
  const oauth = await getOAuthStatus();

  const queueCounts = { pendingCount: 0, failedCount: 0, waitingPaymentCount: 0 };
  const issues: PaymentEventIssue[] = [];
  if (dataSource() !== 'local' && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const sdb = createServiceClient(2000);
      const { data: qData } = await sdb
        .from('cafe24_payment_events')
        .select('shop_no,order_no,event_no,status,attempts,last_error,updated_at')
        .order('updated_at', { ascending: false });
      if (Array.isArray(qData)) {
        for (const row of qData) {
          const exhausted = row.attempts >= 10 && ['pending', 'processing', 'waiting_payment'].includes(row.status);
          if (exhausted || row.status === 'failed') {
            queueCounts.failedCount++;
            if (issues.length < 20) {
              issues.push({
                shopNo: Number(row.shop_no) || 1,
                orderNo: String(row.order_no ?? ''),
                eventNo: Number(row.event_no) || 90025,
                status: exhausted ? `${row.status} (재시도 초과)` : String(row.status),
                attempts: Number(row.attempts) || 0,
                lastError: typeof row.last_error === 'string' ? row.last_error : null,
                updatedAt: String(row.updated_at ?? ''),
              });
            }
          } else if (row.status === 'pending' || row.status === 'processing') queueCounts.pendingCount++;
          else if (row.status === 'waiting_payment') queueCounts.waitingPaymentCount++;
        }
      }
    } catch {
      // 큐 조회 실패 시 기본값 유지
    }
  }

  const cafe24Health = {
    connected: oauth.connected,
    mallId: oauth.mallId,
    expiresAt: oauth.expiresAt,
    isExpired: oauth.isExpired,
    refreshTokenExpiresAt: oauth.refreshTokenExpiresAt,
    isRefreshTokenExpired: oauth.isRefreshTokenExpired,
    ...queueCounts,
    ...(service ? {} : { issues }),
  };

  if (dataSource() === 'local') {
    const events = localEvents() as unknown as Health['events'];
    return {
      schemaVersion: 'local',
      lastSync: loadSyncInfo().syncedAt,
      productCount: loadCatalog().products.length,
      errors24h: events.filter((e) => e.outcome === 'error' && Date.parse(e.created_at) > Date.now() - 86400000).length,
      events: events.slice(-50).reverse(),
      cafe24: cafe24Health,
    };
  }
  const db = service ? createServiceClient() : await createClient();
  const { data, error } = await db.rpc('operational_health');
  if (error || !data || data.schemaVersion !== '20261027') throw new Error('운영 DB 변경 적용과 연결을 확인해 주세요.');
  return { ...(data as Health), cafe24: cafe24Health };
}
