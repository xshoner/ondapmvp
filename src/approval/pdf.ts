import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { ApprovalDocumentModel, CandidateCalculatedRow } from './types.ts';
import { getCachedImagePath, readProductImageBytes } from '../data/approval-repository.ts';
import { won } from '../lib/result-query.ts';

const INK_DARK = rgb(0.08, 0.1, 0.15); // #141A26 (Black)
const INK_MUTED = rgb(0.35, 0.38, 0.44); // #596170
const BG_LIGHT = rgb(0.95, 0.95, 0.95); // #F2F2F2 연회색
const BORDER_COLOR = rgb(0.1, 0.1, 0.1); // 가는 검정 표 테두리
const WHITE = rgb(1, 1, 1);

// 텍스트 줄바꿈 계산
function wrapText(text: string, maxWidth: number, font: PDFFont, fontSize: number): string[] {
  if (!text) return [''];
  const lines: string[] = [];
  const paragraphs = text.split('\n');

  for (const para of paragraphs) {
    if (!para) {
      lines.push('');
      continue;
    }
    let currentLine = '';
    for (let i = 0; i < para.length; i++) {
      const char = para[i];
      const testLine = currentLine + char;
      const width = font.widthOfTextAtSize(testLine, fontSize);
      if (width > maxWidth && currentLine.length > 0 && !/[)\]}.,·%]/.test(char)) {
        const lastSpace = currentLine.lastIndexOf(' ');
        if (char !== ' ' && lastSpace > 0 && /[\x21-\x7e]/.test(char) && /[\x21-\x7e]/.test(currentLine[currentLine.length - 1])) {
          lines.push(currentLine.slice(0, lastSpace));
          currentLine = currentLine.slice(lastSpace + 1) + char;
        } else {
          lines.push(currentLine.trimEnd());
          currentLine = char === ' ' ? '' : char;
        }
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine.length > 0) {
      lines.push(currentLine);
    }
  }
  return lines;
}

export async function generateApprovalPdf(model: ApprovalDocumentModel): Promise<Uint8Array> {
  return renderApprovalPdf(model, 0);
}

async function renderApprovalPdf(model: ApprovalDocumentModel, extra: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  // 로컬 한글 폰트 로드
  const fontRegularPath = path.resolve(process.cwd(), 'assets', 'fonts', 'NanumGothic-Regular.ttf');
  const fontBoldPath = path.resolve(process.cwd(), 'assets', 'fonts', 'NanumGothic-Bold.ttf');

  const [regularBytes, boldBytes] = await Promise.all([
    fs.readFile(fontRegularPath),
    fs.readFile(fontBoldPath),
  ]);

  const fontRegular = await doc.embedFont(regularBytes);
  const fontBold = await doc.embedFont(boldBytes);

  // Word 문서와 같은 15mm 페이지 여백
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const marginX = 44.0;
  const marginTop = 42.5;
  const marginBottom = 42.5;
  const contentWidth = pageWidth - marginX * 2; // ~499pt

  // 본문 10.5pt, 줄 높이 16pt, 셀 여백 상하 3pt·좌우 8pt
  const BODY_SIZE = 10.5;
  const BODY_LH = 16;
  const CELL_PX = 8;
  const CELL_PY = 3;
  const MIN_ROW = 22;

  let currentPage = doc.addPage([pageWidth, pageHeight]);
  let currentY = pageHeight - marginTop;
  let spacingCount = 0;

  // 새 페이지 필요시 추가
  function checkNewPage(neededHeight: number) {
    if (currentY - neededHeight < marginBottom) {
      currentPage = doc.addPage([pageWidth, pageHeight]);
      currentY = pageHeight - marginTop;
    }
  }

  // 칸 안 글자: 줄 묶음을 칸 높이의 세로 가운데에 놓는다
  function drawCellLines(
    lines: string[],
    x: number,
    boxTop: number,
    boxHeight: number,
    boxWidth: number,
    font: PDFFont,
    size: number,
    lh: number,
    align: 'LEFT' | 'CENTER' = 'LEFT',
  ) {
    const blockH = lines.length * lh;
    const firstTop = boxTop - Math.max(0, (boxHeight - blockH) / 2);
    lines.forEach((line, idx) => {
      const lineTop = firstTop - idx * lh;
      const baseline = lineTop - (lh - size) / 2 - size * 0.86;
      const w = font.widthOfTextAtSize(line, size);
      const tx = align === 'CENTER' ? x + (boxWidth - w) / 2 : x + CELL_PX;
      currentPage.drawText(line, { x: tx, y: baseline, size, font, color: INK_DARK });
    });
  }

  function drawBox(x: number, topY: number, w: number, h: number, fill: ReturnType<typeof rgb>) {
    currentPage.drawRectangle({
      x,
      y: topY - h,
      width: w,
      height: h,
      color: fill,
      borderColor: BORDER_COLOR,
      borderWidth: 0.6,
    });
  }

  // 상단: 결재란(우측)
  const titles = Array.isArray(model.approverTitles) ? model.approverTitles : ['담당', '팀장', '과장'];
  const hasApprovers = titles.length > 0;

  if (hasApprovers) {
    const stampHeaderHeight = 17;
    const stampBodyHeight = 30;
    const stampTotalHeight = stampHeaderHeight + stampBodyHeight;
    const stampLabelWidth = 24;
    const stampColWidth = 54;
    const stampTotalWidth = stampLabelWidth + stampColWidth * titles.length;
    const stampX = pageWidth - marginX - stampTotalWidth;

    drawBox(stampX, currentY, stampLabelWidth, stampTotalHeight, BG_LIGHT);
    drawCellLines(['결', '재'], stampX, currentY, stampTotalHeight, stampLabelWidth, fontBold, 9.5, 15, 'CENTER');

    titles.forEach((title, i) => {
      const colX = stampX + stampLabelWidth + i * stampColWidth;
      drawBox(colX, currentY, stampColWidth, stampHeaderHeight, BG_LIGHT);
      drawCellLines([title], colX, currentY, stampHeaderHeight, stampColWidth, fontBold, 9.5, 14, 'CENTER');
      drawBox(colX, currentY - stampHeaderHeight, stampColWidth, stampBodyHeight, WHITE);
    });
    currentY -= stampTotalHeight + 8;
  }

  // 문서 제목 (화면과 같이 결재란 아래 중앙)
  const titleText = '답례품 선정 검토서';
  const titleFontSize = 19;
  const titleW = fontBold.widthOfTextAtSize(titleText, titleFontSize);
  currentPage.drawText(titleText, {
    x: (pageWidth - titleW) / 2,
    y: currentY - titleFontSize,
    size: titleFontSize,
    font: fontBold,
    color: INK_DARK,
  });
  currentY -= titleFontSize + 6;

  // 섹션 제목 (13pt) — 위 16pt, 아래 8pt 간격
  function drawSectionTitle(title: string) {
    checkNewPage(60 + extra);
    currentY -= 8 + extra;
    spacingCount++;
    currentPage.drawText(title, {
      x: marginX,
      y: currentY - 13,
      size: 13,
      font: fontBold,
      color: INK_DARK,
    });
    currentY -= 13 + 6;
  }

  type Cell = { text: string; w: number; bold?: boolean; label?: boolean };

  // 한 행 그리기: 칸마다 줄바꿈을 계산하고 가장 높은 칸에 행 높이를 맞춘다
  function drawRow(cells: Cell[], fontSize = BODY_SIZE, lh = BODY_LH, minRow = MIN_ROW) {
    const wrapped = cells.map((c) =>
      wrapText(c.text, c.w - CELL_PX * 2, c.bold || c.label ? fontBold : fontRegular, fontSize),
    );
    const maxLines = Math.max(1, ...wrapped.map((l) => l.length));
    const rowHeight = Math.max(minRow, maxLines * lh + CELL_PY * 2) + extra;
    spacingCount++;
    checkNewPage(rowHeight);

    let x = marginX;
    cells.forEach((c, i) => {
      drawBox(x, currentY, c.w, rowHeight, c.label ? BG_LIGHT : WHITE);
      drawCellLines(
        wrapped[i],
        x,
        currentY,
        rowHeight,
        c.w,
        c.bold || c.label ? fontBold : fontRegular,
        fontSize,
        lh,
        c.label ? 'CENTER' : 'LEFT',
      );
      x += c.w;
    });
    currentY -= rowHeight;
  }

  const LABEL_W = 92;

  // 2열 키-값 표
  function drawKeyValueTable(rows: [string, string, boolean?][]) {
    for (const [key, val, isValBold] of rows) {
      drawRow([
        { text: key, w: LABEL_W, label: true },
        { text: val, w: contentWidth - LABEL_W, bold: !!isValBold },
      ]);
    }
    currentY -= 2;
  }

  // 1. 기안 정보 — 화면처럼 4열(라벨/값/라벨/값) 배치
  drawSectionTitle('1. 기안 정보');
  const gridLabelW = contentWidth * 0.18;
  const gridValueW = contentWidth * 0.32;
  drawRow([
    { text: '행 사 명', w: gridLabelW, label: true },
    { text: model.eventName, w: gridValueW, bold: true },
    { text: '행 사 일', w: gridLabelW, label: true },
    { text: model.eventDateText, w: gridValueW },
  ]);
  drawRow([
    { text: '기 안 자', w: gridLabelW, label: true },
    { text: model.authorText, w: gridValueW },
    { text: '작 성 일', w: gridLabelW, label: true },
    { text: model.createdDateText, w: gridValueW },
  ]);
  drawRow([
    { text: '대상·수량', w: gridLabelW, label: true },
    {
      text: `${model.relationCategoryName} (${model.eventCategoryName} 기준) / ${model.quantity.toLocaleString('ko-KR')}개`,
      w: contentWidth - gridLabelW,
      bold: true,
    },
  ]);
  if (model.purposeText) {
    drawRow([
      { text: '추진 목적', w: gridLabelW, label: true },
      { text: model.purposeText, w: contentWidth - gridLabelW },
    ]);
  }
  currentY -= 2;

  // 2. 선정 개요
  drawSectionTitle('2. 선정 개요');
  const summaryRows: [string, string, boolean?][] = [
    ['최종 선정안', `${model.selectedPlanLabel} [선택] ${model.selectedCandidate.productName}`, true],
    ['선정 사유', model.selectedReason],
    ['소요 금액', `단가 ${won(model.unitPrice)} × ${model.quantity.toLocaleString('ko-KR')}개 = 상품 합계 ${won(model.itemTotal)}\n※ ${model.extraCostNote}`, true],
    ['예산 비교', model.budgetStatus, true],
  ];
  if (model.hasInternalLimit && model.perPersonLimitCheckText) {
    summaryRows.push(['내부 가액 기준', model.perPersonLimitCheckText]);
  }
  drawKeyValueTable(summaryRows);

  // 3. 추천 상품 비교
  drawSectionTitle('3. 추천 상품 비교 (대안 검토)');
  if (model.hasShortage && model.shortageReason) {
    checkNewPage(24);
    currentPage.drawText(`※ 안내: ${model.shortageReason}`, {
      x: marginX,
      y: currentY - 11,
      size: 10,
      font: fontRegular,
      color: INK_DARK,
    });
    currentY -= 22;
  }

  const rowsCount = model.candidateRows.length;
  const col0Width = LABEL_W;
  const colWidth = (contentWidth - col0Width) / Math.max(1, rowsCount);
  const compFontSize = 10;
  const compLineHeight = 15;

  // 각 후보의 사진 로드
  const candidateImages: (any | null)[] = [];
  for (const r of model.candidateRows) {
    if (r.candidate.localImageFilename) {
      try {
        const imgBytes = await readProductImageBytes(r.candidate.localImageFilename);
        if (imgBytes) {
          const embedded = await doc.embedPng(imgBytes).catch(() => null);
          candidateImages.push(embedded);
        } else {
          candidateImages.push(null);
        }
      } catch {
        candidateImages.push(null);
      }
    } else {
      candidateImages.push(null);
    }
  }

  // 3-1. 비교표 헤더 행
  const headerCells: Cell[] = [
    { text: '구분', w: col0Width, label: true },
    ...model.candidateRows.map((r) => ({
      text: `${r.planLabel} ${r.isSelected ? '[선택]' : ''}`.trim(),
      w: colWidth,
      label: true,
    })),
  ];
  {
    const h = 24;
    checkNewPage(h + 90);
    let x = marginX;
    headerCells.forEach((c) => {
      drawBox(x, currentY, c.w, h, BG_LIGHT);
      drawCellLines([c.text], x, currentY, h, c.w, fontBold, compFontSize, compLineHeight, 'CENTER');
      x += c.w;
    });
    currentY -= h;
  }

  // 3-2. 사진 행
  {
    const photoRowHeight = 52;
    checkNewPage(photoRowHeight);
    drawBox(marginX, currentY, col0Width, photoRowHeight, BG_LIGHT);
    drawCellLines(['참고 상품', '사진'], marginX, currentY, photoRowHeight, col0Width, fontBold, compFontSize, compLineHeight, 'CENTER');

    model.candidateRows.forEach((r, i) => {
      const colX = marginX + col0Width + i * colWidth;
      drawBox(colX, currentY, colWidth, photoRowHeight, WHITE);
      const img = candidateImages[i];
      if (img) {
        const maxImgW = colWidth - 20;
        const maxImgH = photoRowHeight - 16;
        const scale = Math.min(maxImgW / img.width, maxImgH / img.height);
        const imgW = img.width * scale;
        const imgH = img.height * scale;
        currentPage.drawImage(img, {
          x: colX + (colWidth - imgW) / 2,
          y: currentY - photoRowHeight + (photoRowHeight - imgH) / 2,
          width: imgW,
          height: imgH,
        });
      } else {
        const fb = '[사진 없음]';
        const fbW = fontRegular.widthOfTextAtSize(fb, 10);
        currentPage.drawText(fb, {
          x: colX + (colWidth - fbW) / 2,
          y: currentY - photoRowHeight / 2 - 3.5,
          size: 10,
          font: fontRegular,
          color: INK_MUTED,
        });
      }
    });
    currentY -= photoRowHeight;
  }

  // 3-3. 텍스트 비교 행들
  const compItems: [string, (r: CandidateCalculatedRow) => string, boolean?][] = [
    ['상품명', (r) => (r.isSelected ? `▶ ${r.candidate.productName}` : r.candidate.productName), true],
    ['단가 / 수량', (r) => `${won(r.unitPrice)} / ${r.quantity.toLocaleString('ko-KR')}개`],
    ['상품 합계', (r) => won(r.itemTotal), true],
    ['비고', (r) => r.remark],
  ];

  for (const [label, getter, isItemBold] of compItems) {
    drawRow(
      [
        { text: label, w: col0Width, label: true },
        ...model.candidateRows.map((r) => ({
          text: getter(r),
          w: colWidth,
          bold: !!(isItemBold && r.isSelected),
        })),
      ],
      compFontSize,
      compLineHeight,
    );
  }
  currentY -= 2;

  // 4. 추진 일정 및 비고 (사용자가 입력한 경우에만 표시)
  if (model.hasScheduleOrNote) {
    drawSectionTitle('4. 추진 일정 및 비고');
    const scheduleRows: [string, string, boolean?][] = [];
    if (model.deliveryScheduleText) {
      scheduleRows.push(['추진 일정', model.deliveryScheduleText]);
    }
    if (model.additionalNote && model.additionalNote.trim()) {
      scheduleRows.push(['비 고', model.additionalNote.trim()]);
    }
    if (scheduleRows.length > 0) {
      drawKeyValueTable(scheduleRows);
    }
  }

  // 하단 메타 정보 (화면처럼 위에 가는 선)
  checkNewPage(36);
  currentY -= 6;
  currentPage.drawLine({
    start: { x: marginX, y: currentY },
    end: { x: pageWidth - marginX, y: currentY },
    thickness: 0.6,
    color: BORDER_COLOR,
  });
  const metaText = `작성일: ${model.createdDateText}  |  자료 기준일: ${model.catalogDateText}`;
  currentPage.drawText(metaText, {
    x: marginX,
    y: currentY - 16,
    size: 9,
    font: fontRegular,
    color: INK_MUTED,
  });
  const noteLines = wrapText(`※ ${model.draftNotice}`, contentWidth, fontRegular, 8);
  noteLines.forEach((line, idx) => {
    currentPage.drawText(line, {
      x: marginX,
      y: currentY - 29 - idx * 12,
      size: 8,
      font: fontRegular,
      color: INK_MUTED,
    });
  });

  const spare = currentY - 30 - (noteLines.length - 1) * 12 - marginBottom - 3;
  if (extra === 0 && doc.getPageCount() === 1 && spare > 1 && spacingCount > 0) {
    return renderApprovalPdf(model, spare / spacingCount);
  }
  return doc.save();
}
