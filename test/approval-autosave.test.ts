import test from 'node:test';
import assert from 'node:assert/strict';
import { createApprovalAutosave } from '../src/approval/autosave.ts';
import type { ApprovalDraft, ApprovalDraftEditable } from '../src/approval/types.ts';

const initial = (): ApprovalDraft => ({
  schemaVersion: 1, id: '22222222-3333-4444-8555-666666666666', revision: 1, createdAt: '', updatedAt: '',
  source: { query: { event: 'wedding', relation: 'business', budget: 50000, qty: 10, exclude: [] }, originalTotalBudget: null, modelVersion: 'v2', catalogSyncedAt: '', snapshotAt: '', candidates: [] },
  editable: { eventName: '초기 문서', eventDate: null, organization: '', department: '', author: '', purpose: '', quantity: 10, selectedProductNo: 1, additionalNote: '', approverTitles: [], internalPerPersonLimit: null, internalRuleMemo: '' },
});

test('approval autosave keeps later edits and serializes revisions; flush waits for all pending saves', async () => {
  let stored = initial();
  let shown = stored;
  let release!: () => void;
  const first = new Promise<void>(resolve => { release = resolve; });
  const revisions: number[] = [];
  const states: string[] = [];
  const queue = createApprovalAutosave(stored, async (patch, revision) => {
    revisions.push(revision);
    if (revisions.length === 1) await first;
    assert.equal(revision, stored.revision);
    stored = { ...stored, revision: revision + 1, editable: { ...stored.editable, ...patch } };
    return stored;
  }, draft => { shown = draft; }, state => states.push(state));
  queue.edit({ quantity: 20 });
  const waiting = queue.flush();
  queue.edit({ quantity: 30, author: '추가 입력' });
  assert.equal(queue.flush(), waiting);
  release();
  assert.equal(await waiting, true);
  assert.deepEqual(revisions, [1, 2]);
  assert.equal(shown.editable.quantity, 30);
  assert.equal(stored.editable.author, '추가 입력');
  assert.equal(queue.dirty(), false);
  assert.equal(states.at(-1), 'saved');
});

test('approval autosave stops on failure, preserves edits and retries only when requested', async () => {
  let calls = 0;
  let savedPatch: Partial<ApprovalDraftEditable> | null = null;
  const queue = createApprovalAutosave(initial(), async patch => {
    calls++;
    if (calls === 1) throw new Error('offline');
    savedPatch = patch;
    return { ...initial(), revision: 2, editable: { ...initial().editable, ...patch } };
  }, () => {}, () => {});
  queue.edit({ author: '실패해도 보존' });
  assert.equal(await queue.flush(), false);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(queue.dirty(), true);
  queue.edit({ quantity: 25 });
  assert.equal(await queue.flush(), true);
  assert.deepEqual(savedPatch, { author: '실패해도 보존', quantity: 25 });
});

test('approval autosave blocks download readiness after revision conflict and keeps the draft', async () => {
  let calls = 0;
  let shown = initial();
  let state = '';
  const queue = createApprovalAutosave(shown, async () => {
    calls++;
    const error = new Error('conflict'); error.name = 'RevisionConflictError'; throw error;
  }, draft => { shown = draft; }, next => { state = next; });
  queue.edit({ author: '내 작성 내용' });
  assert.equal(await queue.flush(), false);
  assert.equal(state, 'conflict');
  assert.equal(shown.editable.author, '내 작성 내용');
  assert.equal(await queue.flush(), false);
  assert.equal(calls, 1);
  assert.equal(queue.dirty(), true);
});
