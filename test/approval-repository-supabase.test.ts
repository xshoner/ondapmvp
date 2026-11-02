import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  saveDraft,
  getDraft,
  updateDraftEditable,
  deleteDraft,
  setApprovalServiceClientForTest,
  RevisionConflictError,
} from '../src/data/approval-repository.ts';
import type { ApprovalDraft } from '../src/approval/types.ts';

// Query-level mock fixture for Supabase approval_drafts table
function createSupabaseApprovalFixture() {
  type Row = {
    id: string;
    revision: number;
    creator_token_hash: string;
    data: any;
    created_at: string;
    updated_at: string;
  };

  const table: Row[] = [];

  function client(): SupabaseClient {
    return {
      from(tableName: string) {
        if (tableName !== 'approval_drafts') throw new Error(`Unknown table: ${tableName}`);

        let op = 'select';
        let payload: any = {};
        const filters: [string, any][] = [];
        let selectColumns = '*';
        let single = false;

        const q = {
          select(cols: string) {
            selectColumns = cols;
            return q;
          },
          eq(column: string, value: any) {
            filters.push([column, value]);
            return q;
          },
          insert(row: any) {
            op = 'insert';
            payload = row;
            return q;
          },
          update(row: any) {
            op = 'update';
            payload = row;
            return q;
          },
          delete() {
            op = 'delete';
            return q;
          },
          maybeSingle() {
            single = true;
            return q;
          },
          single() {
            single = true;
            return q;
          },
          then(resolve: (result: { data: any; error: any }) => any) {
            const matches = (r: Row) => filters.every(([col, val]) => r[col as keyof Row] === val);

            if (op === 'select') {
              const matched = table.filter(matches);
              const result = single ? (matched[0] ?? null) : matched;
              return Promise.resolve(resolve({ data: result, error: null }));
            }

            if (op === 'insert') {
              const exists = table.some((r) => r.id === payload.id);
              if (exists) {
                return Promise.resolve(resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }));
              }
              const row: Row = {
                id: payload.id,
                revision: payload.revision,
                creator_token_hash: payload.creator_token_hash,
                data: payload.data,
                created_at: payload.created_at || new Date().toISOString(),
                updated_at: payload.updated_at || new Date().toISOString(),
              };
              table.push(row);
              return Promise.resolve(resolve({ data: single ? row : [row], error: null }));
            }

            if (op === 'update') {
              const matched = table.filter(matches);
              if (matched.length === 0) {
                // 0 rows updated (e.g. revision mismatch)
                return Promise.resolve(resolve({ data: null, error: null }));
              }
              for (const r of matched) {
                Object.assign(r, payload);
              }
              return Promise.resolve(resolve({ data: single ? matched[0] : matched, error: null }));
            }

            if (op === 'delete') {
              const idx = table.findIndex(matches);
              if (idx >= 0) {
                const deleted = table.splice(idx, 1)[0];
                return Promise.resolve(resolve({ data: single ? deleted : [deleted], error: null }));
              }
              return Promise.resolve(resolve({ data: null, error: null }));
            }

            return Promise.resolve(resolve({ data: null, error: null }));
          },
        };
        return q;
      },
      storage: {
        from(_bucket: string) {
          return {
            list: async () => ({ data: [], error: null }),
            remove: async () => ({ data: [], error: null }),
            upload: async () => ({ data: null, error: null }),
            download: async () => ({ data: null, error: null }),
          };
        },
      },
    } as unknown as SupabaseClient;
  }

  return { client, table };
}

test('Supabase 모드 approval-repository: 생성, 조건부 개정 갱신, 동시 수정 충돌 차단 검증', async () => {
  const fixture = createSupabaseApprovalFixture();
  const mockServiceClient = fixture.client();
  setApprovalServiceClientForTest(mockServiceClient);

  const originalSource = process.env.ONDAP_DATA_SOURCE;
  process.env.ONDAP_DATA_SOURCE = 'supabase';

  try {
    const testId = '11111111-2222-4333-8444-555555555555';
    const draft: ApprovalDraft = {
      schemaVersion: 1,
      id: testId,
      revision: 1,
      createdAt: '2026-11-02T00:00:00.000Z',
      updatedAt: '2026-11-02T00:00:00.000Z',
      creatorTokenHash: 'a'.repeat(64),
      source: {
        query: { event: 'wedding', relation: 'senior', budget: 50000, qty: 10, exclude: [] },
        budgetMode: 'per_item',
        originalTotalBudget: null,
        modelVersion: 'core-contract-v1',
        catalogSyncedAt: '2026-11-02T00:00:00.000Z',
        snapshotAt: '2026-11-02T00:00:00.000Z',
        candidates: [],
      },
      editable: {
        eventName: '결혼식 답례품',
        eventDate: null,
        organization: '온답',
        department: '기획팀',
        author: '홍길동',
        purpose: '감사 답례품',
        quantity: 10,
        selectedProductNo: 101,
        additionalNote: '',
        approverTitles: ['담당', '팀장'],
        internalPerPersonLimit: null,
        internalRuleMemo: '',
      },
    };

    // 1. 새 초안 DB 생성
    const created = await saveDraft(draft);
    assert.equal(created.revision, 1);
    assert.equal(fixture.table.length, 1);
    assert.equal(fixture.table[0].revision, 1);

    // 2. 조회 검증
    const fetched = await getDraft(testId);
    assert.ok(fetched);
    assert.equal(fetched.id, testId);
    assert.equal(fetched.revision, 1);
    assert.equal(fetched.creatorTokenHash, 'a'.repeat(64));

    // 3. 정상 수정 (r1 -> r2)
    const updated = await updateDraftEditable(testId, { eventName: '수정된 결혼식' }, 1);
    assert.equal(updated.revision, 2);
    assert.equal(fixture.table[0].revision, 2);
    assert.equal(fixture.table[0].data.editable.eventName, '수정된 결혼식');

    // 4. 동시 수정 충돌: 두 프로세스가 동시에 r2를 대상으로 수정 시도
    // 첫 번째 수정 (r2 -> r3) 성공
    const updated2 = await updateDraftEditable(testId, { quantity: 20 }, 2);
    assert.equal(updated2.revision, 3);
    assert.equal(fixture.table[0].revision, 3);

    // 두 번째 수정 (지연 도착하여 expectedRevision: 2로 제출) -> RevisionConflictError 발생 및 DB 갱신 차단
    await assert.rejects(
      async () => {
        await updateDraftEditable(testId, { quantity: 30 }, 2);
      },
      (err: any) => {
        assert.ok(err instanceof RevisionConflictError);
        assert.equal(err.currentRevision, 3);
        return true;
      },
    );

    // DB의 데이터는 첫 번째 프로세스의 내용(quantity: 20, r3)으로 보존됨
    assert.equal(fixture.table[0].revision, 3);
    assert.equal(fixture.table[0].data.editable.quantity, 20);

    // 5. 초안 삭제
    const deleted = await deleteDraft(testId);
    assert.equal(deleted, true);
    assert.equal(fixture.table.length, 0);

    // 삭제 후 조회 시 null
    const notFound = await getDraft(testId);
    assert.equal(notFound, null);
  } finally {
    process.env.ONDAP_DATA_SOURCE = originalSource;
    setApprovalServiceClientForTest(null);
  }
});
