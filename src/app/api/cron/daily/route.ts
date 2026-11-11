import { cronAuthorized } from '@/lib/cron-auth.ts';
import { runDailyTasksDetailed } from '@/lib/daily-cron.ts';
import { GET as syncProducts } from '../sync-products/route.ts';
import { GET as checkHealth } from '../health/route.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  const result = await runDailyTasksDetailed(() => syncProducts(request), () => checkHealth(request));
  const ok = result.sync === 200 && result.health === 200;
  return Response.json({ ok, ...result }, { status: ok ? 200 : 503, headers });
}
