// 관리자 실적 일별 CSV: /admin/stats/export?from=YYYY-MM-DD&to=YYYY-MM-DD (엑셀용 BOM)
import { getRecommendationLogs } from '@/data/repository.ts';
import { listDesigns } from '@/data/packaging-repository.ts';
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
  if (!DATE.test(from) || !DATE.test(to) || from > to) return new Response('기간이 올바르지 않습니다.', { status: 400 });

  const [recs, designs] = await Promise.all([getRecommendationLogs(kstRange({ from, to })), listDesigns({ from, to, limit: 5000 })]);
  const s = summarize(recs, designs.map((d) => ({ createdAt: d.createdAt, status: d.status, orderNo: d.orderNo, hasSticker: Boolean(d.sticker) })), { from, to });
  return new Response(summaryCsv(s), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ondap-stats-${from}_${to}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
