// 관리자 실적 일별 CSV: /admin/stats/export?from=YYYY-MM-DD&to=YYYY-MM-DD (엑셀용 BOM)
import { getStats, validStatsPeriod } from '@/stats/repository.ts';
import { getAdminStatus } from '@/lib/admin-guard.ts';
import { kstRange } from '@/packaging/design-filter.ts';
import { summarize, summaryCsv } from '@/stats/summary.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const status = await getAdminStatus();
  if (!status.allowed) return new Response('관리자만 내려받을 수 있습니다.', { status: 403 });
  const q = new URL(request.url).searchParams;
  const from = q.get('from') ?? '';
  const to = q.get('to') ?? '';
  if (!validStatsPeriod(from, to)) return new Response('기간이 올바르지 않습니다 (최대 400일).', { status: 400 });

  let s;
  try { s = (await getStats(from, to)).summary; }
  catch { return new Response('전체 실적을 확인하지 못해 CSV를 만들지 않았습니다. 운영 상태를 확인해 주세요.', { status: 503, headers: { 'Cache-Control': 'private, no-store' } }); }
  return new Response(summaryCsv(s), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ondap-stats-${from}_${to}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
