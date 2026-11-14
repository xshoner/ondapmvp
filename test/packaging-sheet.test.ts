import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { MAX_SHEETS, sheetLayout, sheetPlan } from '../src/packaging/sheet.ts';
import { buildPrintPdf } from '../src/packaging/print-pdf.ts';

test('한 장에 들어가는 개수: 6cm는 A4 12·A3 24, 4cm는 A4 24·A3 54', () => {
  const c6 = { shape: 'circle', sizeCm: 6 } as const;
  const s4 = { shape: 'square', sizeCm: 4 } as const;
  assert.equal(sheetLayout(c6, 'A4').perSheet, 12);
  assert.equal(sheetLayout(c6, 'A3').perSheet, 24);
  assert.equal(sheetLayout(s4, 'A4').perSheet, 24);
  assert.equal(sheetLayout(s4, 'A3').perSheet, 54);
  const l = sheetLayout(c6, 'A4');
  assert.equal(l.cellMm, 64); // 60mm + 재단 여백 2mm × 2
  assert.ok(l.originX >= 6 && l.originY >= 6); // 용지 여백 안쪽
});

test('카드(엽서) 판걸이: 74×50mm는 A4 10장, 148×100mm는 A4 2장', () => {
  const cardSmall = { sizeMm: '74x50' } as const;
  const cardLarge = { sizeMm: '148x100' } as const;
  const lSmall = sheetLayout(cardSmall, 'A4');
  assert.equal(lSmall.cellWidthMm, 78); // 74 + 4
  assert.equal(lSmall.cellHeightMm, 54); // 50 + 4
  assert.equal(lSmall.cols, 2);
  assert.equal(lSmall.rows, 5);
  assert.equal(lSmall.perSheet, 10);
  assert.ok(lSmall.originX >= 6 && lSmall.originY >= 6);

  const lLarge = sheetLayout(cardLarge, 'A4');
  assert.equal(lLarge.cellWidthMm, 152); // 148 + 4
  assert.equal(lLarge.cellHeightMm, 104); // 100 + 4
  assert.equal(lLarge.cols, 1);
  assert.equal(lLarge.rows, 2);
  assert.equal(lLarge.perSheet, 2);
  assert.ok(lLarge.originX >= 6 && lLarge.originY >= 6);
});

test('장 수: 30개는 A4 3장(12·12·6), 남는 칸 채우기면 마지막 장도 12', () => {
  const l = sheetLayout({ shape: 'circle', sizeCm: 6 }, 'A4');
  assert.deepEqual(sheetPlan(l, 30, false), [12, 12, 6]);
  assert.deepEqual(sheetPlan(l, 30, true), [12, 12, 12]);
  assert.deepEqual(sheetPlan(l, 12, false), [12]);
  assert.deepEqual(sheetPlan(l, 0, false), [1]);
  // 상한을 넘으면 말없이 잘라 내지 않고 거절한다 (모자란 인쇄 방지)
  assert.equal(sheetPlan(l, MAX_SHEETS * l.perSheet, false).length, MAX_SHEETS);
  assert.throws(() => sheetPlan(l, MAX_SHEETS * l.perSheet + 1, false), /장까지/);
});

// 1×1 투명 PNG
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

test('PDF: 실제 mm 크기 페이지, 장 수만큼 페이지, 이미지는 한 번만 들어간다', async () => {
  const label = { code: 'OD-ABCD-EF23', orderNo: '20261021-0000123', productNo: 27, quantity: 30 };
  const a4 = await buildPrintPdf({ png: PNG, sticker: { shape: 'circle', sizeCm: 6 }, paper: 'A4', count: 30, fill: false, label });
  assert.equal(a4.sheets, 3);
  assert.equal(a4.stickers, 30);
  const doc = await PDFDocument.load(a4.pdf);
  assert.equal(doc.getPageCount(), 3);
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(Math.abs(width - (210 * 72) / 25.4) < 0.01 && Math.abs(height - (297 * 72) / 25.4) < 0.01);

  const a3 = await buildPrintPdf({ png: PNG, sticker: { shape: 'square', sizeCm: 4 }, paper: 'A3', count: 30, fill: true, label });
  assert.equal(a3.sheets, 1);
  assert.equal(a3.stickers, 54);
  // 3장짜리 A4와 1장짜리 A3의 크기 차이가 작다 = 이미지를 칸마다 다시 넣지 않는다
  assert.ok(a4.pdf.length < 20000, `A4 PDF ${a4.pdf.length}바이트`);
});

test('PDF: 카드(엽서) 실제 mm 크기 및 장 수 계산', async () => {
  const label = { code: 'OD-CARD-TEST', orderNo: '20261114-0000001', productNo: 11, quantity: 25 };
  const a4 = await buildPrintPdf({ png: PNG, card: { sizeMm: '74x50' }, paper: 'A4', count: 25, fill: false, label });
  assert.equal(a4.sheets, 3); // 10 + 10 + 5 = 25
  assert.equal(a4.stickers, 25);
  const doc = await PDFDocument.load(a4.pdf);
  assert.equal(doc.getPageCount(), 3);

  const a4Large = await buildPrintPdf({ png: PNG, card: { sizeMm: '148x100' }, paper: 'A4', count: 5, fill: true, label });
  assert.equal(a4Large.sheets, 3); // 2 + 2 + 2 = 6 (fill: true)
  assert.equal(a4Large.stickers, 6);
});

test('PDF: 주문번호에 한글이 있어도 실패하지 않는다 (기본 글꼴에 없는 글자는 ?로)', async () => {
  const r = await buildPrintPdf({ png: PNG, sticker: { shape: 'circle', sizeCm: 4 }, paper: 'A4', count: 5, fill: false,
    label: { code: 'OD-ABCD-EF23', orderNo: '확인중', productNo: 1, quantity: 5 } });
  assert.equal(r.sheets, 1);
});
