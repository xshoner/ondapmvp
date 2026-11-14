import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLEED_MM,
  CARD_SIZES,
  cardCanvasUnits,
  cardDimensionsMm,
  cardPrintPixels,
  effectiveDpiCard,
  fitScaleCard,
  sanitizeCard,
  sanitizeDraft,
} from '../src/packaging/rules.ts';
import { sheetLayout } from '../src/packaging/sheet.ts';
import { buildPrintPdf } from '../src/packaging/print-pdf.ts';
import { fromStored, toStored } from '../src/app/packaging/editor-store.ts';
import type { EditorSnapshot } from '../src/app/packaging/editor-types.ts';

test('1. 카드 규격 검증: 74x50mm 및 148x100mm 허용, 유효하지 않은 규격 거절', () => {
  assert.deepEqual(sanitizeCard({ sizeMm: '74x50' }), { sizeMm: '74x50' });
  assert.deepEqual(sanitizeCard({ sizeMm: '148x100' }), { sizeMm: '148x100' });

  // 허용되지 않은 규격은 null 반환
  assert.equal(sanitizeCard({ sizeMm: '100x100' }), null);
  assert.equal(sanitizeCard({ sizeMm: 'custom' }), null);
  assert.equal(sanitizeCard(null), null);
  assert.equal(sanitizeCard(undefined), null);
  assert.equal(sanitizeCard({}), null);
});

test('2. 카드 물리 치수 및 300dpi 인쇄 해상도 계산 (2mm 재단 여백 포함)', () => {
  // 74x50 mm + 2mm bleed = 78x54 mm
  const dim74 = cardDimensionsMm('74x50');
  assert.equal(dim74.widthMm, 74);
  assert.equal(dim74.heightMm, 50);

  const px74 = cardPrintPixels('74x50');
  assert.equal(px74.width, 921);
  assert.equal(px74.height, 638);

  // 148x100 mm + 2mm bleed = 152x104 mm
  const dim148 = cardDimensionsMm('148x100');
  assert.equal(dim148.widthMm, 148);
  assert.equal(dim148.heightMm, 100);

  const px148 = cardPrintPixels('148x100');
  assert.equal(px148.width, 1795);
  assert.equal(px148.height, 1228);
});

test('3. 카드 캔버스 좌표계 비율 유지 검증 (가로 1000 기준)', () => {
  const units74 = cardCanvasUnits('74x50');
  assert.equal(units74.widthUnits, 1000);
  // (54 / 78) * 1000 = 692.3 -> 692
  assert.equal(units74.heightUnits, 692);
  assert.ok(units74.bleedX > 0);
  assert.ok(units74.bleedY > 0);

  const units148 = cardCanvasUnits('148x100');
  assert.equal(units148.widthUnits, 1000);
  // (104 / 152) * 1000 = 684.2 -> 684
  assert.equal(units148.heightUnits, 684);
});

test('4. 카드 안전선 맞춤(fitScaleCard) 검증', () => {
  const units = cardCanvasUnits('74x50');
  const safeW = units.widthUnits - 4 * units.bleedX;
  const safeH = units.heightUnits - 4 * units.bleedY;

  // 정가운데에 위치하고 안전선보다 작은 박스는 scale >= 1
  const centerBox = {
    x: 500 - 100,
    y: units.heightUnits / 2 - 50,
    width: 200,
    height: 100,
  };
  const scaleCenter = fitScaleCard('74x50', centerBox);
  assert.ok(scaleCenter > 1, `가운데 작은 상자는 안전선 안이어야 함: ${scaleCenter}`);

  // 안전선을 벗어난 거대한 박스는 scale < 1
  const hugeBox = {
    x: 0,
    y: 0,
    width: 1000,
    height: units.heightUnits,
  };
  const scaleHuge = fitScaleCard('74x50', hugeBox);
  assert.ok(scaleHuge < 1, `안전선을 벗어난 상자는 1 미만이어야 함: ${scaleHuge}`);
});

test('5. 카드 위 사진 실효 해상도(effectiveDpiCard) 검증', () => {
  // 1000px 이미지가 가로 1000 유닛 전체를 채울 때
  // 74x50 카드 전체 폭은 78mm = 3.07 inch.
  // 1000px / 3.07 inch = ~325.6 dpi (>= 300 dpi 충족)
  const dpi = effectiveDpiCard(1000, 1000, '74x50');
  assert.ok(dpi > 300, `실효 dpi가 300 이상이어야 함: ${dpi}`);

  // 400px 저해상도 이미지가 전체를 채울 때
  const lowDpi = effectiveDpiCard(400, 1000, '74x50');
  assert.ok(lowDpi < 200, `저해상도는 200 미만이어야 함: ${lowDpi}`);
});

test('6. 카드 인쇄 시트(SheetLayout) 및 PDF 생성 검증', async () => {
  // A4 용지에 74x50mm 카드 배치: 가로 2열 x 세로 5행 = 10장
  const layoutA4 = sheetLayout({ sizeMm: '74x50' }, 'A4');
  assert.equal(layoutA4.cols, 2);
  assert.equal(layoutA4.rows, 5);
  assert.equal(layoutA4.perSheet, 10);
  assert.equal(layoutA4.cellWidthMm, 78);
  assert.equal(layoutA4.cellHeightMm, 54);

  // A4 용지에 148x100mm 카드 배치: 1열 x 2행 = 2장 (재단 여백 포함 152x104mm)
  const layoutBigA4 = sheetLayout({ sizeMm: '148x100' }, 'A4');
  assert.equal(layoutBigA4.cols, 1);
  assert.equal(layoutBigA4.rows, 2);
  assert.equal(layoutBigA4.perSheet, 2);
  assert.equal(layoutBigA4.cellWidthMm, 152);
  assert.equal(layoutBigA4.cellHeightMm, 104);

  // 실제 PDF 바이너리 생성 테스트
  const dummyPng = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  const res = await buildPrintPdf({
    paper: 'A4',
    card: { sizeMm: '74x50' },
    png: dummyPng,
    count: 10,
    fill: false,
    label: { code: 'OD-CARD-TEST', orderNo: null, productNo: 1, quantity: 10 },
  });
  assert.ok(res.pdf instanceof Uint8Array);
  assert.equal(res.sheets, 1);
  assert.equal(res.stickers, 10);
  assert.ok(res.pdf.length > 500, '유효한 PDF 바이너리가 생성되어야 함');
});

test('7. 스냅샷(toStored / fromStored) 직렬화 및 카드 데이터 복원 검증', async () => {
  const originalSnap: EditorSnapshot = {
    version: 2,
    purpose: 'return',
    styleId: 'style-1',
    withSticker: true,
    shape: 'circle',
    sizeCm: 6,
    background: '#ffffff',
    layers: [
      { id: 'role-main', type: 'text', text: '스티커 문구', x: 500, y: 500, rotation: 0, scaleX: 1, scaleY: 1, font: 'serif', fontSize: 60, color: '#1f2a26', stroke: null, shadow: false },
    ],
    fields: { recipient: '홍길동', sender: '김철수', date: '2026-11-14' },
    withCard: true,
    cardSizeMm: '148x100',
    cardBackground: '#f6edd8',
    cardLayers: [
      { id: 'role-main', type: 'text', text: '카드 메시지', x: 500, y: 340, rotation: 0, scaleX: 1, scaleY: 1, font: 'sans', fontSize: 50, color: '#2f5a4b', stroke: null, shadow: false },
    ],
    cardFields: { recipient: '홍길동', sender: '김철수', date: '2026-11-14' },
    event: 'wedding',
    quantity: 50,
  };

  const stored = toStored(originalSnap) as Record<string, any>;
  assert.equal(stored.withCard, true);
  assert.equal(stored.cardSizeMm, '148x100');
  assert.equal(stored.cardBackground, '#f6edd8');
  assert.ok(Array.isArray(stored.cardLayers));

  const restored = await fromStored(stored, {
    styleIds: ['style-1'],
    events: ['wedding'],
  });

  assert.ok(restored !== null);
  const snap = restored.snap;
  assert.equal(snap.withCard, true);
  assert.equal(snap.cardSizeMm, '148x100');
  assert.equal(snap.cardBackground, '#f6edd8');
  assert.equal(snap.cardLayers?.length, 1);
  assert.equal((snap.cardLayers?.[0] as any).text, '카드 메시지');
  assert.equal(snap.cardFields?.recipient, '홍길동');
  assert.equal(snap.withSticker, true);
  assert.equal(snap.layers.length, 1);

  const legacy = await fromStored({ ...stored, cardLayers: undefined, withCard: undefined }, { styleIds: ['style-1'], events: ['wedding'] });
  assert.equal(legacy?.snap.cardLayers, undefined);
});

test('8. 로컬 저장소 createDesign, lookupDesign, reorderDesign 카드 호환성 검증', async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const testDir = mkdtempSync(join(tmpdir(), 'ondap-postcard-test-'));
  process.env.ONDAP_TEST_DATA_DIR = testDir;

  try {
    const { createDesign, lookupDesign, reorderDesign, readPrintFile, listDesigns } = await import('../src/data/packaging-repository.ts');

    const stickerPng = Uint8Array.from([1, 2, 3, 4]);
    const cardPng = Uint8Array.from([5, 6, 7, 8]);

    // 1) 스티커 + 카드 동시 접수
    const codeBoth = 'OD-BOTH-1234';
    const resBoth = await createDesign(
      {
        code: codeBoth,
        productNo: 27,
        productName: '테스트 답례품',
        quantity: 50,
        event: 'wedding',
        styleId: 's1',
        styleName: '모던 화이트',
        sticker: { shape: 'circle', sizeCm: 6 },
        draft: { background: '#fff', layers: [], fields: { recipient: '', sender: '', date: '' } },
        card: { sizeMm: '74x50' },
        cardDraft: { background: '#fff', layers: [], fields: { recipient: '', sender: '', date: '' } },
      },
      stickerPng,
      cardPng,
    );
    assert.equal(resBoth, 'ok');

    const loadedBoth = await lookupDesign(codeBoth);
    assert.ok(loadedBoth !== null);
    assert.equal(loadedBoth.code, codeBoth);
    assert.deepEqual(loadedBoth.sticker, { shape: 'circle', sizeCm: 6 });
    assert.deepEqual(loadedBoth.card, { sizeMm: '74x50' });

    const [desBoth] = await listDesigns({ code: codeBoth, includePending: true });
    assert.ok(desBoth);
    assert.equal(desBoth.hasPrintFile, true);
    assert.equal(desBoth.hasCardPrintFile, true);

    // 파일 읽기
    const readSticker = await readPrintFile(codeBoth, 'sticker');
    assert.deepEqual(readSticker, stickerPng);
    const readCard = await readPrintFile(codeBoth, 'card');
    assert.deepEqual(readCard, cardPng);

    // 2) 카드 단독 접수
    const codeCardOnly = 'OD-CARD-5678';
    const resCard = await createDesign(
      {
        code: codeCardOnly,
        productNo: 27,
        productName: '테스트 답례품',
        quantity: 30,
        event: 'wedding',
        styleId: 's1',
        styleName: '모던 화이트',
        sticker: null,
        draft: null,
        card: { sizeMm: '148x100' },
        cardDraft: { background: '#fff', layers: [], fields: { recipient: '', sender: '', date: '' } },
      },
      null,
      cardPng,
    );
    assert.equal(resCard, 'ok');

    const loadedCard = await lookupDesign(codeCardOnly);
    assert.ok(loadedCard !== null);
    assert.equal(loadedCard.sticker, null);
    assert.deepEqual(loadedCard.card, { sizeMm: '148x100' });

    const [desCard] = await listDesigns({ code: codeCardOnly, includePending: true });
    assert.ok(desCard);
    assert.equal(desCard.hasPrintFile, false);
    assert.equal(desCard.hasCardPrintFile, true);
    assert.equal(desCard.printCode, codeCardOnly);

    const reorderedCardOnly = 'OD-CARD-8888';
    assert.equal(await reorderDesign(codeCardOnly, reorderedCardOnly, 30), 'ok');
    const [cardOnlyCopy] = await listDesigns({ code: reorderedCardOnly, includePending: true });
    assert.equal(cardOnlyCopy.printCode, codeCardOnly);
    assert.equal(cardOnlyCopy.hasPrintFile, false);
    assert.equal(cardOnlyCopy.hasCardPrintFile, true);
    assert.deepEqual(await readPrintFile(cardOnlyCopy.printCode!, 'card'), cardPng);

    // 3) 재주문 시 스티커와 카드 두 파일 모두 참조 유지
    const codeReorder = 'OD-REOR-9999';
    const resReorder = await reorderDesign(codeBoth, codeReorder, 100);
    assert.equal(resReorder, 'ok');

    const loadedReorder = await lookupDesign(codeReorder);
    assert.ok(loadedReorder !== null);
    assert.equal(loadedReorder.quantity, 100);
    assert.deepEqual(loadedReorder.sticker, { shape: 'circle', sizeCm: 6 });
    assert.deepEqual(loadedReorder.card, { sizeMm: '74x50' });

    const [desReorder] = await listDesigns({ code: codeReorder, includePending: true });
    assert.ok(desReorder);
    assert.equal(desReorder.sourceCode, codeBoth);
    assert.equal(desReorder.hasPrintFile, true);
    assert.equal(desReorder.hasCardPrintFile, true);

    const reorderedSticker = await readPrintFile(codeReorder, 'sticker');
    assert.deepEqual(reorderedSticker, stickerPng);
    const reorderedCard = await readPrintFile(codeReorder, 'card');
    assert.deepEqual(reorderedCard, cardPng);

    // 4) 기존 레거시 데이터(카드 없음) 역호환성
    const codeLegacy = 'OD-LEGC-0001';
    await createDesign(
      {
        code: codeLegacy,
        productNo: 27,
        productName: '레거시 상품',
        quantity: 20,
        event: 'wedding',
        styleId: 's1',
        styleName: '모던 화이트',
        sticker: { shape: 'square', sizeCm: 6 },
        draft: { background: '#fff', layers: [], fields: { recipient: '', sender: '', date: '' } },
      },
      stickerPng,
    );
    const loadedLegacy = await lookupDesign(codeLegacy);
    assert.ok(loadedLegacy !== null);
    assert.equal(loadedLegacy.card, null);

    const [desLegacy] = await listDesigns({ code: codeLegacy, includePending: true });
    assert.ok(desLegacy);
    assert.equal(desLegacy.hasCardPrintFile, false);
    assert.equal(desLegacy.hasPrintFile, true);
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(testDir, { recursive: true, force: true });
  }
});
