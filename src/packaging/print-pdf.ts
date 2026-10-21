// 인쇄소·사무실 프린터용 판걸이 PDF (실제 크기 mm, A4·A3).
// 스티커 이미지(재단 여백 포함 PNG)는 한 번만 넣고 여러 칸에서 다시 쓰므로 장 수가 늘어도 파일이 거의 커지지 않는다.
// 기본 글꼴은 한글이 없어 안내 문구는 영문·숫자로만 쓴다(한글 글꼴을 넣으면 PDF가 수 MB 커짐).

import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib';
import { BLEED_CM } from './rules.ts';
import { PAPERS, sheetLayout, sheetPlan, type Paper } from './sheet.ts';
import type { StickerSpec } from './types.ts';

const PT_PER_MM = 72 / 25.4;
const mm = (v: number) => v * PT_PER_MM;
const CUT = rgb(1, 0, 1); // 칼선: 마젠타 0.25pt (인쇄소 대부분이 별도 색 선으로 받는다)
const INK = rgb(0.25, 0.25, 0.25);
// 기본 글꼴(WinAnsi)에 없는 글자(한글 등)는 ?로 바꾼다. 그대로 쓰면 PDF 생성이 실패한다
const ascii = (v: string) => v.replace(/[^\x20-\x7E]/g, '?');

export interface PrintSheetInput {
  png: Uint8Array;
  sticker: StickerSpec;
  paper: Paper;
  count: number;
  fill: boolean;
  label: { code: string; orderNo: string | null; productNo: number; quantity: number };
}

export async function buildPrintPdf(input: PrintSheetInput): Promise<{ pdf: Uint8Array; sheets: number; stickers: number }> {
  const { sticker, paper } = input;
  const layout = sheetLayout(sticker, paper);
  const plan = sheetPlan(layout, input.count, input.fill);
  const doc = await PDFDocument.create();
  doc.setTitle(`ONDAP ${input.label.code} ${paper}`);
  doc.setCreator('ONDAP');
  const image = await doc.embedPng(input.png);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const { width, height } = PAPERS[paper];
  const bleed = BLEED_CM * 10;
  const size = sticker.sizeCm * 10;

  plan.forEach((onSheet, sheetIndex) => {
    const page = doc.addPage([mm(width), mm(height)]);
    // pdf 좌표는 왼쪽 아래 기준 → 위에서 잰 mm를 뒤집는다
    const y = (topMm: number) => mm(height - topMm);
    for (let i = 0; i < onSheet; i++) {
      const col = i % layout.cols;
      const row = Math.floor(i / layout.cols);
      const left = layout.originX + col * layout.cellMm;
      const top = layout.originY + row * layout.cellMm;
      page.drawImage(image, { x: mm(left), y: y(top + layout.cellMm), width: mm(layout.cellMm), height: mm(layout.cellMm) });
      if (sticker.shape === 'circle') {
        page.drawEllipse({ x: mm(left + layout.cellMm / 2), y: y(top + layout.cellMm / 2), xScale: mm(size / 2), yScale: mm(size / 2), borderColor: CUT, borderWidth: 0.25 });
      } else {
        page.drawRectangle({ x: mm(left + bleed), y: y(top + bleed + size), width: mm(size), height: mm(size), borderColor: CUT, borderWidth: 0.25 });
      }
    }
    drawCropMarks(page, layout.originX, layout.originY, layout.cols * layout.cellMm, Math.ceil(onSheet / layout.cols) * layout.cellMm, height);

    const { code, orderNo, productNo, quantity } = input.label;
    const head = `ONDAP ${code}${orderNo ? `  order ${orderNo}` : ''}  product #${productNo}  qty ${quantity}  |  ${sticker.shape} ${sticker.sizeCm}cm  ${paper}  sheet ${sheetIndex + 1}/${plan.length}  (${onSheet} pcs)`;
    page.drawText(ascii(head), { x: mm(6), y: y(4.5), size: 7, font, color: INK });
    page.drawText('Print at 100% (actual size). Magenta line = cut line (not printed). Colors are RGB; slight shift after CMYK conversion.', {
      x: mm(6), y: mm(2.5), size: 6, font, color: INK,
    });
  });

  return { pdf: await doc.save(), sheets: plan.length, stickers: plan.reduce((a, b) => a + b, 0) };
}

// 배치 영역 네 모서리의 재단 표시 (5mm 선, 영역에서 1mm 띄움)
function drawCropMarks(page: PDFPage, x: number, topMm: number, w: number, h: number, pageHeight: number) {
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    page.drawLine({ start: { x: mm(x1), y: mm(pageHeight - y1) }, end: { x: mm(x2), y: mm(pageHeight - y2) }, thickness: 0.25, color: rgb(0, 0, 0) });
  const L = 4;
  const g = 1;
  for (const [cx, cy, dx, dy] of [[x, topMm, -1, -1], [x + w, topMm, 1, -1], [x, topMm + h, -1, 1], [x + w, topMm + h, 1, 1]] as const) {
    line(cx + dx * g, cy, cx + dx * (g + L), cy);
    line(cx, cy + dy * g, cx, cy + dy * (g + L));
  }
}
