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

test('장 수: 30개는 A4 3장(12·12·6), 남는 칸 채우기면 마지막 장도 12', () => {
  const l = sheetLayout({ shape: 'circle', sizeCm: 6 }, 'A4');
  assert.deepEqual(sheetPlan(l, 30, false), [12, 12, 6]);
  assert.deepEqual(sheetPlan(l, 30, true), [12, 12, 12]);
  assert.deepEqual(sheetPlan(l, 12, false), [12]);
  assert.deepEqual(sheetPlan(l, 0, false), [1]);
  assert.equal(sheetPlan(l, 100000, false).length, MAX_SHEETS);
  assert.ok(sheetPlan(l, 100000, false).every((n) => n <= l.perSheet));
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
