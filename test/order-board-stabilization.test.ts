import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  mergeDesignsAndOrders,
  type MergedBoardItem,
} from '../src/packaging/order-board-merge.ts';
import {
  listDesigns,
  getDesign,
  updateDesign,
} from '../src/data/packaging-repository.ts';
import {
  confirmResumeAction,
  confirmCancelAction,
} from '../src/app/admin/packaging/actions.ts';
import {
  fetchRecentCafe24OrdersReadOnly,
} from '../src/cafe24/readonly-orders.ts';
import {
  handleCanceledItem,
  handleCanceledOrder,
  markAmbiguousPartialCancel,
} from '../src/cafe24/intake-worker.ts';
import { calculateScheduleStatus } from '../src/packaging/schedule.ts';
import { saveStoredToken } from '../src/cafe24/oauth.ts';
import type { Design } from '../src/packaging/types.ts';
import type { Cafe24AdminOrder } from '../src/cafe24/admin-orders.ts';

function createMockDesign(overrides: Partial<Design> = {}): Design {
  const code = overrides.code || `OD-TEST-2233`;
  return {
    code,
    createdAt: new Date().toISOString(),
    productNo: 101,
    productName: '도라지정과 세트',
    quantity: 10,
    event: 'wedding',
    styleId: 'pkg-luxury',
    styleName: '단아한 한지 포장',
    sticker: null,
    card: null,
    status: 'received',
    statusChangedAt: new Date().toISOString(),
    orderNo: null,
    memo: '',
    sourceCode: null,
    hasPrintFile: false,
    hasCardPrintFile: false,
    printCode: null,
    eventDate: null,
    desiredDeliveryDate: null,
    cafe24Canceled: false,
    draft: null,
    cardDraft: null,
    ...overrides,
  };
}

function setupTestEnv() {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ondap-stab-'));
  const origDataDir = process.env.ONDAP_TEST_DATA_DIR;
  const origDataSource = process.env.ONDAP_DATA_SOURCE;
  const origAllowLocalAdmin = process.env.ONDAP_ALLOW_LOCAL_ADMIN;

  process.env.ONDAP_TEST_DATA_DIR = testDir;
  process.env.ONDAP_DATA_SOURCE = 'local';
  process.env.ONDAP_ALLOW_LOCAL_ADMIN = '1';

  const writeDesigns = (designs: Design[]) => {
    fs.writeFileSync(path.join(testDir, 'designs.json'), JSON.stringify(designs, null, 2));
  };

  const cleanup = () => {
    if (origDataDir !== undefined) process.env.ONDAP_TEST_DATA_DIR = origDataDir;
    else delete process.env.ONDAP_TEST_DATA_DIR;

    if (origDataSource !== undefined) process.env.ONDAP_DATA_SOURCE = origDataSource;
    else delete process.env.ONDAP_DATA_SOURCE;

    if (origAllowLocalAdmin !== undefined) process.env.ONDAP_ALLOW_LOCAL_ADMIN = origAllowLocalAdmin;
    else delete process.env.ONDAP_ALLOW_LOCAL_ADMIN;

    fs.rmSync(testDir, { recursive: true, force: true });
  };

  return { testDir, writeDesigns, cleanup };
}

// ----------------------------------------------------------------------
// 1. 같은 주문의 여러 디자인 중 일부만 접수되거나 연결된 경우
// ----------------------------------------------------------------------
test('필수 검증 1: 같은 주문의 여러 디자인 중 일부만 접수된 경우 미연결 코드 보존 및 확인 필요 유지', () => {
  const codeA = 'OD-MULT-2233';
  const codeB = 'OD-MULT-4455';
  const orderId = '20261118-0000001';

  // 주문서에는 디자인 코드 2개가 기재되어 있음
  const order: Cafe24AdminOrder = {
    order_id: orderId,
    order_date: '2026-11-18T09:00:00+09:00',
    shop_no: 1,
    order_status: 'N20',
    payment_status: 'P',
    items: [
      {
        item_no: 1,
        product_no: 101,
        product_name: '답례떡 10개 세트',
        quantity: 10,
        options: [{ name: '포장선택', value: `선물포장 (디자인: ${codeA})` }],
      },
      {
        item_no: 2,
        product_no: 102,
        product_name: '호두정과 10개 세트',
        quantity: 10,
        options: [{ name: '포장선택', value: `선물포장 (디자인: ${codeB})` }],
      },
    ],
  };

  // codeA만 접수되어 있고 codeB는 아직 고객이 미접수한 상황
  const designA = createMockDesign({ code: codeA, orderNo: orderId, productNo: 101, quantity: 10 });
  const merged = mergeDesignsAndOrders([designA], [order]);

  // 접수된 designA는 linked_design으로 노출
  const linked = merged.find((m) => m.kind === 'linked_design' && m.code === codeA);
  assert.ok(linked, '접수된 designA는 작업판에 linked_design으로 존재해야 함');
  if (linked && linked.kind === 'linked_design') {
    assert.equal(linked.matchedOrder?.orderId, orderId);
  }

  // 아직 접수되지 않은 codeB가 포함된 unlinked_order 항목이 별도로 유지되어야 함 (누락 방지)
  const unlinked = merged.find((m) => m.kind === 'unlinked_order');
  assert.ok(unlinked, '미접수 디자인 코드가 있는 주문은 unlinked_order로 유지되어야 함');
  if (unlinked && unlinked.kind === 'unlinked_order') {
    assert.equal(unlinked.order.orderId, orderId);
    assert.ok(unlinked.suggestedCodes.includes(codeB), '추천 코드에 미연결된 codeB가 포함되어야 함');
    assert.match(unlinked.missingReason, /일부 디자인 미접수|OD-MULT-4455/);
  }

  const wrongOrder = createMockDesign({ code: codeB, orderNo: '20261118-0000009', productNo: 102, quantity: 10 });
  const mismatched = mergeDesignsAndOrders([designA, wrongOrder], [order]);
  const stillUnlinked = mismatched.find((m) => m.kind === 'unlinked_order');
  assert.ok(stillUnlinked && stillUnlinked.kind === 'unlinked_order' && stillUnlinked.suggestedCodes.includes(codeB), '다른 주문에 연결된 코드는 이 주문의 미연결 항목에 남아야 함');
});

// ----------------------------------------------------------------------
// 2. 같은 주문의 일부 품목만 취소된 경우
// ----------------------------------------------------------------------
test('필수 검증 2: 같은 주문의 일부 품목만 취소 시 해당 디자인만 취소되고 동일 주문 타 품목은 보존', async () => {
  const env = setupTestEnv();
  try {
    const orderNo = '20261118-0000002';
    const codeA = 'OD-PART-2233';
    const codeB = 'OD-PART-4455';

    // 로컬 저장소에 두 디자인 등록 (동일 주문)
    env.writeDesigns([
      createMockDesign({ code: codeA, orderNo, productNo: 101, status: 'received' }),
      createMockDesign({ code: codeB, orderNo, productNo: 102, status: 'received' }),
    ]);

    const mockOrder: Cafe24AdminOrder = {
      order_id: orderNo,
      order_date: '2026-11-18T09:00:00+09:00',
      shop_no: 1,
      order_status: 'N20',
      payment_status: 'P',
      items: [
        {
          item_no: 1,
          product_no: 101,
          product_name: '상품A',
          quantity: 10,
          options: [{ name: '디자인코드', value: codeA }],
        },
        {
          item_no: 2,
          product_no: 102,
          product_name: '상품B',
          quantity: 10,
          options: [{ name: '디자인코드', value: codeB }],
        },
      ],
    };

    // 품목 A(codeA)만 부분 취소 처리 실행
    const res = await handleCanceledItem(mockOrder, Date.now(), codeA);

    assert.equal(res.status, 'canceled');
    assert.equal(res.code, codeA);

    const updatedA = await getDesign(codeA);
    const updatedB = await getDesign(codeB);

    // 취소된 A는 status: 'canceled', cafe24Canceled: true
    assert.equal(updatedA?.status, 'canceled');
    assert.equal(updatedA?.cafe24Canceled, true);

    // 동일 주문의 B는 취소되지 않고 status: 'received' 유지 (보존)
    assert.equal(updatedB?.status, 'received');
    assert.equal(updatedB?.cafe24Canceled, false);
  } finally {
    env.cleanup();
  }
});

// ----------------------------------------------------------------------
// 3. 취소 대상이 불명확한 상태에서 정상 진행과 취소 확정을 각각 선택하는 경우
// ----------------------------------------------------------------------
test('필수 검증 3: 부분 취소 대상 불명확 시 관리자의 정상 진행(confirmResume) 및 취소 확정(confirmCancel) 분기', async () => {
  const env = setupTestEnv();
  const originalFetch = globalThis.fetch;
  const originalMall = process.env.CAFE24_MALL_ID;
  try {
    const orderNo = '20261118-0000003';
    const codeResume = 'OD-RESU-2233';
    const codeCancel = 'OD-CANC-4455';

    env.writeDesigns([
      createMockDesign({ code: codeResume, orderNo, status: 'printed', memo: '기존메모1' }),
      createMockDesign({ code: codeCancel, orderNo, status: 'received', memo: '기존메모2' }),
    ]);

    const mockOrder: Cafe24AdminOrder = {
      order_id: orderNo,
      order_date: '2026-11-18T09:00:00+09:00',
      shop_no: 1,
      order_status: 'N20',
      payment_status: 'P',
      items: [
        {
          item_no: 1,
          product_no: 101,
          product_name: '세트A',
          quantity: 10,
        },
      ],
    };

    // 부분 취소 발생했으나 코드가 없어 불명확 -> markAmbiguousPartialCancel
    await markAmbiguousPartialCancel(mockOrder, [codeResume, codeCancel]);

    const beforeResume = await getDesign(codeResume);
    const beforeCancel = await getDesign(codeCancel);

    // 둘 다 상태는 유지되고 cafe24Canceled: true (확인 필요) 마킹
    assert.equal(beforeResume?.status, 'printed');
    assert.equal(beforeResume?.cafe24Canceled, true);
    assert.equal(beforeCancel?.status, 'received');
    assert.equal(beforeCancel?.cafe24Canceled, true);

    process.env.CAFE24_MALL_ID = 'testmall';
    await saveStoredToken({ mall_id: 'testmall', shop_no: 1, access_token: 'test', refresh_token: 'test', expires_at: '2099-01-01T00:00:00Z', refresh_token_expires_at: '2099-01-01T00:00:00Z', scope: '' });
    globalThis.fetch = async () => { throw new Error('offline'); };
    const offline = await confirmResumeAction(codeResume, '확인');
    assert.equal(offline.ok, false, '주문 조회 실패 시 취소 경고를 해제하지 않아야 함');
    assert.equal((await getDesign(codeResume))?.cafe24Canceled, true);
    globalThis.fetch = async () => new Response(JSON.stringify({ order: { ...mockOrder, canceled: 'T' } }), { status: 200 });
    assert.equal((await confirmResumeAction(codeResume, '확인')).ok, false, '전체 취소 주문은 정상 진행할 수 없음');
    assert.equal((await getDesign(codeResume))?.cafe24Canceled, true);
    globalThis.fetch = async () => new Response(JSON.stringify({ order: mockOrder }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    // 3-A: 관리자가 주문서 대조 후 정상 건으로 판단 -> confirmResumeAction
    const resumeRes = await confirmResumeAction(codeResume, '고객 확인: 취소 품목 아님');
    assert.ok(resumeRes.ok, '정상 진행 확인 성공');

    const afterResume = await getDesign(codeResume);
    assert.equal(afterResume?.cafe24Canceled, false, 'cafe24Canceled가 false로 해제되어야 함');
    assert.equal(afterResume?.status, 'printed', '기존 제작 상태가 유지되어야 함');
    assert.match(afterResume?.memo || '', /\[관리자 확인: 정상 진행 - 고객 확인: 취소 품목 아님\]/);

    // 3-B: 관리자가 취소 품목임을 확인 -> confirmCancelAction
    const cancelRes = await confirmCancelAction(codeCancel, '주문서 대조: 취소된 상품 맞음');
    assert.ok(cancelRes.ok, '취소 확정 성공');

    const afterCancel = await getDesign(codeCancel);
    assert.equal(afterCancel?.status, 'canceled', '상태가 canceled로 확정되어야 함');
    assert.equal(afterCancel?.cafe24Canceled, true);
    assert.match(afterCancel?.memo || '', /\[관리자 확인: 취소 확정 - 주문서 대조: 취소된 상품 맞음\]/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalMall === undefined) delete process.env.CAFE24_MALL_ID;
    else process.env.CAFE24_MALL_ID = originalMall;
    env.cleanup();
  }
});

// ----------------------------------------------------------------------
// 4. 다른 주문 또는 미연결 디자인이 잘못 변경되지 않는 경우
// ----------------------------------------------------------------------
test('필수 검증 4: 특정 주문 취소 시 다른 주문 및 미연결 접수는 원천 보호', async () => {
  const env = setupTestEnv();
  try {
    const targetOrder = '20261118-0000004';
    const otherOrder = '20261118-0000005';
    const codeTarget = 'OD-TGTT-2233';
    const codeOther = 'OD-OTHR-4455';
    const codeUnlinked = 'OD-UNLK-6677';

    env.writeDesigns([
      createMockDesign({ code: codeTarget, orderNo: targetOrder, status: 'received' }),
      createMockDesign({ code: codeOther, orderNo: otherOrder, status: 'received' }),
      createMockDesign({ code: codeUnlinked, orderNo: null, status: 'received' }),
    ]);

    const mockTargetOrder: Cafe24AdminOrder = {
      order_id: targetOrder,
      order_date: '2026-11-18T09:00:00+09:00',
      shop_no: 1,
      order_status: 'C40',
      payment_status: 'F',
      items: [{ item_no: 1, product_no: 101, product_name: '상품', quantity: 5 }],
    };

    // targetOrder에 대한 전체 취소 실행
    await handleCanceledOrder(mockTargetOrder, Date.now());

    const resTarget = await getDesign(codeTarget);
    const resOther = await getDesign(codeOther);
    const resUnlinked = await getDesign(codeUnlinked);

    // 타깃 주문만 취소됨
    assert.equal(resTarget?.status, 'canceled');
    assert.equal(resTarget?.cafe24Canceled, true);

    // 다른 주문의 디자인은 불변
    assert.equal(resOther?.status, 'received');
    assert.equal(resOther?.cafe24Canceled, false);

    // 미연결 접수(orderNo: null)도 원천 보호되어 불변
    assert.equal(resUnlinked?.status, 'received');
    assert.equal(resUnlinked?.cafe24Canceled, false);
  } finally {
    env.cleanup();
  }
});

// ----------------------------------------------------------------------
// 5. 오래된 미완료 접수가 최근 완료 건들에 밀려 사라지지 않는 경우
// ----------------------------------------------------------------------
test('필수 검증 5: 대량의 최근 완료 건이 있어도 오래된 미완료/확인필요 접수가 누락되지 않음 (preserveIncomplete)', async () => {
  const env = setupTestEnv();
  try {
    const oldIncompleteCode = 'OD-OLDD-2233';
    const oldCheckCode = 'OD-OLDD-4455';

    // 1) 30일 전 오래된 미완료 및 확인필요 접수
    const oldDate = new Date(Date.now() - 30 * 86400000).toISOString();
    const oldDesigns: Design[] = [
      createMockDesign({
        code: oldIncompleteCode,
        createdAt: oldDate,
        status: 'received',
      }),
      createMockDesign({
        code: oldCheckCode,
        createdAt: oldDate,
        status: 'printed',
        cafe24Canceled: true, // 확인 필요
      }),
    ];

    // 2) 최근 완료된 접수 210건을 생성하여 200건 한도를 초과하도록 구성
    const recentCompletedDesigns: Design[] = [];
    for (let i = 0; i < 210; i++) {
      const recentDate = new Date(Date.now() - (i + 1) * 60000).toISOString();
      recentCompletedDesigns.push(
        createMockDesign({
          code: `OD-CMPP-${String(2000 + i)}`,
          createdAt: recentDate,
          status: 'completed',
        }),
      );
    }

    env.writeDesigns([...recentCompletedDesigns, ...oldDesigns]);

    // 3) preserveIncomplete: true 옵션으로 조회
    const list = await listDesigns({ limit: 200, preserveIncomplete: true });

    const foundOldIncomplete = list.find((d) => d.code === oldIncompleteCode);
    const foundOldCheck = list.find((d) => d.code === oldCheckCode);

    assert.ok(foundOldIncomplete, '오래된 미완료 접수가 200건 완료 건에 밀려 누락되지 않아야 함');
    assert.ok(foundOldCheck, '오래된 확인 필요 접수가 200건 완료 건에 밀려 누락되지 않아야 함');
  } finally {
    env.cleanup();
  }
});

// ----------------------------------------------------------------------
// 6. 카페24 조회·취소 반영 중 일부 실패했을 때 관리자에게 실패가 보이는 경우
// ----------------------------------------------------------------------
test('필수 검증 6: 카페24 API 실패 시 친절한 안내와 함께 실패 상태가 관리자에게 노출됨', async () => {
  const origMallId = process.env.CAFE24_MALL_ID;
  process.env.CAFE24_MALL_ID = 'ondap-mock-mall';

  try {
    // 잘못된 커스텀 토큰과 짧은 타임아웃으로 조회하여 실패 유발
    const res = await fetchRecentCafe24OrdersReadOnly({
      days: 7,
      customToken: 'invalid-token-test',
      timeoutMs: 1000,
    });

    assert.equal(res.ok, false);
    assert.ok(res.error, '에러 메시지가 존재해야 함');
    // 개발자 기술용어(403 Forbidden, OAuth 등)가 아닌 이해하기 쉬운 문구여야 함
    assert.doesNotMatch(res.error || '', /403 Forbidden|Bearer|OAuth/i);
    assert.equal(res.checkedDays, 7);
  } finally {
    if (origMallId !== undefined) process.env.CAFE24_MALL_ID = origMallId;
    else delete process.env.CAFE24_MALL_ID;
  }
});

// ----------------------------------------------------------------------
// 7. 취소 확정 건의 인쇄 및 정상 상태 복귀가 차단되는 경우
// ----------------------------------------------------------------------
test('필수 검증 7: 취소 확정된 접수는 정상 진행 복귀 및 인쇄가 영구 차단됨', async () => {
  const env = setupTestEnv();
  try {
    const canceledCode = 'OD-CANC-2233';
    env.writeDesigns([
      createMockDesign({
        code: canceledCode,
        status: 'canceled',
        cafe24Canceled: true,
        hasPrintFile: true,
        printCode: canceledCode,
      }),
    ]);

    // 정상 진행 복귀 시도 -> 차단되어야 함
    const resumeRes = await confirmResumeAction(canceledCode, '복구 시도');
    assert.equal(resumeRes.ok, false);
    assert.match(resumeRes.message || '', /취소 확정된 접수는 정상 진행으로/);

    // 디자인 상태 여전히 canceled
    const design = await getDesign(canceledCode);
    assert.equal(design?.status, 'canceled');
  } finally {
    env.cleanup();
  }
});

// ----------------------------------------------------------------------
// 8. 고객의 행사일·희망 수령일 입력과 관리자 표시가 유지되는 경우
// ----------------------------------------------------------------------
test('필수 검증 8: 고객의 행사일 및 희망 수령일이 저장소에 유지되고 관리자 일정 산출에 반영됨', async () => {
  const env = setupTestEnv();
  try {
    const scheduleCode = 'OD-SCHD-2233';
    const desiredDeliveryDate = '2026-11-20';
    const eventDate = '2026-11-23';

    env.writeDesigns([
      createMockDesign({
        code: scheduleCode,
        desiredDeliveryDate,
        eventDate,
        status: 'received',
      }),
    ]);

    const saved = await getDesign(scheduleCode);
    assert.equal(saved?.desiredDeliveryDate, desiredDeliveryDate);
    assert.equal(saved?.eventDate, eventDate);

    // KST 기준 일정 산출 (2026-11-18 기준 -> D-2 임박)
    const fixedNow = Date.parse('2026-11-18T03:00:00Z');
    const scheduleInfo = calculateScheduleStatus(saved!, fixedNow);

    assert.equal(scheduleInfo.targetType, 'desired');
    assert.equal(scheduleInfo.targetDate, desiredDeliveryDate);
    assert.equal(scheduleInfo.dDay, 2);
    assert.equal(scheduleInfo.urgency, 'imminent');
    assert.match(scheduleInfo.displayDateText, /희망 수령 11\/20/);
  } finally {
    env.cleanup();
  }
});

// ----------------------------------------------------------------------
// 9. 관리자 화면을 PC와 모바일 크기에서 확인하고 문구가 잘리지 않는 경우
// ----------------------------------------------------------------------
test('필수 검증 9: 관리자 작업판 문구 간결화 및 모바일 줄바꿈/여백 CSS 스타일 보존 검증', () => {
  const tsxPath = path.resolve(process.cwd(), 'src/app/admin/packaging/designs-table.tsx');
  const tsxContent = fs.readFileSync(tsxPath, 'utf-8');

  // 모바일 반응형 및 스타일 확인
  assert.ok(tsxContent.includes('.board-kpi-summary'), '상단 요약 바 스타일 존재');
  assert.ok(tsxContent.includes('.schedule-badge'), '일정 배지 스타일 존재');
  assert.ok(tsxContent.includes('@media (max-width: 768px)'), '모바일 미디어 쿼리 스타일 존재');

  // 작업판 tsx 파일에서 금지된 개발자 용어 배제 확인
  assert.doesNotMatch(tsxContent, /5대 불변식/, '5대 불변식 개발 용어가 화면에 노출되지 않아야 함');
  assert.doesNotMatch(tsxContent, /관리자 토큰 만료/, '토큰 등 기술 용어가 화면에 노출되지 않아야 함');
  assert.ok(tsxContent.includes('정상 진행'), '정상 진행 확인 버튼이 존재해야 함');
  assert.ok(tsxContent.includes('취소 확정'), '취소 확정 버튼이 존재해야 함');
});
