import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { ApprovalDocumentModel, CandidateCalculatedRow } from './types.ts';
import { getCachedImagePath } from '../data/approval-repository.ts';
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
      if (width > maxWidth && currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = char;
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

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const marginX = 36.0;
  const marginY = 24.0;
  const contentWidth = pageWidth - marginX * 2; // ~523pt
  const bottomThreshold = 22.0;

  let currentPage = doc.addPage([pageWidth, pageHeight]);
  let currentY = pageHeight - marginY;

  // 새 페이지 필요시 추가
  function checkNewPage(neededHeight: number) {
    if (currentY - neededHeight < bottomThreshold) {
      currentPage = doc.addPage([pageWidth, pageHeight]);
      currentY = pageHeight - marginY;
    }
  }

  // 상단 헤더: 제목(중앙) + 결재란(우측)
  const titles = Array.isArray(model.approverTitles) ? model.approverTitles : ['담당', '팀장', '과장'];
  const hasApprovers = titles.length > 0;
  const stampHeaderHeight = 10.4; // 직책란 여백을 줄여 텍스트 높이에 맞춤 (기존 13.0pt에서 20% 축소)
  const stampBodyHeight = 27.5; // 하단 공란(서명란) 높이 10% 확대 유지 (기존 25.0pt)
  const stampTotalHeight = stampHeaderHeight + stampBodyHeight; // 37.9pt
  const headerTopY = currentY;

  if (hasApprovers) {
    const stampLabelWidth = 18;
    const stampColWidth = 38;
    const stampTotalWidth = stampLabelWidth + stampColWidth * titles.length;

    const stampX = pageWidth - marginX - stampTotalWidth;
    const stampY = headerTopY - stampTotalHeight;

    // 결재 라벨 (2행 통합)
    currentPage.drawRectangle({
      x: stampX,
      y: stampY,
      width: stampLabelWidth,
      height: stampTotalHeight,
      color: BG_LIGHT,
      borderColor: BORDER_COLOR,
      borderWidth: 0.5,
    });
    currentPage.drawText('결', {
      x: stampX + (stampLabelWidth - fontBold.widthOfTextAtSize('결', 7.5)) / 2,
      y: stampY + stampTotalHeight / 2 + 2,
      size: 7.5,
      font: fontBold,
      color: INK_DARK,
    });
    currentPage.drawText('재', {
      x: stampX + (stampLabelWidth - fontBold.widthOfTextAtSize('재', 7.5)) / 2,
      y: stampY + stampTotalHeight / 2 - 8,
      size: 7.5,
      font: fontBold,
      color: INK_DARK,
    });

    // 직책 칸들
    titles.forEach((title, i) => {
      const colX = stampX + stampLabelWidth + i * stampColWidth;
      // 헤더 셀
      currentPage.drawRectangle({
        x: colX,
        y: headerTopY - stampHeaderHeight,
        width: stampColWidth,
        height: stampHeaderHeight,
        color: BG_LIGHT,
        borderColor: BORDER_COLOR,
        borderWidth: 0.5,
      });
      const tWidth = fontBold.widthOfTextAtSize(title, 8);
      currentPage.drawText(title, {
        x: colX + (stampColWidth - tWidth) / 2,
        y: headerTopY - stampHeaderHeight + 2.0,
        size: 8,
        font: fontBold,
        color: INK_DARK,
      });

      // 서명 빈 칸
      currentPage.drawRectangle({
        x: colX,
        y: stampY,
        width: stampColWidth,
        height: stampBodyHeight,
        color: WHITE,
        borderColor: BORDER_COLOR,
        borderWidth: 0.5,
      });
    });
  }

  // 문서 제목 (중앙 정렬, 18pt) - 결재란과 수직 중앙 정렬
  const titleText = '답례품 선정 검토서';
  const titleFontSize = 18;
  const titleW = fontBold.widthOfTextAtSize(titleText, titleFontSize);
  const titleY = hasApprovers
    ? (headerTopY - stampTotalHeight / 2 - titleFontSize / 2 + 2)
    : (headerTopY - titleFontSize);

  currentPage.drawText(titleText, {
    x: (pageWidth - titleW) / 2,
    y: titleY,
    size: titleFontSize,
    font: fontBold,
    color: INK_DARK,
  });

  currentY = hasApprovers ? (headerTopY - stampTotalHeight - 8) : (headerTopY - titleFontSize - 14);

  // 섹션 제목 렌더러 (12.5pt)
  function drawSectionTitle(title: string) {
    checkNewPage(16);
    currentY -= 3;
    currentPage.drawText(title, {
      x: marginX,
      y: currentY - 9.5,
      size: 12.5,
      font: fontBold,
      color: INK_DARK,
    });
    currentY -= 13;
  }

  // 2열 키-값 표 렌더러 (본문 11pt)
  function drawKeyValueTable(
    rows: [string, string, boolean?][],
    col1Width: number,
    opts: { fontSize?: number; lineHeight?: number; paddingY?: number } = {},
  ) {
    const col2Width = contentWidth - col1Width;
    const paddingX = 5;
    const paddingY = opts.paddingY ?? 2.5;
    const fontSize = opts.fontSize ?? 11;
    const lineHeight = opts.lineHeight ?? 13.5;

    for (const [key, val, isValBold] of rows) {
      const keyLines = wrapText(key, col1Width - paddingX * 2, fontBold, fontSize);
      const valFont = isValBold ? fontBold : fontRegular;
      const valLines = wrapText(val, col2Width - paddingX * 2, valFont, fontSize);
      const maxLines = Math.max(keyLines.length, valLines.length);
      const rowHeight = Math.max(17, maxLines * lineHeight + paddingY * 2);

      checkNewPage(rowHeight);

      // 열1 (키)
      currentPage.drawRectangle({
        x: marginX,
        y: currentY - rowHeight,
        width: col1Width,
        height: rowHeight,
        color: BG_LIGHT,
        borderColor: BORDER_COLOR,
        borderWidth: 0.5,
      });
      const keyStartY = currentY - paddingY - fontSize + 1;
      keyLines.forEach((line, idx) => {
        currentPage.drawText(line, {
          x: marginX + paddingX,
          y: keyStartY - idx * lineHeight,
          size: fontSize,
          font: fontBold,
          color: INK_DARK,
        });
      });

      // 열2 (값)
      currentPage.drawRectangle({
        x: marginX + col1Width,
        y: currentY - rowHeight,
        width: col2Width,
        height: rowHeight,
        color: WHITE,
        borderColor: BORDER_COLOR,
        borderWidth: 0.5,
      });
      const valStartY = currentY - paddingY - fontSize + 1;
      valLines.forEach((line, idx) => {
        currentPage.drawText(line, {
          x: marginX + col1Width + paddingX,
          y: valStartY - idx * lineHeight,
          size: fontSize,
          font: valFont,
          color: INK_DARK,
        });
      });

      currentY -= rowHeight;
    }
  }

  // 1. 기안 정보
  drawSectionTitle('1. 기안 정보');
  const overviewRows: [string, string, boolean?][] = [
    ['행 사 명', model.eventName, true],
    ['행 사 일', model.eventDateText],
    ['기 안 자', model.authorText],
    ['작 성 일', model.createdDateText],
    ['대상·수량', `${model.relationCategoryName} (${model.eventCategoryName} 기준) / ${model.quantity.toLocaleString('ko-KR')}개`, true],
  ];
  if (model.purposeText) {
    overviewRows.push(['추진 목적', model.purposeText]);
  }
  drawKeyValueTable(overviewRows, 95);

  // 2. 선정 개요
  drawSectionTitle('2. 선정 개요');
  const summaryRows: [string, string, boolean?][] = [
    ['최종 선정안', `${model.selectedPlanLabel} [선택] ${model.selectedCandidate.productName}`, true],
    ['선정 사유', model.selectedReason],
    ['소요 금액', `단가 ${won(model.unitPrice)} × ${model.quantity.toLocaleString('ko-KR')}개 = 상품 합계 ${won(model.itemTotal)}\n(※ ${model.extraCostNote})`, true],
    ['예산 비교', model.budgetStatus, true],
  ];
  if (model.hasInternalLimit && model.perPersonLimitCheckText) {
    summaryRows.push(['내부 가액 기준', model.perPersonLimitCheckText]);
  }
  drawKeyValueTable(summaryRows, 95);

  // 3. 추천 상품 비교
  drawSectionTitle('3. 추천 상품 비교 (대안 검토)');
  if (model.hasShortage && model.shortageReason) {
    checkNewPage(14);
    currentPage.drawText(`※ 안내: ${model.shortageReason}`, {
      x: marginX,
      y: currentY - 9,
      size: 10,
      font: fontRegular,
      color: INK_DARK,
    });
    currentY -= 14;
  }

  // 비교표 너비 계산
  const rowsCount = model.candidateRows.length;
  const col0Width = 80;
  const colWidth = (contentWidth - col0Width) / Math.max(1, rowsCount);
  const compFontSize = 10.5;
  const compLineHeight = 13.5;
  const compPaddingX = 5;
  const compPaddingY = 3.5;

  // 각 후보의 사진 로드
  const candidateImages: (any | null)[] = [];
  for (const r of model.candidateRows) {
    if (r.candidate.localImageFilename) {
      try {
        const imgPath = getCachedImagePath(r.candidate.localImageFilename);
        const imgBytes = await fs.readFile(imgPath);
        const embedded = await doc.embedPng(imgBytes).catch(() => null);
        candidateImages.push(embedded);
      } catch {
        candidateImages.push(null);
      }
    } else {
      candidateImages.push(null);
    }
  }

  // 3-1. 비교표 헤더 행
  const compHeaderHeight = 22;
  checkNewPage(compHeaderHeight);

  currentPage.drawRectangle({
    x: marginX,
    y: currentY - compHeaderHeight,
    width: col0Width,
    height: compHeaderHeight,
    color: BG_LIGHT,
    borderColor: BORDER_COLOR,
    borderWidth: 0.5,
  });
  currentPage.drawText('구분', {
    x: marginX + (col0Width - fontBold.widthOfTextAtSize('구분', compFontSize)) / 2,
    y: currentY - compHeaderHeight + 6,
    size: compFontSize,
    font: fontBold,
    color: INK_DARK,
  });

  model.candidateRows.forEach((r, i) => {
    const colX = marginX + col0Width + i * colWidth;
    currentPage.drawRectangle({
      x: colX,
      y: currentY - compHeaderHeight,
      width: colWidth,
      height: compHeaderHeight,
      color: BG_LIGHT,
      borderColor: BORDER_COLOR,
      borderWidth: 0.5,
    });
    const label = `${r.planLabel} ${r.isSelected ? '[선택]' : ''}`;
    const labelW = fontBold.widthOfTextAtSize(label, compFontSize);
    currentPage.drawText(label, {
      x: colX + (colWidth - labelW) / 2,
      y: currentY - compHeaderHeight + 6,
      size: compFontSize,
      font: fontBold,
      color: INK_DARK,
    });
  });
  currentY -= compHeaderHeight;

  // 3-2. 사진 행
  const photoRowHeight = 50;
  checkNewPage(photoRowHeight);

  currentPage.drawRectangle({
    x: marginX,
    y: currentY - photoRowHeight,
    width: col0Width,
    height: photoRowHeight,
    color: BG_LIGHT,
    borderColor: BORDER_COLOR,
    borderWidth: 0.5,
  });
  currentPage.drawText('참고 상품 사진', {
    x: marginX + (col0Width - fontBold.widthOfTextAtSize('참고 상품 사진', 9)) / 2,
    y: currentY - photoRowHeight / 2 - 3,
    size: 9,
    font: fontBold,
    color: INK_DARK,
  });

  model.candidateRows.forEach((r, i) => {
    const colX = marginX + col0Width + i * colWidth;
    currentPage.drawRectangle({
      x: colX,
      y: currentY - photoRowHeight,
      width: colWidth,
      height: photoRowHeight,
      color: WHITE,
      borderColor: BORDER_COLOR,
      borderWidth: 0.5,
    });

    const img = candidateImages[i];
    if (img) {
      const maxImgW = colWidth - 10;
      const maxImgH = photoRowHeight - 10;
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
      const fallbackText = '[사진 없음]';
      const fbW = fontRegular.widthOfTextAtSize(fallbackText, 9);
      currentPage.drawText(fallbackText, {
        x: colX + (colWidth - fbW) / 2,
        y: currentY - photoRowHeight / 2 - 3,
        size: 9,
        font: fontRegular,
        color: INK_MUTED,
      });
    }
  });
  currentY -= photoRowHeight;

  // 3-3. 텍스트 비교 행들 (본문 11~11.5pt)
  const compItems: [string, (r: CandidateCalculatedRow) => string, boolean?][] = [
    ['상품명', (r) => (r.isSelected ? `▶ ${r.candidate.productName}` : r.candidate.productName), true],
    ['단가 / 수량', (r) => `${won(r.unitPrice)} / ${r.quantity.toLocaleString('ko-KR')}개`],
    ['상품 합계', (r) => won(r.itemTotal), true],
    ['핵심 특징', (r) => `${r.tier} (${r.candidate.model === 'v2' ? '추천 점수' : '격식지수'} ${r.matchScore}점)\n${r.reason}`],
  ];

  for (const [label, getter, isItemBold] of compItems) {
    const allColLines = model.candidateRows.map((r) =>
      wrapText(getter(r), colWidth - compPaddingX * 2, (isItemBold && r.isSelected) ? fontBold : fontRegular, compFontSize),
    );
    const maxLines = Math.max(1, ...allColLines.map((lines) => lines.length));
    const rowHeight = Math.max(18, maxLines * compLineHeight + compPaddingY * 2);

    checkNewPage(rowHeight);

    // 구분 셀
    currentPage.drawRectangle({
      x: marginX,
      y: currentY - rowHeight,
      width: col0Width,
      height: rowHeight,
      color: BG_LIGHT,
      borderColor: BORDER_COLOR,
      borderWidth: 0.5,
    });
    currentPage.drawText(label, {
      x: marginX + (col0Width - fontBold.widthOfTextAtSize(label, compFontSize)) / 2,
      y: currentY - compPaddingY - compFontSize + 1,
      size: compFontSize,
      font: fontBold,
      color: INK_DARK,
    });

    model.candidateRows.forEach((r, i) => {
      const colX = marginX + col0Width + i * colWidth;
      currentPage.drawRectangle({
        x: colX,
        y: currentY - rowHeight,
        width: colWidth,
        height: rowHeight,
        color: WHITE,
        borderColor: BORDER_COLOR,
        borderWidth: 0.5,
      });

      const lines = allColLines[i];
      const startY = currentY - compPaddingY - compFontSize + 1;
      const cellFont = (isItemBold && r.isSelected) ? fontBold : fontRegular;
      lines.forEach((line, lineIdx) => {
        currentPage.drawText(line, {
          x: colX + compPaddingX,
          y: startY - lineIdx * compLineHeight,
          size: compFontSize,
          font: cellFont,
          color: INK_DARK,
        });
      });
    });

    currentY -= rowHeight;
  }

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
      drawKeyValueTable(scheduleRows, 95);
    }
  }

  // 하단 메타 정보
  checkNewPage(24);
  currentY -= 12;
  const metaText = `작성일: ${model.createdDateText}  |  자료 기준일: ${model.catalogDateText}`;
  currentPage.drawText(metaText, {
    x: marginX,
    y: currentY - 8,
    size: 8.5,
    font: fontRegular,
    color: INK_MUTED,
  });
  currentPage.drawText(`※ ${model.draftNotice}`, {
    x: marginX,
    y: currentY - 18,
    size: 7.5,
    font: fontRegular,
    color: INK_MUTED,
  });

  return doc.save();
}
