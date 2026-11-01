import fs from 'node:fs/promises';
import {
  Document,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  ImageRun,
  WidthType,
  AlignmentType,
  BorderStyle,
  Packer,
  convertMillimetersToTwip,
  ShadingType,
  HeightRule,
} from 'docx';
import type { ApprovalDocumentModel } from './types.ts';
import { getCachedImagePath } from '../data/approval-repository.ts';
import { won } from '../lib/result-query.ts';

const INK_DARK = '111827';
const INK_MUTED = '4B5563';
const BG_LIGHT = 'F2F2F2';
const BORDER_COLOR = '000000';

const cellBorder = {
  top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
  left: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
  right: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
};

export async function generateApprovalDocx(model: ApprovalDocumentModel): Promise<Uint8Array> {
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

  // 1. 우측 상단 결재란 표 생성 (결재 헤더 + 담당 / 팀장 / 과장)
  const hasApprovers = approverTitles && approverTitles.length > 0;
  let approverTable: Table | null = null;

  if (hasApprovers) {
    const headerRowCells = [
      new TableCell({
        rowSpan: 2,
        shading: { fill: BG_LIGHT, type: ShadingType.CLEAR },
        borders: cellBorder,
        width: { size: 600, type: WidthType.DXA },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: '결\n재', bold: true, size: 22, color: INK_DARK })],
          }),
        ],
      }),
      ...approverTitles.map(
        (title) =>
          new TableCell({
            shading: { fill: BG_LIGHT, type: ShadingType.CLEAR },
            borders: cellBorder,
            width: { size: 1200, type: WidthType.DXA },
            margins: { top: 40, bottom: 40, left: 60, right: 60 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 20, after: 20 },
                children: [new TextRun({ text: title, bold: true, size: 22, color: INK_DARK })],
              }),
            ],
          }),
      ),
    ];

    const sigRowCells = approverTitles.map(
      () =>
        new TableCell({
          borders: cellBorder,
          width: { size: 1200, type: WidthType.DXA },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 265, after: 265 },
              children: [new TextRun({ text: ' ', size: 22 })],
            }),
          ],
        }),
    );

    approverTable = new Table({
      alignment: AlignmentType.RIGHT,
      rows: [
        new TableRow({ height: { value: 280, rule: HeightRule.ATLEAST }, children: headerRowCells }),
        new TableRow({ height: { value: 720, rule: HeightRule.ATLEAST }, children: sigRowCells }),
      ],
    });
  }

  // 상단 헤더 블록 (결재란 있을 경우 우측 정렬 표 배치)
  const topHeaderBlock = approverTable
    ? [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.NONE },
            bottom: { style: BorderStyle.NONE },
            left: { style: BorderStyle.NONE },
            right: { style: BorderStyle.NONE },
            insideHorizontal: { style: BorderStyle.NONE },
            insideVertical: { style: BorderStyle.NONE },
          },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 40, type: WidthType.PERCENTAGE },
                  children: [new Paragraph({ children: [] })],
                }),
                new TableCell({
                  width: { size: 60, type: WidthType.PERCENTAGE },
                  children: [approverTable],
                }),
              ],
            }),
          ],
        }),
        new Paragraph({ spacing: { before: 120, after: 120 }, children: [] }),
      ]
    : [];

  // 문서 제목 (중앙 정렬, 20pt)
  const titleParagraph = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 180, after: 260 },
    children: [
      new TextRun({
        text: '답례품 선정 검토서',
        bold: true,
        size: 40, // 20pt
        color: INK_DARK,
      }),
    ],
  });

  // 섹션 제목 헬퍼 (14pt, 굵게)
  const makeSectionHeading = (title: string) =>
    new Paragraph({
      spacing: { before: 240, after: 100 },
      children: [
        new TextRun({
          text: title,
          bold: true,
          size: 28, // 14pt
          color: INK_DARK,
        }),
      ],
    });

  // 1. 기안 정보 표 (본문 12pt = size 24)
  const overviewRows = [
    [
      { label: '행 사 명', val: eventName, isBold: true },
      { label: '행 사 일', val: eventDateText, isBold: false },
    ],
    [
      { label: '기 안 자', val: authorText, isBold: false },
      { label: '작 성 일', val: createdDateText, isBold: false },
    ],
  ].map((pair) =>
    new TableRow({
      children: [
        new TableCell({
          width: { size: 18, type: WidthType.PERCENTAGE },
          shading: { fill: BG_LIGHT, type: ShadingType.CLEAR },
          borders: cellBorder,
          children: [new Paragraph({ children: [new TextRun({ text: pair[0].label, bold: true, size: 24 })] })],
        }),
        new TableCell({
          width: { size: 32, type: WidthType.PERCENTAGE },
          borders: cellBorder,
          children: [new Paragraph({ children: [new TextRun({ text: pair[0].val, bold: pair[0].isBold, size: 24 })] })],
        }),
        new TableCell({
          width: { size: 18, type: WidthType.PERCENTAGE },
          shading: { fill: BG_LIGHT, type: ShadingType.CLEAR },
          borders: cellBorder,
          children: [new Paragraph({ children: [new TextRun({ text: pair[1].label, bold: true, size: 24 })] })],
        }),
        new TableCell({
          width: { size: 32, type: WidthType.PERCENTAGE },
          borders: cellBorder,
          children: [new Paragraph({ children: [new TextRun({ text: pair[1].val, bold: pair[1].isBold, size: 24 })] })],
        }),
      ],
    }),
  );

  // 대상·수량 행
  overviewRows.push(
    new TableRow({
      children: [
        new TableCell({
          width: { size: 18, type: WidthType.PERCENTAGE },
          shading: { fill: BG_LIGHT, type: ShadingType.CLEAR },
          borders: cellBorder,
          children: [new Paragraph({ children: [new TextRun({ text: '대상·수량', bold: true, size: 24 })] })],
        }),
        new TableCell({
          width: { size: 82, type: WidthType.PERCENTAGE },
          columnSpan: 3,
          borders: cellBorder,
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: `${relationCategoryName} (${eventCategoryName} 기준) / `,
                  size: 24,
                }),
                new TextRun({
                  text: `${quantity.toLocaleString('ko-KR')}개`,
                  bold: true,
                  size: 24,
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  );

  if (purposeText) {
    overviewRows.push(
      new TableRow({
        children: [
          new TableCell({
            width: { size: 18, type: WidthType.PERCENTAGE },
            shading: { fill: BG_LIGHT, type: ShadingType.CLEAR },
            borders: cellBorder,
            children: [new Paragraph({ children: [new TextRun({ text: '추진 목적', bold: true, size: 24 })] })],
          }),
          new TableCell({
            width: { size: 82, type: WidthType.PERCENTAGE },
            columnSpan: 3,
            borders: cellBorder,
            children: [new Paragraph({ children: [new TextRun({ text: purposeText, size: 24 })] })],
          }),
        ],
      }),
    );
  }

  const overviewTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: overviewRows,
  });

  // 2. 선정 개요 표 (본문 12pt)
  const summaryRows = [
    new TableRow({
      children: [
        new TableCell({
          width: { size: 20, type: WidthType.PERCENTAGE },
          shading: { fill: BG_LIGHT, type: ShadingType.CLEAR },
          borders: cellBorder,
          children: [new Paragraph({ children: [new TextRun({ text: '최종 선정안', bold: true, size: 24 })] })],
        }),
        new TableCell({
          width: { size: 80, type: WidthType.PERCENTAGE },
          borders: cellBorder,
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: `${selectedPlanLabel} [선택] `, bold: true, size: 24 }),
                new TextRun({ text: selectedCandidate.productName, size: 24 }),
              ],
            }),
          ],
        }),
      ],
    }),
    new TableRow({
      children: [
        new TableCell({
          width: { size: 20, type: WidthType.PERCENTAGE },
          shading: { fill: BG_LIGHT, type: ShadingType.CLEAR },
          borders: cellBorder,
          children: [new Paragraph({ children: [new TextRun({ text: '선정 사유', bold: true, size: 24 })] })],
        }),
        new TableCell({
          width: { size: 80, type: WidthType.PERCENTAGE },
          borders: cellBorder,
          children: [new Paragraph({ children: [new TextRun({ text: selectedReason, size: 24 })] })],
        }),
      ],
    }),
    new TableRow({
      children: [
        new TableCell({
          width: { size: 20, type: WidthType.PERCENTAGE },
          shading: { fill: BG_LIGHT, type: ShadingType.CLEAR },
          borders: cellBorder,
          children: [new Paragraph({ children: [new TextRun({ text: '소요 금액', bold: true, size: 24 })] })],
        }),
        new TableCell({
          width: { size: 80, type: WidthType.PERCENTAGE },
          borders: cellBorder,
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: `단가 ${won(unitPrice)} × ${quantity.toLocaleString('ko-KR')}개 = `, size: 24 }),
                new TextRun({ text: `상품 합계 ${won(itemTotal)}`, bold: true, size: 24 }),
              ],
            }),
            new Paragraph({
              children: [new TextRun({ text: `※ ${extraCostNote}`, size: 20, color: INK_MUTED })],
            }),
          ],
        }),
      ],
    }),
    new TableRow({
      children: [
        new TableCell({
          width: { size: 20, type: WidthType.PERCENTAGE },
          shading: { fill: BG_LIGHT, type: ShadingType.CLEAR },
          borders: cellBorder,
          children: [new Paragraph({ children: [new TextRun({ text: '예산 비교', bold: true, size: 24 })] })],
        }),
        new TableCell({
          width: { size: 80, type: WidthType.PERCENTAGE },
          borders: cellBorder,
          children: [new Paragraph({ children: [new TextRun({ text: budgetStatus, bold: true, size: 24 })] })],
        }),
      ],
    }),
  ];

  if (hasInternalLimit && perPersonLimitCheckText) {
    summaryRows.push(
      new TableRow({
        children: [
          new TableCell({
            width: { size: 20, type: WidthType.PERCENTAGE },
            shading: { fill: BG_LIGHT, type: ShadingType.CLEAR },
            borders: cellBorder,
            children: [new Paragraph({ children: [new TextRun({ text: '내부 가액 기준', bold: true, size: 24 })] })],
          }),
          new TableCell({
            width: { size: 80, type: WidthType.PERCENTAGE },
            borders: cellBorder,
            children: [new Paragraph({ children: [new TextRun({ text: perPersonLimitCheckText, size: 24 })] })],
          }),
        ],
      }),
    );
  }

  const summaryTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: summaryRows,
  });

  // 3. 추천 상품 비교표 (사진 포함, 12pt)
  const colCount = candidateRows.length;
  const colPct = Math.floor(82 / Math.max(1, colCount));

  // 각 후보의 사진 로드 시도
  const candidateImages: (Uint8Array | null)[] = [];
  for (const row of candidateRows) {
    if (row.candidate.localImageFilename) {
      try {
        const imgPath = getCachedImagePath(row.candidate.localImageFilename);
        const imgBytes = await fs.readFile(imgPath);
        candidateImages.push(imgBytes);
      } catch {
        candidateImages.push(null);
      }
    } else {
      candidateImages.push(null);
    }
  }

  // 비교표 헤더
  const compHeaderCells = [
    new TableCell({
      width: { size: 18, type: WidthType.PERCENTAGE },
      shading: { fill: BG_LIGHT, type: ShadingType.CLEAR },
      borders: cellBorder,
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '구분', bold: true, size: 24 })] })],
    }),
    ...candidateRows.map(
      (r) =>
        new TableCell({
          width: { size: colPct, type: WidthType.PERCENTAGE },
          shading: { fill: BG_LIGHT, type: ShadingType.CLEAR },
          borders: cellBorder,
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: `${r.planLabel} ${r.isSelected ? '[선택]' : ''}`,
                  bold: true,
                  size: 24,
                  color: INK_DARK,
                }),
              ],
            }),
          ],
        }),
    ),
  ];

  // 사진 행
  const compPhotoCells = [
    new TableCell({
      width: { size: 18, type: WidthType.PERCENTAGE },
      shading: { fill: BG_LIGHT, type: ShadingType.CLEAR },
      borders: cellBorder,
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '참고 상품 사진', bold: true, size: 22 })] })],
    }),
    ...candidateRows.map((r, i) => {
      const imgBytes = candidateImages[i];
      let cellChildren: Paragraph[];
      if (imgBytes) {
        cellChildren = [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                data: imgBytes,
                transformation: { width: 90, height: 90 },
                type: 'png',
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: '참고 상품 사진', size: 16, color: INK_MUTED })],
          }),
        ];
      } else {
        cellChildren = [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: '[사진 없음]', size: 20, color: INK_MUTED })],
          }),
        ];
      }
      return new TableCell({
        width: { size: colPct, type: WidthType.PERCENTAGE },
        borders: cellBorder,
        children: cellChildren,
      });
    }),
  ];

  // 기타 비교 행 정의 (본문 12pt)
  const compareTableRows = [
    new TableRow({ children: compHeaderCells }),
    new TableRow({ children: compPhotoCells }),
    new TableRow({
      children: [
        new TableCell({
          width: { size: 18, type: WidthType.PERCENTAGE },
          shading: { fill: BG_LIGHT, type: ShadingType.CLEAR },
          borders: cellBorder,
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '상품명', bold: true, size: 24 })] })],
        }),
        ...candidateRows.map(
          (r) =>
            new TableCell({
              width: { size: colPct, type: WidthType.PERCENTAGE },
              borders: cellBorder,
              children: [
                new Paragraph({
                  children: [new TextRun({ text: `${r.isSelected ? '▶ ' : ''}${r.candidate.productName}`, bold: r.isSelected, size: 24 })],
                }),
              ],
            }),
        ),
      ],
    }),
    new TableRow({
      children: [
        new TableCell({
          width: { size: 18, type: WidthType.PERCENTAGE },
          shading: { fill: BG_LIGHT, type: ShadingType.CLEAR },
          borders: cellBorder,
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '단가 / 수량', bold: true, size: 24 })] })],
        }),
        ...candidateRows.map(
          (r) =>
            new TableCell({
              width: { size: colPct, type: WidthType.PERCENTAGE },
              borders: cellBorder,
              children: [
                new Paragraph({
                  children: [new TextRun({ text: `${won(r.unitPrice)} / ${r.quantity.toLocaleString('ko-KR')}개`, size: 24 })],
                }),
              ],
            }),
        ),
      ],
    }),
    new TableRow({
      children: [
        new TableCell({
          width: { size: 18, type: WidthType.PERCENTAGE },
          shading: { fill: BG_LIGHT, type: ShadingType.CLEAR },
          borders: cellBorder,
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '상품 합계', bold: true, size: 24 })] })],
        }),
        ...candidateRows.map(
          (r) =>
            new TableCell({
              width: { size: colPct, type: WidthType.PERCENTAGE },
              borders: cellBorder,
              children: [
                new Paragraph({
                  children: [new TextRun({ text: won(r.itemTotal), bold: r.isSelected, size: 24 })],
                }),
              ],
            }),
        ),
      ],
    }),
    new TableRow({
      children: [
        new TableCell({
          width: { size: 18, type: WidthType.PERCENTAGE },
          shading: { fill: BG_LIGHT, type: ShadingType.CLEAR },
          borders: cellBorder,
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '핵심 특징', bold: true, size: 24 })] })],
        }),
        ...candidateRows.map(
          (r) =>
            new TableCell({
              width: { size: colPct, type: WidthType.PERCENTAGE },
              borders: cellBorder,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: `${r.tier} (${r.candidate.model === 'v2' ? '상품 희소값' : '격식지수'} ${r.matchScore}점)`, bold: true, size: 22 }),
                  ],
                }),
                new Paragraph({
                  children: [new TextRun({ text: r.reason, size: 22 })],
                }),
              ],
            }),
        ),
      ],
    }),
  ];

  const compareTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: compareTableRows,
  });

  // 4. 추진 일정 및 비고 표 (사용자가 행사일 또는 메모를 입력한 경우에만 표시)
  let scheduleTable: Table | null = null;
  if (hasScheduleOrNote) {
    const scheduleRows: TableRow[] = [];
    if (deliveryScheduleText) {
      scheduleRows.push(
        new TableRow({
          children: [
            new TableCell({
              width: { size: 20, type: WidthType.PERCENTAGE },
              shading: { fill: BG_LIGHT, type: ShadingType.CLEAR },
              borders: cellBorder,
              children: [new Paragraph({ children: [new TextRun({ text: '추진 일정', bold: true, size: 24 })] })],
            }),
            new TableCell({
              width: { size: 80, type: WidthType.PERCENTAGE },
              borders: cellBorder,
              children: [new Paragraph({ children: [new TextRun({ text: deliveryScheduleText, size: 24 })] })],
            }),
          ],
        }),
      );
    }
    if (additionalNote && additionalNote.trim()) {
      scheduleRows.push(
        new TableRow({
          children: [
            new TableCell({
              width: { size: 20, type: WidthType.PERCENTAGE },
              shading: { fill: BG_LIGHT, type: ShadingType.CLEAR },
              borders: cellBorder,
              children: [new Paragraph({ children: [new TextRun({ text: '비 고', bold: true, size: 24 })] })],
            }),
            new TableCell({
              width: { size: 80, type: WidthType.PERCENTAGE },
              borders: cellBorder,
              children: [new Paragraph({ children: [new TextRun({ text: additionalNote.trim(), size: 24 })] })],
            }),
          ],
        }),
      );
    }
    if (scheduleRows.length > 0) {
      scheduleTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: scheduleRows,
      });
    }
  }

  // 문서 조립 (A4 세로, 15mm 여백)
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertMillimetersToTwip(15),
              bottom: convertMillimetersToTwip(15),
              left: convertMillimetersToTwip(15),
              right: convertMillimetersToTwip(15),
            },
          },
        },
        children: [
          ...topHeaderBlock,
          titleParagraph,
          makeSectionHeading('1. 기안 정보'),
          overviewTable,
          makeSectionHeading('2. 선정 개요'),
          summaryTable,
          makeSectionHeading('3. 추천 상품 비교 (대안 검토)'),
          ...(hasShortage && shortageReason
            ? [
                new Paragraph({
                  children: [new TextRun({ text: `※ 안내: ${shortageReason}`, size: 22, color: INK_DARK })],
                }),
              ]
            : []),
          compareTable,
          ...(scheduleTable
            ? [makeSectionHeading('4. 추진 일정 및 비고'), scheduleTable]
            : []),
          new Paragraph({
            spacing: { before: 240, after: 60 },
            children: [
              new TextRun({
                text: `작성일: ${createdDateText}  |  자료 기준일: ${catalogDateText}`,
                size: 20,
                color: INK_MUTED,
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `※ ${draftNotice}`,
                size: 18,
                color: INK_MUTED,
              }),
            ],
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
