import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from '../lib/paths.ts';
import { createClient } from '../lib/supabase/server.ts';
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

export interface Health {
  schemaVersion: string;
  lastSync: string | null;
  productCount: number;
  errors24h: number;
  events: { created_at: string; operation: string; outcome: string; code: string; duration_ms: number }[];
}
export async function getOperationalHealth(service = false): Promise<Health> {
  if (dataSource() === 'local') {
    const events = localEvents() as unknown as Health['events'];
    return { schemaVersion: 'local', lastSync: loadSyncInfo().syncedAt, productCount: loadCatalog().products.length, errors24h: events.filter((e) => e.outcome === 'error' && Date.parse(e.created_at) > Date.now() - 86400000).length, events: events.slice(-50).reverse() };
  }
  const db = service ? createServiceClient() : await createClient();
  const { data, error } = await db.rpc('operational_health');
  if (error || !data || data.schemaVersion !== '20261027') throw new Error('운영 DB 변경 적용과 연결을 확인해 주세요.');
  return data as Health;
}
