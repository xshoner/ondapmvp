import fs from 'node:fs/promises';
import sharp from 'sharp';
import { BlankFileMaker, HWPXWriter } from 'ownhwpx';
import * as fflate from 'fflate';
import type { ApprovalDocumentModel } from './types.ts';
import { getCachedImagePath } from '../data/approval-repository.ts';
import { won } from '../lib/result-query.ts';
import { createStyleRegistry } from './hwpxStyles.ts';

// OWPML 단위: 1pt = 100 hwp unit. A4 가로: 210mm (~59528 hwp unit). 여백 15mm 제외 가용 폭: 51,000 hwp unit (180mm).
const TOTAL_WIDTH = 51000;

function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface CellParagraph {
  text: string;
  charPrId?: string;
  align?: 'LEFT' | 'CENTER' | 'RIGHT';
}

interface TableCellSpec {
  text?: string;
  paragraphs?: CellParagraph[];
  charPrId?: string;
  borderFillId?: string;
  isHeader?: boolean;
  colSpan?: number;
  rowSpan?: number;
  imageRef?: string;
  imageWidth?: number;
  imageHeight?: number;
  imagePixelWidth?: number;
  imagePixelHeight?: number;
  align?: 'LEFT' | 'CENTER' | 'RIGHT';
}

// D5: 글자 시각적 가중치 계산 (한글/CJK = 1.0, 영문/숫자/특수문자 = 0.55)
function getVisualLength(str: string): number {
  let len = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if ((code >= 0xac00 && code <= 0xd7a3) || (code >= 0x4e00 && code <= 0x9fff)) {
      len += 1;
    } else {
      len += 0.55;
    }
  }
  return len;
}

// D5: 셀 높이 계산 함수: (줄 수 × 1600 + 400) 이상으로 계산, 최소 2000
function estimateCellHeight(cell: TableCellSpec, cellWidth: number): number {
  if (cell.imageRef) {
    const imgH = cell.imageHeight ?? 8000;
    return imgH + 1600 + 400; // 사진 + 캡션 1줄(1600) + 상하여백(400) = 10000
  }

  const usableWidth = Math.max(1000, cellWidth - 1020); // 좌우 여백 510*2 제외
  const charsPerLine = Math.max(1, Math.floor(usableWidth / 950)); // 10pt 기준 줄당 한글 글자 수

  let totalLines = 0;
  if (cell.paragraphs && cell.paragraphs.length > 0) {
    for (const p of cell.paragraphs) {
      const lines = (p.text || '').split('\n');
      for (const line of lines) {
        totalLines += Math.max(1, Math.ceil(getVisualLength(line) / charsPerLine));
      }
    }
  } else {
    const lines = (cell.text || '').split('\n');
    for (const line of lines) {
      totalLines += Math.max(1, Math.ceil(getVisualLength(line) / charsPerLine));
    }
  }

  totalLines = Math.max(1, totalLines);
  return totalLines * 1600 + 400;
}

export async function generateApprovalHwpx(model: ApprovalDocumentModel): Promise<Uint8Array> {
  const {
    eventName,
    eventDateText,
    authorText,
    eventCategoryName,
    relationCategoryName,
    purposeText,
    selectedCandidate,
    selectedPlanLabel,
    quantity,
    unitPrice,
    itemTotal,
    extraCostNote,
    budgetStatus,
    selectedReason,
    additionalNote,
    hasInternalLimit,
    perPersonLimitCheckText,
    hasScheduleOrNote,
    deliveryScheduleText,
    approverTitles,
    candidateRows,
    hasShortage,
    shortageReason,
    createdDateText,
    catalogDateText,
    documentId,
    revision,
    draftNotice,
  } = model;

  const images = new Map<number, { bytes: Uint8Array; width: number; height: number }>();
  for (const { candidate } of candidateRows) {
    if (!candidate.localImageFilename) continue;
    try {
      const bytes = await fs.readFile(getCachedImagePath(candidate.localImageFilename));
      const metadata = await sharp(bytes).metadata();
      if (metadata.format === 'png' && metadata.width && metadata.height) {
        images.set(candidate.productNo, { bytes, width: metadata.width, height: metadata.height });
      }
    } catch {
      /* 사진을 읽지 못하면 대체 문구를 사용한다. */
    }
  }

  const doc = BlankFileMaker.make();
  const reg = createStyleRegistry();
  let nextId = 1000000000;

  // 문단 XML 생성 헬퍼
  function buildParaXml(
    text: string,
    charPrId: string = reg.roles.VALUE.charPrId,
    align = 'LEFT',
    paraPrIdOverride?: string,
  ): string {
    const pId = nextId++;
    const safeText = escapeXml(text);
    const paraPrId =
      paraPrIdOverride ??
      (align === 'CENTER'
        ? reg.paras.CENTER
        : align === 'RIGHT'
          ? reg.paras.RIGHT
          : reg.paras.LEFT);
    return `
<hp:p id="${pId}" paraPrIDRef="${paraPrId}" styleIDRef="${reg.styles.NORMAL}" pageBreak="0" columnBreak="0" merged="0">
  <hp:run charPrIDRef="${charPrId}">
    <hp:t>${safeText}</hp:t>
  </hp:run>
</hp:p>`;
  }

  // 섹션 제목 헬퍼 (12pt 굵게, 위쪽 12pt, 아래쪽 5pt 간격)
  function buildSectionHeadingXml(title: string): string {
    return buildParaXml(
      title,
      reg.roles.HEADING.charPrId,
      'LEFT',
      reg.roles.HEADING.paraPrId,
    );
  }

  // OWPML 규격 완전 일치 표준 표 빌더 (D5 행 높이 자동 계산, D6 hasMargin=1 적용)
  function buildTableXml(opts: {
    colWidths: number[];
    rowHeights?: number[];
    rows: TableCellSpec[][];
    totalWidth?: number;
    align?: 'LEFT' | 'RIGHT' | 'CENTER';
  }): string {
    const tblId = nextId++;
    const pId = nextId++;
    const rowCnt = opts.rows.length;
    const colCnt = opts.colWidths.length;
    const tWidth = opts.totalWidth ?? opts.colWidths.reduce((a, b) => a + b, 0);

    // D5: 각 행의 모든 셀 높이를 계산하여 같은 행은 동일한 높이를 부여 (명시된 rowHeights 우선)
    const computedRowHeights: number[] = opts.rows.map((row, rowIdx) => {
      const explicitH = opts.rowHeights?.[rowIdx];
      let maxH = explicitH ?? 2000;
      let colCursor = 0;
      row.forEach((cell) => {
        const cSpan = cell.colSpan ?? 1;
        let w = 0;
        for (let c = 0; c < cSpan; c++) {
          w += opts.colWidths[colCursor + c] ?? 10000;
        }
        colCursor += cSpan;
        if ((cell.rowSpan ?? 1) === 1) {
          const est = estimateCellHeight(cell, w);
          if (est > maxH && !explicitH) maxH = est;
        }
      });
      return explicitH !== undefined ? explicitH : Math.max(2000, maxH);
    });

    const totalTableHeight = computedRowHeights.reduce((sum, h) => sum + h, 0);
    const trXmlList: string[] = [];
    const occupiedUntil = Array(colCnt).fill(0) as number[];

    opts.rows.forEach((row, rowIdx) => {
      const tcXmlList: string[] = [];
      let currentCol = 0;

      row.forEach((cell) => {
        while (occupiedUntil[currentCol] > rowIdx) currentCol++;
        const cSpan = cell.colSpan ?? 1;
        const rSpan = cell.rowSpan ?? 1;
        for (let c = 0; c < cSpan; c++) occupiedUntil[currentCol + c] = rowIdx + rSpan;

        const bfId = cell.borderFillId ?? (cell.isHeader ? reg.borders.LABEL : reg.borders.CELL);
        const charPr = cell.charPrId ?? (cell.isHeader ? reg.roles.LABEL.charPrId : reg.roles.VALUE.charPrId);

        let cellWidth = 0;
        for (let c = 0; c < cSpan; c++) {
          cellWidth += opts.colWidths[currentCol + c] ?? 10000;
        }

        let subParas = '';
        if (cell.imageRef) {
          const imgW = cell.imageWidth ?? 8500;
          const imgH = cell.imageHeight ?? 8000;
          const sourceW = (cell.imagePixelWidth ?? 1) * 75;
          const sourceH = (cell.imagePixelHeight ?? 1) * 75;
          const cellPId = nextId++;
          const capPId = nextId++;
          subParas = `
<hp:p id="${cellPId}" paraPrIDRef="${reg.paras.CENTER}" styleIDRef="${reg.styles.NORMAL}" pageBreak="0" columnBreak="0" merged="0">
  <hp:run charPrIDRef="${charPr}">
    <hp:pic id="${nextId++}" zOrder="0" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${nextId++}" reverse="0">
      <hp:sz width="${imgW}" widthRelTo="ABSOLUTE" height="${imgH}" heightRelTo="ABSOLUTE" protect="0"/>
      <hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="CENTER" vertOffset="0" horzOffset="0"/>
      <hp:outMargin left="0" right="0" top="0" bottom="0"/>
      <hp:offset x="0" y="0"/><hp:orgSz width="${imgW}" height="${imgH}"/><hp:curSz width="${imgW}" height="${imgH}"/>
      <hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="${Math.round(imgW / 2)}" centerY="${Math.round(imgH / 2)}" rotateimage="1"/>
      <hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>
      <hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${imgW}" y="0"/><hc:pt2 x="${imgW}" y="${imgH}"/><hc:pt3 x="0" y="${imgH}"/></hp:imgRect>
      <hp:imgClip left="0" right="${sourceW}" top="0" bottom="${sourceH}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="${sourceW}" dimheight="${sourceH}"/>
      <hc:img binaryItemIDRef="${cell.imageRef}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>
    </hp:pic>
  </hp:run>
</hp:p>
<hp:p id="${capPId}" paraPrIDRef="${reg.paras.CENTER}" styleIDRef="${reg.styles.NORMAL}" pageBreak="0" columnBreak="0" merged="0">
  <hp:run charPrIDRef="${reg.roles.NOTE.charPrId}">
    <hp:t>참고 상품 사진</hp:t>
  </hp:run>
</hp:p>`;
        } else if (cell.paragraphs && cell.paragraphs.length > 0) {
          for (const p of cell.paragraphs) {
            const pParaPr = p.align === 'CENTER' ? reg.paras.CENTER : p.align === 'RIGHT' ? reg.paras.RIGHT : (cell.align === 'CENTER' ? reg.paras.CENTER : reg.paras.LEFT);
            const pCharPr = p.charPrId ?? charPr;
            const safeText = escapeXml(p.text);
            subParas += `
<hp:p id="${nextId++}" paraPrIDRef="${pParaPr}" styleIDRef="${reg.styles.NORMAL}" pageBreak="0" columnBreak="0" merged="0">
  <hp:run charPrIDRef="${pCharPr}">
    <hp:t>${safeText}</hp:t>
  </hp:run>
</hp:p>`;
          }
        } else {
          const rawText = cell.text ?? '';
          const lines = rawText.split('\n');
          const cellParaPr = cell.align === 'CENTER' ? reg.paras.CENTER : cell.align === 'RIGHT' ? reg.paras.RIGHT : reg.paras.LEFT;
          lines.forEach((line) => {
            const cellPId = nextId++;
            const safeLine = escapeXml(line);
            subParas += `
<hp:p id="${cellPId}" paraPrIDRef="${cellParaPr}" styleIDRef="${reg.styles.NORMAL}" pageBreak="0" columnBreak="0" merged="0">
  <hp:run charPrIDRef="${charPr}">
    <hp:t>${safeLine}</hp:t>
  </hp:run>
</hp:p>`;
          });
        }

        // D5: spanHeight = rSpan 개 행의 computedRowHeights 합산 (최소 2000 이상 보장)
        const spanHeight = Array.from({ length: rSpan }, (_, i) => computedRowHeights[rowIdx + i]).reduce((a, b) => a + b, 0);

        // D6: hasMargin="1", 직책 헤더(담당, 팀장, 과장)는 텍스트 높이에 맞게 여백을 100으로 줄여 20% 축소 반영
        const isApproverHeader = cell.isHeader && (cell.rowSpan ?? 1) === 1 && opts.align === 'RIGHT';
        const cellMarginTop = isApproverHeader ? 100 : 200;
        const cellMarginBottom = isApproverHeader ? 100 : 200;

        const tcXml = `
<hp:tc name="" header="${cell.isHeader ? 1 : 0}" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${bfId}">
  <hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">
    ${subParas}
  </hp:subList>
  <hp:cellAddr colAddr="${currentCol}" rowAddr="${rowIdx}"/>
  <hp:cellSpan colSpan="${cSpan}" rowSpan="${rSpan}"/>
  <hp:cellSz width="${cellWidth}" height="${spanHeight}"/>
  <hp:cellMargin left="510" right="510" top="${cellMarginTop}" bottom="${cellMarginBottom}"/>
</hp:tc>`;
        tcXmlList.push(tcXml);
        currentCol += cSpan;
      });

      trXmlList.push(`<hp:tr>${tcXmlList.join('')}</hp:tr>`);
    });

    const horzAlign = opts.align === 'RIGHT' ? 'RIGHT' : opts.align === 'CENTER' ? 'CENTER' : 'LEFT';
    const horzRelTo = 'PARA';

    // D5: 표 전체 hp:sz height = 모든 행 높이의 합산
    return `
<hp:p id="${pId}" paraPrIDRef="${opts.align === 'RIGHT' ? reg.paras.RIGHT : opts.align === 'CENTER' ? reg.paras.CENTER : reg.paras.LEFT}" styleIDRef="${reg.styles.NORMAL}" pageBreak="0" columnBreak="0" merged="0">
  <hp:run charPrIDRef="${reg.roles.VALUE.charPrId}">
    <hp:tbl id="${tblId}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropCapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${rowCnt}" colCnt="${colCnt}" cellSpacing="0" borderFillIDRef="${reg.borders.CELL}">
      <hp:sz width="${tWidth}" height="${totalTableHeight}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE" protect="0"/>
      <hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="${horzRelTo}" vertAlign="TOP" horzAlign="${horzAlign}" vertOffset="0" horzOffset="0"/>
      <hp:outMargin left="0" right="0" top="0" bottom="0"/>
      <hp:inMargin left="510" right="510" top="200" bottom="200"/>
      ${trXmlList.join('')}
    </hp:tbl>
  </hp:run>
</hp:p>`;
  }

  // 본문 XML 조립
  const bodyXmlParts: string[] = [];

  // 1. 상단 결재란 (직책이 있을 때 우측 상단 배치)
  const hasApprovers = approverTitles && approverTitles.length > 0;
  if (hasApprovers) {
    const stampLabelW = 3000;
    const appColW = 6000;
    const stampTotalW = stampLabelW + appColW * approverTitles.length;
    const colWidths = [stampLabelW, ...approverTitles.map(() => appColW)];

    const headerRow: TableCellSpec[] = [
      { text: '결\n재', charPrId: reg.roles.LABEL.charPrId, borderFillId: reg.borders.LABEL, isHeader: true, align: 'CENTER', rowSpan: 2 },
      ...approverTitles.map((t) => ({ text: t, charPrId: reg.roles.LABEL.charPrId, borderFillId: reg.borders.LABEL, isHeader: true, align: 'CENTER' as const })),
    ];
    const sigRow: TableCellSpec[] = approverTitles.map(() => ({
      text: ' ',
      charPrId: reg.roles.VALUE.charPrId,
      borderFillId: reg.borders.CELL,
      align: 'CENTER' as const,
    }));

    bodyXmlParts.push(
      buildTableXml({
        colWidths,
        rowHeights: [1600, 3300], // 직책 헤더 20% 축소(2000->1600, 텍스트 높이 맞춤 여백), 하단 서명란 10% 확대 유지(3300)
        rows: [headerRow, sigRow],
        totalWidth: stampTotalW,
        align: 'RIGHT',
      }),
    );
  }

  // 문서 제목 (16pt 굵게, 중앙 정렬, 상하 여백)
  bodyXmlParts.push(buildParaXml('답례품 선정 검토서', reg.roles.TITLE.charPrId, 'CENTER', reg.roles.TITLE.paraPrId));

  // 1. 기안 정보 (18% / 32% / 18% / 32% 비율, 라벨 중앙 정렬, 내용 좌측 정렬)
  bodyXmlParts.push(buildSectionHeadingXml('1. 기안 정보'));
  const infoRows: TableCellSpec[][] = [
    [
      { text: '행 사 명', isHeader: true, align: 'CENTER' },
      { text: eventName, charPrId: reg.roles.VALUE_BOLD.charPrId, align: 'LEFT' },
      { text: '행 사 일', isHeader: true, align: 'CENTER' },
      { text: eventDateText, charPrId: reg.roles.VALUE.charPrId, align: 'LEFT' },
    ],
    [
      { text: '기 안 자', isHeader: true, align: 'CENTER' },
      { text: authorText, charPrId: reg.roles.VALUE.charPrId, align: 'LEFT' },
      { text: '작 성 일', isHeader: true, align: 'CENTER' },
      { text: createdDateText, charPrId: reg.roles.VALUE.charPrId, align: 'LEFT' },
    ],
    [
      { text: '대상·수량', isHeader: true, align: 'CENTER' },
      {
        paragraphs: [
          {
            text: `${relationCategoryName} (${eventCategoryName} 기준) / ${quantity.toLocaleString('ko-KR')}개`,
            charPrId: reg.roles.VALUE_BOLD.charPrId,
            align: 'LEFT',
          },
        ],
        colSpan: 3,
        align: 'LEFT',
      },
    ],
  ];

  if (purposeText) {
    infoRows.push([
      { text: '추진 목적', isHeader: true, align: 'CENTER' },
      { text: purposeText, charPrId: reg.roles.VALUE.charPrId, colSpan: 3, align: 'LEFT' },
    ]);
  }

  bodyXmlParts.push(
    buildTableXml({
      colWidths: [9180, 16320, 9180, 16320],
      rows: infoRows,
      totalWidth: TOTAL_WIDTH,
    }),
  );

  // 2. 선정 개요 (20% / 80% 비율, 라벨 중앙 정렬)
  bodyXmlParts.push(buildSectionHeadingXml('2. 선정 개요'));
  const summaryRows: TableCellSpec[][] = [
    [
      { text: '최종 선정안', isHeader: true, align: 'CENTER' },
      {
        paragraphs: [
          {
            text: `${selectedPlanLabel} [선택] ${selectedCandidate.productName}`,
            charPrId: reg.roles.VALUE_BOLD.charPrId,
            align: 'LEFT',
          },
        ],
        align: 'LEFT',
      },
    ],
    [
      { text: '선정 사유', isHeader: true, align: 'CENTER' },
      { text: selectedReason, charPrId: reg.roles.VALUE.charPrId, align: 'LEFT' },
    ],
    [
      { text: '소요 금액', isHeader: true, align: 'CENTER' },
      {
        paragraphs: [
          {
            text: `단가 ${won(unitPrice)} × ${quantity.toLocaleString('ko-KR')}개 = 상품 합계 ${won(itemTotal)}`,
            charPrId: reg.roles.VALUE_BOLD.charPrId,
            align: 'LEFT',
          },
          {
            text: `※ ${extraCostNote}`,
            charPrId: reg.roles.NOTE.charPrId,
            align: 'LEFT',
          },
        ],
        align: 'LEFT',
      },
    ],
    [
      { text: '예산 비교', isHeader: true, align: 'CENTER' },
      { text: budgetStatus, charPrId: reg.roles.VALUE.charPrId, align: 'LEFT' },
    ],
  ];

  if (hasInternalLimit && perPersonLimitCheckText) {
    summaryRows.push([
      { text: '내부 가액 기준', isHeader: true, align: 'CENTER' },
      { text: perPersonLimitCheckText, charPrId: reg.roles.VALUE.charPrId, align: 'LEFT' },
    ]);
  }

  bodyXmlParts.push(
    buildTableXml({
      colWidths: [10200, 40800],
      rows: summaryRows,
      totalWidth: TOTAL_WIDTH,
    }),
  );

  // 3. 추천 상품 비교 (대안 검토)
  bodyXmlParts.push(buildSectionHeadingXml('3. 추천 상품 비교 (대안 검토)'));
  if (hasShortage && shortageReason) {
    bodyXmlParts.push(buildParaXml(`※ 안내: ${shortageReason}`, reg.roles.NOTE.charPrId, 'LEFT'));
  }

  const cCount = candidateRows.length;
  const col0W = 9180;
  const cWidth = Math.floor((TOTAL_WIDTH - col0W) / Math.max(1, cCount));
  const compColWidths = [col0W, ...candidateRows.map((_, i) => (i === cCount - 1 ? TOTAL_WIDTH - col0W - cWidth * (cCount - 1) : cWidth))];

  const compHeaderRow: TableCellSpec[] = [
    { text: '구분', isHeader: true, align: 'CENTER' },
    ...candidateRows.map((r) => ({
      text: `${r.planLabel} ${r.isSelected ? '[선택]' : ''}`,
      charPrId: reg.roles.LABEL.charPrId,
      isHeader: true,
      align: 'CENTER' as const,
    })),
  ];

  const compPhotoRow: TableCellSpec[] = [
    { text: '참고 상품 사진', isHeader: true, align: 'CENTER' },
    ...candidateRows.map((r) => {
      const image = images.get(r.candidate.productNo);
      if (image) {
        const scale = Math.min(8500 / image.width, 8000 / image.height);
        return {
          imageRef: `img_${r.candidate.productNo}`,
          imageWidth: Math.round(image.width * scale),
          imageHeight: Math.round(image.height * scale),
          imagePixelWidth: image.width,
          imagePixelHeight: image.height,
          borderFillId: reg.borders.CELL,
          align: 'CENTER' as const,
        };
      }
      return {
        text: '[사진 없음]',
        charPrId: reg.roles.NOTE.charPrId,
        borderFillId: reg.borders.CELL,
        align: 'CENTER' as const,
      };
    }),
  ];

  const compNameRow: TableCellSpec[] = [
    { text: '상품명', isHeader: true, align: 'CENTER' },
    ...candidateRows.map((r) => ({
      text: `${r.isSelected ? '▶ ' : ''}${r.candidate.productName}`,
      charPrId: r.isSelected ? reg.roles.VALUE_BOLD.charPrId : reg.roles.VALUE.charPrId,
      borderFillId: reg.borders.CELL,
      align: 'LEFT' as const,
    })),
  ];

  const compPriceRow: TableCellSpec[] = [
    { text: '단가 / 수량', isHeader: true, align: 'CENTER' },
    ...candidateRows.map((r) => ({
      text: `${won(r.unitPrice)} / ${r.quantity.toLocaleString('ko-KR')}개`,
      charPrId: reg.roles.VALUE.charPrId,
      borderFillId: reg.borders.CELL,
      align: 'LEFT' as const,
    })),
  ];

  const compTotalRow: TableCellSpec[] = [
    { text: '상품 합계', isHeader: true, align: 'CENTER' },
    ...candidateRows.map((r) => ({
      text: won(r.itemTotal),
      charPrId: r.isSelected ? reg.roles.VALUE_BOLD.charPrId : reg.roles.VALUE.charPrId,
      borderFillId: reg.borders.CELL,
      align: 'LEFT' as const,
    })),
  ];

  const compFeaturesRow: TableCellSpec[] = [
    { text: '핵심 특징', isHeader: true, align: 'CENTER' },
    ...candidateRows.map((r) => ({
      paragraphs: [
        { text: `${r.tier} (${r.candidate.model === 'v2' ? '상품 희소값' : '격식지수'} ${r.matchScore}점)`, charPrId: reg.roles.VALUE_BOLD.charPrId, align: 'LEFT' as const },
        { text: r.reason, charPrId: reg.roles.VALUE.charPrId, align: 'LEFT' as const },
      ],
      borderFillId: reg.borders.CELL,
      align: 'LEFT' as const,
    })),
  ];

  const compareRows = [compHeaderRow, compPhotoRow, compNameRow, compPriceRow, compTotalRow, compFeaturesRow];
  bodyXmlParts.push(
    buildTableXml({
      colWidths: compColWidths,
      rows: compareRows,
      totalWidth: TOTAL_WIDTH,
    }),
  );

  // 4. 추진 일정 및 비고 (사용자가 행사일 또는 메모를 입력한 경우에만 표시)
  if (hasScheduleOrNote) {
    bodyXmlParts.push(buildSectionHeadingXml('4. 추진 일정 및 비고'));
    const scheduleRows: TableCellSpec[][] = [];
    if (deliveryScheduleText) {
      scheduleRows.push([
        { text: '추진 일정', isHeader: true, align: 'CENTER' },
        { text: deliveryScheduleText, charPrId: reg.roles.VALUE.charPrId, align: 'LEFT' },
      ]);
    }
    if (additionalNote && additionalNote.trim()) {
      scheduleRows.push([
        { text: '비 고', isHeader: true, align: 'CENTER' },
        { text: additionalNote.trim(), charPrId: reg.roles.VALUE.charPrId, align: 'LEFT' },
      ]);
    }
    if (scheduleRows.length > 0) {
      bodyXmlParts.push(
        buildTableXml({
          colWidths: [10200, 40800],
          rows: scheduleRows,
          totalWidth: TOTAL_WIDTH,
        }),
      );
    }
  }

  // 하단 메타 정보 (작성일 | 자료 기준일, 9pt 회색)
  bodyXmlParts.push(
    buildParaXml(
      `작성일: ${createdDateText}  |  자료 기준일: ${catalogDateText}`,
      reg.roles.META.charPrId,
      'LEFT',
      reg.roles.META.paraPrId,
    ),
  );
  bodyXmlParts.push(buildParaXml(`※ ${draftNotice}`, reg.roles.META.charPrId, 'LEFT'));

  // HWPX 기본 바이트 생성
  const baseBytes = HWPXWriter.toBytes(doc);
  const unzipped = fflate.unzipSync(baseBytes);

  // header.xml 스타일 레지스트리 기반 완전 직렬화 (D1, D2, D4)
  let headerXml = new TextDecoder().decode(unzipped['Contents/header.xml']);
  headerXml = headerXml.replaceAll('face="함초롬돋움"', 'face="맑은 고딕"');

  const { borderFillsXml, charPropertiesXml, paraPropertiesXml, stylesXml } = reg.serializeHeaderParts();
  headerXml = headerXml.replace(/<hh:borderFills[\s\S]*?<\/hh:borderFills>/, borderFillsXml);
  headerXml = headerXml.replace(/<hh:charProperties[\s\S]*?<\/hh:charProperties>/, charPropertiesXml);
  headerXml = headerXml.replace(/<hh:paraProperties[\s\S]*?<\/hh:paraProperties>/, paraPropertiesXml);
  headerXml = headerXml.replace(/<hh:styles[\s\S]*?<\/hh:styles>/, stylesXml);
  unzipped['Contents/header.xml'] = new TextEncoder().encode(headerXml);

  // section0.xml 본문 조립 및 용지/여백/테두리 정비 (D2, D3, 2-5)
  let secXml = new TextDecoder('utf-8').decode(unzipped['Contents/section0.xml']);

  // D3: pagePr에 width="59528" height="84186" (A4 세로) 명시
  secXml = secXml.replace(
    /<hp:pagePr[^>]*>/,
    '<hp:pagePr landscape="WIDELY" width="59528" height="84186" gutterType="LEFT_ONLY">',
  );

  // 좌우 여백 15mm (4252 hwp unit) 통일
  secXml = secXml.replace(
    /<hp:margin [^>]*?\/>/,
    '<hp:margin header="0" footer="0" gutter="0" left="4252" right="4252" top="4252" bottom="4252"/>',
  );

  // D2: pageBorderFill 3개 모두 1번(NONE)을 가리키게 설정
  secXml = secXml.replace(
    /<hp:pageBorderFill ([^>]*?)borderFillIDRef="\d+"([^>]*?)\/>/g,
    `<hp:pageBorderFill $1borderFillIDRef="${reg.borders.PAGE}"$2/>`,
  );

  // 2-5: 최종 파일에 hp:linesegarray는 남기지 않음 (기존 템플릿 포함 전면 제거)
  secXml = secXml.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '');

  const closeSecIdx = secXml.lastIndexOf('</hs:sec>');
  secXml = `${secXml.slice(0, closeSecIdx)}${bodyXmlParts.join('')}${secXml.slice(closeSecIdx)}`;
  unzipped['Contents/section0.xml'] = new TextEncoder().encode(secXml);

  // BinData 이미지 임베딩 및 content.hpf 매니페스트 동기화
  const newManifestItems: string[] = [];
  for (const [productNo, image] of images) {
    const binPath = `BinData/image_${productNo}.png`;
    unzipped[binPath] = Uint8Array.from(image.bytes);
    newManifestItems.push(`<opf:item id="img_${productNo}" href="${binPath}" media-type="image/png" isEmbeded="1"/>`);
  }

  if (newManifestItems.length > 0 && unzipped['Contents/content.hpf']) {
    let hpfXml = new TextDecoder('utf-8').decode(unzipped['Contents/content.hpf']);
    const insertIdx = hpfXml.indexOf('</opf:manifest>');
    if (insertIdx !== -1) {
      hpfXml = `${hpfXml.slice(0, insertIdx)}${newManifestItems.join('')}${hpfXml.slice(insertIdx)}`;
      unzipped['Contents/content.hpf'] = new TextEncoder().encode(hpfXml);
    }
  }

  // fflate 재패키징 (mimetype은 무압축 보장)
  const zipFiles: fflate.Zippable = {};
  const mimetypeBytes = unzipped['mimetype'] || new TextEncoder().encode('application/hwp+zip');
  zipFiles['mimetype'] = [mimetypeBytes, { level: 0 as const }];

  for (const [filename, fileBytes] of Object.entries(unzipped)) {
    if (filename === 'mimetype') continue;
    zipFiles[filename] = [fileBytes, { level: 6 as const }];
  }

  return fflate.zipSync(zipFiles);
}
