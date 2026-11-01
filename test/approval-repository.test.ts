import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDraft,
  saveDraft,
  updateDraftEditable,
  deleteDraft,
  RevisionConflictError,
  isValidUUID,
} from '../src/data/approval-repository.ts';
import type { ApprovalDraft } from '../src/approval/types.ts';

const testId = '11111111-2222-4333-8444-555555555555';

after(async () => {
  await deleteDraft(testId).catch(() => {});
});

test('UUID 검증', () => {
  assert.equal(isValidUUID(testId), true);
  assert.equal(isValidUUID('invalid-uuid'), false);
  assert.equal(isValidUUID('../../../etc/passwd'), false);
});

test('동시 저장 직렬화: 두 탭이 동시에 같은 개정번호로 저장 시도 시 하나만 성공하고 다른 하나는 개정 충돌 에러', async () => {
  const concurrentDraftId = '22222222-3333-4444-8555-666666666666';
  const initial: ApprovalDraft = {
    schemaVersion: 1,
    id: concurrentDraftId,
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: {
      query: { event: 'wedding', relation: 'senior', budget: 50000, qty: 10, exclude: [] },
      originalTotalBudget: null,
      modelVersion: 'v1',
      catalogSyncedAt: new Date().toISOString(),
      snapshotAt: new Date().toISOString(),
      candidates: [],
    },
    editable: {
      eventName: '초기 문서',
      eventDate: null,
      organization: '',
      department: '',
      author: '',
      purpose: '',
      quantity: 10,
      selectedProductNo: 1,
      additionalNote: '',
      approverTitles: ['담당'],
      internalPerPersonLimit: null,
      internalRuleMemo: '',
    },
  };

  await saveDraft(initial);

  // expectedRevision: 1 로 동시에 2개의 요청을 보냄
  const results = await Promise.allSettled([
    updateDraftEditable(concurrentDraftId, { eventName: '탭 1에서 수정' }, 1),
    updateDraftEditable(concurrentDraftId, { eventName: '탭 2에서 수정' }, 1),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, '정확히 1개의 요청만 성공해야 함');
  assert.equal(rejected.length, 1, '정확히 1개의 요청은 충돌로 거부되어야 함');

  const conflictErr = (rejected[0] as PromiseRejectedResult).reason;
  assert.ok(conflictErr instanceof RevisionConflictError);
  assert.equal(conflictErr.currentRevision, 2);

  // 최종 저장된 문서는 revision 2여야 함
  const finalDraft = await getDraft(concurrentDraftId);
  assert.equal(finalDraft?.revision, 2);

  await deleteDraft(concurrentDraftId);
});

test('저장소 CRUD 및 개정번호 원자적 증가', async () => {
  const dummyDraft: ApprovalDraft = {
    schemaVersion: 1,
    id: testId,
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: {
      query: { event: 'wedding', relation: 'senior', budget: 50000, qty: 10, exclude: [] },
      budgetMode: 'per_item',
      originalTotalBudget: null,
      modelVersion: '2026.10',
      catalogSyncedAt: new Date().toISOString(),
      snapshotAt: new Date().toISOString(),
      candidates: [
        {
          rank: 1,
          productNo: 101,
          productName: '테스트 상품',
          price: 30000,
          imageUrl: '',
          tier: '격식',
          matchScore: 90,
          reason: '좋은 상품',
          region: '담양',
          category: '식품',
          isDepopulationArea: false,
        },
      ],
    },
    editable: {
      eventName: '초기 행사명',
      eventDate: '2026-11-20',
      organization: '소속',
      department: '부서',
      author: '작성자',
      purpose: '목적',
      quantity: 10,
      selectedProductNo: 101,
      additionalNote: '',
      approverTitles: ['담당', '팀장', '과장'],
      internalPerPersonLimit: null,
      internalRuleMemo: '',
    },
  };

  // 1. 생성
  const saved = await saveDraft(dummyDraft);
  assert.equal(saved.revision, 1);

  // 2. 조회
  const fetched = await getDraft(testId);
  assert.ok(fetched);
  assert.equal(fetched.editable.eventName, '초기 행사명');
  assert.equal(fetched.revision, 1);

  // 3. 정상 수정 (expectedRevision: 1)
  const updated = await updateDraftEditable(testId, { eventName: '수정된 행사명' }, 1);
  assert.equal(updated.revision, 2);
  assert.equal(updated.editable.eventName, '수정된 행사명');

  // 4. 개정 충돌 검증 (expectedRevision: 1 -> 현재는 2이므로 충돌 발생)
  await assert.rejects(
    async () => {
      await updateDraftEditable(testId, { eventName: '충돌 시도' }, 1);
    },
    (err: unknown) => {
      return err instanceof RevisionConflictError && err.currentRevision === 2;
    },
  );

  // 5. 삭제
  const deleted = await deleteDraft(testId);
  assert.equal(deleted, true);

  // 6. 삭제 후 조회 불가
  const notFound = await getDraft(testId);
  assert.equal(notFound, null);
});
