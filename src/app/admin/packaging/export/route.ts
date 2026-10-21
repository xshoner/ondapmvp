// 관리자 디자인 접수 CSV 내려받기: /admin/packaging/export?status=&from=&to=&code=
// 접수 목록 화면과 같은 거르기 조건. 엑셀에서 바로 열리도록 UTF-8 BOM.

import { getCatalog } from '@/data/repository.ts';
import { listDesigns } from '@/data/packaging-repository.ts';
import { getAdminStatus } from '@/lib/admin-guard.ts';
import { kstLabel } from '@/lib/kst.ts';
import { designsCsv, parseDesignFilter } from '@/packaging/design-filter.ts';

export async function GET(request: Request) {
  const status = await getAdminStatus();
  if (!status.allowed) return new Response('관리자만 내려받을 수 있습니다.', { status: 403 });

  const filter = parseDesignFilter(Object.fromEntries(new URL(request.url).searchParams));
  if (filter.codeInvalid) return new Response('코드 형식이 맞지 않습니다.', { status: 400 });
  const [designs, { config }] = await Promise.all([listDesigns({ ...filter, limit: 5000 }), getCatalog()]);
  const eventNames = Object.fromEntries(Object.entries(config.events).map(([k, v]) => [k, v.name]));

  const stamp = kstLabel(new Date().toISOString()).slice(0, 10).replaceAll('-', '');
  return new Response(designsCsv(designs, eventNames, kstLabel), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ondap-designs-${stamp}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
