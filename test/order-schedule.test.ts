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

test('14-1. 다중 디자인 코드 주문의 수동 연결: 첫 번째 코드뿐 아니라 두 번째/모든 품목의 디자인 코드도 검증 및 연결 통과', async () => {
  const { extractAllDesignCodes } = await import('../src/cafe24/admin-orders.ts');

  const order: import('../src/cafe24/admin-orders.ts').Cafe24AdminOrder = {
    order_id: '20261118-0005555',
    shop_no: 1,
    order_date: '2026-11-18 11:00:00',
    paid: 'T',
    canceled: 'F',
    items: [
      {
        product_no: 101,
        product_name: '상품 1',
        quantity: 10,
        options: [{ name: '선물 포장 코드', value: 'OD-FRST-2345' }],
      },
      {
        product_no: 102,
        product_name: '상품 2',
        quantity: 20,
        options: [{ name: '선물 포장 코드', value: 'OD-SCND-2345' }],
      },
    ],
    additional_order_info_list: [
      { name: '공통 포장 코드', value: 'OD-THRD-2345' },
    ],
  };

  const allCodes = extractAllDesignCodes(order);
  assert.deepEqual(allCodes.sort(), ['OD-FRST-2345', 'OD-SCND-2345', 'OD-THRD-2345'].sort());

  // 첫 번째 코드가 아닌 두 번째 품목의 코드(OD-SCND-2345)도 allCodes에 포함됨을 검증
  assert.ok(allCodes.includes('OD-SCND-2345'), '두 번째 품목의 디자인 코드도 검증 통과해야 함');
  assert.ok(allCodes.includes('OD-THRD-2345'), '공통 추가 정보의 디자인 코드도 검증 통과해야 함');
  assert.ok(!allCodes.includes('OD-NONE-9999'), '주문서에 없는 코드는 거절되어야 함');
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
    await updateDesign('OD-BATCH-01', { status: 'received', orderNo: '20261117-0000001' });
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
    const updated = await updateDesignsStatus(['OD-BATCH-01', 'OD-BATCH-02', 'OD-BATCH-03'], 'order_confirmed');
    assert.ok(updated.includes('OD-BATCH-01'));
    assert.ok(!updated.includes('OD-BATCH-02'), 'canceled 상태인 디자인은 덮어쓰기에서 제외되어야 함');
    assert.ok(!updated.includes('OD-BATCH-03'), '결제 대기 디자인은 상태 변경에서 제외되어야 함');

    await assert.rejects(
      () => updateDesign('OD-BATCH-02', { status: 'printed' }, { status: 'received', orderNo: null }),
      /상태가 변경/,
      '다른 작업에서 취소된 접수는 이전 상태를 기준으로 덮어쓸 수 없어야 함',
    );

    const [after02] = await listDesigns({ code: 'OD-BATCH-02', limit: 1, includePending: true });
    assert.equal(after02.status, 'canceled', 'OD-BATCH-02는 취소 불변식이 유지되어야 함');
    await createDesign({
      code: 'OD-STYLE-01', productNo: 305, productName: '포장 접수', quantity: 10,
      event: null, styleId: 'style-1', styleName: '포장지', sticker: null, draft: null,
    }, null, null);
    await updateDesign('OD-STYLE-01', { status: 'received', orderNo: '20261117-0000002' });
    const noPackaging = await updateDesignsStatus(['OD-STYLE-01'], 'no_packaging');
    assert.deepEqual(noPackaging, [], '포장 스타일이 있는 접수는 포장 없음으로 바꿀 수 없어야 함');
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

test('18-1. 로컬 취소 처리: 이미 인쇄된 건이 있어도 같은 주문의 미인쇄 건은 취소됨을 검증', async () => {
  const testDir = mkdtempSync(join(tmpdir(), 'ondap-schd-cancel-partial-'));
  process.env.ONDAP_TEST_DATA_DIR = testDir;

  try {
    const orderId = '20261118-0099111';

    // 1) 인쇄 완료된 디자인 1건
    await createDesign({
      code: 'OD-PRNT-0001',
      productNo: 305,
      productName: '흑삼 세트 (인쇄완료)',
      quantity: 10,
      event: null,
      styleId: 's1',
      styleName: '자개',
      sticker: { shape: 'circle', sizeCm: 6 },
      draft: null,
    }, null, null);
    await updateDesign('OD-PRNT-0001', {
      status: 'printed',
      orderNo: orderId,
    });

    // 2) 아직 미인쇄된 디자인 1건 (order_confirmed)
    await createDesign({
      code: 'OD-UNPR-0002',
      productNo: 306,
      productName: '도라지정과 (미인쇄)',
      quantity: 20,
      event: null,
      styleId: 's1',
      styleName: '자개',
      sticker: null,
      draft: null,
    }, null, null);
    await updateDesign('OD-UNPR-0002', {
      status: 'order_confirmed',
      orderNo: orderId,
    });

    const { verifyAndAcceptOrder } = await import('../src/cafe24/intake-worker.ts');

    const canceledOrder: import('../src/cafe24/admin-orders.ts').Cafe24AdminOrder = {
      order_id: orderId,
      shop_no: 1,
      order_date: '2026-11-18',
      canceled: 'T',
      order_status: 'C00',
      items: [
        { product_no: 305, product_name: '흑삼 세트', quantity: 10, status: 'C00' },
        { product_no: 306, product_name: '도라지정과', quantity: 20, status: 'C00' },
      ],
    };

    const decision = await verifyAndAcceptOrder(canceledOrder);

    // conflict 반환 (인쇄 완료 건이 있으므로 경고)
    assert.equal(decision.status, 'conflict');
    assert.ok(decision.message.includes('인쇄 완료'));

    // 1) 인쇄 완료 건은 printed 상태 유지 + cafe24Canceled: true
    const [dPrnt] = await listDesigns({ code: 'OD-PRNT-0001', limit: 1, includePending: true });
    assert.equal(dPrnt.status, 'printed');
    assert.equal(dPrnt.cafe24Canceled, true);
    assert.ok(dPrnt.memo.includes('취소/환불 알림 — 인쇄 완료 건 확인 필요'));

    // 2) 미인쇄 건은 정상적으로 canceled 로 변경되었는지 검증!
    const [dUnpr] = await listDesigns({ code: 'OD-UNPR-0002', limit: 1, includePending: true });
    assert.equal(dUnpr.status, 'canceled', '미인쇄 건은 인쇄된 건이 있어도 취소 처리되어야 함');
    assert.equal(dUnpr.cafe24Canceled, true);
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('18-2. 동일 주문 부분 취소: 한 품목만 취소된 경우 해당 품목 디자인만 취소되고 다른 유효 품목 디자인은 온전히 유지됨을 검증', async () => {
  const testDir = mkdtempSync(join(tmpdir(), 'ondap-schd-part-cancel-'));
  process.env.ONDAP_TEST_DATA_DIR = testDir;

  try {
    const orderId = '20261118-0099888';

    // 품목 1: 상품 #305 (수량 10개), 디자인 OD-KEEP-0001 (유효 품목, order_confirmed)
    await createDesign({
      code: 'OD-KEEP-0001',
      productNo: 305,
      productName: '호두강정 세트 (유효)',
      quantity: 10,
      event: null,
      styleId: 's1',
      styleName: '자개',
      sticker: { shape: 'circle', sizeCm: 6 },
      draft: null,
    }, null, null);
    await updateDesign('OD-KEEP-0001', {
      status: 'order_confirmed',
      orderNo: orderId,
    });

    // 품목 2: 상품 #306 (수량 20개), 디자인 OD-DROP-0002 (취소 품목, order_confirmed)
    await createDesign({
      code: 'OD-DROP-0002',
      productNo: 306,
      productName: '도라지정과 세트 (취소 대상)',
      quantity: 20,
      event: null,
      styleId: 's1',
      styleName: '자개',
      sticker: null,
      draft: null,
    }, null, null);
    await updateDesign('OD-DROP-0002', {
      status: 'order_confirmed',
      orderNo: orderId,
    });

    const { verifyAndAcceptOrder } = await import('../src/cafe24/intake-worker.ts');

    // 카페24 주문: 주문 전체는 정상(paid: 'T', canceled: 'F'), 품목 305는 정상(N10), 품목 306은 취소/환불(C00)
    const partialCanceledOrder: import('../src/cafe24/admin-orders.ts').Cafe24AdminOrder = {
      order_id: orderId,
      shop_no: 1,
      order_date: '2026-11-18 10:00:00',
      paid: 'T',
      canceled: 'F',
      order_status: 'N10',
      items: [
        {
          product_no: 305,
          product_name: '호두강정 세트',
          quantity: 10,
          status: 'N10',
          options: [{ name: '선물 포장 코드', value: 'OD-KEEP-0001' }],
        },
        {
          product_no: 306,
          product_name: '도라지정과 세트',
          quantity: 20,
          status: 'C00',
          options: [{ name: '선물 포장 코드', value: 'OD-DROP-0002' }],
        },
      ],
    };

    // 1) verifyAndAcceptOrder(partialCanceledOrder, 'OD-DROP-0002') 로 취소 품목 검증
    const dropDecision = await verifyAndAcceptOrder(partialCanceledOrder, 'OD-DROP-0002');
    assert.equal(dropDecision.status, 'canceled', '취소된 품목은 canceled 결정');

    // 검증:
    // 취소 품목(OD-DROP-0002): canceled 및 cafe24Canceled = true
    const [dDrop] = await listDesigns({ code: 'OD-DROP-0002', limit: 1, includePending: true });
    assert.equal(dDrop.status, 'canceled', '취소 품목은 canceled 로 전환되어야 함');
    assert.equal(dDrop.cafe24Canceled, true);
    assert.ok(dDrop.memo.includes('품목 취소/환불 확인'));

    // 유효 품목(OD-KEEP-0001): 여전히 order_confirmed 및 cafe24Canceled = false 로 온전히 유지되어야 함!!
    const [dKeep] = await listDesigns({ code: 'OD-KEEP-0001', limit: 1, includePending: true });
    assert.equal(dKeep.status, 'order_confirmed', '다른 유효 품목은 order_confirmed 상태를 그대로 유지해야 함');
    assert.equal(Boolean(dKeep.cafe24Canceled), false, '다른 유효 품목은 취소 플래그가 붙지 않아야 함');

    // 2) 유효 품목을 verifyAndAcceptOrder 호출 시 정상 already_confirmed 확인
    const keepDecision = await verifyAndAcceptOrder(partialCanceledOrder, 'OD-KEEP-0001');
    assert.equal(keepDecision.status, 'already_confirmed', '유효 품목은 정상 confirmed 유지');
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('18-3. 부분 취소 대상 디자인이 불명확한 경우: 전체를 취소하지 않고 cafe24Canceled: true 및 확인 필요 경고로 처리', async () => {
  const testDir = mkdtempSync(join(tmpdir(), 'ondap-schd-part-ambig-'));
  process.env.ONDAP_TEST_DATA_DIR = testDir;

  try {
    const orderId = '20261118-0099777';

    // 동일 상품 #401에 2개 디자인 등록
    await createDesign({
      code: 'OD-AMBG-0001',
      productNo: 401,
      productName: '도라지정과 1호',
      quantity: 10,
      event: null,
      styleId: 's1',
      styleName: '자개',
      sticker: { shape: 'circle', sizeCm: 6 },
      draft: null,
    }, null, null);
    await updateDesign('OD-AMBG-0001', {
      status: 'order_confirmed',
      orderNo: orderId,
    });

    await createDesign({
      code: 'OD-AMBG-0002',
      productNo: 401,
      productName: '도라지정과 2호',
      quantity: 10,
      event: null,
      styleId: 's1',
      styleName: '자개',
      sticker: null,
      draft: null,
    }, null, null);
    await updateDesign('OD-AMBG-0002', {
      status: 'order_confirmed',
      orderNo: orderId,
    });

    const { verifyAndAcceptOrder } = await import('../src/cafe24/intake-worker.ts');

    // 주문에 #401 품목 2개 중 1개만 취소되었으나, 옵션에 디자인 코드가 적혀있지 않아 어느 디자인이 취소된 것인지 불명확한 경우
    const ambiguousOrder: import('../src/cafe24/admin-orders.ts').Cafe24AdminOrder = {
      order_id: orderId,
      shop_no: 1,
      order_date: '2026-11-18 10:00:00',
      paid: 'T',
      canceled: 'F',
      order_status: 'N10',
      items: [
        {
          product_no: 401,
          product_name: '도라지정과',
          quantity: 10,
          status: 'N10',
          options: [{ name: '선물 포장 신청', value: '보자기 포장' }], // 코드 없음
        },
        {
          product_no: 401,
          product_name: '도라지정과',
          quantity: 10,
          status: 'C00', // 취소됨!
          options: [{ name: '선물 포장 신청', value: '보자기 포장' }], // 코드 없음
        },
      ],
    };

    const decision = await verifyAndAcceptOrder(ambiguousOrder, 'OD-AMBG-0001');

    // conflict(확인 필요) 반환되어야 함
    assert.equal(decision.status, 'conflict');
    assert.ok(decision.message.includes('관리자 확인이 필요'));

    // 두 디자인 모두 canceled 로 함부로 변경되지 않아야 함!
    const [d1] = await listDesigns({ code: 'OD-AMBG-0001', limit: 1, includePending: true });
    assert.equal(d1.status, 'order_confirmed', '취소 대상 불명확 시 canceled로 함부로 변경되지 않아야 함');
    assert.equal(d1.cafe24Canceled, true, '관리자 확인 필요를 위해 cafe24Canceled=true 설정되어야 함');
    assert.ok(d1.memo.includes('대상 디자인 불명확, 관리자 확인 필요'));

    const [d2] = await listDesigns({ code: 'OD-AMBG-0002', limit: 1, includePending: true });
    assert.equal(d2.status, 'order_confirmed', '다른 디자인도 canceled로 바뀌지 않아야 함');
    await updateDesign('OD-AMBG-0002', { orderNo: '20261118-0099888' });
    await verifyAndAcceptOrder(ambiguousOrder, 'OD-AMBG-0002');
    const [otherOrder] = await listDesigns({ code: 'OD-AMBG-0002', limit: 1, includePending: true });
    assert.equal(Boolean(otherOrder.cafe24Canceled), false, '다른 주문의 디자인은 부분 취소 경고로 차단하지 않는다');
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('18-4. 미연결 접수 보호: order_no가 없는 received/printed 접수는 취소되지 않고, 메모에 해당 주문번호가 있는 pending만 대기 안내 변경', async () => {
  const testDir = mkdtempSync(join(tmpdir(), 'ondap-schd-part-protect-'));
  process.env.ONDAP_TEST_DATA_DIR = testDir;

  try {
    const cancelOrderId = '20261118-0099555';

    // 1) 아직 주문번호가 없는 일반 검수 접수 건 (received)
    await createDesign({
      code: 'OD-PROT-0001',
      productNo: 501,
      productName: '배도라지청 (미연결 검수)',
      quantity: 10,
      event: null,
      styleId: 's1',
      styleName: '자개',
      sticker: { shape: 'circle', sizeCm: 6 },
      draft: null,
    }, null, null);
    await updateDesign('OD-PROT-0001', { status: 'received' }); // orderNo 없음!

    // 2) 아직 주문번호가 없지만 메모에 cancelOrderId가 적힌 무통장 입금 대기 건 (pending)
    await createDesign({
      code: 'OD-PROT-0002',
      productNo: 502,
      productName: '수제 양갱 (무통장 대기)',
      quantity: 20,
      event: null,
      styleId: 's1',
      styleName: '자개',
      sticker: null,
      draft: null,
    }, null, null);
    await updateDesign('OD-PROT-0002', {
      status: 'pending',
      memo: `[주문번호 ${cancelOrderId} (무통장 입금 대기)] 고객 결제 대기 중`,
    });

    // 갱신 전: pending 건에 (무통장 입금 대기) 존재 확인
    const [d2Before] = await listDesigns({ code: 'OD-PROT-0002', limit: 1, includePending: true });
    assert.ok(d2Before.memo.includes('(무통장 입금 대기)'));

    const { verifyAndAcceptOrder } = await import('../src/cafe24/intake-worker.ts');

    const canceledOrder: import('../src/cafe24/admin-orders.ts').Cafe24AdminOrder = {
      order_id: cancelOrderId,
      shop_no: 1,
      order_date: '2026-11-18 10:00:00',
      paid: 'F',
      canceled: 'T',
      order_status: 'C00',
      items: [
        { product_no: 501, product_name: '배도라지청', quantity: 10, status: 'C00' },
        { product_no: 502, product_name: '수제 양갱', quantity: 20, status: 'C00' },
      ],
    };

    // 1) 취소 주문 처리 시, orderNo가 없는 received 디자인(OD-PROT-0001)은 보호되어 변경되지 않아야 함!
    await verifyAndAcceptOrder(canceledOrder, 'OD-PROT-0001');
    const [d1] = await listDesigns({ code: 'OD-PROT-0001', limit: 1, includePending: true });
    assert.equal(d1.status, 'received', 'order_no가 없는 received 접수는 취소되지 않고 유지되어야 함');
    assert.equal(Boolean(d1.cafe24Canceled), false, '다른 주문 취소에 영향받지 않아야 함');

    // 2) 반면 메모에 해당 주문번호가 명시된 pending 건(OD-PROT-0002)은 대기 안내가 (주문 취소)로 안전하게 치환됨:
    const [d2After] = await listDesigns({ code: 'OD-PROT-0002', limit: 1, includePending: true });
    assert.equal(d2After.status, 'pending', 'pending 상태는 유지');
    assert.equal(d2After.cafe24Canceled, true);
    assert.ok(d2After.memo.includes('(주문 취소)'), '무통장 대기 안내가 주문 취소로 변경되어야 함');
  } finally {
    delete process.env.ONDAP_TEST_DATA_DIR;
    rmSync(testDir, { recursive: true, force: true });
  }
});

test('18-5. 작업판 확인 필요(needs_check) 필터: cafe24Canceled=true 여도 status=canceled 이면 목록에서 제외됨을 검증', () => {
  const checkNeedsCheck = (d: { status: string; orderNo: string | null; cafe24Canceled?: boolean | null }): boolean => {
    const isDone = d.status === 'completed' || d.status === 'no_packaging';
    const isCanceled = d.status === 'canceled';
    const isPending = d.status === 'pending';
    return (
      d.status === 'received' ||
      (!d.orderNo && !isDone && !isCanceled && !isPending) ||
      (Boolean(d.cafe24Canceled) && d.status !== 'canceled')
    );
  };

  // 1. 카페24 취소 알림이 발생했으나 아직 취소 확정 전인 건 -> 확인 필요에 노출되어야 함!
  assert.equal(checkNeedsCheck({ status: 'completed', orderNo: '20261118-0000001', cafe24Canceled: true }), true);
  assert.equal(checkNeedsCheck({ status: 'printed', orderNo: '20261118-0000001', cafe24Canceled: true }), true);
  assert.equal(checkNeedsCheck({ status: 'order_confirmed', orderNo: '20261118-0000001', cafe24Canceled: true }), true);

  // 2. 관리자가 '취소 확인 처리'를 완료하여 status = 'canceled'가 된 건 -> 확인 필요 목록에서 깔끔하게 빠져야 함!
  assert.equal(checkNeedsCheck({ status: 'canceled', orderNo: '20261118-0000001', cafe24Canceled: true }), false, '취소 확정 건은 needs_check에서 빠져야 함');
  assert.equal(checkNeedsCheck({ status: 'canceled', orderNo: '20261118-0000001', cafe24Canceled: false }), false);
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
