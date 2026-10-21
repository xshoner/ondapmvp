// 관리자 인쇄용 판걸이 PDF: /admin/packaging/print/OD-XXXX-XXXX/sheet?paper=A4|A3&fill=1&count=30
// count를 빼면 주문 수량, fill=1이면 마지막 장의 남는 칸도 채운다(여분)

import { listDesigns, readPrintFile } from '@/data/packaging-repository.ts';
import { getAdminStatus } from '@/lib/admin-guard.ts';
import { buildPrintPdf } from '@/packaging/print-pdf.ts';
import { normalizeDesignCode } from '@/packaging/rules.ts';
import { isPaper } from '@/packaging/sheet.ts';

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const status = await getAdminStatus();
  if (!status.allowed) return new Response('관리자만 내려받을 수 있습니다.', { status: 403 });

  const code = normalizeDesignCode((await params).code);
  if (!code) return new Response('잘못된 디자인 코드입니다.', { status: 400 });
  const q = new URL(request.url).searchParams;
  const paper = isPaper(q.get('paper')) ? (q.get('paper') as 'A4' | 'A3') : 'A4';

  const [design] = await listDesigns({ code, limit: 1 });
  if (!design?.sticker) return new Response('스티커가 없는 접수입니다.', { status: 404 });
  const png = await readPrintFile(code);
  if (!png) return new Response('인쇄 파일이 없습니다.', { status: 404 });

  const count = Math.min(100000, Math.max(1, Math.round(Number(q.get('count')) || design.quantity)));
  const { pdf } = await buildPrintPdf({
    png,
    sticker: design.sticker,
    paper,
    count,
    fill: q.get('fill') === '1',
    label: { code, orderNo: design.orderNo, productNo: design.productNo, quantity: count },
  });

  return new Response(pdf as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${code}-${paper}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
