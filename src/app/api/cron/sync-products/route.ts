import { cronAuthorized } from '@/lib/cron-auth.ts';
import { dataSource } from '@/lib/supabase/env.ts';
import { createServiceClient } from '@/lib/supabase/service.ts';
import { cafe24ConfigFromEnv, fetchAllProducts } from '@/cafe24/client.ts';
import { productToRow } from '@/data/rows.ts';
import { recordOperation } from '@/data/operations-repository.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 32) return Response.json({ error: 'not_configured' }, { status: 503, headers });
  if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  if (dataSource() !== 'supabase' || !process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ error: 'not_configured' }, { status: 503, headers });
  const startedAt = Date.now();
  try {
    const db = createServiceClient();
    // 조회 전에 버전을 읽어, 먼저 시작한 작업이 나중 작업의 결과를 덮어쓰지 못하게 한다.
    const before = await db.from('products').select('synced_at').order('synced_at', { ascending: false }).limit(1);
    if (before.error) throw new Error('read');
    const config = cafe24ConfigFromEnv(process.env as Record<string, string>);
    const products = await fetchAllProducts(config, startedAt + 35000);
    const { error } = await db.rpc('sync_product_snapshot', { p_products: products.map(productToRow), p_expected_synced_at: before.data[0]?.synced_at ?? null });
    if (error) throw new Error('write');
    await recordOperation('catalog_sync', 'ok', startedAt);
    // 운영 기록만 90일 보관. 고객 접수/인쇄 원본은 이 작업이 지우지 않는다.
    await db.from('operation_events').delete().lt('created_at', new Date(Date.now() - 90 * 86400000).toISOString());
    return Response.json({ ok: true, count: products.length }, { headers });
  } catch {
    await recordOperation('catalog_sync', 'error', startedAt, 'sync_rejected');
    return Response.json({ error: 'sync_failed_previous_snapshot_kept' }, { status: 503, headers });
  }
}
