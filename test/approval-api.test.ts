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

before(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
  process.env.ONDAP_DATA_SOURCE = 'local';
});

after(async () => {
  if (createdId) {
    await deleteDraft(createdId).catch(() => {});
  }
});

test('API 보안: development가 아니거나 supabase 모드이면 404 차단', async () => {
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

test('POST /api/approval: 정상 초안 생성 및 기대값 변경 감지', async () => {
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
  const json = await res.json();
  assert.ok(json.id);
  assert.equal(json.draft.revision, 1);
  assert.ok(json.model);
  createdId = json.id;
});

test('GET /api/approval/[id]: 초안 및 계산 모델 정상 조회', async () => {
  const req = new Request(`http://127.0.0.1:3000/api/approval/${createdId}`, {
    headers: { Origin: 'http://127.0.0.1:3000' },
  });
  const res = await getDraftRoute(req, { params: Promise.resolve({ id: createdId }) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.draft.id, createdId);
  assert.ok(data.model.summaryClipboardText);
});

test('PATCH /api/approval/[id]: 입력 검증 및 개정 충돌 처리', async () => {
  // 1. 잘못된 수량 (소수, 음수) 거부
  const invalidQtyReq = new Request(`http://127.0.0.1:3000/api/approval/${createdId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3000' },
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
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3000' },
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
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3000' },
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
  // HWPX
  const hwpxReq = new Request(`http://127.0.0.1:3000/api/approval/${createdId}/hwpx`, {
    headers: { Origin: 'http://127.0.0.1:3000' },
  });
  const hwpxRes = await getHwpxRoute(hwpxReq, { params: Promise.resolve({ id: createdId }) });
  assert.equal(hwpxRes.status, 200);
  assert.equal(hwpxRes.headers.get('Content-Type'), 'application/hwp+zip');
  assert.match(decodeURIComponent(hwpxRes.headers.get('Content-Disposition') || ''), /답례품_선정검토서.*\.hwpx/);

  // DOCX
  const docxReq = new Request(`http://127.0.0.1:3000/api/approval/${createdId}/docx`, {
    headers: { Origin: 'http://127.0.0.1:3000' },
  });
  const docxRes = await getDocxRoute(docxReq, { params: Promise.resolve({ id: createdId }) });
  assert.equal(docxRes.status, 200);
  assert.equal(docxRes.headers.get('Content-Type'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.match(decodeURIComponent(docxRes.headers.get('Content-Disposition') || ''), /답례품_선정검토서/);

  // PDF
  const pdfReq = new Request(`http://127.0.0.1:3000/api/approval/${createdId}/pdf`, {
    headers: { Origin: 'http://127.0.0.1:3000' },
  });
  const pdfRes = await getPdfRoute(pdfReq, { params: Promise.resolve({ id: createdId }) });
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers.get('Content-Type'), 'application/pdf');
  assert.match(decodeURIComponent(pdfRes.headers.get('Content-Disposition') || ''), /답례품_선정검토서/);
});

test('DELETE /api/approval/[id]: 초안 삭제 후 조회 차단', async () => {
  const delReq = new Request(`http://127.0.0.1:3000/api/approval/${createdId}`, {
    method: 'DELETE',
    headers: { Origin: 'http://127.0.0.1:3000' },
  });
  const delRes = await deleteDraftRoute(delReq, { params: Promise.resolve({ id: createdId }) });
  assert.equal(delRes.status, 204);

  // 삭제 후 조회 시 404
  const getReq = new Request(`http://127.0.0.1:3000/api/approval/${createdId}`, {
    headers: { Origin: 'http://127.0.0.1:3000' },
  });
  const getRes = await getDraftRoute(getReq, { params: Promise.resolve({ id: createdId }) });
  assert.equal(getRes.status, 404);
  createdId = ''; // 정리 완료
});
