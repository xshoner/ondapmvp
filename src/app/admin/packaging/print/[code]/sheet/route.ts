// 관리자 인쇄용 판걸이 PDF: /admin/packaging/print/OD-XXXX-XXXX/sheet?paper=A4|A3&fill=1&count=30&test=1
// count를 빼면 주문 수량, fill=1이면 마지막 장의 남는 칸도 채운다(여분), test=1이면 머리글에 TEST PRINT.
// 오른쪽 위 QR을 휴대폰으로 찍으면 /s/코드 → 관리자 스캔 화면에서 '인쇄 완료'로 바꾼다

import { listDesigns, readPrintFile } from '@/data/packaging-repository.ts';
import { getAdminStatus } from '@/lib/admin-guard.ts';
import { buildPrintPdf } from '@/packaging/print-pdf.ts';
import { cardPrintPixels, normalizeDesignCode, pngSize, printPixels, sanitizeCard, sanitizeSticker } from '@/packaging/rules.ts';
import { isPaper } from '@/packaging/sheet.ts';
import { recordOperation } from '@/data/operations-repository.ts';

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const startedAt = Date.now();
  const status = await getAdminStatus();
  if (!status.allowed) return new Response('관리자만 내려받을 수 있습니다.', { status: 403 });

  const code = normalizeDesignCode((await params).code);
  if (!code) return new Response('잘못된 디자인 코드입니다.', { status: 400 });
  const q = new URL(request.url).searchParams;
  const paper = isPaper(q.get('paper')) ? (q.get('paper') as 'A4' | 'A3') : 'A4';

  const [design] = await listDesigns({ code, limit: 1 });
  if (!design) return new Response('디자인을 찾을 수 없습니다.', { status: 404 });

  const isCard = q.get('item') === 'card' || (!design.sticker && Boolean(design.card));
  let png: Uint8Array | null = null;
  let sticker = sanitizeSticker(design.sticker);
  let card = sanitizeCard(design.card);

  if (isCard) {
    if (!card) return new Response('카드(엽서)가 없는 접수입니다.', { status: 404 });
    png = design.printCode ? await readPrintFile(design.printCode, 'card') : null;
    const size = png && pngSize(png);
    const want = cardPrintPixels(card.sizeMm);
    if (!png || !size) return new Response('카드 인쇄 파일이 없습니다.', { status: 404 });
    if (Math.abs(size.width - want.width) > 2 || Math.abs(size.height - want.height) > 2) {
      return new Response(`인쇄 파일 크기(${size.width}×${size.height}px)가 규격(${want.width}×${want.height}px)과 다릅니다.`, { status: 422 });
    }
  } else {
    if (!sticker) return new Response('스티커가 없는 접수입니다.', { status: 404 });
    png = design.printCode ? await readPrintFile(design.printCode, 'sticker') : null;
    const size = png && pngSize(png);
    const want = printPixels(sticker.sizeCm);
    if (!png || !size) return new Response('스티커 인쇄 파일이 없습니다.', { status: 404 });
    if (Math.abs(size.width - want) > 2 || Math.abs(size.height - want) > 2) {
      return new Response(`인쇄 파일 크기가 규격(${want}px)과 다릅니다.`, { status: 422 });
    }
  }

  const count = Math.min(100000, Math.max(1, Math.round(Number(q.get('count')) || design.quantity)));
  try {
    const { pdf } = await buildPrintPdf({
      png,
      ...(isCard ? { card: card! } : { sticker: sticker! }),
      paper,
      count,
      fill: q.get('fill') === '1',
      label: { code, orderNo: design.orderNo, productNo: design.productNo, quantity: count, test: q.get('test') === '1' },
      qrUrl: `${new URL(request.url).origin}/s/${code}`,
    });
    await recordOperation('print_export', 'ok', startedAt);
    const filename = isCard ? `${code}-card-${paper}.pdf` : `${code}-${paper}.pdf`;
    return new Response(pdf as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    await recordOperation('print_export', 'error', startedAt, 'pdf_build');
    return new Response('PDF를 만들지 못했습니다. 운영 상태를 확인하고 다시 시도해 주세요.', { status: 422 });
  }
}
