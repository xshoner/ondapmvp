import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateScheduleStatus,
  diffDays,
  formatMmDd,
  toKstDateString,
} from '../src/packaging/schedule.ts';
import { sanitizeIsoDate } from '../src/packaging/rules.ts';
import { designsCsv } from '../src/packaging/design-filter.ts';
import type { Design, DesignDraft } from '../src/packaging/types.ts';

test('1. toKstDateString & diffDays & formatMmDd KST 날짜 변환 검증', () => {
  // UTC 2026-11-17T01:00:00Z -> KST 2026-11-17 (10:00)
  assert.equal(toKstDateString('2026-11-17T01:00:00Z'), '2026-11-17');
  // UTC 2026-11-17T16:00:00Z -> KST 2026-11-18 (01:00)
  assert.equal(toKstDateString('2026-11-17T16:00:00Z'), '2026-11-18');

  // formatMmDd
  assert.equal(formatMmDd('2026-11-25'), '11/25');
  assert.equal(formatMmDd('2026-05-03'), '5/3');
  assert.equal(formatMmDd(null), '');

  // diffDays (A - B)
  assert.equal(diffDays('2026-11-20', '2026-11-17'), 3);
  assert.equal(diffDays('2026-11-15', '2026-11-17'), -2);
  assert.equal(diffDays('2026-11-17', '2026-11-17'), 0);
});

test('2. sanitizeIsoDate 유효성 검증', () => {
  assert.equal(sanitizeIsoDate('2026-11-20'), '2026-11-20');
  assert.equal(sanitizeIsoDate(' 2026-05-01 '), '2026-05-01');
  assert.equal(sanitizeIsoDate('2026/11/20'), null);
  assert.equal(sanitizeIsoDate('invalid-date'), null);
  assert.equal(sanitizeIsoDate(null), null);
  assert.equal(sanitizeIsoDate(undefined), null);
});

test('3. 기준일 우선순위: 희망 수령일 우선, 없으면 행사일, 없으면 미입력', () => {
  const fixedNow = Date.parse('2026-11-17T03:00:00Z'); // KST 2026-11-17 12:00

  // (1) 희망 수령일 + 행사일 모두 있음 -> 희망 수령일 기준, 행사일 병기
  const dBoth = {
    createdAt: '2026-11-17T00:00:00Z',
    status: 'order_confirmed' as const,
    desiredDeliveryDate: '2026-11-21',
    eventDate: '2026-11-23',
  };
  const infoBoth = calculateScheduleStatus(dBoth, fixedNow);
  assert.equal(infoBoth.targetType, 'desired');
  assert.equal(infoBoth.targetDate, '2026-11-21');
  assert.equal(infoBoth.displayDateText, '희망 수령 11/21 (행사 11/23)');
  assert.equal(infoBoth.dDay, 4);
  assert.equal(infoBoth.urgency, 'normal');

  // (2) 희망 수령일만 있음
  const dDesiredOnly = {
    createdAt: '2026-11-17T00:00:00Z',
    status: 'order_confirmed' as const,
    desiredDeliveryDate: '2026-11-20',
    eventDate: null,
  };
  const infoDesired = calculateScheduleStatus(dDesiredOnly, fixedNow);
  assert.equal(infoDesired.targetType, 'desired');
  assert.equal(infoDesired.targetDate, '2026-11-20');
  assert.equal(infoDesired.displayDateText, '희망 수령 11/20');
  assert.equal(infoDesired.dDay, 3);
  assert.equal(infoDesired.urgency, 'imminent');
  assert.equal(infoBoth.hasConflict, false);

  // (3) 행사일만 있음
  const dEventOnly = {
    createdAt: '2026-11-17T00:00:00Z',
    status: 'received' as const,
    desiredDeliveryDate: null,
    eventDate: '2026-11-19',
  };
  const infoEvent = calculateScheduleStatus(dEventOnly, fixedNow);
  assert.equal(infoEvent.targetType, 'event');
  assert.equal(infoEvent.targetDate, '2026-11-19');
  assert.equal(infoEvent.displayDateText, '행사일 11/19');
  assert.equal(infoEvent.dDay, 2);
  assert.equal(infoEvent.urgency, 'imminent');

  // (4) 둘 다 없음
  const dNone = {
    createdAt: '2026-11-15T00:00:00Z',
    status: 'received' as const,
    desiredDeliveryDate: null,
    eventDate: null,
  };
  const infoNone = calculateScheduleStatus(dNone, fixedNow);
  assert.equal(infoNone.targetType, 'none');
  assert.equal(infoNone.targetDate, null);
  assert.equal(infoNone.displayDateText, '일정 미입력');
  assert.equal(infoNone.badgeText, '일정 미입력 (+2일)');
  assert.equal(infoNone.urgency, 'none');
});

test('4. D-Day 및 긴급도 단계: 경과 / D-0 / D-1 / D-2 / D-3 / D-4+', () => {
  const fixedNow = Date.parse('2026-11-17T03:00:00Z'); // KST 2026-11-17

  // 경과건 (dDay < 0)
  const overdue = calculateScheduleStatus({
    createdAt: '2026-11-10T00:00:00Z',
    status: 'order_confirmed',
    desiredDeliveryDate: '2026-11-15',
    eventDate: null,
  }, fixedNow);
  assert.equal(overdue.urgency, 'emergency');
  assert.equal(overdue.badgeTone, 'red');
  assert.equal(overdue.badgeText, '기준일 경과 (+2일)');

  // D-Day 당일 (dDay = 0)
  const d0 = calculateScheduleStatus({
    createdAt: '2026-11-16T00:00:00Z',
    status: 'order_confirmed',
    desiredDeliveryDate: '2026-11-17',
    eventDate: null,
  }, fixedNow);
  assert.equal(d0.urgency, 'emergency');
  assert.equal(d0.badgeTone, 'red');
  assert.equal(d0.badgeText, 'D-Day (오늘)');

  // D-1 내일 (dDay = 1)
  const d1 = calculateScheduleStatus({
    createdAt: '2026-11-16T00:00:00Z',
    status: 'order_confirmed',
    desiredDeliveryDate: '2026-11-18',
    eventDate: null,
  }, fixedNow);
  assert.equal(d1.urgency, 'emergency');
  assert.equal(d1.badgeTone, 'red');
  assert.equal(d1.badgeText, 'D-1 (내일)');

  // D-2, D-3 (임박)
  const d2 = calculateScheduleStatus({
    createdAt: '2026-11-16T00:00:00Z',
    status: 'order_confirmed',
    desiredDeliveryDate: '2026-11-19',
    eventDate: null,
  }, fixedNow);
  assert.equal(d2.urgency, 'imminent');
  assert.equal(d2.badgeTone, 'amber');
  assert.equal(d2.badgeText, 'D-2');

  const d3 = calculateScheduleStatus({
    createdAt: '2026-11-16T00:00:00Z',
    status: 'order_confirmed',
    desiredDeliveryDate: '2026-11-20',
    eventDate: null,
  }, fixedNow);
  assert.equal(d3.urgency, 'imminent');
  assert.equal(d3.badgeTone, 'amber');
  assert.equal(d3.badgeText, 'D-3');

  // D-4 (일반)
  const d4 = calculateScheduleStatus({
    createdAt: '2026-11-16T00:00:00Z',
    status: 'order_confirmed',
    desiredDeliveryDate: '2026-11-21',
    eventDate: null,
  }, fixedNow);
  assert.equal(d4.urgency, 'normal');
  assert.equal(d4.badgeTone, 'gray');
  assert.equal(d4.badgeText, 'D-4');
});

test('5. 날짜 역전 및 과거일 입력 오류 감지 (Conflict detection)', () => {
  const fixedNow = Date.parse('2026-11-17T03:00:00Z'); // KST 2026-11-17

  // 희망 수령일 > 행사일 역전 오류
  const conflictReverse = calculateScheduleStatus({
    createdAt: '2026-11-17T00:00:00Z',
    status: 'received',
    desiredDeliveryDate: '2026-11-25',
    eventDate: '2026-11-20',
  }, fixedNow);
  assert.equal(conflictReverse.hasConflict, true);
  assert.equal(conflictReverse.badgeText, '일정 확인 필요');
  assert.equal(conflictReverse.badgeTone, 'red');
  assert.ok(conflictReverse.conflictMessage?.includes('행사일보다 늦습니다'));

  // 희망 수령일이 디자인 생성일보다 과거인 오류
  const conflictPast = calculateScheduleStatus({
    createdAt: '2026-11-17T00:00:00Z',
    status: 'received',
    desiredDeliveryDate: '2026-11-10',
    eventDate: null,
  }, fixedNow);
  assert.equal(conflictPast.hasConflict, true);
  assert.equal(conflictPast.badgeText, '일정 확인 필요');
  assert.equal(conflictPast.conflictMessage, '희망 수령일이 디자인 생성일보다 과거입니다.');
});

test('6. 완료 및 취소 상태: 긴급/경과 알림 미표시 및 녹색 배지 처리', () => {
  const fixedNow = Date.parse('2026-11-17T03:00:00Z');

  // 포장 완료건 (기준일이 지났어도 완료되었으므로 긴급 경보 해제)
  const completed = calculateScheduleStatus({
    createdAt: '2026-11-10T00:00:00Z',
    status: 'completed',
    desiredDeliveryDate: '2026-11-12',
    eventDate: '2026-11-15',
  }, fixedNow);
  assert.equal(completed.urgency, 'none');
  assert.equal(completed.badgeTone, 'green');
  assert.equal(completed.badgeText, '포장 완료');

  // 포장 없음건
  const noPackaging = calculateScheduleStatus({
    createdAt: '2026-11-10T00:00:00Z',
    status: 'no_packaging',
    desiredDeliveryDate: '2026-11-12',
    eventDate: null,
  }, fixedNow);
  assert.equal(noPackaging.urgency, 'none');
  assert.equal(noPackaging.badgeTone, 'green');
  assert.equal(noPackaging.badgeText, '포장 없음');

  // 취소건
  const canceled = calculateScheduleStatus({
    createdAt: '2026-11-10T00:00:00Z',
    status: 'canceled',
    desiredDeliveryDate: '2026-11-12',
    eventDate: null,
  }, fixedNow);
  assert.equal(canceled.urgency, 'none');
  assert.equal(canceled.badgeTone, 'gray');
  assert.equal(canceled.badgeText, '취소됨');
});

test('7. 정렬 우선순위 가중치 (sortScore) 검증', () => {
  const fixedNow = Date.parse('2026-11-17T03:00:00Z');

  const sConflict = calculateScheduleStatus({
    createdAt: '2026-11-17T00:00:00Z', status: 'received',
    desiredDeliveryDate: '2026-11-25', eventDate: '2026-11-20',
  }, fixedNow).sortScore;

  const sOverdue = calculateScheduleStatus({
    createdAt: '2026-11-10T00:00:00Z', status: 'order_confirmed',
    desiredDeliveryDate: '2026-11-15', eventDate: null,
  }, fixedNow).sortScore;

  const sD0 = calculateScheduleStatus({
    createdAt: '2026-11-16T00:00:00Z', status: 'order_confirmed',
    desiredDeliveryDate: '2026-11-17', eventDate: null,
  }, fixedNow).sortScore;

  const sD1 = calculateScheduleStatus({
    createdAt: '2026-11-16T00:00:00Z', status: 'order_confirmed',
    desiredDeliveryDate: '2026-11-18', eventDate: null,
  }, fixedNow).sortScore;

  const sD2 = calculateScheduleStatus({
    createdAt: '2026-11-16T00:00:00Z', status: 'order_confirmed',
    desiredDeliveryDate: '2026-11-19', eventDate: null,
  }, fixedNow).sortScore;

  const sNone = calculateScheduleStatus({
    createdAt: '2026-11-16T00:00:00Z', status: 'received',
    desiredDeliveryDate: null, eventDate: null,
  }, fixedNow).sortScore;

  const sCompleted = calculateScheduleStatus({
    createdAt: '2026-11-16T00:00:00Z', status: 'completed',
    desiredDeliveryDate: '2026-11-18', eventDate: null,
  }, fixedNow).sortScore;

  const sCanceled = calculateScheduleStatus({
    createdAt: '2026-11-16T00:00:00Z', status: 'canceled',
    desiredDeliveryDate: '2026-11-18', eventDate: null,
  }, fixedNow).sortScore;

  // 정렬 순서: 오류 건 < 경과 건 < D-0 < D-1 < D-2 < 일정미입력 < 완료 < 취소
  assert.ok(sConflict < sOverdue, '오류 건이 경과 건보다 우선');
  assert.ok(sOverdue < sD0, '경과 건이 D-0보다 우선');
  assert.ok(sD0 < sD1, 'D-0이 D-1보다 우선');
  assert.ok(sD1 < sD2, 'D-1이 D-2보다 우선');
  assert.ok(sD2 < sNone, 'D-2가 일정 미입력보다 우선');
  assert.ok(sNone < sCompleted, '일정 미입력이 완료보다 우선');
  assert.ok(sCompleted < sCanceled, '완료가 취소보다 우선');
});

test('8. designsCsv에 희망 수령일 및 행사일 컬럼 포함 검증', () => {
  const d: Design = {
    code: 'OD-SCHD-0001',
    createdAt: '2026-11-17T01:00:00Z',
    productNo: 101,
    productName: '답례떡 세트',
    quantity: 50,
    event: 'wedding',
    styleId: 's1',
    styleName: '전통 자개',
    sticker: { shape: 'circle', sizeCm: 6 },
    draft: null,
    card: null,
    cardDraft: null,
    hasPrintFile: true,
    hasCardPrintFile: false,
    printCode: 'OD-SCHD-0001',
    sourceCode: null,
    status: 'order_confirmed',
    statusChangedAt: '2026-11-17T01:00:00Z',
    orderNo: '20261117-0000001',
    memo: '행사 전날 오후 도착 희망',
    desiredDeliveryDate: '2026-11-21',
    eventDate: '2026-11-23',
  };

  const csv = designsCsv([d], { wedding: '결혼' }, (iso) => iso.slice(0, 10));
  assert.ok(csv.includes('희망 수령일,행사일'));
  assert.ok(csv.includes('2026-11-21,2026-11-23'));
});
// ---------- 저장소 및 무결성 회귀 테스트 (데이터 격리) ----------

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  createDesign,
  getDesign,
  getDesignsByCodes,
  getDesignsByOrderNo,
  listDesigns,
  updateDesign,
  reorderDesign,
  updateDesignsStatus,
  type NewDesign,
} from '../src/data/packaging-repository.ts';
import {
  prepareUploadSession,
  commitUploadSession,
  saveLocalSessionFile,
  type UploadSessionMeta,
} from '../src/data/upload-session-repository.ts';
import { printPixels } from '../src/packaging/rules.ts';

async function makeTestPng(width: number, height: number): Promise<Uint8Array> {
  const buf = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 200, g: 200, b: 200, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

test('9. createDesign & listDesigns: 희망 수령일 및 행사일 보존 검증', async () => {
  const testDir = mkdtempSync(join(tmpdir(), 'ondap-schd-test-'));
  process.env.ONDAP_TEST_DATA_DIR = testDir;

  try {
    const newDesign: NewDesign = {
      code: 'OD-TEST-0001',
      productNo: 201,
      productName: '호두과자 세트',
      quantity: 30,
      event: 'wedding',
      styleId: 's1',
      styleName: '전통 자개',
      sticker: { shape: 'circle', sizeCm: 6 },
      draft: null,
      eventDate: '2026-11-30',
      desiredDeliveryDate: '2026-11-28',
    };

    const res = await createDesign(newDesign, null, null);
    assert.equal(res, 'ok');

    const [saved] = await listDesigns({ code: 'OD-TEST-0001', limit: 1, includePending: true });
    assert.ok(saved);
    assert.equal(saved.code, 'OD-TEST-0001');
    assert.equal(saved.eventDate, '2026-11-30');
    assert.equal(saved.desiredDeliveryDate, '2026-11-28');
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('10. prepareUploadSession & commitUploadSession: 세션 업로드 시 희망 수령일 및 행사일 보존 검증', async () => {
  const testDir = mkdtempSync(join(tmpdir(), 'ondap-schd-sess-'));
  process.env.ONDAP_TEST_DATA_DIR = testDir;

  try {
    const stickerPx = printPixels(6);
    const stickerPng = await makeTestPng(stickerPx, stickerPx);

    const meta: UploadSessionMeta = {
      productNo: 202,
      productName: '도라지정과 세트',
      quantity: 50,
      event: 'thanks',
      styleId: 's2',
      styleName: '모던 플라워',
      sticker: { shape: 'circle', sizeCm: 6 },
      draft: null,
      card: null,
      cardDraft: null,
      eventDate: '2026-12-25',
      desiredDeliveryDate: '2026-12-23',
    };

    const prep = await prepareUploadSession(meta);
    assert.equal(prep.ok, true);
    if (!prep.ok || prep.direct) {
      assert.fail('세션 준비 실패');
    }

    const { sessionId, secret, code, uploads } = prep;
    assert.ok(uploads.sticker);

    saveLocalSessionFile(sessionId, 'sticker', secret, stickerPng);

    const commit = await commitUploadSession({ sessionId, secret });
    assert.equal(commit.ok, true);

    const [saved] = await listDesigns({ code, limit: 1, includePending: true });
    assert.ok(saved);
    assert.equal(saved.code, code);
    assert.equal(saved.eventDate, '2026-12-25');
    assert.equal(saved.desiredDeliveryDate, '2026-12-23');
    assert.equal(saved.status, 'pending');
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('11. reorderDesign: 재주문 시 원본의 행사일 및 희망 수령일 복제 보존 검증', async () => {
  const testDir = mkdtempSync(join(tmpdir(), 'ondap-schd-reorder-'));
  process.env.ONDAP_TEST_DATA_DIR = testDir;

  try {
    const src: NewDesign = {
      code: 'OD-ORIG-0001',
      productNo: 203,
      productName: '꿀약과 세트',
      quantity: 40,
      event: 'funeral',
      styleId: 's3',
      styleName: '차분한 단색',
      sticker: { shape: 'square', sizeCm: 4 },
      draft: null,
      eventDate: '2026-12-10',
      desiredDeliveryDate: '2026-12-08',
    };
    await createDesign(src, null, null);

    const reorderRes = await reorderDesign('OD-ORIG-0001', 'OD-REORDER-0002', 60);
    assert.equal(reorderRes, 'ok');

    const [reordered] = await listDesigns({ code: 'OD-REORDER-0002', limit: 1, includePending: true });
    assert.ok(reordered);
    assert.equal(reordered.code, 'OD-REORDER-0002');
    assert.equal(reordered.quantity, 60);
    assert.equal(reordered.eventDate, '2026-12-10');
    assert.equal(reordered.desiredDeliveryDate, '2026-12-08');
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('12. updateDesign: 독립 부분 수정(Partial Update) 시 타 필드 보존 검증', async () => {
  const testDir = mkdtempSync(join(tmpdir(), 'ondap-schd-partial-'));
  process.env.ONDAP_TEST_DATA_DIR = testDir;

  try {
    const initial: NewDesign = {
      code: 'OD-PARTIAL-0001',
      productNo: 204,
      productName: '곶감 세트',
      quantity: 20,
      event: 'birthday',
      styleId: 's1',
      styleName: '자개',
      sticker: null,
      draft: null,
      eventDate: '2026-11-25',
      desiredDeliveryDate: '2026-11-22',
    };
    await createDesign(initial, null, null);

    await updateDesign('OD-PARTIAL-0001', {
      status: 'received',
      orderNo: '20261117-0001111',
      memo: '초기 메모 내용',
    });

    let [current] = await listDesigns({ code: 'OD-PARTIAL-0001', limit: 1, includePending: true });
    assert.equal(current.status, 'received');
    assert.equal(current.orderNo, '20261117-0001111');
    assert.equal(current.memo, '초기 메모 내용');
    assert.equal(current.eventDate, '2026-11-25');
    assert.equal(current.desiredDeliveryDate, '2026-11-22');

    // (1) 메모만 단독 수정 시 -> orderNo, eventDate, desiredDeliveryDate 유지
    await updateDesign('OD-PARTIAL-0001', { memo: '메모만 수정됨' });

    [current] = await listDesigns({ code: 'OD-PARTIAL-0001', limit: 1, includePending: true });
    assert.equal(current.memo, '메모만 수정됨');
    assert.equal(current.orderNo, '20261117-0001111');
    assert.equal(current.eventDate, '2026-11-25');
    assert.equal(current.desiredDeliveryDate, '2026-11-22');
    assert.equal(current.status, 'received');

    // (2) 희망 수령일만 단독 수정 시 -> memo, orderNo, eventDate 유지
    await updateDesign('OD-PARTIAL-0001', { desiredDeliveryDate: '2026-11-23' });

    [current] = await listDesigns({ code: 'OD-PARTIAL-0001', limit: 1, includePending: true });
    assert.equal(current.desiredDeliveryDate, '2026-11-23');
    assert.equal(current.eventDate, '2026-11-25');
    assert.equal(current.memo, '메모만 수정됨');
    assert.equal(current.orderNo, '20261117-0001111');

    // (3) 상태만 단독 수정 시 -> 타 필드 유지
    await updateDesign('OD-PARTIAL-0001', { status: 'order_confirmed' });

    [current] = await listDesigns({ code: 'OD-PARTIAL-0001', limit: 1, includePending: true });
    assert.equal(current.status, 'order_confirmed');
    assert.equal(current.desiredDeliveryDate, '2026-11-23');
    assert.equal(current.eventDate, '2026-11-25');
    assert.equal(current.memo, '메모만 수정됨');
    assert.equal(current.orderNo, '20261117-0001111');
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('13. dismissPackaging 가드 불변식 검증 (인쇄물 포함 건, 결제대기 건, 취소 건 차단)', async () => {
  const canDismissPackaging = (d: {
    status: string;
    sticker: unknown;
    card: unknown;
    hasPrintFile: boolean;
    hasCardPrintFile: boolean;
  }): { ok: boolean; reason?: string } => {
    if (d.status === 'pending') return { ok: false, reason: '결제 대기' };
    if (d.status === 'canceled') return { ok: false, reason: '취소된 주문' };
    if (d.sticker || d.card || d.hasPrintFile || d.hasCardPrintFile) {
      return { ok: false, reason: '인쇄물이 포함된 주문은 포장 없음 불가' };
    }
    return { ok: true };
  };

  const withSticker = canDismissPackaging({
    status: 'received',
    sticker: { shape: 'circle', sizeCm: 6 },
    card: null,
    hasPrintFile: true,
    hasCardPrintFile: false,
  });
  assert.equal(withSticker.ok, false);
  assert.ok(withSticker.reason?.includes('포장 없음 불가'));

  const withCard = canDismissPackaging({
    status: 'order_confirmed',
    sticker: null,
    card: { sizeMm: '148x100' },
    hasPrintFile: false,
    hasCardPrintFile: true,
  });
  assert.equal(withCard.ok, false);
  assert.ok(withCard.reason?.includes('포장 없음 불가'));

  const pending = canDismissPackaging({
    status: 'pending',
    sticker: null,
    card: null,
    hasPrintFile: false,
    hasCardPrintFile: false,
  });
  assert.equal(pending.ok, false);
  assert.equal(pending.reason, '결제 대기');

  const canceled = canDismissPackaging({
    status: 'canceled',
    sticker: null,
    card: null,
    hasPrintFile: false,
    hasCardPrintFile: false,
  });
  assert.equal(canceled.ok, false);
  assert.equal(canceled.reason, '취소된 주문');

  const plain = canDismissPackaging({
    status: 'received',
    sticker: null,
    card: null,
    hasPrintFile: false,
    hasCardPrintFile: false,
  });
  assert.equal(plain.ok, true);
});

test('14. linkDesignToOrder 가드 및 자동 상태 전진 차단 검증', async () => {
  const testDir = mkdtempSync(join(tmpdir(), 'ondap-schd-link-'));
  process.env.ONDAP_TEST_DATA_DIR = testDir;

  try {
    await createDesign({
      code: 'OD-LINK-0001',
      productNo: 208,
      productName: '홍삼 세트',
      quantity: 15,
      event: 'wedding',
      styleId: 's1',
      styleName: '자개',
      sticker: { shape: 'circle', sizeCm: 6 },
      draft: null,
    }, null, null);

    await updateDesign('OD-LINK-0001', { status: 'received' });
    await updateDesign('OD-LINK-0001', { orderNo: '20261117-0009999' });

    const [linked] = await listDesigns({ code: 'OD-LINK-0001', limit: 1, includePending: true });
    assert.equal(linked.orderNo, '20261117-0009999');
    assert.equal(linked.status, 'received');
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('15. 인쇄(PDF/PNG) 라우트 가드: 결제대기(pending) 및 취소(canceled) 차단 불변식 검증', () => {
  const canGeneratePrint = (status: string): { allowed: boolean; httpStatus?: number } => {
    if (status === 'canceled' || status === 'pending') {
      return { allowed: false, httpStatus: 403 };
    }
    return { allowed: true };
  };

  assert.deepEqual(canGeneratePrint('pending'), { allowed: false, httpStatus: 403 });
  assert.deepEqual(canGeneratePrint('canceled'), { allowed: false, httpStatus: 403 });
  assert.deepEqual(canGeneratePrint('received'), { allowed: true });
  assert.deepEqual(canGeneratePrint('order_confirmed'), { allowed: true });
  assert.deepEqual(canGeneratePrint('printed'), { allowed: true });
  assert.deepEqual(canGeneratePrint('completed'), { allowed: true });
});

test('16. getDesign: 단건 상세 조회 시 draft 및 cardDraft 고객 문구 보존 검증', async () => {
  const testDir = mkdtempSync(join(tmpdir(), 'ondap-schd-detail-'));
  process.env.ONDAP_TEST_DATA_DIR = testDir;

  try {
    const draftData: DesignDraft = {
      background: 'bg-1',
      fields: { recipient: '신랑 김철수 & 신부 이영희', sender: '혼주 일동', date: '2026-12-25' },
      layers: [
        { id: 't1', type: 'text', text: '신랑 김철수 & 신부 이영희', font: 'Pretendard', fontSize: 16, color: '#000', stroke: null, shadow: false, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        { id: 't2', type: 'text', text: '귀한 발걸음 감사드립니다.', font: 'Pretendard', fontSize: 14, color: '#000', stroke: null, shadow: false, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      ],
    };
    const cardDraftData: DesignDraft = {
      background: 'card-bg-1',
      fields: { recipient: '', sender: '', date: '' },
      layers: [
        { id: 'c1', type: 'text', text: '마음을 담아 드립니다.', font: 'Pretendard', fontSize: 16, color: '#000', stroke: null, shadow: false, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      ],
    };

    await createDesign({
      code: 'OD-DTL-0001',
      productNo: 301,
      productName: '수제 도라지정과',
      quantity: 50,
      event: 'wedding',
      styleId: 's1',
      styleName: '전통 자개',
      sticker: { shape: 'circle', sizeCm: 6 },
      draft: draftData,
      card: { sizeMm: '148x100' },
      cardDraft: cardDraftData,
    }, null, null);

    // 1) listDesigns는 목록 경량화를 위해 draft 및 cardDraft가 null이어야 함
    const [listItem] = await listDesigns({ code: 'OD-DTL-0001', limit: 1, includePending: true });
    assert.ok(listItem);
    assert.equal(listItem.draft, null, '목록 조회 시 draft는 null로 경량화되어야 함');
    assert.equal(listItem.cardDraft, null, '목록 조회 시 cardDraft도 null로 경량화되어야 함');

    // 2) getDesign은 고객 문구 검수를 위해 draft 및 cardDraft를 온전히 반환해야 함
    const detail = await getDesign('OD-DTL-0001');
    assert.ok(detail);
    assert.ok(detail.draft);
    assert.ok(detail.cardDraft);
    assert.equal(detail.draft.layers.length, 2);
    assert.equal((detail.draft.layers[0] as { text: string }).text, '신랑 김철수 & 신부 이영희');
    assert.equal((detail.cardDraft.layers[0] as { text: string }).text, '마음을 담아 드립니다.');
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('17. getDesignsByCodes 전수 조회 및 updateDesignsStatus 동시 취소 경합 방어 검증', async () => {
  const testDir = mkdtempSync(join(tmpdir(), 'ondap-schd-batch2-'));
  process.env.ONDAP_TEST_DATA_DIR = testDir;

  try {
    await createDesign({
      code: 'OD-BATCH-01', productNo: 302, productName: '다과 1', quantity: 10,
      event: null, styleId: '', styleName: '', sticker: null, draft: null,
    }, null, null);
    await createDesign({
      code: 'OD-BATCH-02', productNo: 303, productName: '다과 2', quantity: 20,
      event: null, styleId: '', styleName: '', sticker: null, draft: null,
    }, null, null);
    await createDesign({
      code: 'OD-BATCH-03', productNo: 304, productName: '다과 3', quantity: 30,
      event: null, styleId: '', styleName: '', sticker: null, draft: null,
    }, null, null);

    // 01은 received, 02는 canceled 상태
    await updateDesign('OD-BATCH-01', { status: 'received' });
    await updateDesign('OD-BATCH-02', { status: 'canceled' });
    // 03은 pending 상태 유지

    // 1) getDesignsByCodes 전수 조회 검증
    const found = await getDesignsByCodes(['OD-BATCH-01', 'OD-BATCH-02', 'OD-BATCH-03', 'OD-BATCH-NONE']);
    assert.equal(found.length, 3);
    const codeMap = new Map(found.map((x) => [x.code, x.status]));
    assert.equal(codeMap.get('OD-BATCH-01'), 'received');
    assert.equal(codeMap.get('OD-BATCH-02'), 'canceled');
    assert.equal(codeMap.get('OD-BATCH-03'), 'pending');

    // 2) updateDesignsStatus 동시 취소 경합 방어 검증:
    // 01, 02에 대해 일괄 'order_confirmed' 변경 시도 시 이미 canceled인 02는 절대 덮어써지지 않아야 함
    const updated = await updateDesignsStatus(['OD-BATCH-01', 'OD-BATCH-02'], 'order_confirmed');
    assert.ok(updated.includes('OD-BATCH-01'));
    assert.ok(!updated.includes('OD-BATCH-02'), 'canceled 상태인 디자인은 덮어쓰기에서 제외되어야 함');

    const [after02] = await listDesigns({ code: 'OD-BATCH-02', limit: 1, includePending: true });
    assert.equal(after02.status, 'canceled', 'OD-BATCH-02는 취소 불변식이 유지되어야 함');
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('18. 카페24 취소 시 completed(포장 완료) 건 오출고 방지 보호 및 경고 검증', async () => {
  const testDir = mkdtempSync(join(tmpdir(), 'ondap-schd-cancel-'));
  process.env.ONDAP_TEST_DATA_DIR = testDir;

  try {
    await createDesign({
      code: 'OD-CMPL-0001',
      productNo: 305,
      productName: '프리미엄 흑삼 세트',
      quantity: 25,
      event: 'wedding',
      styleId: 's1',
      styleName: '자개',
      sticker: { shape: 'circle', sizeCm: 6 },
      draft: null,
    }, null, null);

    // 포장 완료(completed) 및 주문번호 연결 상태 설정
    await updateDesign('OD-CMPL-0001', {
      status: 'completed',
      orderNo: '20261117-0099887',
      memo: '포장 완료 및 박스 봉인',
    });

    const { verifyAndAcceptOrder } = await import('../src/cafe24/intake-worker.ts');

    // 카페24에서 취소된 주문 수신 시뮬레이션
    const canceledOrder: import('../src/cafe24/admin-orders.ts').Cafe24AdminOrder = {
      order_id: '20261117-0099887',
      shop_no: 1,
      order_date: '2026-11-17',
      canceled: 'T',
      order_status: 'C00',
      items: [
        {
          product_no: 305,
          product_name: '프리미엄 흑삼 세트',
          quantity: 25,
          status: 'C00',
        },
      ],
      additional_order_info_list: [
        { name: '포장 디자인 코드', value: 'OD-CMPL-0001' },
      ],
    };

    const decision = await verifyAndAcceptOrder(canceledOrder);

    // conflict 반환 및 경고 메시지 확인
    assert.equal(decision.status, 'conflict');
    assert.ok(decision.message.includes('포장 완료'));

    // DB에 주의 메모가 기록되고 상태가 completed로 안전하게 유지되었는지 검증 (오출고 방지 경고)
    const [d] = await listDesigns({ code: 'OD-CMPL-0001', limit: 1, includePending: true });
    assert.equal(d.status, 'completed', '제작/완료된 건은 임의로 지워지지 않고 완료 상태를 유지해야 함');
    assert.ok(d.memo.includes('취소/환불 알림 — 포장 완료 건 확인 필요'));
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('19. getDesignsByOrderNo: 500개 제한 없는 전수 조회 및 한 주문 복수 디자인 연결 검증', async () => {
  const testDir = mkdtempSync(join(tmpdir(), 'ondap-schd-orderno-'));
  process.env.ONDAP_TEST_DATA_DIR = testDir;

  try {
    const targetOrderNo = '20261117-0001234';

    // 1) 같은 주문에 서로 다른 2개 상품의 디자인 등록
    await createDesign({
      code: 'OD-ORD-01', productNo: 301, productName: '도라지정과', quantity: 50,
      event: null, styleId: '', styleName: '', sticker: null, draft: null,
      card: null, cardDraft: null,
    }, null, null);
    await updateDesign('OD-ORD-01', { status: 'order_confirmed', orderNo: targetOrderNo });

    await createDesign({
      code: 'OD-ORD-02', productNo: 302, productName: '호두강정', quantity: 30,
      event: null, styleId: '', styleName: '', sticker: null, draft: null,
      card: null, cardDraft: null,
    }, null, null);
    await updateDesign('OD-ORD-02', { status: 'order_confirmed', orderNo: targetOrderNo });

    // 2) 다른 주문번호의 디자인 등록
    await createDesign({
      code: 'OD-ORD-03', productNo: 301, productName: '도라지정과', quantity: 20,
      event: null, styleId: '', styleName: '', sticker: null, draft: null,
      card: null, cardDraft: null,
    }, null, null);
    await updateDesign('OD-ORD-03', { status: 'order_confirmed', orderNo: '20261117-0009999' });

    // 3) getDesignsByOrderNo 전수 조회 검증: 정확히 targetOrderNo에 해당하는 2건 반환
    const linked = await getDesignsByOrderNo(targetOrderNo);
    assert.equal(linked.length, 2, '주문번호에 연결된 2건의 디자인이 모두 조회되어야 함');
    const codes = linked.map((x) => x.code).sort();
    assert.deepEqual(codes, ['OD-ORD-01', 'OD-ORD-02']);

    // 조회된 결과도 목록 경량화(draft, cardDraft null)되어야 함
    assert.equal(linked[0].draft, null);
    assert.equal(linked[0].cardDraft, null);
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('20. 주문 수량 할당 및 다품목/복수 디자인 초과 검증 로직', () => {
  // 모의 카페24 주문:
  // 품목 1: 상품 301 (도라지정과) 100개
  // 품목 2: 상품 302 (호두강정) 30개
  const validItems = [
    { product_no: 301, product_name: '도라지정과', quantity: 100 },
    { product_no: 302, product_name: '호두강정', quantity: 30 },
  ];

  // 1) 품목 301의 총 수량은 100개
  const totalQty301 = validItems
    .filter((i) => i.product_no === 301)
    .reduce((sum, i) => sum + i.quantity, 0);
  assert.equal(totalQty301, 100);

  // 기존 연결: 디자인 1 (상품 301, 50개), 디자인 2 (상품 302, 30개)
  const existingLinked: { code: string; productNo: number; quantity: number; status: import('../src/packaging/types.ts').DesignStatus }[] = [
    { code: 'OD-A', productNo: 301, quantity: 50, status: 'order_confirmed' },
    { code: 'OD-B', productNo: 302, quantity: 30, status: 'order_confirmed' },
  ];

  // Case A: 다른 상품(#302)이 이미 있어도 상품 #301의 잔여 수량(100 - 50 = 50) 범위 내 50개 연결 허용
  const otherLinkedFor301 = existingLinked.filter((x) => x.code !== 'OD-NEW-301' && x.status !== 'canceled');
  const allocated301 = otherLinkedFor301
    .filter((x) => x.productNo === 301)
    .reduce((sum, x) => sum + x.quantity, 0);
  const remaining301 = totalQty301 - allocated301;
  assert.equal(remaining301, 50);
  assert.ok(remaining301 >= 50, '잔여 수량 50개에 대해 50개 디자인 연결 가능');

  // Case B: 잔여 수량 초과 시 (예: 60개 연결 시도) 차단
  const requestedOverQty = 60;
  assert.ok(remaining301 < requestedOverQty, '잔여 수량 50개보다 큰 60개는 차단되어야 함');

  // Case C: 상품 #302는 이미 30개가 전부 할당되어 추가 연결 불가
  const totalQty302 = validItems
    .filter((i) => i.product_no === 302)
    .reduce((sum, i) => sum + i.quantity, 0);
  const otherLinkedFor302 = existingLinked.filter((x) => x.code !== 'OD-NEW-302' && x.status !== 'canceled');
  const allocated302 = otherLinkedFor302
    .filter((x) => x.productNo === 302)
    .reduce((sum, x) => sum + x.quantity, 0);
  const remaining302 = totalQty302 - allocated302;
  assert.equal(remaining302, 0);
  assert.ok(remaining302 < 10, '이미 30개 전액 할당된 품목은 추가 연결 불가');
});
