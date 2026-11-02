import type { ApprovalDraft, ApprovalDraftEditable } from './types.ts';

export type SaveStatus = 'saving' | 'saved' | 'error' | 'conflict';

export function createApprovalAutosave(
  initial: ApprovalDraft,
  save: (patch: Partial<ApprovalDraftEditable>, revision: number) => Promise<ApprovalDraft>,
  changed: (draft: ApprovalDraft) => void,
  status: (state: SaveStatus, message: string | null) => void,
) {
  let draft = initial;
  let pending: Partial<ApprovalDraftEditable> | null = null;
  let running: Promise<boolean> | null = null;
  let conflict = false;
  const queued = (): Partial<ApprovalDraftEditable> | null => pending;
  async function drain(): Promise<boolean> {
    while (pending) {
      const patch = pending;
      pending = null;
      status('saving', null);
      try {
        const saved = await save(patch, draft.revision);
        draft = { ...saved, editable: { ...saved.editable, ...queued() } };
        changed(draft);
      } catch (error) {
        pending = { ...patch, ...queued() };
        conflict = error instanceof Error && error.name === 'RevisionConflictError';
        status(conflict ? 'conflict' : 'error', conflict
          ? '다른 곳에서 문서가 변경되었습니다. 작성한 내용은 유지됩니다. 최신 내용을 확인해 주세요.'
          : '저장하지 못했습니다. 작성한 내용은 유지됩니다. 다시 시도해 주세요.');
        return false;
      }
    }
    status('saved', null);
    return true;
  }
  return {
    edit(patch: Partial<ApprovalDraftEditable>) {
      pending = { ...pending, ...patch };
      draft = { ...draft, editable: { ...draft.editable, ...patch } };
      changed(draft);
      if (!conflict) status('saving', null);
    },
    dirty: () => pending !== null || running !== null,
    flush(): Promise<boolean> {
      if (conflict) return Promise.resolve(false);
      if (!running) running = drain().finally(() => { running = null; });
      return running;
    },
  };
}
