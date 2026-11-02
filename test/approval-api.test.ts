import './fixtures/approval-data.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { POST as createDraftRoute } from '../src/app/api/approval/route.ts';
import {
  GET as getDraftRoute,
  PATCH as patchDraftRoute,
  DELETE as deleteDraftRoute,
} from '../src/app/api/approval/[id]/route.ts';
import { GET as getDocxRoute } from '../src/app/api/approval/[id]/docx/route.ts';
import { GET as getPdfRoute } from '../src/app/api/approval/[id]/pdf/route.ts';
import { GET as getHwpxRoute } from '../src/app/api/approval/[id]/hwpx/route.ts';
import { deleteDraft } from '../src/data/approval-repository.ts';

let createdId = '';
let createdToken = '';

before(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
  process.env.ONDAP_DATA_SOURCE = 'local';
  delete process.env.ENABLE_APPROVAL_DOCS;
});

after(async () => {
  if (createdId) {
    await deleteDraft(createdId).catch(() => {});
  }
});

test('API 보안: development가 아니거나 supabase 모드이면 기본 404 차단', async () => {
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  const req = new Request('http://127.0.0.1:3000/api/approval', {
    method: 'POST',
    body: JSON.stringify({ query: { event: 'wedding', relation: 'senior' } }),
  });
  const res = await createDraftRoute(req);
  assert.equal(res.status, 404);
  (process.env as Record<string, string | undefined>).NODE_ENV = 'development';

  process.env.ONDAP_DATA_SOURCE = 'supabase';
  const res2 = await createDraftRoute(req);
  assert.equal(res2.status, 404);
  process.env.ONDAP_DATA_SOURCE = 'local';
});

test('API 보안: ENABLE_APPROVAL_DOCS=true이면 프로덕션에서도 안전하게 활성화', async () => {
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  process.env.ENABLE_APPROVAL_DOCS = 'true';
  const req = new Request('http://127.0.0.1:3000/api/approval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3000' },
    body: JSON.stringify({ query: { event: 'wedding', relation: 'senior', qty: 10 } }),
  });
  const res = await createDraftRoute(req);
  // 활성화되어 404가 아님 (200 OK)
  assert.equal(res.status, 200);
  const data = await res.json();
  await deleteDraft(data.id).catch(() => {});

  (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
  delete process.env.ENABLE_APPROVAL_DOCS;
});

test('API 보안: 외부 Origin 요청 시 403 차단', async () => {
  const req = new Request('http://127.0.0.1:3000/api/approval', {
    method: 'POST',
    headers: {
      Origin: 'https://malicious-site.com',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: { event: 'wedding', relation: 'senior' } }),
  });
  const res = await createDraftRoute(req);
  assert.equal(res.status, 403);
});

test('POST /api/approval: 정상 초안 생성, 새 추천 결과 및 사본 고정, 기대값 변경 감지', async () => {
  // 1. 가격 불일치 시 409 Conflict
  const conflictReq = new Request('http://127.0.0.1:3000/api/approval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3000' },
    body: JSON.stringify({
      query: { event: 'wedding', relation: 'senior', budget: 50000, qty: 10, exclude: [] },
      expectedCandidates: [{ productNo: 999999, price: 1000 }], // 일치하지 않는 기대값
    }),
  });
  const conflictRes = await createDraftRoute(conflictReq);
  assert.equal(conflictRes.status, 409);
  const conflictJson = await conflictRes.json();
  assert.equal(conflictJson.error, 'catalog_changed');

  // 2. 정상 생성
  const validReq = new Request('http://127.0.0.1:3000/api/approval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3000' },
    body: JSON.stringify({
      query: { event: 'wedding', relation: 'senior', budget: 50000, qty: 10, exclude: [] },
    }),
  });
  const res = await createDraftRoute(validReq);
  assert.equal(res.status, 200);

  // Set-Cookie 헤더 확인
  const cookieHeader = res.headers.get('set-cookie');
  assert.ok(cookieHeader);

  const json = await res.json();
  assert.ok(json.id);
  assert.ok(json.token);
  assert.ok(cookieHeader.includes(`ondap_approval_${json.id}`));
  assert.equal(json.draft.revision, 1);
  assert.equal(json.draft.source.modelVersion, 'core-contract-v1');
  assert.ok(json.draft.source.candidates.length > 0);

  // 후보 사본에 R(희소값)과 S(추천점수)가 구분 보관되었는지 확인
  const cand0 = json.draft.source.candidates[0];
  assert.equal(typeof cand0.recommendationScore, 'number');
  assert.equal(typeof cand0.rarityValue, 'number');
  assert.equal(cand0.model, 'core-contract-v1');
  assert.ok(json.model.selectedReason.includes(cand0.recommendationScore.toFixed(1)));

  createdId = json.id;
  createdToken = json.token;
});

test('접근 보호: 토큰 없는 익명 요청 및 잘못된 토큰 403 차단', async () => {
  // 1. 토큰 없이 GET -> 403 Forbidden
  const noTokenReq = new Request(`http://127.0.0.1:3000/api/approval/${createdId}`, {
    headers: { Origin: 'http://127.0.0.1:3000' },
  });
  const noTokenRes = await getDraftRoute(noTokenReq, { params: Promise.resolve({ id: createdId }) });
  assert.equal(noTokenRes.status, 403);
  const noTokenJson = await noTokenRes.json();
  assert.equal(noTokenJson.error, 'forbidden');

  // 2. 잘못된 토큰으로 GET -> 403 Forbidden
  const wrongTokenReq = new Request(`http://127.0.0.1:3000/api/approval/${createdId}`, {
    headers: { Origin: 'http://127.0.0.1:3000', 'X-Approval-Token': 'wrong-token-abc' },
  });
  const wrongTokenRes = await getDraftRoute(wrongTokenReq, { params: Promise.resolve({ id: createdId }) });
  assert.equal(wrongTokenRes.status, 403);

  // 3. 토큰 없이 PATCH -> 403 Forbidden
  const noTokenPatch = new Request(`http://127.0.0.1:3000/api/approval/${createdId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3000' },
    body: JSON.stringify({ patch: { quantity: 15 }, expectedRevision: 1 }),
  });
  const noTokenPatchRes = await patchDraftRoute(noTokenPatch, { params: Promise.resolve({ id: createdId }) });
  assert.equal(noTokenPatchRes.status, 403);

  // 4. 토큰 없이 다운로드 (DOCX/PDF/HWPX) -> 403 Forbidden
  const noTokenDocx = new Request(`http://127.0.0.1:3000/api/approval/${createdId}/docx`, {
    headers: { Origin: 'http://127.0.0.1:3000' },
  });
  const noTokenDocxRes = await getDocxRoute(noTokenDocx, { params: Promise.resolve({ id: createdId }) });
  assert.equal(noTokenDocxRes.status, 403);

  // 5. 토큰 없이 DELETE -> 403 Forbidden
  const noTokenDel = new Request(`http://127.0.0.1:3000/api/approval/${createdId}`, {
    method: 'DELETE',
    headers: { Origin: 'http://127.0.0.1:3000' },
  });
  const noTokenDelRes = await deleteDraftRoute(noTokenDel, { params: Promise.resolve({ id: createdId }) });
  assert.equal(noTokenDelRes.status, 403);
});

test('GET /api/approval/[id]: 올바른 토큰(Cookie 및 X-Approval-Token 헤더)으로 정상 조회', async () => {
  // 1. Cookie를 통한 조회
  const cookieReq = new Request(`http://127.0.0.1:3000/api/approval/${createdId}`, {
    headers: {
      Origin: 'http://127.0.0.1:3000',
      Cookie: `ondap_approval_${createdId}=${createdToken}`,
    },
  });
  const cookieRes = await getDraftRoute(cookieReq, { params: Promise.resolve({ id: createdId }) });
  assert.equal(cookieRes.status, 200);
  const data = await cookieRes.json();
  assert.equal(data.draft.id, createdId);
  assert.ok(data.model.summaryClipboardText);

  // 2. X-Approval-Token 헤더를 통한 조회
  const headerReq = new Request(`http://127.0.0.1:3000/api/approval/${createdId}`, {
    headers: {
      Origin: 'http://127.0.0.1:3000',
      'X-Approval-Token': createdToken,
    },
  });
  const headerRes = await getDraftRoute(headerReq, { params: Promise.resolve({ id: createdId }) });
  assert.equal(headerRes.status, 200);
});

test('PATCH /api/approval/[id]: 입력 검증 및 개정 충돌 처리', async () => {
  // 1. 잘못된 수량 (소수, 음수) 거부
  const invalidQtyReq = new Request(`http://127.0.0.1:3000/api/approval/${createdId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:3000',
      'X-Approval-Token': createdToken,
    },
    body: JSON.stringify({
      patch: { quantity: 15.5 },
      expectedRevision: 1,
    }),
  });
  const invRes = await patchDraftRoute(invalidQtyReq, { params: Promise.resolve({ id: createdId }) });
  assert.equal(invRes.status, 400);

  // 2. 정상 수정 (r1 -> r2)
  const validPatchReq = new Request(`http://127.0.0.1:3000/api/approval/${createdId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:3000',
      'X-Approval-Token': createdToken,
    },
    body: JSON.stringify({
      patch: {
        eventName: '수정된 결혼식 답례품',
        quantity: 20,
      },
      expectedRevision: 1,
    }),
  });
  const patchRes = await patchDraftRoute(validPatchReq, { params: Promise.resolve({ id: createdId }) });
  assert.equal(patchRes.status, 200);
  const patchData = await patchRes.json();
  assert.equal(patchData.draft.revision, 2);
  assert.equal(patchData.draft.editable.eventName, '수정된 결혼식 답례품');
  assert.equal(patchData.draft.editable.quantity, 20);

  // 3. 개정 충돌 검증 (expectedRevision: 1 제출 -> 현재 r2이므로 409 반환)
  const conflictReq = new Request(`http://127.0.0.1:3000/api/approval/${createdId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:3000',
      'X-Approval-Token': createdToken,
    },
    body: JSON.stringify({
      patch: { eventName: '동시 수정 시도' },
      expectedRevision: 1,
    }),
  });
  const conflictRes = await patchDraftRoute(conflictReq, { params: Promise.resolve({ id: createdId }) });
  assert.equal(conflictRes.status, 409);
  const conflictData = await conflictRes.json();
  assert.equal(conflictData.error, 'revision_conflict');
  assert.equal(conflictData.currentRevision, 2);
});

test('GET /api/approval/[id]/docx & pdf & hwpx: 실제 파일 다운로드', async () => {
  const authHeaders = {
    Origin: 'http://127.0.0.1:3000',
    'X-Approval-Token': createdToken,
  };

  // HWPX
  const hwpxReq = new Request(`http://127.0.0.1:3000/api/approval/${createdId}/hwpx`, {
    headers: authHeaders,
  });
  const hwpxRes = await getHwpxRoute(hwpxReq, { params: Promise.resolve({ id: createdId }) });
  assert.equal(hwpxRes.status, 200);
  assert.equal(hwpxRes.headers.get('Content-Type'), 'application/hwp+zip');
  assert.match(decodeURIComponent(hwpxRes.headers.get('Content-Disposition') || ''), /답례품_선정검토서.*\.hwpx/);

  // DOCX
  const docxReq = new Request(`http://127.0.0.1:3000/api/approval/${createdId}/docx`, {
    headers: authHeaders,
  });
  const docxRes = await getDocxRoute(docxReq, { params: Promise.resolve({ id: createdId }) });
  assert.equal(docxRes.status, 200);
  assert.equal(docxRes.headers.get('Content-Type'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.match(decodeURIComponent(docxRes.headers.get('Content-Disposition') || ''), /답례품_선정검토서/);

  // PDF
  const pdfReq = new Request(`http://127.0.0.1:3000/api/approval/${createdId}/pdf`, {
    headers: authHeaders,
  });
  const pdfRes = await getPdfRoute(pdfReq, { params: Promise.resolve({ id: createdId }) });
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers.get('Content-Type'), 'application/pdf');
  assert.match(decodeURIComponent(pdfRes.headers.get('Content-Disposition') || ''), /답례품_선정검토서/);
});

test('전체 예산 500,001원 / 10개 조건, 수량 20개 변경, 예산 없음 및 상품 제외 검증', async () => {
  // 1. 전체 예산 500,001원 / 수량 10개로 초안 생성
  const totalReq = new Request('http://127.0.0.1:3000/api/approval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3000' },
    body: JSON.stringify({
      query: { event: 'wedding', relation: 'senior', budgetMode: 'total', totalBudget: 500001, qty: 10, exclude: [] },
    }),
  });
  const totalRes = await createDraftRoute(totalReq);
  assert.equal(totalRes.status, 200);
  const totalJson = await totalRes.json();
  const draftId1 = totalJson.id;
  const token1 = totalJson.token;

  // 원래 전체 예산 원본 보존 확인
  assert.equal(totalJson.draft.source.originalTotalBudget, 500001);
  assert.equal(totalJson.draft.source.budgetMode, 'total');

  // 2. 수량을 20개로 변경하여 저장
  const patchQty20 = new Request(`http://127.0.0.1:3000/api/approval/${draftId1}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:3000',
      'X-Approval-Token': token1,
    },
    body: JSON.stringify({
      patch: { quantity: 20 },
      expectedRevision: 1,
    }),
  });
  const patchQtyRes = await patchDraftRoute(patchQty20, { params: Promise.resolve({ id: draftId1 }) });
  assert.equal(patchQtyRes.status, 200);
  const patchQtyJson = await patchQtyRes.json();
  assert.equal(patchQtyJson.draft.editable.quantity, 20);
  // 원래 입력된 전체 예산 원본(500,001원)은 그대로 보존되어야 함
  assert.equal(patchQtyJson.draft.source.originalTotalBudget, 500001);

  // 3. 예산 없음(none) 초안 생성
  const noBudgetReq = new Request('http://127.0.0.1:3000/api/approval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3000' },
    body: JSON.stringify({
      query: { event: 'wedding', relation: 'senior', budgetMode: 'none', qty: 10, exclude: [] },
    }),
  });
  const noBudgetRes = await createDraftRoute(noBudgetReq);
  assert.equal(noBudgetRes.status, 200);
  const noBudgetJson = await noBudgetRes.json();
  const draftId2 = noBudgetJson.id;
  assert.equal(noBudgetJson.draft.source.budgetMode, 'none');
  assert.equal(noBudgetJson.model.budgetStatus, '예산 미설정 (상품비 기준 검토)');

  // 4. 상품 제외(exclude) 초안 생성
  const firstPNo = totalJson.draft.source.candidates[0].productNo;
  const excludeReq = new Request('http://127.0.0.1:3000/api/approval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3000' },
    body: JSON.stringify({
      query: { event: 'wedding', relation: 'senior', qty: 10, exclude: [firstPNo] },
    }),
  });
  const excludeRes = await createDraftRoute(excludeReq);
  assert.equal(excludeRes.status, 200);
  const excludeJson = await excludeRes.json();
  const draftId3 = excludeJson.id;
  // 제외된 상품이 추천 후보에 없어야 함
  assert.ok(!excludeJson.draft.source.candidates.some((c: any) => c.productNo === firstPNo));

  // 정리
  await deleteDraft(draftId1);
  await deleteDraft(draftId2);
  await deleteDraft(draftId3);
});

test('DELETE /api/approval/[id]: 초안 삭제 후 조회 차단', async () => {
  const delReq = new Request(`http://127.0.0.1:3000/api/approval/${createdId}`, {
    method: 'DELETE',
    headers: {
      Origin: 'http://127.0.0.1:3000',
      'X-Approval-Token': createdToken,
    },
  });
  const delRes = await deleteDraftRoute(delReq, { params: Promise.resolve({ id: createdId }) });
  assert.equal(delRes.status, 204);

  // 삭제 후 조회 시 404
  const getReq = new Request(`http://127.0.0.1:3000/api/approval/${createdId}`, {
    headers: {
      Origin: 'http://127.0.0.1:3000',
      'X-Approval-Token': createdToken,
    },
  });
  const getRes = await getDraftRoute(getReq, { params: Promise.resolve({ id: createdId }) });
  assert.equal(getRes.status, 404);
  createdId = ''; // 정리 완료
});

test('new request preserves multiple exclusions and rejects stale score snapshots and invalid totals', async () => {
  const { recommendForCustomer } = await import('../src/recommendation/server.ts');
  const base = { event: 'wedding', relation: 'senior', quantity: 10, budget: { mode: 'none' }, excludedProductNos: [] } as const;
  const initial = await recommendForCustomer({ ...base, excludedProductNos: [] });
  assert.ok(initial.ok);
  const excluded = initial.data.items.slice(0, 2).map(item => item.productNo);
  const request = { ...base, excludedProductNos: excluded };
  const expected = await recommendForCustomer(request);
  assert.ok(expected.ok);
  const send = (body: unknown) => createDraftRoute(new Request('http://127.0.0.1:3000/api/approval', { method: 'POST', headers: { Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  const changed = structuredClone(expected.data); changed.items[0].recommendationScore -= 1;
  assert.equal((await send({ request, expectedResponse: changed })).status, 409);
  const response = await send({ request, expectedResponse: expected.data });
  assert.equal(response.status, 200);
  const created = await response.json();
  try {
    assert.deepEqual(created.draft.source.query.exclude, excluded);
    assert.ok(created.draft.source.candidates.every((item: {productNo: number}) => !excluded.includes(item.productNo)));
    assert.equal(created.draft.source.candidates[0].recommendationScore, expected.data.items[0].recommendationScore);
  } finally { await deleteDraft(created.id); }
  assert.equal((await send({ query: { event: 'wedding', relation: 'senior', qty: 10, budgetMode: 'total', budget: 50000, exclude: [] } })).status, 400);
});
