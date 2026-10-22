// 인쇄용 판걸이: 스티커를 A4·A3 용지에 반복 배치하는 계산. 단위는 mm.
// 칸 하나 = 스티커 + 사방 재단 여백(BLEED_CM). 칸끼리는 붙여 놓고, 자르는 선은 칸 안쪽 스티커 테두리.

import { BLEED_CM } from './rules.ts';
import type { StickerSpec } from './types.ts';

export type Paper = 'A4' | 'A3';
export const PAPERS: Record<Paper, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
};
const SHEET_MARGIN_MM = 6; // 용지 가장자리 여백 (프린터가 못 찍는 부분 + 안내 문구)
export const MAX_SHEETS = 200; // 한 번에 만드는 최대 장 수. 넘으면 잘라 내지 않고 거절한다 (이미지는 한 번만 들어가 200장도 1MB 안팎)

interface SheetLayout {
  paper: Paper;
  cellMm: number;
  cols: number;
  rows: number;
  perSheet: number;
  originX: number; // 첫 칸 왼쪽 위 (mm, 용지 왼쪽 위 기준)
  originY: number;
}

export function isPaper(v: unknown): v is Paper {
  return v === 'A4' || v === 'A3';
}

export function sheetLayout(sticker: StickerSpec, paper: Paper): SheetLayout {
  const { width, height } = PAPERS[paper];
  const cellMm = sticker.sizeCm * 10 + BLEED_CM * 10 * 2;
  const cols = Math.floor((width - SHEET_MARGIN_MM * 2) / cellMm);
  const rows = Math.floor((height - SHEET_MARGIN_MM * 2) / cellMm);
  // 남는 공간은 양쪽에 나눠 가운데 정렬
  return {
    paper,
    cellMm,
    cols,
    rows,
    perSheet: cols * rows,
    originX: (width - cols * cellMm) / 2,
    originY: (height - rows * cellMm) / 2,
  };
}

export function sheetsNeeded(layout: SheetLayout, count: number): number {
  return Math.ceil(Math.max(1, Math.floor(count)) / layout.perSheet);
}

// 필요한 장 수와 장별 개수. fill이면 마지막 장의 남는 칸도 채운다(여분). MAX_SHEETS를 넘으면 오류
export function sheetPlan(layout: SheetLayout, count: number, fill: boolean): number[] {
  const n = Math.max(1, Math.floor(count));
  const sheets = sheetsNeeded(layout, n);
  if (sheets > MAX_SHEETS) throw new Error(`한 번에 ${MAX_SHEETS}장까지 만들 수 있습니다 (필요 ${sheets}장). 개수를 나눠 받으세요.`);
  return Array.from({ length: sheets }, (_, i) =>
    fill || i < sheets - 1 ? layout.perSheet : n - layout.perSheet * (sheets - 1),
  );
}
