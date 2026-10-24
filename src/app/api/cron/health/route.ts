import { cronAuthorized } from '@/lib/cron-auth.ts';
import { getOperationalHealth, recordOperation } from '@/data/operations-repository.ts';
import { createServiceClient } from '@/lib/supabase/service.ts';
import { dataSource } from '@/lib/supabase/env.ts';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  const startedAt = Date.now();
  try {
    if (dataSource() !== 'supabase') throw new Error('mode');
    const health = await getOperationalHealth(true);
    const db = createServiceClient();
    const storage = await Promise.all(['design-files','packaging-assets'].map((bucket) => db.storage.from(bucket).list('', { limit: 1 })));
    const error = storage.some((r) => r.error);
    const stale = !health.lastSync || Date.now() - Date.parse(health.lastSync) > 36 * 3600000;
    const ok = !error && !stale && health.productCount > 0;
    await recordOperation('health_check', ok ? 'ok' : 'error', startedAt, ok ? 'ok' : error ? 'storage_unavailable' : 'catalog_stale');
    return Response.json({ ok, schemaVersion: health.schemaVersion, catalogFresh: !stale, storageAvailable: !error, errors24h: health.errors24h }, { status: ok ? 200 : 503, headers });
  } catch {
    await recordOperation('health_check', 'error', startedAt, 'dependency_unavailable');
    return Response.json({ ok: false, error: 'dependency_unavailable' }, { status: 503, headers });
  }
}
